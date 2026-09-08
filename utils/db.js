const config = require('./config.js')
const { db, COLLECTIONS, fetchAll } = require('./cloud.js')
const { pad } = require('./util.js')

/**
 * 数据访问层：dishes / records / categories 三个集合
 * records 为按日点单记录：date + dishId 唯一，num 累加；confirmed=1 表示已确认进日历
 */

const colDishes = () => db().collection(COLLECTIONS.DISHES)
const colRecords = () => db().collection(COLLECTIONS.RECORDS)
const colCategories = () => db().collection(COLLECTIONS.CATEGORIES)

/** 今天日期字符串 YYYY-MM-DD（每次调用实时计算，跨午夜自动翻新） */
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/* ==================== 菜品 ==================== */

/** 只取上架菜品（首页） */
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

/** 菜品实时监听（首页同步：家人录菜立刻出现） */
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
 * 点菜 / 减菜：date + dishId 唯一，num 累加；减到 0 自动删除记录
 * 冗余 dishName/dishImage，菜品删除后历史日历仍可读
 */
async function recordUpsert(date, dish, delta) {
  const exist = await findRecord(date, dish._id)
  if (!exist) {
    if (delta <= 0) return
    return colRecords().add({
      data: {
        date: date,
        dishId: dish._id,
        dishName: dish.name,
        dishImage: dish.image || '',
        price: dish.price || 0,
        num: delta,
        remark: '',
        confirmed: config.RECORD_CONFIRMED.DRAFT,
        createTime: db().serverDate(),
        updateTime: db().serverDate()
      }
    })
  }
  const num = (exist.num || 0) + delta
  if (num <= 0) return colRecords().doc(exist._id).remove()
  return colRecords().doc(exist._id).update({
    data: { num: num, updateTime: db().serverDate() }
  })
}

function updateRecordNum(id, num) {
  return colRecords().doc(id).update({ data: { num: num, updateTime: db().serverDate() } })
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

/** 确认点单：当日全部标记已确认 */
async function markConfirmed(date) {
  return colRecords()
    .where({ date: date, confirmed: config.RECORD_CONFIRMED.DRAFT })
    .update({ data: { confirmed: config.RECORD_CONFIRMED.CONFIRMED } })
}

async function countConfirmed(date) {
  const res = await colRecords().where({ date: date, confirmed: config.RECORD_CONFIRMED.CONFIRMED }).count()
  return res.total || 0
}

/** 全部记录（日历页聚合用） */
async function getAllRecords() {
  return fetchAll(colRecords, q => q.orderBy('createTime', 'desc'))
}

/** 某日记录实时监听（点单清单页 / 首页悬浮球） */
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

/* ==================== 统计辅助 ==================== */

/** 各菜累计点单份数（首页「常点」排序） */
async function getDishFreq() {
  const records = await getAllRecords()
  const map = {}
  records.forEach(r => {
    map[r.dishId] = (map[r.dishId] || 0) + (r.num || 0)
  })
  return map
}

module.exports = {
  todayStr: todayStr,
  getOnDishes: getOnDishes,
  getAllDishes: getAllDishes,
  addDish: addDish,
  updateDish: updateDish,
  removeDish: removeDish,
  setFavorite: setFavorite,
  watchDishes: watchDishes,
  getCategories: getCategories,
  addCategory: addCategory,
  updateCategory: updateCategory,
  removeCategory: removeCategory,
  moveDishesCategory: moveDishesCategory,
  getRecordsByDate: getRecordsByDate,
  recordUpsert: recordUpsert,
  updateRecordNum: updateRecordNum,
  updateRecordRemark: updateRecordRemark,
  removeRecord: removeRecord,
  clearDrafts: clearDrafts,
  markConfirmed: markConfirmed,
  countConfirmed: countConfirmed,
  getAllRecords: getAllRecords,
  watchRecordsByDate: watchRecordsByDate,
  getDishFreq: getDishFreq
}
