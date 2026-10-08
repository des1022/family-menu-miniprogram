const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { toast, pad } = require('../../utils/util.js')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 日期格上菜品色点的固定色板（与设计稿一致） */
const DOT_COLORS = [
  '#E7A176', '#BFCB93', '#E8C077', '#D9A0A0', '#9DBCC9',
  '#AFD2C0', '#C9B49B', '#C7B2D9', '#E0B7C4', '#E5B58C'
]
const CAT_COLORS = ['#D9714E', '#7E9A5C', '#C79A3C', '#8C7AA8', '#5C8FA8', '#C9576E']

function dotColor(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  return DOT_COLORS[h % DOT_COLORS.length]
}

function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0) : '菜'
}

function phIdx(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  const PH = ['', 'img-ph--2', 'img-ph--3', 'img-ph--4', 'img-ph--5']
  return PH[h % PH.length]
}

Page({
  data: {
    themeCls: '',
    year: 2026,
    month: 1,
    monthText: '',
    today: '',
    cells: [],
    detail: null,
    reuseLoading: false,
    loading: true,
    mealCount: 0,
    topName: '',
    topNum: 0,
    top3: [],
    cats: [],
    tipText: ''
  },

  onLoad() {
    const now = new Date()
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      today: db.todayStr()
    })
  },

  onShow() {
    this.setData({ themeCls: theme.className() })
    this.loadRecords()
  },

  onPullDownRefresh() {
    this.loadRecords().then(() => wx.stopPullDownRefresh())
  },

  dateStr(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d)
  },

  async loadRecords() {
    try {
      const records = await db.getAllRecords()
      this._records = records
      const byDate = {}
      records.forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = []
        byDate[r.date].push(r)
      })
      this._byDate = byDate
      this.buildCells()
      await this.ensureDishes()
      this.buildReview()
    } catch (e) {
      console.error('[calendar] 加载失败', e)
      toast('加载失败，下拉重试')
    } finally {
      this.setData({ loading: false })
    }
  },

  buildCells() {
    const year = this.data.year
    const month = this.data.month
    const byDate = this._byDate || {}
    const first = new Date(year, month - 1, 1)
    const offset = (first.getDay() + 6) % 7
    const days = new Date(year, month, 0).getDate()

    const cells = []
    for (let i = 0; i < offset; i++) cells.push({ key: 'b' + i, day: '', date: '', dots: [] })
    for (let d = 1; d <= days; d++) {
      const date = this.dateStr(year, month, d)
      const list = byDate[date] || []
      cells.push({
        key: date,
        day: d,
        date: date,
        dots: list.slice(0, 3).map(r => dotColor(r.dishId))
      })
    }
    while (cells.length % 7 !== 0) cells.push({ key: 'e' + cells.length, day: '', date: '', dots: [] })

    this.setData({
      cells: cells,
      monthText: year + ' 年 ' + month + ' 月'
    })
  },

  /** 本月回顾：顿数 / 最爱 / Top3 / 分类占比 / 建议 */
  buildReview() {
    const prefix = this.data.year + '-' + pad(this.data.month)
    const list = (this._records || []).filter(r => String(r.date).indexOf(prefix) === 0)
    const dates = {}
    const dishCount = {}
    const dishName = {}
    list.forEach(r => {
      dates[r.date] = true
      dishCount[r.dishId] = (dishCount[r.dishId] || 0) + 1
      dishName[r.dishId] = r.dishName || dishName[r.dishId] || ''
    })

    const ranked = Object.keys(dishCount)
      .map(id => ({ id: id, name: dishName[id], count: dishCount[id] }))
      .sort((a, b) => b.count - a.count)

    const max = ranked.length ? ranked[0].count : 1
    const top3 = ranked.slice(0, 3).map(x => ({
      name: x.name,
      count: x.count,
      pct: Math.max(8, Math.round((x.count / max) * 100))
    }))

    const topName = ranked.length ? ranked[0].name : ''
    const topNum = ranked.length ? ranked[0].count : 0

    // 分类占比：菜品分类（拿不到就归到「其他」）
    const dishMap = this._dishMap || (this._dishMap = {})
    const catCount = {}
    list.forEach(r => {
      const d = dishMap[r.dishId]
      const c = (d && d.category) || '其他'
      catCount[c] = (catCount[c] || 0) + 1
    })
    const total = list.length || 1
    const cats = Object.keys(catCount)
      .map((name, i) => ({ name: name, pct: Math.round((catCount[name] / total) * 100), color: CAT_COLORS[i % CAT_COLORS.length] }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)

    const hasVeg = Object.keys(catCount).some(c => /素|青菜|蔬/.test(c))
    const hasSoup = Object.keys(catCount).some(c => /汤|羹/.test(c))
    let tipText = ''
    if (list.length) {
      if (!hasVeg) tipText = '这个月的素菜偏少，可以多安排几道清爽的。'
      else if (!hasSoup) tipText = '这个月几乎没喝汤，天凉了加个汤更舒服。'
      else tipText = '荤素汤都顾到了，搭配挺均衡。'
    }

    this.setData({
      mealCount: Object.keys(dates).length,
      topName: topName,
      topNum: topNum,
      top3: top3,
      cats: cats,
      tipText: tipText
    })
  },

  prevMonth() {
    let y = this.data.year
    let m = this.data.month - 1
    if (m === 0) { y -= 1; m = 12 }
    this.setData({ year: y, month: m }, () => this.buildCells())
    this.ensureDishes().then(() => this.buildReview())
  },

  nextMonth() {
    let y = this.data.year
    let m = this.data.month + 1
    if (m === 13) { y += 1; m = 1 }
    this.setData({ year: y, month: m }, () => this.buildCells())
    this.ensureDishes().then(() => this.buildReview())
  },

  /** 分类占比需要菜品表的 category，按月懒加载一次 */
  ensureDishes() {
    if (this._dishMap && Object.keys(this._dishMap).length) return Promise.resolve()
    return db.getAllDishes().then(list => {
      const map = {}
      list.forEach(d => { map[d._id] = d })
      this._dishMap = map
    }).catch(() => { this._dishMap = {} })
  },

  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    const list = (this._byDate || {})[date]
    if (!list || !list.length) return

    this.ensureDishes().then(() => {
      this.setData({
        detail: {
          date: date,
          dateText: date.replace('-', ' 年 ').replace('-', ' 月 ') + ' 日',
          list: list.map(r => {
            const d = (this._dishMap || {})[r.dishId]
            return {
              id: r._id,
              dishId: r.dishId,
              name: r.dishName || (d ? d.name : ''),
              image: r.dishImage || '',
              remark: r.remark || '',
              byName: r.byName || '',
              initial: initialOf(r.dishName),
              ph: phIdx(r.dishId)
            }
          })
        }
      })
    })
  },

  closeDetail() {
    this.setData({ detail: null })
  },

  /** 那天的一桌菜，一键加进今晚 */
  async onReuse() {
    const detail = this.data.detail
    if (!detail || this.data.reuseLoading) return
    this.setData({ reuseLoading: true })
    try {
      const today = db.todayStr()
      await db.clearDrafts(today)
      for (let i = 0; i < detail.list.length; i++) {
        const r = detail.list[i]
        await db.addToTonight({
          _id: r.dishId,
          name: r.name,
          image: r.image
        }, today)
      }
      this.setData({ detail: null, reuseLoading: false })
      toast('已把 ' + detail.list.length + ' 道菜加进今晚')
    } catch (e) {
      console.error('[calendar] 复用失败', e)
      this.setData({ reuseLoading: false })
      toast('加进失败，请重试')
    }
  },

  noop() {}
})
