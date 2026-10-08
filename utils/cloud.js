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
 * 分页拉取集合全部数据（客户端单次最多 100 条）
 */
async function fetchAll(collFn, orderFn) {
  const size = config.PAGE_SIZE
  let all = []
  let skip = 0
  for (let guard = 0; guard < 20; guard++) {
    let query = collFn()
    if (orderFn) query = orderFn(query)
    const res = await query.skip(skip).limit(size).get()
    const list = res.data || []
    all = all.concat(list)
    if (list.length < size) break
    skip += size
  }
  return all
}

module.exports = {
  initCloud: initCloud,
  db: db,
  COLLECTIONS: COLLECTIONS,
  fetchAll: fetchAll
}
