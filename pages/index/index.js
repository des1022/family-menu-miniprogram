const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { toast } = require('../../utils/util.js')

const ALL_CAT = '全部'
const FAV_CAT = config.CAT_FAV
const FAV_LABEL = '常吃 ⭐'

function splitTags(raw) {
  return String(raw || '').split(/[,，;；]+/).filter(Boolean)
}

Page({
  data: {
    allDishes: [],
    showList: [],
    categories: [ALL_CAT, FAV_LABEL],
    activeCat: ALL_CAT,
    keyword: '',
    tagPool: [],
    activeTags: [],
    activeTagMap: {},
    numMap: {},
    totalNum: 0,
    loading: true,
    showGuide: false
  },

  onLoad() {
    const guideShown = wx.getStorageSync(config.KEYS.GUIDE_SHOWN)
    if (!guideShown) this.setData({ showGuide: true })
  },

  onShow() {
    this.loadDishes()
    this.loadToday()
    // 实时同步：家人点菜 / 录菜自动刷新
    this.attachWatcher()
  },

  onHide() {
    this.detachWatcher()
  },

  onUnload() {
    this.detachWatcher()
  },

  onPullDownRefresh() {
    this.loadDishes(true)
    this.loadToday()
    wx.stopPullDownRefresh()
  },

  /* ---------- 数据 ---------- */

  async loadDishes(silent) {
    if (!silent) this.setData({ loading: true })
    try {
      const dishes = await db.getOnDishes()
      const cats = await db.getCategories()
      let freq = {}
      try { freq = await db.getDishFreq() } catch (e) { freq = {} }
      this._freq = freq

      const fromDishes = Array.from(new Set(dishes.map(d => d.category).filter(Boolean)))
      const merged = [ALL_CAT, FAV_LABEL].concat(
        Array.from(new Set(cats.map(c => c.name).concat(fromDishes)))
      )

      // 标签池：全部上架菜出现过的标签
      const tagSet = {}
      dishes.forEach(d => splitTags(d.tags).forEach(t => { tagSet[t] = true }))
      const tagPool = Object.keys(tagSet).sort()

      this.setData({
        allDishes: dishes,
        categories: merged,
        tagPool: tagPool
      }, () => this.filterList())
    } catch (e) {
      console.error('[index] 加载菜品失败', e)
      toast('菜品加载失败，下拉重试')
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadToday() {
    try {
      const records = await db.getRecordsByDate(db.todayStr())
      this.applyRecords(records)
    } catch (e) {
      console.warn('[index] 今日记录加载失败', e)
    }
  },

  applyRecords(records) {
    const numMap = {}
    let total = 0
    records.forEach(r => {
      numMap[r.dishId] = r.num
      total += r.num
    })
    this.setData({ numMap: numMap, totalNum: total })
  },

  attachWatcher() {
    if (this._watcher) return
    this._watcher = db.watchRecordsByDate(db.todayStr(), docs => this.applyRecords(docs))
  },

  detachWatcher() {
    if (this._watcher && this._watcher.close) this._watcher.close()
    this._watcher = null
  },

  /* ---------- 筛选 ---------- */

  filterList() {
    const { allDishes, activeCat, keyword, activeTags } = this.data
    const freq = this._freq || {}
    const kw = (keyword || '').trim()
    const isFav = activeCat === FAV_LABEL

    let list = allDishes.filter(item => {
      if (kw && (item.name || '').indexOf(kw) === -1) return false
      if (activeTags.length) {
        const tags = splitTags(item.tags)
        for (let i = 0; i < activeTags.length; i++) {
          if (tags.indexOf(activeTags[i]) === -1) return false
        }
      }
      if (isFav) {
        return item.favorite === 1 || (freq[item._id] || 0) > 0
      }
      if (activeCat !== ALL_CAT) return item.category === activeCat
      return true
    })

    if (isFav) {
      list = list.slice().sort((a, b) => {
        const fa = a.favorite === 1 ? 999999 : (freq[a._id] || 0)
        const fb = b.favorite === 1 ? 999999 : (freq[b._id] || 0)
        return fb - fa
      })
    }

    this.setData({ showList: list })
  },

  onSwitchCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat }, () => this.filterList())
  },

  onToggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.activeTags.slice()
    const idx = list.indexOf(tag)
    if (idx > -1) list.splice(idx, 1)
    else list.push(tag)
    const map = {}
    list.forEach(item => { map[item] = true })
    this.setData({ activeTags: list, activeTagMap: map }, () => this.filterList())
  },

  onClearTags() {
    this.setData({ activeTags: [], activeTagMap: {} }, () => this.filterList())
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.filterList())
  },

  onSearch() {
    this.filterList()
  },

  onClearSearch() {
    this.setData({ keyword: '' }, () => this.filterList())
  },

  /* ---------- 点菜（直写云端 records，全家实时同步） ---------- */

  async onAddDish(e) {
    const dish = e.detail.dish
    try {
      await db.recordUpsert(db.todayStr(), dish, 1)
      const cur = this.data.numMap[dish._id] || 0
      this.setData({
        ['numMap.' + dish._id]: cur + 1,
        totalNum: this.data.totalNum + 1
      })
      wx.vibrateShort({ type: 'light', fail: () => {} })
    } catch (err) {
      console.error('[index] 点菜失败', err)
      toast('点菜失败，请重试')
    }
  },

  async onDecDish(e) {
    const dish = e.detail.dish
    try {
      await db.recordUpsert(db.todayStr(), dish, -1)
      const cur = this.data.numMap[dish._id] || 0
      const next = Math.max(0, cur - 1)
      this.setData({
        ['numMap.' + dish._id]: next,
        totalNum: Math.max(0, this.data.totalNum - 1)
      })
    } catch (err) {
      console.error('[index] 减菜失败', err)
      toast('操作失败，请重试')
    }
  },

  onCloseGuide() {
    wx.setStorageSync(config.KEYS.GUIDE_SHOWN, true)
    this.setData({ showGuide: false })
  },

  noop() {}
})
