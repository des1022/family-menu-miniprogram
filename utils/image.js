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
 * 上传菜品图片到云存储
 * @param {string} filePath 本地临时路径
 * @returns {Promise<string>} 云文件 ID（cloud://...）
 */
async function uploadDishImage(filePath) {
  const { initCloud } = require('./cloud.js')
  initCloud()
  const compressed = await compressImage(filePath)
  const cloudPath = `${config.DISH_IMAGE_DIR}${Date.now()}-${randomStr(8)}.jpg`
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

module.exports = {
  compressImage,
  uploadDishImage,
  deleteDishImage,
  chooseImage
}
