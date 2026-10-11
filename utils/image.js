const config = require('./config.js')
const { randomStr } = require('./util.js')

/**
 * 图片压缩 + 云存储上传
 * 压缩策略：先把宽度缩到 800px 以内，再按质量逐级下调，直到单张 <= 200KB
 */

const fs = wx.getFileSystemManager()

function getFileSize(path) {
  return new Promise((resolve, reject) => {
    fs.getFileInfo({
      filePath: path,
      success: res => resolve(res.size),
      fail: reject
    })
  })
}

/** 读取图片原始宽高 */
function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 原生压缩接口（基础库 2.26.0+）
 * @param {number} width 目标宽度，传 0 表示不缩放（避免小图被放大）
 */
function nativeCompress(src, quality, width) {
  return new Promise(resolve => {
    if (typeof wx.compressImage !== 'function') return resolve(src)
    const params = { src, quality }
    if (width > 0) params.compressedWidth = width
    wx.compressImage(Object.assign(params, {
      success: res => resolve(res.tempFilePath || src),
      fail: err => {
        console.warn('[image] 原生压缩失败，改用画布压缩', err)
        resolve(src)
      }
    }))
  })
}

/** 画布压缩：按 800px 宽度重绘（兼容较老基础库） */
function canvasCompress(src) {
  return new Promise((resolve, reject) => {
    if (typeof wx.createOffscreenCanvas !== 'function') return resolve(src)
    wx.getImageInfo({
      src,
      success: info => {
        const maxW = config.MAX_IMAGE_WIDTH
        let w = info.width
        let h = info.height
        if (w > maxW) {
          h = Math.round((h * maxW) / w)
          w = maxW
        }
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
        const ctx = canvas.getContext('2d')
        const img = canvas.createImage()
        img.onload = () => {
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0, width: w, height: h,
            destWidth: w, destHeight: h,
            fileType: 'jpg',
            quality: 0.85,
            success: res => resolve(res.tempFilePath),
            fail: reject
          })
        }
        img.onerror = reject
        img.src = info.path || src
      },
      fail: reject
    })
  })
}

/**
 * 压缩到目标体积以内
 * @param {string} src 本地临时路径
 * @returns {Promise<string>} 压缩后的本地路径
 */
async function compressImage(src) {
  let path = src

  // 只在原图超过 800px 时才缩放，小图保持原尺寸，避免被放大失真
  let targetWidth = 0
  try {
    const info = await getImageInfo(src)
    if (info.width > config.MAX_IMAGE_WIDTH) targetWidth = config.MAX_IMAGE_WIDTH
  } catch (e) {
    targetWidth = config.MAX_IMAGE_WIDTH
  }

  // 1) 限制宽度（优先原生接口，失败回退画布）
  path = await nativeCompress(path, 85, targetWidth)
  let size = await getFileSize(path)
  if (size > config.MAX_IMAGE_SIZE) {
    try {
      const canvasPath = await canvasCompress(path)
      if (canvasPath && canvasPath !== path) {
        const canvasSize = await getFileSize(canvasPath)
        if (canvasSize < size) {
          path = canvasPath
          size = canvasSize
        }
      }
    } catch (e) {
      console.warn('[image] 画布压缩不可用', e)
    }
  }

  // 2) 仍超体积则逐级降低质量
  const qualities = [80, 70, 60, 50, 40, 30, 20]
  for (let i = 0; i < qualities.length; i++) {
    if (size <= config.MAX_IMAGE_SIZE) break
    // 降质量阶段不再重复缩放
    const next = await nativeCompress(path, qualities[i], 0)
    if (!next || next === path) break
    const nextSize = await getFileSize(next)
    if (nextSize < size) {
      path = next
      size = nextSize
    }
  }

  console.log('[image] 压缩完成，大小约', Math.round(size / 1024), 'KB')
  return path
}

/**
 * 按文件头判断真实图片类型。
 *
 * 原来 cloudPath 一律写死 `.jpg`，但压缩后未必真是 jpg（原图是 png 时
 * wx.compressImage / 画布都可能原样返回 png）——扩展名和内容不符的话，
 * CDN 回来的 Content-Type 会对不上，图就有可能加载不出来。
 * @returns {'jpg'|'png'|'gif'|'webp'}
 */
