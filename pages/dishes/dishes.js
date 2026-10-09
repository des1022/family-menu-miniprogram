const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { toast, confirm, parseTags, parseIngredients, parseSteps } = require('../../utils/util.js')

const PH = ['', 'img-ph--2', 'img-ph--3', 'img-ph--4', 'img-ph--5']
const FOCUS_KEY = 'fm_focus_dish'

/* ==================== 分类图标 ==================== */

const CAT_ICON_EXACT = {
  '全部': 'all', '热菜': 'hot', '炒菜': 'hot', '荤菜': 'hot',
  '素菜': 'veg', '青菜': 'veg', '蔬菜': 'veg',
  '汤羹': 'soup', '汤': 'soup',
  '主食': 'staple', '饭面': 'staple',
  '凉菜': 'cold', '凉拌': 'cold',
  '水产': 'fish', '海鲜': 'fish'
}

/** 分类名 -> 图标键。精确命中优先，否则按关键词猜，最后兜底「盘子」 */
function catIconKey(name) {
  const n = String(name || '').trim()
  if (!n) return 'all'
  if (CAT_ICON_EXACT[n]) return CAT_ICON_EXACT[n]
  if (/凉|拌/.test(n)) return 'cold'          // 要先判，否则「凉菜」会被 /菜/ 抢走
  if (/热菜|炒|荤|肉|锅/.test(n)) return 'hot'
  if (/汤|羹|煲/.test(n)) return 'soup'
  if (/主食|饭|面|粥|馍|粉/.test(n)) return 'staple'
  if (/水产|海鲜|鱼|虾|蟹|贝/.test(n)) return 'fish'
  if (/素|青|蔬|菜/.test(n)) return 'veg'
  return 'def'
}

/** 分类项图标表：未选中＝彩色版，选中＝白色版（压在实心色块上）。
    写成完整路径而不是拼字符串，静态检查才校验得到图片是否真的存在。 */
const CAT_ICONS = {
  all: { icon: '/assets/icons/cat-all.png', iconW: '/assets/icons/cat-all-w.png' },
  hot: { icon: '/assets/icons/cat-hot.png', iconW: '/assets/icons/cat-hot-w.png' },
  veg: { icon: '/assets/icons/cat-veg.png', iconW: '/assets/icons/cat-veg-w.png' },
  soup: { icon: '/assets/icons/cat-soup.png', iconW: '/assets/icons/cat-soup-w.png' },
  staple: { icon: '/assets/icons/cat-staple.png', iconW: '/assets/icons/cat-staple-w.png' },
  cold: { icon: '/assets/icons/cat-cold.png', iconW: '/assets/icons/cat-cold-w.png' },
  fish: { icon: '/assets/icons/cat-fish.png', iconW: '/assets/icons/cat-fish-w.png' },
  def: { icon: '/assets/icons/cat-def.png', iconW: '/assets/icons/cat-def-w.png' }
}

function catIcons(name) {
  return CAT_ICONS[catIconKey(name)] || CAT_ICONS.def
}

function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0) : '菜'
}

function phOf(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  return PH[h % PH.length]
}

/** 距离上次做这道菜多少天 */
function daysAgoText(dateStr, lastMap, id) {
  const d = lastMap[id]
  if (!d) return '还没做过'
  const t = new Date(d.replace(/-/g, '/') + ' 00:00:00').getTime()
  const now = new Date(new Date().toDateString()).getTime()
  const days = Math.round((now - t) / 86400000)
  if (days <= 0) return '今天做过'
  if (days === 1) return '昨天做过'
  return days + ' 天没做了'
}

