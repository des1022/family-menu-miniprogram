const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { toast, confirm, pad, parseTags, parseIngredients, parseSteps } = require('../../utils/util.js')

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

/** 距离上次吃这道菜多久 */
function lastText(lastMap, id) {
  const d = (lastMap || {})[id]
  if (!d) return '还没做过'
  const t = new Date(d.replace(/-/g, '/') + ' 00:00:00').getTime()
  const now = new Date(new Date().toDateString()).getTime()
  const days = Math.round((now - t) / 86400000)
  if (days <= 0) return '今天吃过'
  if (days === 1) return '昨天吃过'
  return days + ' 天没做了'
}

Page({
  data: {
    themeCls: '',
    ico: {},
    year: 2026,
    month: 1,
    monthText: '',
    today: '',
    cells: [],
    arr: null,
    arrDetail: null,
    upcoming: [],
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
    const n = theme.isDark() ? '-d' : ''
    this.setData({
      themeCls: theme.className(),
      ico: { search: '/assets/icons/search' + n + '.png' }
    })
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
      const lastMap = {}
      records.forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = []
        byDate[r.date].push(r)
        if (!lastMap[r.dishId] || r.date > lastMap[r.dishId]) lastMap[r.dishId] = r.date
      })
      this._byDate = byDate
      this._lastMap = lastMap
      this.buildCells()
      this.buildUpcoming()
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

  /** 菜品表：分类占比要用 category，安排菜品时要用整个上架列表 */
  ensureDishes() {
    if (this._dishList) return Promise.resolve()
    return db.getAllDishes().then(list => {
      const map = {}
      list.forEach(d => { map[d._id] = d })
      this._dishMap = map
      this._dishList = list.filter(d => d.status === config.DISH_STATUS.ON)
    }).catch(() => {
      this._dishMap = {}
      this._dishList = []
    })
  },

  /** 接下来的安排：未来日期已经排好的菜（几号 · 什么菜） */
  buildUpcoming() {
    const today = db.todayStr()
    const byDate = this._byDate || {}
    const dates = Object.keys(byDate).filter(d => d > today).sort()
    this.setData({
      upcoming: dates.slice(0, 10).map(d => ({
        date: d,
        label: this.dateCN(d),
        names: (byDate[d] || []).map(r => r.dishName || '这道菜').join('、')
      }))
    })
  },

  onUpTap(e) {
    const date = e.currentTarget.dataset.date
    if (date) this.openArrange(date)
  },

  /* ==================== 某天的一桌菜 / 提前安排 ==================== */

  /** 日期中文写法：10月15日 周三 */
  dateCN(date) {
    const p = String(date).split('-')
    const y = Number(p[0])
    const m = Number(p[1])
    const d = Number(p[2])
    const w = '日一二三四五六'.charAt(new Date(y, m - 1, d).getDay())
    return m + '月' + d + '日 周' + w
  },

  /** 点任意日期（含未来）→ 打开「安排这一天」的弹层 */
  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    this.openArrange(date)
  },

  async openArrange(date) {
    await this.ensureDishes()
    const today = db.todayStr()
    const list = (this._byDate || {})[date] || []
    const picked = {}
    list.forEach(r => { picked[r.dishId] = true })

    this._arrDate = date
    this._picked = picked
    this._arrRecords = list.slice()
    this._arrDirty = false

    const title = date === today
      ? '今天 · ' + this.dateCN(date)
      : (date < today ? '补记 · ' + this.dateCN(date) : '安排到 · ' + this.dateCN(date))

    this.setData({
      arr: {
        date: date,
        title: title,
        keyword: '',
        tab: 'all',
        canReuse: date !== today && list.length > 0,
        picked: this.pickedChips(),
        items: []
      }
    })
    this.buildArrItems()
  },

  pickedChips() {
    return (this._arrRecords || []).map(r => ({
      dishId: r.dishId,
      name: r.dishName || '这道菜'
    }))
  },

  buildArrItems() {
    const arr = this.data.arr
    if (!arr) return
    const kw = String(arr.keyword || '').trim()
    const picked = this._picked || {}
    const lastMap = this._lastMap || {}

    const list = (this._dishList || []).filter(d => {
      if (kw) {
        const hit = String(d.name || '').indexOf(kw) > -1
          || String(d.ingredients || '').indexOf(kw) > -1
        if (!hit) return false
      }
      if (arr.tab === 'fav' && d.favorite !== 1) return false
      return true
    })

    // 已排在这一天的排前面，方便直接撤
    const sorted = list.slice().sort((a, b) => (picked[b._id] ? 1 : 0) - (picked[a._id] ? 1 : 0))
    this.setData({
      'arr.items': sorted.map(d => ({
        _id: d._id,
        name: d.name,
        initial: initialOf(d.name),
        ph: phIdx(d._id),
        sub: (d.category ? d.category + ' · ' : '') + lastText(lastMap, d._id),
        on: !!picked[d._id]
      }))
    })
  },

  onArrSearch(e) {
    this.setData({ 'arr.keyword': e.detail.value }, () => this.buildArrItems())
  },

  onArrTab(e) {
    this.setData({ 'arr.tab': e.currentTarget.dataset.t }, () => this.buildArrItems())
  },

  onPlan(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const dish = (this._dishList || []).filter(d => d._id === id)[0]
    if (dish) this.togglePlan(dish)
  },

  onUnplan(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const dish = (this._dishList || []).filter(d => d._id === id)[0] || { _id: id }
    this.togglePlan(dish)
  },

  /** 加进这一天 / 从这一天撤掉 */
  async togglePlan(dish) {
    const date = this._arrDate
    const id = dish && dish._id
    if (!date || !id) return
    const picked = this._picked || {}
    const on = !!picked[id]
    try {
      if (on) {
        await db.removeFromTonight(date, id)
        delete picked[id]
        this._arrRecords = (this._arrRecords || []).filter(r => r.dishId !== id)
      } else {
        await db.addToTonight(dish, date)
        picked[id] = true
        this._arrRecords = (this._arrRecords || []).concat([{
          dishId: id,
          dishName: dish.name || '',
          dishImage: dish.image || ''
        }])
        wx.vibrateShort({ type: 'light', fail: () => {} })
      }
      this._picked = picked
      this._arrDirty = true
      this.setData({
        'arr.picked': this.pickedChips(),
        'arr.canReuse': date !== db.todayStr() && this._arrRecords.length > 0
      })
      this.buildArrItems()
    } catch (err) {
      console.error('[calendar] 安排菜品失败', err)
      toast('操作失败，请重试')
    }
  },

  /** 点菜名 → 看这道菜的详情（做法 / 食材），和菜库里看到的一样 */
  onOpenDish(e) {
    const id = e.currentTarget.dataset.id
    const dish = (this._dishList || []).filter(d => d._id === id)[0]
    if (!dish) return
    const picked = this._picked || {}
    this.setData({
      arrDetail: {
        _id: dish._id,
        name: dish.name,
        image: dish.image || '',
        initial: initialOf(dish.name),
        ph: phIdx(dish._id),
        category: dish.category || '',
        meta: (dish.category ? dish.category + ' · ' : '') + lastText(this._lastMap || {}, dish._id),
        tagList: parseTags(dish.tags).slice(0, 4),
        ingList: parseIngredients(dish.ingredients).slice(0, 12),
        stepList: parseSteps(dish.steps),
        desc: dish.desc || '',
        on: !!picked[dish._id]
      }
    })
  },

  closeDish() {
    this.setData({ arrDetail: null })
  },

  async onDetailToggle() {
    const d = this.data.arrDetail
    if (!d) return
    const dish = (this._dishList || []).filter(x => x._id === d._id)[0] || { _id: d._id, name: d.name }
    await this.togglePlan(dish)
    this.setData({ 'arrDetail.on': !!(this._picked || {})[d._id] })
  },

  closeArr() {
    const dirty = this._arrDirty
    this._arrDate = null
    this._arrRecords = []
    this._arrDirty = false
    this.setData({ arr: null, arrDetail: null })
    if (dirty) this.loadRecords()
  },

  /** 把这天的菜一键搬到今晚（替换今晚的草稿，会先确认） */
  async onReuse() {
    if (this.data.reuseLoading) return
    const records = this._arrRecords || []
    if (!records.length) return
    const today = db.todayStr()
    const ok = await confirm('把今晚的菜单换成这 ' + records.length + ' 道菜？', '加进今晚', '换过去')
    if (!ok) return
    this.setData({ reuseLoading: true })
    try {
      await db.clearDrafts(today)
      for (let i = 0; i < records.length; i++) {
        const r = records[i]
        await db.addToTonight({ _id: r.dishId, name: r.dishName, image: r.dishImage || '' }, today)
      }
      this.setData({ reuseLoading: false })
      toast('已把 ' + records.length + ' 道菜加进今晚')
      this._arrDirty = false
      this.closeArr()
    } catch (e) {
      console.error('[calendar] 复用失败', e)
      this.setData({ reuseLoading: false })
      toast('加进失败，请重试')
    }
  },

  noop() {}
})
