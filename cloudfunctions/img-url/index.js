/**
 * img-url —— 云端小工具（现在干两件事）
 *
 * ⚠️ 名字是历史原因：最初只用来「把云存储 fileID 换成临时链接」。2026-11-05 又加了
 *    一个 `action: 'query'` 的分支（服务端读集合），**没有另建云函数**，原因很实际：
 *    CI 里的 `ci.cloud.uploadFunction()` 只能**更新已存在的云函数**，名字不存在会直接报
 *    ResourceNotFound.Function（新建必须在云开发控制台点一次）。
 *    所以读集合就挂在这个已经部署、也在跑的函数里 —— 哪天想拆出去，
 *    先在控制台建好新函数，再把 queryCollection 那段整体挪走即可。
 *
 * ============ 用法一：换图片链接（默认行为，不传 action 就是它） ============
 *   入参 { fileIDs: string[] }        —— 只认 cloud:// 开头的，其它原样忽略
 *   返回 { urls: { fileID: url } }    —— 拿不到的不会出现在 urls 里
 *
 *   为什么必须走服务端：这个环境的存储桶是「仅创建者及管理员可读写」（私有），
 *   「管理员」指云后台/服务端，不是小程序里的某个用户 —— 客户端直接读 fileID 或
 *   getTempFileURL 都会被拦，只剩首字占位块。云函数跑在服务端，天生有管理员权限。
 *
 * ============ 用法二：读集合（action: 'query'） ============
 *   入参 { action: 'query', collection, where?, orderBy?, skip?, limit? }
 *   返回 { ok, total, docs, pageSize, skip, count } / { ok: false, error }
 *
 *   为什么要有它：小程序端 `get()` 单次最多 **20** 条，菜多了要来回十几次；
 *   服务端单次上限是 **100**，而且服务端自己翻页不用客户端往返，
 *   一次调用就能把几百条读完再一次性返回。
 *   - 集合名走**白名单**，别让它变成「任意集合都能读」的口子；
 *   - 单次最多 500 条 / 30 页：返回值超过 1MB 会被平台截断，多了让客户端带 skip 再来。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// getTempFileURL 单次最多 50 个，和官方限制保持一致
const MAX_FILES = 50

/* ==================== 用法二：读集合 ==================== */

const ALLOWED = ['dishes', 'records', 'categories', 'members', 'shopping']
const PAGE = 100        // 服务端单次上限
const MAX_LIMIT = 500   // 单次最多返回 500 条（返回体别撑破 1MB）
const MAX_PAGES = 30    // 单次最多翻 30 页

async function queryCollection(event) {
  const name = String((event && event.collection) || '')
  if (ALLOWED.indexOf(name) < 0) {
    return { ok: false, error: 'collection not allowed: ' + name }
  }

  const where = event.where && typeof event.where === 'object' ? event.where : null
  const orderBy = Array.isArray(event.orderBy) ? event.orderBy.slice(0, 3) : []
  const skip = Math.max(0, Number(event.skip) || 0)
  const limit = Math.min(Math.max(1, Number(event.limit) || MAX_LIMIT), MAX_LIMIT)

  const build = () => {
    let q = where ? db.collection(name).where(where) : db.collection(name)
    orderBy.forEach(o => {
      if (o && o.field) q = q.orderBy(o.field, o.dir === 'desc' ? 'desc' : 'asc')
    })
    return q
  }

  let total = -1
  try {
    const c = await build().count()
    total = c && typeof c.total === 'number' ? c.total : -1
  } catch (e) {
    console.warn('[query] count 失败', e)
    total = -1
  }

  const docs = []
  let cursor = skip
  for (let guard = 0; guard < MAX_PAGES && docs.length < limit; guard++) {
    const size = Math.min(PAGE, limit - docs.length)
    const res = await build().skip(cursor).limit(size).get()
    const list = res.data || []
    docs.push.apply(docs, list)
    if (list.length < size) break
    cursor += list.length
  }

  return { ok: true, total, docs, pageSize: PAGE, skip, count: docs.length }
}

/* ==================== 入口 ==================== */

exports.main = async event => {
  // 读集合：客户端 utils/cloud.js 的 fetchAll 会带 action: 'query'
  if (event && event.action === 'query') {
    try {
      return await queryCollection(event)
    } catch (e) {
      console.error('[query] 失败', e)
      return { ok: false, error: (e && (e.message || e.errMsg)) || String(e) }
    }
  }

  // 换临时链接（默认行为，和老的调用方完全一致）
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
