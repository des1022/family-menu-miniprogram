const config = require('./config.js')
const { db, COLLECTIONS, fetchAll } = require('./cloud.js')
const { pad, sleep, errText } = require('./util.js')

/**
 * 数据访问层：dishes / records / categories / members
 *
 * records：按日点单记录（date + dishId 唯一）
 *   - num 字段保留但界面不再展示（去掉「份数」后统一为 1），只为兼容历史数据
 *   - byId / byName / byColor：谁点的菜（成员最小版）
 *   - confirmed：1 = 已确认进日历
 *
 * members：家庭成员。云端 add 时自动写入 _openid；
 *   本机把自己的成员文档 _id 存本地（config.KEYS.MEMBER_ID），以此认「我是谁」。
 */

const colDishes = () => db().collection(COLLECTIONS.DISHES)
const colRecords = () => db().collection(COLLECTIONS.RECORDS)
const colCategories = () => db().collection(COLLECTIONS.CATEGORIES)
const colMembers = () => db().collection(COLLECTIONS.MEMBERS)

/** 今天日期字符串 YYYY-MM-DD（每次调用实时计算，跨午夜自动翻新） */
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 最近 n 天的日期字符串数组（含今天） */
function recentDates(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()))
  }
  return out
}

/* ==================== 菜品 ==================== */

/** 只取上架菜品 */
async function getOnDishes() {
  return fetchAll(colDishes, q => q.orderBy('createTime', 'desc'))
    .then(list => list.filter(item => item.status === config.DISH_STATUS.ON))
}

/** 取全部菜品（管理端） */
async function getAllDishes() {
  return fetchAll(colDishes, q => q.orderBy('createTime', 'desc'))
}

function addDish(data) {
  return colDishes().add({
    data: Object.assign({ image: '', price: 0 }, data, { createTime: db().serverDate() })
  })
}

/**
 * 批量新增（示例菜库一键填充用）
 *
 * 为什么不用 Promise.all：小程序端对云数据库的**并发写有限制**，
 * 一次并发打十几条很容易被限流，而 Promise.all 只要一条失败就整批 reject，
 * 表现就是「一道都没进去」。改成顺序写、每 4 条歇一下，单条失败只记下来不中断。
 *
 * @param {Array} list 菜品数组
 * @param {Function} [onProgress] (done, total) => void
 * @returns {Promise<{ok:number, failed:Array<{name:string, err:string}>}>}
 */
async function addDishes(list, onProgress) {
  const items = list || []
  const failed = []
  let ok = 0
  for (let i = 0; i < items.length; i++) {
    try {
      await addDish(items[i])
      ok++
    } catch (e) {
      console.error('[db] 批量新增失败：' + ((items[i] || {}).name || '?'), e)
      failed.push({ name: (items[i] || {}).name || '未命名', err: errText(e) })
    }
    if (onProgress) onProgress(i + 1, items.length)
    if ((i + 1) % 4 === 0 && i + 1 < items.length) await sleep(200)
  }
  return { ok: ok, failed: failed }
}

function updateDish(id, data) {
  return colDishes().doc(id).update({ data })
}

function removeDish(id) {
  return colDishes().doc(id).remove()
}

/** 收藏 / 取消收藏「常吃」 */
function setFavorite(id, favorite) {
  return colDishes().doc(id).update({ data: { favorite: favorite } })
}

/** 菜品实时监听（家人录菜立刻出现） */
function watchDishes(onChange) {
  try {
    return colDishes()
      .orderBy('createTime', 'desc')
      .limit(config.PAGE_SIZE)
      .watch({
        onChange: snapshot => onChange(snapshot.docs || []),
        onError: err => console.error('[db] 菜品监听异常', err)
      })
  } catch (e) {
    console.warn('[db] 当前环境不支持 watch，降级为手动刷新', e)
    return null
  }
}

/* ==================== 分类 ==================== */

async function getCategories() {
  return fetchAll(colCategories, q => q.orderBy('sort', 'asc').orderBy('createTime', 'asc'))
}

function addCategory(name, sort) {
  return colCategories().add({
    data: { name: name, sort: sort, createTime: db().serverDate() }
  })
}

function updateCategory(id, data) {
  return colCategories().doc(id).update({ data: data })
}

