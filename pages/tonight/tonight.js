const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { SAMPLE_DISHES } = require('../../utils/samples.js')
const { toast, confirm, alert, errText, parseSteps, parseIngredients, parseTags } = require('../../utils/util.js')
const { resolveCloudImages, cachedImgUrl, attachImgUrls } = require('../../utils/image.js')

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

/* ---------------- 决策器：搭配 / 人数 / 口味 ---------------- */

const MIXES = [
  { key: 'm1', label: '2荤1素1汤', main: 2, veg: 1, soup: 1 },
  { key: 'm2', label: '2荤2素', main: 2, veg: 2, soup: 0 },
  { key: 'm3', label: '1荤1素1汤', main: 1, veg: 1, soup: 1 },
  { key: 'm4', label: '随便配', main: 0, veg: 0, soup: 0 }
]

const SIZES = [
  { key: 's1', label: '1-2 人', total: 3 },
  { key: 's2', label: '3-4 人', total: 4 },
  { key: 's3', label: '5 人以上', total: 5 }
]

const TASTES = [
  { key: 't0', label: '随便', keys: [] },
  { key: 't1', label: '清淡', keys: ['清爽', '清淡', '凉拌', '清蒸', '不辣', '汤'] },
  { key: 't2', label: '下饭', keys: ['下饭', '家常', '红烧', '慢炖', '肉'] },
  { key: 't3', label: '重口', keys: ['辣', '川湘', '中辣', '特辣', '干锅'] }
]

/** 这道菜算荤、素还是汤 */
function roleOf(dish) {
  const s = (dish.category || '') + ' ' + (dish.tags || '') + ' ' + (dish.name || '')
  if (/汤|羹/.test(s)) return 'soup'
  if (/素|青菜|蔬|凉拌|豆腐/.test(s)) return 'veg'
  return 'main'
}

const ROLE_LABEL = { main: '硬菜', veg: '素菜', soup: '汤' }
const ROLE_ORDER = ['main', 'veg', 'soup']

