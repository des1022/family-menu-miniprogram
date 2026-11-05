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

/** 一次并发几页。读并发比写宽松，但别贪：4 页在真机上稳，8 页开始偶尔超时 */
const FETCH_CONCURRENCY = 4

/** 取一页（skip/limit 由调用方算好） */
async function fetchPage(collFn, orderFn, skip, size) {
  let query = collFn()
  if (orderFn) query = orderFn(query)
  const res = await query.skip(skip).limit(size).get()
  return res.data || []
}

/** 按 _id 去重（并发分页的兜底：排序里时间并列时，skip 可能重复/漏一条） */
function dedupeById(list) {
  const seen = {}
  const out = []
  list.forEach(it => {
    if (!it) return
    const id = it._id
    if (id && seen[id]) return
    if (id) seen[id] = true
    out.push(it)
  })
  return out
}

/** 串行分页（count 不可用时的兜底路径） */
async function fetchAllSequential(collFn, orderFn, size) {
  const all = []
  let skip = 0
  for (let guard = 0; guard < 200; guard++) {
    const list = await fetchPage(collFn, orderFn, skip, size)
    all.push.apply(all, list)
    if (!list.length || list.length < size) break
    skip += list.length
  }
  return all
}

/**
 * 分页拉取集合全部数据。
 *
 * 这里踩过一个很贵的坑：以前 PAGE_SIZE 写成 100，`limit(100)` 在客户端会被
 * 悄悄截成 20 条，而判断是「返回条数 < 请求条数就认为拉完了」——
 * 于是第一页 20 条就 break，菜库永远只显示 20 道（2026-11-05 反馈）。
 *
 * 现在：请求条数按 20 夹紧；先 count 问总数，再**并发**拉页（每轮 4 页），
 * 中间那次往返省掉了 —— 42 道菜从 3 次串行变 1 次往返，300 道也只是 4 轮。
 * count 失败（权限/网络）就退回串行，不会因为数不出总数就不显示。
 */
async function fetchAll(collFn, orderFn) {
  const size = Math.min(Number(config.PAGE_SIZE) || CLIENT_PAGE_MAX, CLIENT_PAGE_MAX)

  let total = -1
  try {
    const res = await collFn().count()
    total = res && typeof res.total === 'number' ? res.total : -1
  } catch (e) {
    console.warn('[cloud] count 失败，退回串行分页', e)
    total = -1
  }
  if (total === 0) return []
  if (total < 0) return fetchAllSequential(collFn, orderFn, size)

  const pages = Math.ceil(total / size)
  let all = []
  for (let start = 0; start < pages; start += FETCH_CONCURRENCY) {
    const batch = []
    const end = Math.min(start + FETCH_CONCURRENCY, pages)
    for (let p = start; p < end; p++) {
      batch.push(fetchPage(collFn, orderFn, p * size, size))
    }
    const lists = await Promise.all(batch)
    lists.forEach(l => { all = all.concat(l) })
  }
  return dedupeById(all)
}

module.exports = {
  initCloud: initCloud,
  db: db,
  COLLECTIONS: COLLECTIONS,
  fetchAll: fetchAll
}