function removeCategory(id) {
  return colCategories().doc(id).remove()
}

/** 删除分类前，把该分类下菜品移到另一个分类 */
async function moveDishesCategory(from, to) {
  const res = await colDishes().where({ category: from }).update({ data: { category: to } })
  return res.stats ? res.stats.updated : 0
}

/* ==================== 家庭成员（最小版） ==================== */

let _me = null

/** 云开发「文档不存在」类错误（区别于网络/权限这种临时故障） */
function isNotFound(e) {
  if (!e) return false
  const code = e.errCode || e.code || ''
  const msg = String(e.errMsg || e.message || '')
  return code === -502004 || /not exist|does not exist|不存在/i.test(msg)
}

/** 把「我是谁」记到本地（_id + openid 都记） */
function remember(m) {
  _me = m || null
  if (_me) {
    wx.setStorageSync(config.KEYS.MEMBER_ID, _me._id)
    if (_me._openid) wx.setStorageSync(config.KEYS.MY_OPENID, _me._openid)
  } else {
    wx.removeStorageSync(config.KEYS.MEMBER_ID)
  }
  return _me
}

/**
 * 读取本地记住的成员文档。
 *
 * ⚠️ 这里踩过一次坑：原来只要读失败就清掉本地 _id，于是网络/权限抖一下都会
 * 让「我是谁」丢失，下一次 ensureMyMember 就新建一条成员 —— 表现就是
 * 「换个客户端打开 / 重新打开一次，家庭里就多出一个成员」。
 * 现在只有「这条记录真的没了」才清本地记忆，临时故障一律保留。
 */
async function getMyMember() {
  if (_me) return _me
  const id = wx.getStorageSync(config.KEYS.MEMBER_ID)
  if (!id) return null
  try {
    const res = await colMembers().doc(id).get()
    _me = res.data || null
    if (_me && _me._openid) wx.setStorageSync(config.KEYS.MY_OPENID, _me._openid)
  } catch (e) {
    _me = null
    if (isNotFound(e)) {
      console.warn('[db] 本地成员记录已不存在，清掉本地记忆')
      wx.removeStorageSync(config.KEYS.MEMBER_ID)
    } else {
      console.warn('[db] 读取本地成员失败（保留本地记忆，下次再试）', e)
    }
  }
  return _me
}

/**
 * 按 openid 找「我自己」那条。
 * 客户端拿不到自己的 openid，但可以从自己新建的文档上把 _openid 读回来，
 * 所以「同一台微信在不同客户端打开」时能靠它把身份找回来。
 * 只认 ensureMyMember/createSelfMember 建的（self === 1），
 * 手动给家人加的成员（self 为 0 或缺省）绝不认 —— 否则会认错人。
 */
async function findSelfByOpenid(openid, exceptId) {
  if (!openid) return null
  try {
    const res = await colMembers().where({ _openid: openid }).limit(20).get()
    const list = (res.data || [])
      .filter(m => m._id !== exceptId && Number(m.self) === 1)
      .sort((a, b) => (a.createTime && a.createTime.$date ? a.createTime.$date : 0) -
                      (b.createTime && b.createTime.$date ? b.createTime.$date : 0))
    return list[0] || null
  } catch (e) {
    console.warn('[db] 按 openid 找成员失败', e)
    return null
  }
}

/** 新建「我」这条成员（self = 1，便于同一个人换客户端时找回） */
async function createSelfMember(count) {
  const legacyNick = wx.getStorageSync(config.KEYS.NICKNAME) || ''
  const color = config.MEMBER_COLORS[(count || 0) % config.MEMBER_COLORS.length]
  const res = await colMembers().add({
    data: {
      nickname: legacyNick,
      color: color,
      eatTonight: config.EAT_TONIGHT.YES,
      tastes: '',
      self: 1,
      createTime: db().serverDate(),
      updateTime: db().serverDate()
    }
  })

  // 读回来拿 _openid（客户端没有直接获取 openid 的 API，只能从自己建的文档上取）
  let doc = { _id: res._id, nickname: legacyNick, color: color, eatTonight: config.EAT_TONIGHT.YES, tastes: '', self: 1 }
  try {
    const back = await colMembers().doc(res._id).get()
    if (back && back.data) doc = back.data
  } catch (e) {
    console.warn('[db] 读回新成员失败', e)
  }

  // 同一个人其实早就认领过（例如这台设备的本地记忆丢了）→ 用老的那条，把刚建的删掉
  const dup = await findSelfByOpenid(doc._openid, doc._id)
  if (dup) {
    try {
      await colMembers().doc(doc._id).remove()
      console.warn('[db] 已合并到已有成员，未产生重复')
    } catch (e) {
      console.warn('[db] 清理多余成员失败', e)
    }
    return remember(dup)
  }
  return remember(doc)
}

