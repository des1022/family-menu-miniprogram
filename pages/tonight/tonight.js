const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { SAMPLE_DISHES } = require('../../utils/samples.js')
const { toast, confirm } = require('../../utils/util.js')

const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const PH = ['', 'img-ph--2', 'img-ph--3', 'img-ph--4', 'img-ph--5']

/** 主题相关的图标路径 */
function iconSet(dark) {
  const n = dark ? '-d' : ''
  const p = dark ? '-pd' : '-p'
  return {
    bowl: '/assets/icons/bowl' + n + '.png',
    basket: '/assets/icons/basket' + p + '.png',
    dice: '/assets/icons/sparkle' + p + '.png',
    users: '/assets/icons/users' + n + '.png',
    download: '/assets/icons/download' + n + '.png'
  }
}

function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0) : '家'
}

function phOf(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  return PH[h % PH.length]
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

Page({
  data: {
    themeCls: '',
    ico: {},
    today: '',
    dateText: '',

    members: [],
    eatCount: 0,

    allDishes: [],
    allCount: 0,
    cards: [],
    recent: [],
    suggest: null,
    ingCount: 0,
    ingList: [],

    pickHint: '2 荤 1 素 1 汤 · 3 秒定',
    showIng: false,
    guide: false,
    busy: false
  },

  onLoad() {
    const now = new Date()
    this.setData({
      today: db.todayStr(),
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + WEEK[now.getDay()]
    })
    if (!wx.getStorageSync(config.KEYS.GUIDE_SHOWN)) this.setData({ guide: true })

    this._unsub = theme.subscribe(() => this.applyTheme())
  },

  onShow() {
    this.applyTheme()
    this.loadAll()
  },

  onUnload() {
    if (this._unsub) this._unsub()
  },

  onHide() {
    if (this._watcher && this._watcher.close) this._watcher.close()
    this._watcher = null
  },

  applyTheme() {
    const dark = theme.isDark()
    this.setData({ themeCls: theme.className(), ico: iconSet(dark), _dark: dark })
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  /* ==================== 数据 ==================== */

  async loadAll() {
    this.setData({ busy: true })
    try {
      await db.ensureMyMember()
    } catch (e) {
      console.warn('[tonight] 成员初始化失败（可能云环境未就绪）', e)
    }

    try {
      const [members, dishes, records] = await Promise.all([
        db.getMembers().catch(() => []),
        db.getAllDishes().catch(() => []),
        db.getRecordsByDate(this.data.today).catch(() => [])
      ])

      this._allRecords = await db.getAllRecords().catch(() => [])
      this._lastMap = {}
      this._allRecords.forEach(r => {
        if (!this._lastMap[r.dishId] || r.date > this._lastMap[r.dishId]) this._lastMap[r.dishId] = r.date
      })

      const onDishes = dishes.filter(d => d.status === config.DISH_STATUS.ON)
      this._dishMap = {}
      dishes.forEach(d => { this._dishMap[d._id] = d })

      this.setData({
        members: members.map(m => Object.assign({}, m, {
          initial: initialOf(m.nickname),
          eatTonight: Number(m.eatTonight) !== config.EAT_TONIGHT.NO
        })),
        eatCount: db.countEatTonight(members),
        allDishes: onDishes,
        allCount: dishes.length,
        busy: false
      })
      this.applyRecords(records)
      this.buildRecent(onDishes)
      this.attachWatcher()
    } catch (e) {
      console.error('[tonight] 加载失败', e)
      this.setData({ busy: false })
      toast('加载失败，下拉重试')
    }
  },

  attachWatcher() {
    if (this._watcher) return
    this._watchDate = this.data.today
    this._watcher = db.watchRecordsByDate(this._watchDate, docs => {
      this.applyRecords(docs)
    })
  },

  applyRecords(records) {
    const today = db.todayStr()
    const cards = (records || []).map(r => {
      const dish = this._dishMap ? this._dishMap[r.dishId] : null
      return {
        id: r._id,
        dishId: r.dishId,
        name: r.dishName || (dish ? dish.name : ''),
        image: r.dishImage || (dish ? dish.image : '') || '',
        category: dish ? dish.category : '',
        remark: r.remark || '',
        confirmed: Number(r.confirmed) === config.RECORD_CONFIRMED.CONFIRMED,
        byName: r.byName || '',
        byColor: r.byColor || '#D9714E',
        initial: initialOf(r.dishName || (dish ? dish.name : '')),
        ph: phOf(r.dishId)
      }
    })
    this.setData({ cards: cards, today: today })
    this.buildSuggest(cards)
    this.buildIngredients(records || [])
  },

  buildRecent(onDishes) {
    const dates = db.recentDates(28)
    const inRange = {}
    dates.forEach(d => { inRange[d] = true })
    const count = {}
    const last = {}
    ;(this._allRecords || []).forEach(r => {
      if (!inRange[r.date]) return
      count[r.dishId] = (count[r.dishId] || 0) + 1
      if (!last[r.dishId] || r.date > last[r.dishId]) last[r.dishId] = r.date
    })

    let list = (onDishes || []).slice().sort((a, b) => {
      const fa = a.favorite === 1 ? 9999 : (count[a._id] || 0)
      const fb = b.favorite === 1 ? 9999 : (count[b._id] || 0)
      return fb - fa
    }).slice(0, 8)

    if (!list.length) {
      // 没有历史就先给出上架菜品的前几道，保证「最近常吃」不是一个空洞
      list = (onDishes || []).slice(0, 6)
    }

    this.setData({
      recent: list.map(d => Object.assign({}, d, {
        initial: initialOf(d.name),
        ph: phOf(d._id),
        freqText: count[d._id] ? '近一个月做过 ' + count[d._id] + ' 次' : '还没做过'
      }))
    })
  },

  buildSuggest(cards) {
    if (!cards.length) {
      this.setData({ suggest: null })
      return
    }
    const hasVeg = cards.some(c => /素|青菜|蔬|凉拌/.test(c.category || ''))
    const hasSoup = cards.some(c => /汤|羹/.test(c.category || ''))
    if (!hasVeg) {
      this.setData({ suggest: { text: '这一桌还缺个青菜', hint: '蒜蓉小青菜 · 凉拌黄瓜 · 醋溜土豆丝' } })
    } else if (!hasSoup) {
      this.setData({ suggest: { text: '再配个汤更完整', hint: '紫菜蛋花汤 · 冬瓜排骨汤' } })
    } else {
      this.setData({ suggest: null })
    }
  },

  buildIngredients(records) {
    const list = db.buildIngredientList(records, this._dishMap || {})
    this.setData({
      ingList: list.map(i => ({ name: i.name, times: i.times, dishes: i.dishes.join('、') })),
      ingCount: list.length
    })
  },

  /* ==================== 动作 ==================== */

  goDishes() {
    wx.switchTab({ url: '/pages/dishes/dishes' })
  },

  async onQuickAdd(e) {
    const id = e.currentTarget.dataset.id
    const dish = (this.data.recent || []).filter(d => d._id === id)[0]
    if (!dish) return
    await this.addDishToTonight(dish)
  },

  async addDishToTonight(dish) {
    try {
      await db.addToTonight(dish, this.data.today)
      wx.vibrateShort({ type: 'light', fail: () => {} })
      toast('已加进今晚的桌')
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
    } catch (err) {
      console.error('[tonight] 加菜失败', err)
      toast('加菜失败，请重试')
    }
  },

  async onRemove(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '这道菜'
    const ok = await confirm('把「' + name + '」从今晚的桌上撤掉？', '撤掉', '撤掉')
    if (!ok) return
    try {
      await db.removeFromTonight(this.data.today, id)
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
    } catch (err) {
      console.error('[tonight] 撤菜失败', err)
      toast('操作失败，请重试')
    }
  },

  onOpenDish(e) {
    // 菜库是 tabBar 页面，只能 switchTab（不能带参数），用本地缓存把要看的菜传过去
    wx.setStorageSync('fm_focus_dish', e.currentTarget.dataset.id)
    wx.switchTab({ url: '/pages/dishes/dishes' })
  },

  onSugTap() {
    wx.switchTab({ url: '/pages/dishes/dishes' })
  },

  /** 帮我选一顿：从自家菜库里洗牌凑一桌（越久没做的越优先） */
  async onPickForMe() {
    if (this.data.busy) return
    const dishes = this.data.allDishes || []
    if (dishes.length < 3) {
      if (!this.data.allCount) {
        const seed = await confirm('菜库还是空的，先填入 12 道家常菜？', '提示', '填入')
        if (seed) this.onSeed()
      } else {
        toast('上架的菜还太少，先去菜库加几道')
      }
      return
    }

    if (this.data.cards.length) {
      const ok = await confirm('今晚已经点了 ' + this.data.cards.length + ' 道，要用新的一桌替换吗？', '重新选', '替换')
      if (!ok) return
    }

    const last = this._lastMap || {}
    const veg = []
    const soup = []
    const main = []
    dishes.forEach(d => {
      const c = d.category || ''
      if (/素|青菜|蔬|凉拌/.test(c)) veg.push(d)
      else if (/汤|羹/.test(c)) soup.push(d)
      else main.push(d)
    })

    const pickFrom = (pool, n) => {
      const sorted = pool.slice().sort((a, b) => {
        const la = last[a._id] || ''
        const lb = last[b._id] || ''
        if (la === lb) return 0
        return la < lb ? -1 : 1
      })
      const cand = sorted.slice(0, Math.max(n * 3, n))
      return shuffle(cand).slice(0, n)
    }

    let picked = []
    picked = picked.concat(pickFrom(main, 2))
    picked = picked.concat(pickFrom(veg, 1))
    picked = picked.concat(pickFrom(soup, 1))

    // 某一类不够就从剩下的里补，凑到 4 道（或菜库上限）
    const target = Math.min(4, dishes.length)
    if (picked.length < target) {
      const used = {}
      picked.forEach(d => { used[d._id] = true })
      const rest = shuffle(dishes.filter(d => !used[d._id]))
      while (picked.length < target && rest.length) picked.push(rest.shift())
    }
    picked = picked.slice(0, target)

    try {
      this.setData({ busy: true })
      await db.clearDrafts(this.data.today)
      for (let i = 0; i < picked.length; i++) {
        await db.addToTonight(picked[i], this.data.today)
      }
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
      this.setData({ busy: false })
      wx.vibrateShort({ type: 'medium', fail: () => {} })
      toast('定了 ' + picked.length + ' 道 · 不满意再点一次')
    } catch (e) {
      console.error('[tonight] 选一顿失败', e)
      this.setData({ busy: false })
      toast('选菜失败，请重试')
    }
  },

  onConfirmTonight() {
    if (this.data.busy || !this.data.cards.length) return
    confirm('确认今晚这 ' + this.data.cards.length + ' 道菜？确认后会记进日历。', '确认这顿饭', '确认').then(async ok => {
      if (!ok) return
      try {
        this.setData({ busy: true })
        await db.markConfirmed(this.data.today)
        const records = await db.getRecordsByDate(this.data.today)
        this.applyRecords(records)
        this.setData({ busy: false })
        wx.vibrateShort({ type: 'medium', fail: () => {} })
        toast('这一桌记下了')
      } catch (e) {
        console.error('[tonight] 确认失败', e)
        this.setData({ busy: false })
        toast('确认失败，请重试')
      }
    })
  },

  onSeed() {
    confirm('把 12 道家常菜填进菜库？（之后可以随意增删改）', '填入示例菜库', '填入').then(async ok => {
      if (!ok) return
      try {
        wx.showLoading({ title: '正在填入', mask: true })
        const cats = await db.getCategories().catch(() => [])
        const names = cats.map(c => c.name)
        const need = []
        ;['热菜', '素菜', '汤羹', '主食'].forEach(n => { if (names.indexOf(n) === -1) need.push(n) })
        for (let i = 0; i < need.length; i++) {
          await db.addCategory(need[i], names.length + i)
        }
        await db.addDishes(SAMPLE_DISHES)
        wx.hideLoading()
        toast('已填入 12 道菜')
        this.loadAll()
      } catch (e) {
        wx.hideLoading()
        console.error('[tonight] 填入示例菜库失败', e)
        toast('填入失败，请重试')
      }
    })
  },

  onOpenIng() {
    this.setData({ showIng: true })
  },

  goPoster() {
    wx.navigateTo({ url: '/pages/poster/poster?date=' + this.data.today })
  },

  closeIng() {
    this.setData({ showIng: false })
  },

  onCopyIng() {
    const list = this.data.ingList || []
    if (!list.length) return
    const text = list.map(i => i.name + ' ×' + i.times).join('\n')
    wx.setClipboardData({
      data: '今日食材清单\n' + text,
      success: () => toast('已复制，可以粘给买菜的人')
    })
  },

  onCloseGuide() {
    wx.setStorageSync(config.KEYS.GUIDE_SHOWN, true)
    this.setData({ guide: false })
  },

  onShareAppMessage() {
    const n = this.data.cards.length
    return {
      title: n ? '今晚我家吃这 ' + n + ' 道，你也来点一道？' : '今晚吃什么？来点一道',
      path: '/pages/tonight/tonight'
    }
  },

  noop() {}
})