/** 距离上次做这道菜多少天 */
function daysAgoText(dateStr) {
  const t = new Date(String(dateStr).replace(/-/g, '/') + ' 00:00:00').getTime()
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
    mixes: MIXES,
    sizes: SIZES,
    tastes: TASTES,
    dec: { open: false, mix: 'm1', size: 's2', taste: 't0', picks: [] },
    how: null,
    guide: false,
    busy: false,

    // 「你是家里的哪位？」（本机认不出身份时问一次）
    whoShow: false,
    whoList: [],

    // 云环境自检：集合缺失时首页直接给「要建哪几个集合」的引导
    envId: config.ENV_ID,
    env: { checked: false, ready: true, missing: [], items: [] }
  },

  onLoad() {
    const now = new Date()
    this.setData({
      today: db.todayStr(),
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + WEEK[now.getDay()]
    })
    if (!wx.getStorageSync(config.KEYS.GUIDE_SHOWN)) this.setData({ guide: true })

    // 未认证小程序用不了转发，先把入口藏掉，别让用户点到一个必然报错的按钮
    if (typeof wx.hideShareMenu === 'function') wx.hideShareMenu()

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

  /* ==================== 云环境自检 ==================== */

  /** 检查集合是否齐全；不齐就直接把引导卡显示出来，别让用户对着空页面猜 */
  async checkEnv() {
    try {
      const r = await db.checkEnv()
      this.setData({ env: { checked: true, ready: r.ready, missing: r.missing, items: r.items } })
      return r
    } catch (e) {
      // 自检本身失败（比如完全没网）就不吓唬用户，照常走后面流程
      console.warn('[tonight] 云环境自检没跑成', e)
      this.setData({ env: { checked: true, ready: true, missing: [], items: [] } })
      return { ready: true, missing: [], items: [] }
    }
  },

  async onRecheckEnv() {
    wx.showLoading({ title: '检查中', mask: true })
    const r = await this.checkEnv()
    wx.hideLoading()
    if (r.ready) {
      toast('环境已就绪')
      this.loadAll()
    } else {
      toast('还差 ' + r.missing.length + ' 个集合')
    }
  },

  onCopyCollections() {
    const names = (this.data.env.items || []).map(x => x.raw).join('\n')
    wx.setClipboardData({
      data: names,
      success: () => toast('5 个集合名已复制')
    })
  },

  /* ==================== 数据 ==================== */

  async loadAll() {
    this.setData({ busy: true })

    // 先确认云环境可用：集合没建的话后面每个查询都会失败，白打一堆请求
    const env = await this.checkEnv()
    if (!env.ready) {
      this.setData({ busy: false, members: [], eatCount: 0, cards: [], recent: [], suggest: null, allDishes: [], allCount: 0 })
      return
    }

    // 认领「我是谁」：换客户端打开 / 清过缓存时可能认不出来（返回 null），
    // 这时不要默默新建成员，交给页面问一句「你是家里的哪位」
    let me = null
    try {
      me = await db.ensureMyMember()
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
        // 认不出我是谁、但家里已经有人了 → 让用户指认，绝不自动新建
        whoShow: !me && members.length > 0 && !this._whoDismissed,
        whoList: members.map(m => ({
          _id: m._id,
          color: m.color || config.MEMBER_COLORS[0],
          initial: initialOf(m.nickname),
          nickname: m.nickname || ''
        })),
        busy: false
      })
      this.applyRecords(records)
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

  async applyRecords(records) {
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
        ph: phOf(r.dishId),
        hasSteps: !!(dish && parseSteps(dish.steps).length),
        imgSrc: r.dishImage || (dish ? dish.image : '') || '',
        imgRetried: false,
        imgFailed: false
      }
    })
    // 先换好图片链接再渲染（否则首帧是占位块，随后闪一下才变成图）
    await attachImgUrls(cards)
    this.setData({ cards: cards, today: today })
    this.buildSuggest(cards)
    this.buildIngredients(records || [])
    // 「最近家里常吃」两种状态都显示，所以要跟着今晚的桌一起刷新（标记哪几道已在桌上）
    this.buildRecent(this.data.allDishes || [])
  },

  async buildRecent(onDishes) {
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

    const onIds = {}
    ;(this.data.cards || []).forEach(c => { onIds[c.dishId] = true })

    const recent = list.map(d => Object.assign({}, d, {
      initial: initialOf(d.name),
      ph: phOf(d._id),
      onTonight: !!onIds[d._id],
      freqText: count[d._id] ? '近一个月做过 ' + count[d._id] + ' 次' : '还没做过'
    }))
    // 这个列表以前直接用 item.image（原始 fileID），所以别人传的图一直显示不出来
    await attachImgUrls(recent)
    this.setData({ recent: recent })
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

    // 已经在桌上：点一下给撤掉（带二次确认，避免误触）
    if (dish.onTonight) {
      const ok = await confirm('把「' + dish.name + '」从今晚撤掉？', '已在今晚', '撤掉')
      if (!ok) return
      try {
        await db.removeFromTonight(this.data.today, dish._id)
        toast('已从今晚撤掉')
        const records = await db.getRecordsByDate(this.data.today)
        this.applyRecords(records)
      } catch (err) {
        console.error('[tonight] 撤菜失败', err)
        toast('撤掉失败，请重试')
      }
      return
    }

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

  /** 图片加载失败 → 退回首字色块（别人账号传的图可能读不到，别留一片空白） */
  async onImgError(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    if (isNaN(idx)) return
    const card = (this.data.cards || [])[idx]
    if (!card) return
    console.warn('[tonight] 图片加载失败', idx, e.detail && e.detail.errMsg)
    if (!card.imgRetried && card.image) {
      this.setData({ ['cards[' + idx + '].imgRetried']: true })
      const urls = await resolveCloudImages([card.image], true)
      const url = urls[card.image]
      if (url) {
        this.setData({ ['cards[' + idx + '].imgSrc']: url })
        return
      }
    }
    this.setData({ ['cards[' + idx + '].imgFailed']: true })
  },

  async onHowImgError() {
    const h = this.data.how
    if (!h) return
    console.warn('[tonight] 详情图加载失败')
    if (!h.imgRetried && h.image) {
      this.setData({ 'how.imgRetried': true })
      const urls = await resolveCloudImages([h.image], true)
      const url = urls[h.image]
      if (url) {
        this.setData({ 'how.imgSrc': url })
        return
      }
    }
    this.setData({ 'how.imgFailed': true })
  },

  /** 「最近家里常吃」和「帮我选一顿」里的缩略图挂了 → 退回占位块（这两处纯展示，不重试） */
  onMiniImgError(e) {
    const ds = e.currentTarget.dataset
    const i = Number(ds.idx)
    if (isNaN(i)) return
    if (ds.list === 'recent') this.setData({ ['recent[' + i + '].imgSrc']: '' })
    else if (ds.list === 'picks') this.setData({ ['dec.picks[' + i + '].imgSrc']: '' })
  },

  /* ============ 菜品详情（就地弹出，不再跳去菜库） ============ */

  /**
   * 点今晚桌上的一道菜 → 就地弹详情。
   *
   * 原来这里是 wx.switchTab 跳去「菜库」再看详情（tabBar 页面带不了参数，
   * 只能拿本地缓存把菜 id 传过去）—— 真机上就是「点一下页面就跳走了」，
   * 2026-10-09 反馈的问题。现在跟菜库一样就地弹层：图片 / 标签 / 食材 / 备注 / 做法 全在里面。
   */
  onOpenDish(e) {
    this.openDishDetail(e.currentTarget.dataset.id)
  },

  /** 「做法」小标签：用的是同一个弹层（内容本来就含做法），只是入口更直接 */
  onOpenHow(e) {
    this.openDishDetail(e.currentTarget.dataset.id)
  },

  openDishDetail(dishId) {
    if (!dishId) return
    const dish = (this._dishMap && this._dishMap[dishId]) || null
    const card = (this.data.cards || []).filter(c => c.dishId === dishId)[0] || null
    if (!dish && !card) return
    const name = (dish && dish.name) || (card && card.name) || ''
    const fileID = (dish && dish.image) || (card && card.image) || ''
    const imgUrl = cachedImgUrl(fileID) || fileID
    this.setData({
      how: {
        recordId: card ? card.id : '',
        dishId: dishId,
        name: name,
        image: fileID,
        imgSrc: imgUrl,
        imgRetried: false,
        imgFailed: false,
        initial: initialOf(name),
        ph: phOf(dishId),
        category: (dish && dish.category) || (card && card.category) || '',
        tagList: parseTags(dish && dish.tags),
        byName: (card && card.byName) || '',
        ingList: parseIngredients(dish && dish.ingredients),
        desc: (dish && dish.desc) || '',
        stepList: parseSteps(dish && dish.steps)
      }
    })
  },

  /** 弹层里的「编辑」：跳到菜品编辑页（这是唯一该离开当前页的动作） */
  onEditDish() {
    const h = this.data.how
    if (!h || !h.dishId) return
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + h.dishId })
  },

  /** 弹层里的「从今晚撤掉」 */
  async onRemoveFromHow() {
    const h = this.data.how
    if (!h || !h.dishId) return
    const ok = await confirm('把「' + h.name + '」从今晚的桌上撤掉？', '撤掉', '撤掉')
    if (!ok) return
    try {
      await db.removeFromTonight(this.data.today, h.dishId)
      this.setData({ how: null })
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
    } catch (err) {
      console.error('[tonight] 撤菜失败', err)
      toast('操作失败，请重试')
    }
  },

  closeHow() {
    this.setData({ how: null })
  },

  /** 把做法复制成一段文字，方便发到家庭群 / 发给做饭的人 */
  onCopyHow() {
    const h = this.data.how
    if (!h) return
    const lines = [h.name]
    if (h.ingList && h.ingList.length) lines.push('食材：' + h.ingList.join('、'))
    lines.push('')
    h.stepList.forEach((s, i) => lines.push((i + 1) + '. ' + s))
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => toast('做法已复制')
    })
  },

  onSugTap() {
    wx.switchTab({ url: '/pages/dishes/dishes' })
  },

  /* ==================== 帮我选一顿（决策器） ==================== */

  onPickForMe() {
    const dishes = this.data.allDishes || []
    if (dishes.length < 3) {
      if (!this.data.allCount) {
        confirm('菜库还是空的，先填入 12 道家常菜？', '提示', '填入').then(ok => {
          if (ok) this.onSeed()
        })
      } else {
        toast('上架的菜还太少，先去菜库加几道')
      }
      return
    }
    this.setData({ 'dec.open': true }, () => this.rollAll())
  },

  closeDec() {
    this.setData({ 'dec.open': false })
  },

  onPickDecOpt(e) {
    const field = e.currentTarget.dataset.field
    const value = e.currentTarget.dataset.value
    const next = {}
    next['dec.' + field] = value
    this.setData(next, () => this.rollAll())
  },

  /** 按当前参数重新凑一桌 */
  async rollAll() {
    const mix = MIXES.filter(m => m.key === this.data.dec.mix)[0] || MIXES[0]
    const size = SIZES.filter(s => s.key === this.data.dec.size)[0] || SIZES[1]
    const taste = TASTES.filter(t => t.key === this.data.dec.taste)[0] || TASTES[0]
    const total = size.total

    let plan
    if (mix.main + mix.veg + mix.soup > 0) {
      plan = [
        { role: 'main', n: mix.main },
        { role: 'veg', n: mix.veg },
        { role: 'soup', n: mix.soup }
      ]
    } else {
      plan = [
        { role: 'main', n: Math.max(1, Math.round(total * 0.5)) },
        { role: 'veg', n: Math.max(1, Math.round(total * 0.34)) },
        { role: 'soup', n: total >= 4 ? 1 : 0 }
      ]
    }

    const used = {}
    const picks = []
    plan.forEach(part => {
      for (let i = 0; i < part.n; i++) {
        const d = this.pickCandidate(part.role, taste, used)
        if (d) {
          used[d._id] = true
          picks.push(this.decoratePick(d))
        }
      }
    })
    while (picks.length < total) {
      const d = this.pickCandidate('', taste, used)
      if (!d) break
      used[d._id] = true
      picks.push(this.decoratePick(d))
    }

    await attachImgUrls(picks)
    this.setData({ 'dec.picks': picks })
  },

  /** 从候选池挑一道：先按口味收窄，再让久没做过的排前面，最后在靠前的里随机 */
  pickCandidate(role, taste, used) {
    const dishes = this.data.allDishes || []
    const last = this._lastMap || {}
    let pool = dishes.filter(d => !used[d._id] && (!role || roleOf(d) === role))
    if (!pool.length && role) pool = dishes.filter(d => !used[d._id])
    if (!pool.length) return null

    if (taste.keys.length) {
      const hit = pool.filter(d => {
        const s = (d.name || '') + ' ' + (d.tags || '') + ' ' + (d.desc || '') + ' ' + (d.category || '')
        return taste.keys.some(k => s.indexOf(k) > -1)
      })
      if (hit.length) pool = hit
    }

    const sorted = pool.slice().sort((a, b) => {
      const la = last[a._id] || ''
      const lb = last[b._id] || ''
      if (la === lb) return 0
      return la < lb ? -1 : 1
    })
    const cand = sorted.slice(0, Math.max(4, Math.ceil(sorted.length / 2)))
    return shuffle(cand)[0]
  },

  decoratePick(d) {
    const last = (this._lastMap || {})[d._id]
    return {
      _id: d._id,
      name: d.name,
      image: d.image || '',
      category: d.category || '',
      roleLabel: ROLE_LABEL[roleOf(d)],
      initial: initialOf(d.name),
      ph: phOf(d._id),
      lastText: last ? daysAgoText(last) : '还没做过'
    }
  },

  /** 单条「换一个」：只在同类里换，不动其它 */
  async onSwapOne(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const picks = this.data.dec.picks.slice()
    const cur = picks[idx]
    if (!cur) return

    const used = {}
    picks.forEach(p => { used[p._id] = true })
    delete used[cur._id]

    const raw = (this.data.allDishes || []).filter(d => d._id === cur._id)[0]
    const role = raw ? roleOf(raw) : ''
    const taste = TASTES.filter(t => t.key === this.data.dec.taste)[0] || TASTES[0]
    const d = this.pickCandidate(role, taste, used)
    if (!d) {
      toast('这一类没有别的可换了')
      return
    }
    picks[idx] = this.decoratePick(d)
    await attachImgUrls([picks[idx]])
    this.setData({ 'dec.picks': picks })
  },

  /** 就这些，定了 */
  async onConfirmDec() {
    const picks = this.data.dec.picks || []
    if (!picks.length || this.data.busy) return

    if (this.data.cards.length) {
      const ok = await confirm('今晚已经点了 ' + this.data.cards.length + ' 道，要用新的一桌替换吗？', '替换', '替换')
      if (!ok) return
    }

    const byId = {}
    ;(this.data.allDishes || []).forEach(d => { byId[d._id] = d })

    try {
      this.setData({ busy: true })
      await db.clearDrafts(this.data.today)
      for (let i = 0; i < picks.length; i++) {
        const d = byId[picks[i]._id]
        if (d) await db.addToTonight(d, this.data.today)
      }
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
      this.setData({ busy: false, 'dec.open': false })
      wx.vibrateShort({ type: 'medium', fail: () => {} })
      toast('定了 ' + picks.length + ' 道')
    } catch (err) {
      console.error('[tonight] 定了失败', err)
      this.setData({ busy: false })
      toast('操作失败，请重试')
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
    confirm('把 ' + SAMPLE_DISHES.length + ' 道家常菜填进菜库？（之后可以随意增删改）', '填入示例菜库', '填入').then(async ok => {
      if (!ok) return
      this.setData({ busy: true })
      wx.showLoading({ title: '正在填入', mask: true })
      try {
        // 1) 分类：缺哪个补哪个。分类建失败不影响菜品写入（菜品自带 category 字符串）
        const cats = await db.getCategories().catch(() => [])
        const names = cats.map(c => c.name)
        const need = ['热菜', '素菜', '汤羹', '主食'].filter(n => names.indexOf(n) === -1)
        for (let i = 0; i < need.length; i++) {
          await db.addCategory(need[i], names.length + i).catch(e => {
            console.warn('[tonight] 分类创建失败，跳过：' + need[i], e)
          })
        }

        // 2) 跳过菜库里已有的同名菜 —— 重复点「填入」不会变成两份
        const exist = await db.getAllDishes().catch(() => [])
        const existNames = exist.map(d => d.name)
        const todo = SAMPLE_DISHES.filter(d => existNames.indexOf(d.name) === -1)

        if (!todo.length) {
          wx.hideLoading()
          this.setData({ busy: false })
          toast('菜库里已经有这些菜了')
          return
        }

        // 3) 顺序写入（不是并发），带进度
        const res = await db.addDishes(todo, (done, total) => {
          wx.showLoading({ title: '正在填入 ' + done + '/' + total, mask: true })
        })
        wx.hideLoading()
        this.setData({ busy: false })
        this.loadAll()

        if (res.failed.length) {
          alert(
            '成功 ' + res.ok + ' 道。失败原因：\n' +
              res.failed.slice(0, 3).map(f => f.name + '：' + f.err).join('\n'),
            '有 ' + res.failed.length + ' 道没填进去'
          )
        } else {
          toast('已填入 ' + res.ok + ' 道菜')
        }
      } catch (e) {
        wx.hideLoading()
        this.setData({ busy: false })
        console.error('[tonight] 填入示例菜库失败', e)
        alert(errText(e), '填入失败')
      }
    })
  },

  onOpenShopping() {
    wx.navigateTo({ url: '/pages/shopping/shopping?date=' + this.data.today })
  },

  goPoster() {
    wx.navigateTo({ url: '/pages/poster/poster?date=' + this.data.today })
  },

  onCloseGuide() {
    wx.setStorageSync(config.KEYS.GUIDE_SHOWN, true)
    this.setData({ guide: false })
  },

  /* ==================== 认领「我是谁」 ==================== */

  async onWhoPick(e) {
    const id = e.detail && e.detail.id
    if (!id) return
    try {
      await db.claimMember(id)
      this.setData({ whoShow: false })
      toast('好，记住你了')
      this.loadAll()
    } catch (err) {
      console.error('[tonight] 认领成员失败', err)
      toast('没选上，再试一次')
    }
  },

  async onWhoCreate() {
    try {
      await db.createSelfMember(this.data.whoList.length)
      this.setData({ whoShow: false })
      toast('已加入，去「家庭」页给自己起个名字')
      this.loadAll()
    } catch (err) {
      console.error('[tonight] 新建成员失败', err)
      toast('没建成，再试一次')
    }
  },

  onWhoClose() {
    // 本次会话内不再弹（去「家庭」页还能重新指认）
    this._whoDismissed = true
    this.setData({ whoShow: false })
  },

  // 分享：小程序未认证时微信会直接提示「由于小程序未完成认证，分享功能暂时无法使用」，
  // 所以先把转发入口从界面上撤掉（页面按钮 + 右上角菜单），改用「生成今日海报」——
  // 海报走 canvas + 保存相册，不依赖认证，家人照样能看到今晚这一桌。
  // 以后完成认证要恢复分享：把下面的 hideShareMenu 去掉，并恢复 onShareAppMessage 即可。

  noop() {}
})