/**
 * 认领一条已有成员（页面「你是哪位」选中后调用；家庭页「把这条设成「我」」也走这里）
 *
 * 除了记住本地，还要把云端 members 里的 `self` 标记**搬**到这条上：
 * 之前只写本地记忆，旧的那条还留着 self=1，于是「换客户端按 openid 找回」
 * 又会认成旧的那个 —— 2026-10-09 反馈的「我标在陈瑞丽身上」就是这个原因。
 * 规矩：云端任何时刻最多只有一条 self=1。
 */
async function claimMember(id) {
  const res = await colMembers().doc(id).get()
  const target = res.data
  if (!target) return null

  // 1) 先把别处的 self 清掉（失败不阻塞认领，本地照样认这条）
  try {
    const others = await colMembers().where({ self: 1 }).limit(20).get()
    const list = others.data || []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (m._id === id) continue
      await colMembers().doc(m._id).update({
        data: { self: 0, updateTime: db().serverDate() }
      })
    }
  } catch (e) {
    console.warn('[db] 清理旧的「我」标记失败（不影响本次认领）', e)
  }

  // 2) 给这条打上标记
  try {
    await colMembers().doc(id).update({
      data: { self: 1, updateTime: db().serverDate() }
    })
    target.self = 1
  } catch (e) {
    console.warn('[db] 写入「我」标记失败（本地仍然认这条）', e)
  }

  return remember(target)
}

/**
 * 认领「我是谁」。返回 null = 认不出来，页面要问一句「你是家里的哪位？」
 *
 * 为什么不再默默新建：本地记忆是按设备存的，换一个客户端（手机 ↔ 电脑）
 * 或清一次缓存就没了；如果这时直接新建，家里就会不断多出「未命名」成员
 * —— 这正是 2026-10-08 真机反馈的那个 bug。现在规矩是：
 *   1) 本地有记录且还读得到 → 直接用
 *   2) 本地缓存过 openid → 按 openid 找回来（自动，不打扰）
 *   3) 家里一个人都还没有 → 第一个使用者自动建
 *   4) 其余情况 → 返回 null，让用户自己指认
 */
async function ensureMyMember() {
  const exist = await getMyMember()
  if (exist) return exist

  const members = await getMembers()

  const cachedOpenid = wx.getStorageSync(config.KEYS.MY_OPENID) || ''
  const byOpenid = await findSelfByOpenid(cachedOpenid)
  if (byOpenid) return remember(byOpenid)

  if (!members.length) return createSelfMember(0)

  return null
}

async function getMembers() {
  return fetchAll(colMembers, q => q.orderBy('createTime', 'asc'))
}

/** 手动新增成员（给家人加的那条，self = 0：绝不被当成「我」） */
function addMember(data) {
  return colMembers().add({
    data: Object.assign({
      nickname: '',
      color: '#D9714E',
      tastes: '',
      eatTonight: 1,
      self: 0
    }, data, {
      createTime: db().serverDate(),
      updateTime: db().serverDate()
    })
  })
}

async function updateMember(id, data) {
  const res = await colMembers().doc(id).update({
    data: Object.assign({}, data, { updateTime: db().serverDate() })
  })
  if (_me && _me._id === id) _me = Object.assign({}, _me, data)
  return res
}

async function removeMember(id) {
  const isMe = !!(wx.getStorageSync(config.KEYS.MEMBER_ID) === id)
  if (_me && _me._id === id) _me = null
  const res = await colMembers().doc(id).remove()
  // 移除的是自己 → 连本地记忆一起清掉（含 openid，避免又被自动认回一条已删除的记录）
  if (isMe) {
    wx.removeStorageSync(config.KEYS.MEMBER_ID)
    wx.removeStorageSync(config.KEYS.MY_OPENID)
  }
  return res
}

