/**
 * db-fetch —— 服务端分页读集合，一次拿一大把
 *
 * 为什么需要它：
 *   小程序端 `get()` 单次最多 **20** 条，菜多了就得来回十几次（42 道 3 次、
 *   300 道 15 次、上千条记录几十次），手机上就是「进菜库转圈」。
 *   云函数跑在服务端，单次 `limit` 上限是 **100**，而且服务端自己翻页不用客户端的往返，
 *   所以一次调用就能把几百条读完再一次性返回。
 *
 * 入参：
 *   { collection: 'dishes'|'records'|'categories'|'members'|'shopping',
 *     where?: {field: value},              // 只支持等值（和客户端用法一致）
 *     orderBy?: [{field, dir}],            // 最多 3 个
 *     skip?: number, limit?: number }      // 客户端分批时用；limit 默认/上限 500
 * 返回：
 *   { ok: true, total, docs, pageSize, skip, count }
 *   { ok: false, error }
 *
 * 注意：
 *  - **集合名走白名单**，别让它变成「任意集合都能读」的口子；
 *  - 单次最多 500 条 / 3000 条封顶：返回值超过 1MB 会被平台截断，
 *    菜多的家庭会分几次调用（客户端 fetchAll 已经处理）；
 *  - 排序字段建议带上创建时间这类不易并列的，否则 skip 翻页可能重复/漏一条 —— 
 *    客户端拿到结果后还会按 _id 去重兜底。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALLOWED = ['dishes', 'records', 'categories', 'members', 'shopping']
const PAGE = 100        // 服务端单次上限
const MAX_LIMIT = 500   // 单次最多返回 500 条（返回体别撑爆 1MB）
const MAX_PAGES = 30    // 单次最多翻 30 页

exports.main = async event => {
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
    console.warn('[db-fetch] count 失败', e)
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
