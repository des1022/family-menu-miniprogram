const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { toast, pad } = require('../../utils/util.js')

const RING_COLORS = ['#D9582B', '#6E8B5A', '#C8A05C', '#E88A4D', '#7FA8B5', '#B389A8', '#D5B8A0', '#9BB56E']

function rangeText(label, from, to) {
  return label + ' · ' + from + ' ~ ' + to
}

/** 简单搭配建议：缺汤/缺主食引导 */
function buildTip(rank, cats) {
  if (!rank.length) return ''
  const names = cats.map(c => c.name)
  const hasSoup = names.some(n => n.indexOf('汤') > -1 || n.indexOf('羹') > -1)
  const hasStaple = names.some(n => n.indexOf('主食') > -1 || n.indexOf('饭') > -1 || n.indexOf('面') > -1)
  if (!hasSoup && !hasStaple) return '主食和汤水有点少，记得来碗饭、配道汤，吃得更舒服。'
  if (!hasSoup) return '可以试着加一道汤，润一润更养胃。'
  if (!hasStaple) return '主食别落下，米饭面条安排上。'
  return '荤素搭配不错，继续保持～'
}

Page({
  data: {
    period: 0,          // 0=本周 1=本月
    loaded: false,
    stats: null
  },

  onLoad() {
    this.build()
  },

  onPullDownRefresh() {
    this.build()
    wx.stopPullDownRefresh()
  },

  onSwitchPeriod(e) {
    this.setData({ period: Number(e.currentTarget.dataset.p) }, () => this.build())
  },

  build() {
    this.setData({ loaded: false })
    const now = new Date()
    let from, to, label
    if (this.data.period === 0) {
      const back = (now.getDay() + 6) % 7
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
      const end = new Date(start.getTime() + 6 * 86400000)
      from = start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate())
      to = end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate())
      label = '本周'
    } else {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      from = start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate())
      to = end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate())
      label = '本月'
    }

    Promise.all([db.getAllRecords(), db.getAllDishes()]).then(args => {
      const records = args[0].filter(r => r.date >= from && r.date <= to)
      const dishMap = {}
      args[1].forEach(d => { dishMap[d._id] = d })

      const days = {}
      const numByDish = {}
      const catNum = {}
      records.forEach(r => {
        const dish = dishMap[r.dishId]
        if (!dish) return
        days[r.date] = true
        numByDish[r.dishId] = (numByDish[r.dishId] || 0) + (r.num || 0)
        catNum[dish.category] = (catNum[dish.category] || 0) + (r.num || 0)
      })

      const rank = Object.keys(numByDish)
        .map(id => ({ name: dishMap[id].name, num: numByDish[id] }))
        .sort((a, b) => b.num - a.num)
        .slice(0, 10)
      const maxNum = rank.length ? rank[0].num : 1
      rank.forEach(r => { r.pct = Math.max(6, Math.round(r.num * 100 / maxNum)) })

      const cats = Object.keys(catNum)
        .map(name => ({ name: name, num: catNum[name] }))
        .sort((a, b) => b.num - a.num)
      const total = cats.reduce((s, c) => s + c.num, 0)
      cats.forEach((c, i) => {
        c.pct = total ? Math.round(c.num * 100 / total) : 0
        c.color = RING_COLORS[i % RING_COLORS.length]
      })

      this.setData({
        loaded: true,
        stats: {
          dayCount: Object.keys(days).length,
          dishCount: rank.length,
          totalNum: records.reduce((s, r) => s + (r.num || 0), 0),
          rank: rank,
          cats: cats,
          topName: rank.length ? rank[0].name : '',
          topNum: rank.length ? rank[0].num : 0,
          tipText: buildTip(rank, cats),
          rangeText: rangeText(label, from, to)
        }
      })
    }).catch(e => {
      console.error('[stats] 加载失败', e)
      toast('加载失败，下拉重试')
      this.setData({ loaded: true, stats: null })
    })
  },

  noop() {}
})