/** 今晚在家吃的人数 */
function countEatTonight(members) {
  return (members || []).filter(m => Number(m.eatTonight) !== config.EAT_TONIGHT.NO).length
}

/* ==================== 点单记录 ==================== */

/** 某日全部记录（按创建时间正序 = 点菜顺序） */
async function getRecordsByDate(date) {
  return fetchAll(
    () => colRecords().where({ date: date }),
    q => q.orderBy('createTime', 'asc')
  )
}

/** 同菜找当日已有记录 */
async function findRecord(date, dishId) {
  const res = await colRecords().where({ date: date, dishId: dishId }).limit(1).get()
  return (res.data || [])[0] || null
}

/**
 * 把一道菜加进今晚的桌（去掉份数后：已在桌上就只刷新点单人，不再累加）
 * 冗余 dishName/dishImage，菜品删除后历史日历仍可读
 */
async function addToTonight(dish, date) {
  const d = date || todayStr()
  const me = await getMyMember()
  const payload = {
    dishName: dish.name,
    dishImage: dish.image || '',
    price: dish.price || 0,
    byId: me ? me._id : '',
    byName: me && me.nickname ? me.nickname : '',
    byColor: me ? me.color : '',
    updateTime: db().serverDate()
  }
  const exist = await findRecord(d, dish._id)
  if (exist) {
    return colRecords().doc(exist._id).update({ data: payload })
  }
  return colRecords().add({
    data: Object.assign({
      date: d,
      dishId: dish._id,
      num: 1,
      remark: '',
      confirmed: config.RECORD_CONFIRMED.DRAFT,
      createTime: db().serverDate()
    }, payload)
  })
}

/** 从今晚的桌上撤掉一道菜 */
async function removeFromTonight(date, dishId) {
  const exist = await findRecord(date, dishId)
  if (!exist) return null
  return colRecords().doc(exist._id).remove()
}

function updateRecordRemark(id, remark) {
  return colRecords().doc(id).update({ data: { remark: remark, updateTime: db().serverDate() } })
}

function removeRecord(id) {
  return colRecords().doc(id).remove()
}

/** 清空某日草稿（保留已确认记录）；返回保留的已确认道数 */
async function clearDrafts(date) {
  const confirmed = await countConfirmed(date)
  const res = await colRecords().where({ date: date, confirmed: config.RECORD_CONFIRMED.DRAFT }).remove()
  return { kept: confirmed, removed: res.stats ? res.stats.removed : 0 }
}

/** 确认这顿饭：当日全部标记已确认 */
async function markConfirmed(date) {
  return colRecords()
    .where({ date: date, confirmed: config.RECORD_CONFIRMED.DRAFT })
    .update({ data: { confirmed: config.RECORD_CONFIRMED.CONFIRMED } })
}

async function countConfirmed(date) {
  const res = await colRecords().where({ date: date, confirmed: config.RECORD_CONFIRMED.CONFIRMED }).count()
  return res.total || 0
}

/** 全部记录（日历聚合用） */
async function getAllRecords() {
  return fetchAll(colRecords, q => q.orderBy('createTime', 'desc'))
}

/** 某日记录实时监听 */
function watchRecordsByDate(date, onChange) {
  try {
    return colRecords()
      .where({ date: date })
      .watch({
        onChange: snapshot => onChange(snapshot.docs || []),
        onError: err => console.error('[db] 记录监听异常', err)
      })
  } catch (e) {
    console.warn('[db] watch 降级为手动刷新', e)
    return null
  }
}

/* ==================== 采购清单 ==================== */

const colShopping = () => db().collection(COLLECTIONS.SHOPPING)

/** 某日全部采购项 */
async function getShopping(date) {
  return fetchAll(() => colShopping().where({ date: date }), q => q.orderBy('createTime', 'asc'))
}

/** 全部采购项（备份导出用） */
async function getAllShopping() {
  return fetchAll(colShopping, q => q.orderBy('createTime', 'desc'))
}

