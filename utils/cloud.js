const config = require('./config.js')

/**
 * 云开发初始化与集合访问封装
 */
let inited = false

function initCloud() {
  if (inited) return true
  if (typeof wx.cloud === 'undefined') {
    console.warn('[cloud] 当前环境不支持云开发，请在真机/开发者工具中使用')
    return false
  }
  try {
    wx.cloud.init({
      env: config.ENV_ID,
      traceUser: true
    })
    inited = true
    return true
  } catch (e) {
    console.error('[cloud] 初始化失败，请检查 utils/config.js 中的 ENV_ID', e)
    return false
  }
}

/** 获取数据库实例（会自动初始化云环境） */
function db() {
  initCloud()
  return wx.cloud.database()
}

/** 集合名常量 */
const COLLECTIONS = {
  DISHES: 'dishes',
  RECORDS: 'records',
  CATEGORIES: 'categories',
  MEMBERS: 'members',      // 家庭成员：一条记录 = 一位家人（_openid 由云端自动写入）
  SHOPPING: 'shopping'     // 采购清单：一条记录 = 一个要买的东西
}

/**
 * 小程序端单次 get 的硬上限：20 条（云函数里才是 100）。
 * 写死在这里，别依赖调用方传的值。
 */
const CLIENT_PAGE_MAX = 20

/**
 * 分页拉取集合全部数据。
 *
 * 这里踩过一个很贵的坑：以前 PAGE_SIZE 写成 100，`limit(100)` 在客户端会被
 * 悄悄截成 20 条，而下面的判断是「返回条数 < 请求条数就认为拉完了」——
 * 于是第一页 20 条就 break，菜库永远只显示 20 道（2026-11-05 反馈）。
 * 现在两处都堵上：请求条数按 20 夹紧，翻页按**实际返回条数**推进。
 */
async function fetchAll(collFn, orderFn) {
  const size = Math.min(Number(config.PAGE_SIZE) || CLIENT_PAGE_MAX, CLIENT_PAGE_MAX)
  let all = []
  let skip = 0
  for (let guard = 0; guard < 200; guard++) {
    let query = collFn()
    if (orderFn) query = orderFn(query)
    const res = await query.skip(skip).limit(size).get()
    const list = res.data || []
    all = all.concat(list)
    if (!list.length || list.length < size) break
    skip += list.length
  }
  return all
}

module.exports = {
  initCloud: initCloud,
  db: db,
  COLLECTIONS: COLLECTIONS,
  fetchAll: fetchAll
}
