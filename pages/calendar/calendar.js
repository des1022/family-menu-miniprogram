const db = require('../../utils/db.js')
const { toast, pad } = require('../../utils/util.js')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

Page({
  data: {
    year: 2026,
    month: 1,
    monthText: '',
    weeks: [],
    today: '',
    monthTotal: 0,
    detail: null,     // { date, dateText, list, totalNum }
    reuseLoading: false
  },

  onLoad() {
    const now = new Date()
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      today: this.dateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
    })
  },

  onShow() {
    this.loadRecords()
  },

  onPullDownRefresh() {
    this.loadRecords()
    wx.stopPullDownRefresh()
  },

  dateStr(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d)
  },

  async loadRecords() {
    try {
      const records = await db.getAllRecords()
      const byDate = {}
      records.forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = { totalNum: 0, dishCount: 0 }
        byDate[r.date].totalNum += r.num || 0
        byDate[r.date].dishCount += 1
      })
      this._records = records
      this._byDate = byDate
      this.buildCells()
    } catch (e) {
      console.error('[calendar] 加载失败', e)
      toast('加载失败，下拉重试')
    }
  },

  buildCells() {
    const year = this.data.year
    const month = this.data.month
    const byDate = this._byDate || {}
    const first = new Date(year, month - 1, 1)
    const offset = (first.getDay() + 6) % 7  // 周一开头
    const days = new Date(year, month, 0).getDate()

    let monthTotal = 0
    const cells = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= days; d++) {
      const date = this.dateStr(year, month, d)
      const mark = byDate[date] || null
      if (mark) monthTotal += mark.totalNum
      cells.push({ day: d, date: date, mark: mark })
    }
    while (cells.length % 7 !== 0) cells.push(null)

    const weeks = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

    this.setData({
      weeks: weeks,
      monthText: year + '年' + month + '月',
      monthTotal: monthTotal
    })
  },

  prevMonth() {
    let y = this.data.year
    let m = this.data.month - 1
    if (m === 0) { y -= 1; m = 12 }
    this.setData({ year: y, month: m }, () => this.buildCells())
  },

  nextMonth() {
    let y = this.data.year
    let m = this.data.month + 1
    if (m === 13) { y += 1; m = 1 }
    this.setData({ year: y, month: m }, () => this.buildCells())
  },

  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    const mark = (this._byDate || {})[date]
    if (!mark) return
    const list = (this._records || []).filter(r => r.date === date)
    if (!list.length) return
    const totalNum = list.reduce((s, r) => s + (r.num || 0), 0)
    this.setData({
      detail: {
        date: date,
        dateText: date.replace('-', '年').replace('-', '月') + '日',
        list: list,
        totalNum: totalNum
      }
    })
  },

  closeDetail() {
    this.setData({ detail: null })
  },

  noop() {},

  /** 当日菜单一键复用到今天 */
  async onReuse() {
    const detail = this.data.detail
    if (!detail || this.data.reuseLoading) return
    this.setData({ reuseLoading: true })
    try {
      const today = db.todayStr()
      for (let i = 0; i < detail.list.length; i++) {
        const r = detail.list[i]
        await db.recordUpsert(today, {
          _id: r.dishId,
          name: r.dishName,
          image: r.dishImage,
          price: r.price
        }, r.num)
      }
      this.setData({ detail: null, reuseLoading: false })
      toast('已复用 ' + detail.list.length + ' 道菜到今日点单')
    } catch (e) {
      console.error('[calendar] 复用失败', e)
      this.setData({ reuseLoading: false })
      toast('复用失败，请重试')
    }
  }
})