function addShoppingItem(date, name, qty) {
  const s = require('./shopping.js')
  return colShopping().add({
    data: {
      date: date,
      name: name,
      qty: qty || '',
      group: s.groupOf(name),
      staple: s.isStaple(name) ? 1 : 0,
      done: 0,
      manual: 1,
      hidden: 0,
      byName: '',
      createTime: db().serverDate(),
      updateTime: db().serverDate()
    }
  })
}

function updateShoppingDone(id, done, byName) {
  return colShopping().doc(id).update({
    data: { done: done ? 1 : 0, byName: byName || '', updateTime: db().serverDate() }
  })
}

function removeShoppingItem(id) {
  return colShopping().doc(id).remove()
}

/** 派生项不真删，只隐藏 —— 否则下次同步又会被从菜里推出来 */
function hideShoppingItem(id) {
  return colShopping().doc(id).update({ data: { hidden: 1, updateTime: db().serverDate() } })
}

/** 清空已买（含隐藏项一起清） */
async function clearShoppingDone(date) {
  const list = await getShopping(date)
  const targets = list.filter(i => Number(i.done) === 1 || Number(i.hidden) === 1)
  await Promise.all(targets.map(i => colShopping().doc(i._id).remove()))
  return targets.length
}

/**
 * 把「今晚的菜」对应的食材同步进采购清单：
 *  - 清单里没有的派生项 → 新建
 *  - 已不在今晚菜单里、且还没买、且非手动的派生项 → 删掉（不再需要买）
 * 手动加的项一律不动。
 */
async function syncShoppingFromDishes(date, derivedNames) {
  const s = require('./shopping.js')
  const stored = await getShopping(date)
  const byKey = {}
  stored.forEach(i => { byKey[i.name] = i })

  const created = []
  for (let i = 0; i < derivedNames.length; i++) {
    const name = derivedNames[i]
    if (byKey[name]) continue
    const res = await colShopping().add({
      data: {
        date: date,
        name: name,
        qty: '',
        group: s.groupOf(name),
        staple: s.isStaple(name) ? 1 : 0,
        done: 0,
        manual: 0,
        hidden: 0,
        byName: '',
        createTime: db().serverDate(),
        updateTime: db().serverDate()
      }
    })
    created.push(res._id)
  }

  const nameSet = {}
  derivedNames.forEach(n => { nameSet[n] = true })
  const stale = stored.filter(i =>
    Number(i.manual) !== 1 && Number(i.done) !== 1 && !nameSet[i.name]
  )
  await Promise.all(stale.map(i => colShopping().doc(i._id).remove()))

  return { created: created.length, removed: stale.length }
}

/** 采购清单实时监听（多人在超市同时勾） */
function watchShopping(date, onChange) {
  try {
    return colShopping()
      .where({ date: date })
      .watch({
        onChange: snapshot => onChange(snapshot.docs || []),
        onError: err => console.error('[db] 采购清单监听异常', err)
      })
  } catch (e) {
    console.warn('[db] watch 降级为手动刷新', e)
    return null
  }
}

/* ==================== 派生数据 ==================== */

/** 各菜累计点单次数（菜库「常吃」排序用） */
async function getDishFreq() {
  const records = await getAllRecords()
  const map = {}
  records.forEach(r => {
    map[r.dishId] = (map[r.dishId] || 0) + 1
  })
  return map
}

/** 最近 n 天内做过的菜 id 集合（菜库「本周没吃」用） */
async function getRecentDishIds(days) {
  const dates = recentDates(days || 7)
  const records = await getAllRecords()
  const map = {}
  records.forEach(r => {
    if (dates.indexOf(r.date) > -1) map[r.dishId] = true
  })
  return map
}

/** 某菜最近一次被做的日期（决策器降权 / 详情页「N 天没做了」用） */
async function getLastCookedMap() {
  const records = await getAllRecords()
  const map = {}
  records.forEach(r => {
    if (!map[r.dishId] || r.date > map[r.dishId]) map[r.dishId] = r.date
  })
  return map
}

