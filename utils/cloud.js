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
 * 小程序端单次 get 的硬上限：20 条（云函数里是 100）。
 * 写死在这里，别依赖调用方传的值。
 */
const CLIENT_PAGE_MAX = 20

/** 一次并发几页。读并发比写宽松，但别贪：4 页在真机上稳，8 页开始偶尔超时 */
const FETCH_CONCURRENCY = 4

/** 云函数单次能带回来多少（云函数那边也会再夹一次 500） */
const FN_LIMIT = 500

/** 云函数读不通（没部署 / 报错）就记下来，本次会话别再试，直接走客户端分页 */
let fnBroken = false

/** 按 name + opts 构造客户端查询（where 只支持等值，和现有用法一致） */
function clientQuery(name, opts) {
  let q = opts && opts.where ? db().collection(name).where(opts.where) : db().collection(name)
  const order = (opts && opts.orderBy) || []
  order.forEach(o => { if (o && o.field) q = q.orderBy(o.field, o.dir === 'desc' ? 'desc' : 'asc') })
  return q
}

async function fetchPage(name, opts, skip, size) {
  const res = await clientQuery(name, opts).skip(skip).limit(size).get()
  return res.data || []
}

/** 按 _id 去重（并发/跨批分页的兜底：排序里时间并列时 skip 可能重复一条） */
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

/** 串行分页（云函数和 count 都不可用时的最后一条路） */
async function fetchAllSequential(name, opts, size) {
  const all = []
  let skip = 0
  for (let guard = 0; guard < 200; guard++) {
    const list = await fetchPage(name, opts, skip, size)
    all.push.apply(all, list)
    if (!list.length || list.length < size) break
    skip += list.length
  }
  return all
}

/**
 * 走云函数读集合：服务端翻页（一次 100 条），一次调用就把整集合带回来。
 * 返回 null 表示「这条路不通」（没部署/报错），交给客户端分页兜底。
 *
 * 为什么调的是 `img-url` 而不是一个叫 db-fetch 的函数：CI 的
 * `ci.cloud.uploadFunction()` 只能更新**已存在**的云函数，新建必须在云开发控制台点一次。
 * 为了不让你手动去点，读集合就挂在已经部署的 img-url 里（`action: 'query'` 分支），
 * 详见 cloudfunctions/img-url/index.js 顶部注释。想拆出去随时可以。
 */
async function fetchAllViaFunction(name, opts) {
  if (fnBroken) return null
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null
  try {
    let all = []
    let skip = 0
    for (let guard = 0; guard < 40; guard++) {
      const res = await wx.cloud.callFunction({
        name: 'img-url',
        data: {
          action: 'query',
          collection: name,
          where: (opts && opts.where) || null,
          orderBy: (opts && opts.orderBy) || null,
          skip: skip,
          limit: FN_LIMIT
        }
      })
      const r = res && res.result
      if (!r || r.ok === false) throw new Error((r && r.error) || '读集合返回异常')
      const list = r.docs || []
      all = all.concat(list)
      skip += list.length
      const total = typeof r.total === 'number' ? r.total : -1
      if (!list.length || list.length < FN_LIMIT) break
      if (total >= 0 && all.length >= total) break
    }
    return dedupeById(all)
  } catch (e) {
    fnBroken = true
    console.warn('[cloud] 云函数读集合走不通，退回客户端分页（云函数没部署/没更新就是这条）', e)
    return null
  }
}

/**
 * 分页拉取集合全部数据。
 *
 * 两条路：
 *  ① 云函数读集合（首选）：服务端一次 100 条、自己翻页，42 道 / 300 道都只是 1 次往返；
 *  ② 客户端分页（兜底）：先 count 问总数，再并发 4 页拉；count 不可用就串行。
 *
 * 这条路以前踩过两个坑，都在这儿堵着：
 *  - 小程序端 limit 上限是 20，写 100 会被 SDK 悄悄截断 → 只在 page 里用 20，且按实际返回条数翻页；
 *  - 菜多了串行分页太慢（300 道 15 次往返）→ 客户端兜底也做了并发。
 *
 * @param {string} name 集合名（和 COLLECTIONS 里的值一致）
 * @param {{where?: object, orderBy?: Array<{field: string, dir: string}>}} [opts]
 */
async function fetchAll(name, opts) {
  const viaFn = await fetchAllViaFunction(name, opts)
  if (viaFn) return viaFn

  const size = Math.min(Number(config.PAGE_SIZE) || CLIENT_PAGE_MAX, CLIENT_PAGE_MAX)
  let total = -1
  try {
    const res = await clientQuery(name, opts).count()
    total = res && typeof res.total === 'number' ? res.total : -1
  } catch (e) {
    console.warn('[cloud] count 失败，退回串行分页', e)
    total = -1
  }
  if (total === 0) return []
  if (total < 0) return fetchAllSequential(name, opts, size)

  const pages = Math.ceil(total / size)
  let all = []
  for (let start = 0; start < pages; start += FETCH_CONCURRENCY) {
    const batch = []
    const end = Math.min(start + FETCH_CONCURRENCY, pages)
    for (let p = start; p < end; p++) {
      batch.push(fetchPage(name, opts, p * size, size))
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