function extOf(filePath) {
  try {
    // 不传 encoding 时 readFileSync 返回 ArrayBuffer
    const buf = wx.getFileSystemManager().readFileSync(filePath)
    const b = new Uint8Array(buf)
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg'
    if (b[0] === 0x89 && b[1] === 0x50) return 'png'
    if (b[0] === 0x47 && b[1] === 0x49) return 'gif'
    if (b[8] === 0x57 && b[9] === 0x45) return 'webp'
  } catch (e) {
    console.warn('[image] 读文件头失败，按 jpg 处理', e)
  }
  return 'jpg'
}

/**
 * 上传菜品图片到云存储
 * @param {string} filePath 本地临时路径
 * @returns {Promise<string>} 云文件 ID（cloud://...）
 */
async function uploadDishImage(filePath) {
  const { initCloud } = require('./cloud.js')
  initCloud()
  const compressed = await compressImage(filePath)
  const ext = extOf(compressed)
  const cloudPath = `${config.DISH_IMAGE_DIR}${Date.now()}-${randomStr(8)}.${ext}`
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: compressed })
  return res.fileID
}

/** 删除云存储中的菜品图片 */
async function deleteDishImage(fileID) {
  if (!fileID || String(fileID).indexOf('cloud://') !== 0) return
  try {
    await wx.cloud.deleteFile({ fileList: [fileID] })
  } catch (e) {
    console.warn('[image] 云存储图片删除失败（可忽略）', e)
  }
}

/** 选择图片（相册/拍照） */
function chooseImage(count = 1) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: res => resolve(res.tempFiles.map(f => f.tempFilePath)),
      fail: reject
    })
  })
}

/**
 * 用云文件 ID 换一条临时链接。
 *
 * 场景：`<image src="cloud://...">` 是官方支持的，但它遵循云存储的权限配置；
 * 有些情况下 fileID 直连读不到（文件级权限不是「所有用户可读」等），
 * 这时用临时链接往往还能拿到 —— 所以图片加载失败时再试一次这条路。
 * @returns {Promise<string>} 失败返回空串
 */
async function tempUrlOf(fileID) {
  if (!fileID || String(fileID).indexOf('cloud://') !== 0) return ''
  try {
    const { initCloud } = require('./cloud.js')
    initCloud()
    const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })
    const f = (res.fileList || [])[0]
    if (f && f.tempFileURL) return f.tempFileURL
    console.warn('[image] 临时链接为空', f && f.errMsg)
    return ''
  } catch (e) {
    console.warn('[image] 取临时链接失败', e)
    return ''
  }
}

/**
 * 批量把云存储 fileID 换成可以直接显示的临时链接。
 *
 * 为什么必须绕云函数：这个环境的存储桶权限是「仅创建者及管理员可读写」，
 * 而这里的「管理员」指的是**云后台 / 服务端**，不是小程序里的某个用户
 * （官方原文：「云后台和服务端始终有所有文件读写权限，安全规则的配置仅对
 * 客户端（小程序端、Web 等）发起的请求有效」）。所以 A 账号传的菜图，
 * B 账号在客户端既读不到 fileID、也拿不到 getTempFileURL —— 上面那个
 * tempUrlOf 在本环境里其实是换不到的。
 * 云函数跑在服务端、有管理员权限，让它去换才拿得到（见 cloudfunctions/img-url）。
 *
 * 容错：任何一步失败都返回空对象，调用方退回原始 fileID（也就是老行为），
 * 不会因为云函数没部署就把图片全弄没。
 *
 * @param {string[]} fileIDs
 * @returns {Promise<Object>} { [fileID]: url }
 */
async function resolveCloudImages(fileIDs) {
  const uniq = []
  ;(fileIDs || []).forEach(id => {
    if (typeof id === 'string' && id.indexOf('cloud://') === 0 && uniq.indexOf(id) < 0) uniq.push(id)
  })
  if (!uniq.length) return {}

  const { initCloud } = require('./cloud.js')
  initCloud()

  try {
    const res = await wx.cloud.callFunction({
      name: 'img-url',
      data: { fileIDs: uniq.slice(0, 50) }
    })
    const urls = (res && res.result && res.result.urls) || {}
    if (!Object.keys(urls).length) console.warn('[image] 云函数没换到链接', res && res.result)
    return urls
  } catch (e) {
    console.warn('[image] 云函数换链接失败（云函数没部署时会走到这里）', e)
    return {}
  }
}

module.exports = {
  compressImage,
  uploadDishImage,
  deleteDishImage,
  chooseImage,
  tempUrlOf,
  resolveCloudImages
}