/** 食材清单：当日已选菜品按食材归并，值为涉及的道数 */
function buildIngredientList(records, dishMap) {
  const map = {}
  ;(records || []).forEach(r => {
    const dish = dishMap[r.dishId]
    const raw = dish ? dish.ingredients : ''
    String(raw || '')
      .split(/[,，、;；/|\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(name => {
        if (!map[name]) map[name] = { name: name, times: 0, dishes: [] }
        map[name].times += 1
        if (map[name].dishes.indexOf(r.dishName) === -1) map[name].dishes.push(r.dishName)
      })
  })
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.times - a.times)
}

/* ==================== 数据连接自检 ==================== */

/**
 * 逐个集合试读一次，把「哪个集合没建 / 权限不对」直接查出来。
 * 手机上没有控制台，出问题时只能靠这个定位。
 */
async function pingAllCollections() {
  const targets = [
    [COLLECTIONS.DISHES, '菜品库', 'dishes'],
    [COLLECTIONS.CATEGORIES, '分类', 'categories'],
    [COLLECTIONS.RECORDS, '点单记录', 'records'],
    [COLLECTIONS.MEMBERS, '家庭成员', 'members'],
    [COLLECTIONS.SHOPPING, '采购清单', 'shopping']
  ]
  const out = []
  for (let i = 0; i < targets.length; i++) {
    const name = targets[i][0]
    const label = targets[i][1]
    const raw = targets[i][2]
    try {
      const res = await db().collection(name).limit(1).get()
      out.push({ name: label, raw: raw, ok: true, info: '可读' + ((res.data || []).length ? '（有数据）' : '（空）') })
    } catch (e) {
      out.push({ name: label, raw: raw, ok: false, info: errText(e) })
    }
  }
  return out
}

/** 云环境是否可用（集合是否齐全） */
async function checkEnv() {
  const items = await pingAllCollections()
  const missing = items.filter(x => !x.ok)
  return { ready: missing.length === 0, missing: missing, items: items }
}

/**
 * 从备份 JSON 恢复（只做「合并」：已存在的跳过，不会动现有数据）。
 *
 * 两个必须处理的点：
 * 1. `_id` / `_openid` 一律剥掉重新生成 —— 客户端 add 不接受外部 _id，
 *    而 _openid 必须由云端按当前用户写入（否则自定义安全规则会对不上）。
 * 2. records.dishId 指向 dishes._id、records.byId 指向 members._id。
 *    重建后 _id 变了，必须建「旧 id → 新 id」映射把引用翻译过去，否则记录会变成孤儿。
 *
 * 写入一律顺序进行 + 每 5 条停一下：云开发客户端并发写有限制，
 * 之前「12 条并发」就整批失败过（见 dev-notes 2026-10-08）。
 */
async function restoreBackup(payload, onProgress) {
  payload = payload || {}
  const report = { dishes: 0, records: 0, categories: 0, shopping: 0, members: 0, skipped: 0, failed: 0 }
  const say = typeof onProgress === 'function' ? onProgress : function () {}
  let count = 0
  const pace = async () => {
    count++
    if (count % 5 === 0) await sleep(220)
  }
  const strip = (doc) => {
    const o = Object.assign({}, doc)
    delete o._id
    delete o._openid
    return o
  }

  /* ---------- 分类 ---------- */
  say('恢复分类…')
  const existCat = {}
  ;(await getCategories().catch(() => [])).forEach(c => { if (c.name) existCat[c.name] = true })
  for (const c of (payload.categories || [])) {
    if (!c || !c.name) continue
    if (existCat[c.name]) { report.skipped++; continue }
    try {
      await colCategories().add({
        data: { name: c.name, sort: Number(c.sort) || 0, createTime: db().serverDate() }
      })
      existCat[c.name] = true
      report.categories++
      await pace()
    } catch (e) {
      console.warn('[db] 恢复分类失败', c.name, e)
      report.failed++
    }
  }

  /* ---------- 菜品（顺便建立 旧 _id → 新 _id 映射） ---------- */
  say('恢复菜品…')
  const dishMap = {}
  const existDish = {}
  ;(await getAllDishes().catch(() => [])).forEach(d => { if (d.name) existDish[d.name] = d._id })
  for (const d of (payload.dishes || [])) {
    if (!d || !d.name) continue
    if (existDish[d.name]) {
      if (d._id) dishMap[d._id] = existDish[d.name]
      report.skipped++
      continue
    }
    try {
      const res = await colDishes().add({
        data: strip(Object.assign({}, d, {
          createTime: db().serverDate(),
          updateTime: db().serverDate()
        }))
      })
      if (d._id) dishMap[d._id] = res._id
      existDish[d.name] = res._id
      report.dishes++
      await pace()
    } catch (e) {
      console.warn('[db] 恢复菜品失败', d.name, e)
      report.failed++
    }
  }

  /* ---------- 成员 ---------- */
  say('恢复成员…')
  const meMap = {}
  const existMember = {}
  ;(await getMembers().catch(() => [])).forEach(m => { if (m.nickname) existMember[m.nickname] = m._id })
  for (const m of (payload.members || [])) {
    if (!m) continue
    const nick = m.nickname || ''
    if (nick && existMember[nick]) {
      if (m._id) meMap[m._id] = existMember[nick]
      report.skipped++
      continue
    }
    try {
      const data = strip(m)
      delete data.self              // 不让导入进来的记录抢「我是谁」的身份标记
      data.eatTonight = Number(m.eatTonight) === 0 ? 0 : 1
      data.createTime = db().serverDate()
      data.updateTime = db().serverDate()
      const res = await colMembers().add({ data: data })
      if (m._id) meMap[m._id] = res._id
      if (nick) existMember[nick] = res._id
      report.members++
      await pace()
    } catch (e) {
      console.warn('[db] 恢复成员失败', nick, e)
      report.failed++
    }
  }

  /* ---------- 点单记录 ---------- */
  say('恢复点单记录…')
  const existRec = {}
  ;(await getAllRecords().catch(() => [])).forEach(r => { existRec[r.date + '|' + r.dishId] = true })
  for (const r of (payload.records || [])) {
    if (!r || !r.date) continue
    const dishId = dishMap[r.dishId] || r.dishId
    const key = r.date + '|' + dishId
    if (existRec[key]) { report.skipped++; continue }
    try {
      const data = strip(r)
      data.dishId = dishId
      if (data.byId && meMap[data.byId]) data.byId = meMap[data.byId]
      data.createTime = db().serverDate()
      data.updateTime = db().serverDate()
      await colRecords().add({ data: data })
      existRec[key] = true
      report.records++
      await pace()
    } catch (e) {
      console.warn('[db] 恢复记录失败', r.date, e)
      report.failed++
    }
  }

  /* ---------- 采购清单 ---------- */
  say('恢复采购清单…')
  const existShop = {}
  ;(await getAllShopping().catch(() => [])).forEach(s => { existShop[s.date + '|' + s.name] = true })
  for (const s of (payload.shopping || [])) {
    if (!s || !s.date || !s.name) continue
    const key = s.date + '|' + s.name
    if (existShop[key]) { report.skipped++; continue }
    try {
      const data = strip(s)
      data.createTime = db().serverDate()
      data.updateTime = db().serverDate()
      await db().collection(COLLECTIONS.SHOPPING).add({ data: data })
      existShop[key] = true
      report.shopping++
      await pace()
    } catch (e) {
      console.warn('[db] 恢复采购项失败', s.name, e)
      report.failed++
    }
  }

  return report
}

module.exports = {
  todayStr,
  recentDates,
  pingAllCollections,
  checkEnv,
  restoreBackup,
  // 菜品
  getOnDishes,
  getAllDishes,
  addDish,
  addDishes,
  updateDish,
  removeDish,
  setFavorite,
  watchDishes,
  // 分类
  getCategories,
  addCategory,
  updateCategory,
  removeCategory,
  moveDishesCategory,
  // 成员
  getMyMember,
  ensureMyMember,
  createSelfMember,
  claimMember,
  findSelfByOpenid,
  getMembers,
  addMember,
  updateMember,
  removeMember,
  countEatTonight,
  // 记录
  getRecordsByDate,
  findRecord,
  addToTonight,
  removeFromTonight,
  updateRecordRemark,
  removeRecord,
  clearDrafts,
  markConfirmed,
  countConfirmed,
  getAllRecords,
  watchRecordsByDate,
  // 采购清单
  getShopping,
  getAllShopping,
  addShoppingItem,
  updateShoppingDone,
  removeShoppingItem,
  hideShoppingItem,
  clearShoppingDone,
  syncShoppingFromDishes,
  watchShopping,
  // 派生
  getDishFreq,
  getRecentDishIds,
  getLastCookedMap,
  buildIngredientList
}
