/**
 * img-url —— 把云存储的 fileID 换成可以直接显示的临时链接。
 *
 * 为什么需要它：
 *   这个环境的云存储桶权限是「仅创建者及管理员可读写」（私有的），
 *   而「管理员」指的是**云后台/服务端**，不是小程序里的某个用户。
 *   所以 A 传的菜品图，B 打开只能看到首字占位块 —— 客户端直接读 fileID
 *   会被权限拦掉，`getTempFileURL` 也一样会被拦。
 *
 *   但**云函数跑在服务端，天生有管理员权限**（官方原文：「云后台和服务端
 *   始终有所有文件读写权限」）。所以让云函数去换链接，就能在不改存储权限、
 *   不额外花钱的前提下，让全家人都看到同一张图。
 *
 * 约定：
 *   入参 { fileIDs: string[] }        —— 只认 cloud:// 开头的，其它原样忽略
 *   返回 { urls: { fileID: url } }    —— 拿不到的不会出现在 urls 里
 *
 * 调用方（小程序端）拿到 urls 后把 <image src> 换成对应链接即可；
 * 临时链接有效期约 2 小时，所以每次进页面重新解析一次就行。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// getTempFileURL 单次最多 50 个，和官方限制保持一致
const MAX_FILES = 50

exports.main = async event => {
  const list = (event && event.fileIDs) || []
  if (!Array.isArray(list) || !list.length) return { urls: {} }

  const ids = list
    .filter(id => typeof id === 'string' && id.indexOf('cloud://') === 0)
    .slice(0, MAX_FILES)

  if (!ids.length) return { urls: {} }

  try {
    const res = await cloud.getTempFileURL({ fileList: ids })
    const urls = {}
    ;(res.fileList || []).forEach(f => {
      if (f && f.tempFileURL) urls[f.fileID] = f.tempFileURL
    })
    return { urls: urls }
  } catch (e) {
    console.error('[img-url] 换链接失败', e)
    return { urls: {}, error: (e && e.message) || String(e) }
  }
}
