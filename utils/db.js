const config = require('./config.js')
const { db, COLLECTIONS, fetchAll } = require('./cloud.js')
const { pad } = require('./util.js')

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
    data: Object.assign({}, data, { createTime: db().serverDate() })
  })
}

/** 批量新增（示例菜库一键填充用） */
function addDishes(list) {
  return Promise.all(list.map(item => addDish(item)))
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

/** 读取本地记住的成员文档（管理员/成员表都可能被清理，取不到就返回 null） */
async function getMyMember() {
  if (_me) return _me
  const id = wx.getStorageSync(config.KEYS.MEMBER_ID)
  if (!id) return null
  try {
    const res = await colMembers().doc(id).get()
    _me = res.data || null
  } catch (e) {
    console.warn('[db] 本地成员已失效，稍后重建', e)
    _me = null
    wx.removeStorageSync(config.KEYS.MEMBER_ID)
  }
  return _me
}

/**
 * 首次进入时认领一个成员身份：新建成员文档并把 _id 存本地。
 * 昵称优先取旧版本遗留的本地昵称，没有就留空（家庭页会提示补全）。
 */
async function ensureMyMember() {
  const exist = await getMyMember()
  if (exist) return exist

  const members = await getMembers()
  const legacyNick = wx.getStorageSync(config.KEYS.NICKNAME) || ''
  const color = config.MEMBER_COLORS[members.length % config.MEMBER_COLORS.length]

  const res = await colMembers().add({
    data: {
      nickname: legacyNick,
      color: color,
      eatTonight: config.EAT_TONIGHT.YES,
      tastes: '',
      createTime: db().serverDate(),
      updateTime: db().serverDate()
    }
  })
  wx.setStorageSync(config.KEYS.MEMBER_ID, res._id)
  _me = { _id: res._id, nickname: legacyNick, color: color, eatTonight: config.EAT_TONIGHT.YES, tastes: '' }
  return _me
}

async function getMembers() {
  return fetchAll(colMembers, q => q.orderBy('createTime', 'asc'))
}

/** 手动新增成员（自己那条是 ensureMyMember 自动建的） */
function addMember(data) {
  return colMembers().add({
    data: Object.assign({
      nickname: '',
      color: '#D9714E',
      tastes: '',
      eatTonight: 1
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

function removeMember(id) {
  if (_me && _me._id === id) _me = null
  return colMembers().doc(id).remove()
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

module.exports = {
  todayStr,
  recentDates,
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
  // 派生
  getDishFreq,
  getRecentDishIds,
  getLastCookedMap,
  buildIngredientList
}