Page({
  data: {
    themeCls: '',
    ico: {},
    keyword: '',
    layout: config.LAYOUT.GRID,

    chips: [],
    activeKey: '',
    activeCat: '',
    catNames: [],
    catList: [],
    hasFilter: false,

    allCount: 0,
    showCount: 0,
    list: [],
    loading: true,
    detail: null
  },

  onShow() {
    this.setData({ themeCls: theme.className(), ico: this.buildIco() })
    this.loadAll().then(() => this.checkFocus())
  },

  buildIco() {
    const n = theme.isDark() ? '-d' : ''
    return { search: '/assets/icons/search' + n + '.png' }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  /** 从「今晚」点某道菜跳过来时，直接打开它的弹层 */
  checkFocus() {
    const id = wx.getStorageSync(FOCUS_KEY)
    if (!id) return
    wx.removeStorageSync(FOCUS_KEY)
    const dish = (this._all || []).filter(d => d._id === id)[0]
    if (dish) this.openDetail(dish)
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [dishes, cats, records] = await Promise.all([
        db.getAllDishes().catch(() => []),
        db.getCategories().catch(() => []),
        db.getAllRecords().catch(() => [])
      ])

      const onShelf = dishes.filter(d => d.status === config.DISH_STATUS.ON)
      this._all = onShelf

      // 近 28 天做过的次数 / 近 7 天做过的集合 / 最后做过日期
      const dates28 = db.recentDates(28)
      const dates7 = db.recentDates(7)
      const in28 = {}
      const in7 = {}
      dates28.forEach(d => { in28[d] = true })
      dates7.forEach(d => { in7[d] = true })

      const freq = {}
      this._recentIds = {}
      this._lastMap = {}
      records.forEach(r => {
        if (in28[r.date]) freq[r.dishId] = (freq[r.dishId] || 0) + 1
        if (in7[r.date]) this._recentIds[r.dishId] = true
        if (!this._lastMap[r.dishId] || r.date > this._lastMap[r.dishId]) this._lastMap[r.dishId] = r.date
      })
      this._freq = freq

      const todayRecords = records.filter(r => r.date === db.todayStr())
      this._tonight = {}
      todayRecords.forEach(r => { this._tonight[r.dishId] = true })

      const fromDishes = Array.from(new Set(onShelf.map(d => d.category).filter(Boolean)))
      const catNames = Array.from(new Set(cats.map(c => c.name).concat(fromDishes)))
      this._cats = catNames

      this.setData({ allCount: dishes.length, catNames: catNames })
      this.buildCatList()
      this.buildChips()
      this.filterList()
    } catch (e) {
      console.error('[dishes] 加载失败', e)
      toast('加载失败，下拉重试')
    } finally {
      this.setData({ loading: false })
    }
  },

  buildChips() {
    // 「全部」已经放到左侧分类列的第一项，这里只留两种状态筛选
    const chips = [
      { key: config.CAT_FAV, label: '★ 常吃', acc: true },
      { key: config.CAT_RECENT, label: '本周没吃', acc: false }
    ]
    this.setData({ chips: chips })
  },

  /** 左侧分类列（含每类数量，「全部」排第一） */
  buildCatList() {
    const all = this._all || []
    const count = {}
    all.forEach(d => {
      const c = d.category || '未分类'
      count[c] = (count[c] || 0) + 1
    })
    const names = Array.from(new Set((this._cats || []).concat(Object.keys(count))))
    const list = [Object.assign({ name: '', label: '全部', count: all.length }, catIcons(''))]
    names.forEach(n => list.push(Object.assign({ name: n, label: n, count: count[n] || 0 }, catIcons(n))))
    this.setData({ catList: list })
  },

  onToggleLayout() {
    const next = this.data.layout === config.LAYOUT.GRID ? config.LAYOUT.LIST : config.LAYOUT.GRID
    wx.setStorageSync('fm_layout', next)
    this.setData({ layout: next })
  },

  /* ==================== 筛选 ==================== */

  onSwitchFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({
      activeKey: key,
      activeCat: '',
      hasFilter: !!key
    }, () => this.filterList())
  },

  /** 左侧分类列点击（name 为空 = 全部） */
  onPickCatSide(e) {
    const name = e.currentTarget.dataset.name || ''
    this.setData({
      activeCat: name,
      activeKey: name,
      hasFilter: !!name
    }, () => this.filterList())
  },

  onClearFilter() {
    this.setData({ activeKey: '', activeCat: '', keyword: '', hasFilter: false }, () => this.filterList())
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.filterList())
  },

  onClearSearch() {
    this.setData({ keyword: '' }, () => this.filterList())
  },

  filterList() {
    const all = this._all || []
    const kw = String(this.data.keyword || '').trim()
    const key = this.data.activeKey
    const freq = this._freq || {}
    const recent = this._recentIds || {}
    const tonight = this._tonight || {}
    const lastMap = this._lastMap || {}

    let list = all.filter(d => {
      if (kw) {
        const hit = String(d.name || '').indexOf(kw) > -1
          || String(d.ingredients || '').indexOf(kw) > -1
        if (!hit) return false
      }
      if (key === config.CAT_FAV) return d.favorite === 1 || (freq[d._id] || 0) > 0
      if (key === config.CAT_RECENT) return !recent[d._id]
      if (key) return d.category === key
      return true
    })

    if (key === config.CAT_FAV) {
      list = list.slice().sort((a, b) => {
        const fa = a.favorite === 1 ? 99999 : (freq[a._id] || 0)
        const fb = b.favorite === 1 ? 99999 : (freq[b._id] || 0)
        return fb - fa
      })
    } else if (!key && !kw) {
      // 全部：收藏优先，其次按最近做过的时间倒序（久没做的排前面更利于轮换）
      list = list.slice().sort((a, b) => {
        const fa = a.favorite === 1 ? 1 : 0
        const fb = b.favorite === 1 ? 1 : 0
        if (fa !== fb) return fb - fa
        return (lastMap[a._id] || '') < (lastMap[b._id] || '') ? -1 : 1
      })
    }

    const decorated = list.map(d => ({
      _id: d._id,
      name: d.name,
      image: d.image || '',
      category: d.category || '',
      favorite: d.favorite === 1 ? 1 : 0,
      ingredients: d.ingredients || '',
      initial: initialOf(d.name),
      ph: phOf(d._id),
      onTonight: !!tonight[d._id],
      tip: freq[d._id] ? '近一月 ' + freq[d._id] + ' 次' : ''
    }))

    this.setData({ list: decorated, showCount: decorated.length })
    this._listRaw = list
  },

  /* ==================== 详情弹层 ==================== */

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id
    const dish = (this._all || []).filter(d => d._id === id)[0]
    if (dish) this.openDetail(dish)
  },

  openDetail(dish) {
    const tonight = this._tonight || {}
    this.setData({
      detail: {
        _id: dish._id,
        name: dish.name,
        image: dish.image || '',
        category: dish.category || '',
        desc: dish.desc || '',
        ingredients: dish.ingredients || '',
        ingList: parseIngredients(dish.ingredients).slice(0, 12),
        stepList: parseSteps(dish.steps),
        tagList: parseTags(dish.tags).slice(0, 4),
        favorite: dish.favorite === 1 ? 1 : 0,
        initial: initialOf(dish.name),
        ph: phOf(dish._id),
        onTonight: !!tonight[dish._id],
        lastText: daysAgoText('', this._lastMap || {}, dish._id)
      }
    })
  },

  closeDetail() {
    this.setData({ detail: null })
  },

  /** 加入 / 撤出今晚（含弹层与列表两处入口） */
  async onToggleTonight(e) {
    const id = (e.currentTarget.dataset.id) || (this.data.detail && this.data.detail._id)
    if (!id) return
    const dish = (this._all || []).filter(d => d._id === id)[0]
    if (!dish) return

    const tonight = this._tonight || {}
    const on = !!tonight[id]
    try {
      if (on) {
        const ok = await confirm('把「' + dish.name + '」从今晚的桌上撤掉？', '撤掉', '撤掉')
        if (!ok) return
        await db.removeFromTonight(db.todayStr(), id)
        delete this._tonight[id]
      } else {
        await db.addToTonight(dish, db.todayStr())
        this._tonight[id] = true
        wx.vibrateShort({ type: 'light', fail: () => {} })
      }
      toast(on ? '已撤掉' : '已加进今晚的桌')
      this.filterList()
      if (this.data.detail && this.data.detail._id === id) {
        this.setData({ 'detail.onTonight': !on })
      }
    } catch (err) {
      console.error('[dishes] 操作失败', err)
      toast('操作失败，请重试')
    }
  },

  async onToggleFav() {
    const d = this.data.detail
    if (!d) return
    const next = d.favorite === 1 ? 0 : 1
    try {
      await db.setFavorite(d._id, next)
      const raw = (this._all || []).filter(x => x._id === d._id)[0]
      if (raw) raw.favorite = next
      this.setData({ 'detail.favorite': next })
      toast(next ? '已标为常吃' : '已取消常吃')
      this.filterList()
    } catch (e) {
      console.error('[dishes] 收藏失败', e)
      toast('操作失败，请重试')
    }
  },

  onEdit() {
    const d = this.data.detail
    if (!d) return
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + d._id })
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  },

  noop() {}
})
