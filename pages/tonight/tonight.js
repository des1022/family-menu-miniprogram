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
    download: '/assets/icons/download' + n + '.png',
    // 决策器三行的小图标：碗=搭配 / 两人=人数 / 火苗=口味
    decMix: '/assets/icons/dec-mix' + n + '.png',
    decSize: '/assets/icons/dec-size' + n + '.png',
    decTaste: '/assets/icons/dec-taste' + n + '.png'
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

/** 「今天在家吃 N 人」→ 这一桌做几道菜 */
function homeTotal(n) {
  if (n <= 1) return 2
  if (n <= 2) return 3
  if (n <= 4) return 4
  return 5
}

/**
 * 决策器的人数档。
 *
 * 家里每个人都有「今晚在不在家吃」的开关，`db.countEatTonight()` 早就把这个数算出来了
 * （今晚页右上角、家庭页标题都在显示），但决策器里还要**再手选一遍** 1-2 / 3-4 / 5 人以上 ——
 * 同一件事填两遍，还可能互相打脸（2 人吃饭却按 3-4 人配了一桌）。
 * 现在把那个数直接接成第一档并默认选中；没人开过这个开关（=0）时就不凭空编一个「0 人」，
 * 还是老三档。
 */
function sizeOptions(eatCount) {
  const list = []
  const n = Number(eatCount) || 0
  if (n > 0) list.push({ key: 'home', home: true, label: n + ' 人（今天在家的）', total: homeTotal(n) })
  return list.concat(SIZES)
}

/**
 * 按人数上限砍菜。
 *
 * 以前 `total` 只在「随便配」时才用得上，选「2荤1素1汤」这类固定搭配就恒定 4 道 ——
 * 也就是说「人数」其实没管住菜量。现在它真的管：超出就砍。
 * 砍的顺序是 汤 → 多出来的荤 → 素（两个人吃 2 荤 1 素，比 1 荤 1 素 1 汤更实在），
 * 而且荤、素各自至少留一道，不会砍成一桌全荤。
 */
function trimToSize(items, total) {
  const out = items.slice()
  // 传进来的可能是「已经装饰过」的菜（只有 category，没有 tags），所以优先用它自带的 role
  const roleOfItem = d => d.role || roleOf(d)
  const sameRole = (arr, role) => arr.filter(d => roleOfItem(d) === role).length
  const rank = d => (roleOfItem(d) === 'soup' ? 0 : roleOfItem(d) === 'main' ? 1 : 2)
  while (out.length > total) {
    let idx = -1
    for (let i = 0; i < out.length; i++) {
      const r = roleOfItem(out[i])
      // 汤随便砍；荤、素要各留一道
      if ((r === 'main' || r === 'veg') && sameRole(out, r) <= 1) continue
      if (idx === -1 || rank(out[i]) < rank(out[idx])) idx = i
    }
    if (idx === -1) break
    out.splice(idx, 1)
  }
  return out
}

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

// 「这一桌缺什么」用的两个判断（只看分类，和 roleOf 的宽松判断分开：
// 桌上有没有青菜看的是这道菜本身，不是它的名字里带了「汤」字）
const VEG_RE = /素|青菜|蔬|凉拌/
const SOUP_RE = /汤|羹/

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
    eating: [],
    eatCount: 0,

    allDishes: [],
    allCount: 0,
    cards: [],
    recent: [],
    suggest: null,
    ingCount: 0,
    ingList: [],
    // 全部确认之后，底部那颗「确认这顿饭」就不该再杵在那儿了
    confirmedCount: 0,
    allConfirmed: false,

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
    this.refreshToday()
    this.loadAll()
  },

  /**
   * 跨零点：页面在后台搁了一夜，回来时「今天」已经变了。
   * 不刷新的话，接下来点的菜会记到昨天，桌上看不到刚加的那道
   * （记录是挂在 this.data.today 上的，watch 也是盯的这一天）。
   */
  refreshToday() {
    const t = db.todayStr()
    if (t === this.data.today) return false
    const now = new Date()
    if (this._watcher && this._watcher.close) this._watcher.close()
    this._watcher = null
    this._watchDate = ''
    this.setData({
      today: t,
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + WEEK[now.getDay()]
    })
    return true
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
      this.setData({ busy: false, members: [], eating: [], eatCount: 0, cards: [], recent: [], suggest: null, allDishes: [], allCount: 0 })
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
      // 显示「上次做是几天前」用的那份：排掉今天。
      // 桌上这道菜「今天」的那条记录就是它自己刚被加进来时建的，
      // 拿它算永远是「今天做过」，写出来纯属噪音。
      this._lastBefore = {}
      const todayStr = db.todayStr()
      this._allRecords.forEach(r => {
        if (!this._lastMap[r.dishId] || r.date > this._lastMap[r.dishId]) this._lastMap[r.dishId] = r.date
        if (r.date < todayStr && (!this._lastBefore[r.dishId] || r.date > this._lastBefore[r.dishId])) {
          this._lastBefore[r.dishId] = r.date
        }
      })

      const onDishes = dishes.filter(d => d.status === config.DISH_STATUS.ON)
      this._dishMap = {}
      dishes.forEach(d => { this._dishMap[d._id] = d })

      // 成员头像：和菜品图一样，先把 fileID 换成临时链接再渲染（不然首帧是空的、随后闪一下）
      const memberList = members.map(m => Object.assign({}, m, {
        initial: initialOf(m.nickname),
        eatTonight: Number(m.eatTonight) !== config.EAT_TONIGHT.NO
      }))
      await attachImgUrls(memberList, 'avatar', 'avatarSrc')

      this.setData({
        members: memberList,
        // 「今晚在家吃」那一行只画今天在家的：以前把所有人画出来（不在家的调淡），
        // 但右边的数字只数在家的 —— 3 个人里 2 个在家就成了「3 个头像 vs 2 人」（2026-10-12 反馈）
        eating: memberList.filter(m => m.eatTonight),
        eatCount: db.countEatTonight(members),
        allDishes: onDishes,
        allCount: dishes.length,
        // 认不出我是谁、但家里已经有人了 → 让用户指认，绝不自动新建
        whoShow: !me && members.length > 0 && !this._whoDismissed,
        whoList: memberList.map(m => ({
          _id: m._id,
          color: m.color || config.MEMBER_COLORS[0],
          initial: m.initial,
          avatarSrc: m.avatarSrc || '',
          nickname: m.nickname || ''
        })),
        busy: false
      })
      this.buildPickHint()
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

  /**
   * 「帮我选一顿」那颗按钮的副标题。
   *
   * 以前是写死的 '2 荤 1 素 1 汤 · 3 秒定' —— 跟上次实际用的搭配、跟今天几个人在家
   * 都没关系，每次打开面板看到的默认值可能根本不是这句话说的。
   * 现在按面板真正的默认（第一个搭配 + 今天在家人数换算的道数）算出来。
   */
  buildPickHint() {
    const mix = MIXES[0]
    const n = Number(this.data.eatCount) || 0
    const total = n > 0 ? homeTotal(n) : SIZES[1].total
    const planTotal = mix.main + mix.veg + mix.soup
    this.setData({ pickHint: mix.label + ' · ' + Math.min(planTotal, total) + ' 道' })
  },

  async applyRecords(records) {
    const today = db.todayStr()
    const lastBefore = this._lastBefore || {}
    const cards = (records || []).map(r => {
      const dish = this._dishMap ? this._dishMap[r.dishId] : null
      return {
        id: r._id,
        dishId: r.dishId,
        name: r.dishName || (dish ? dish.name : ''),
        image: r.dishImage || (dish ? dish.image : '') || '',
        category: dish ? dish.category : '',
        remark: r.remark || '',
        // 「上次做是几天前」：用排掉今天的那份记录，免得每道都写「今天做过」
        lastText: lastBefore[r.dishId] ? daysAgoText(lastBefore[r.dishId]) : '',
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
    const confirmedCount = cards.filter(c => c.confirmed).length
    this.setData({
      cards: cards,
      today: today,
      confirmedCount: confirmedCount,
      allConfirmed: cards.length > 0 && confirmedCount === cards.length
    })
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

  /**
   * 「这一桌还缺个青菜 / 少个汤」。
   *
   * 以前这里的两句提示没问题，但后面挂的菜名是**写死在代码里**的
   * （'蒜蓉小青菜 · 凉拌黄瓜 · 醋溜土豆丝'）—— 菜库里有没有这几道全靠运气，
   * 而且点「去看看」只是跳到菜库、不带任何筛选，等于让用户自己再找一遍。
   *
   * 现在：菜名从**用户自己的上架菜**里按同一类挑 3 道（久没做过的排前面，和决策器一个规矩），
   * 名字点一下直接打开那道菜的详情；右边按钮带分类筛选跳菜库。菜库里这一类还没有菜时，
   * 就说实话（「还没上架素菜，先加一道」），不摆一串不存在的菜名。
   */
  buildSuggest(cards) {
    if (!cards.length) {
      this.setData({ suggest: null })
      return
    }
    const hasVeg = cards.some(c => VEG_RE.test(c.category || ''))
    const hasSoup = cards.some(c => SOUP_RE.test(c.category || ''))
    let role = ''
    let text = ''
    if (!hasVeg) {
      role = 'veg'
      text = '这一桌还缺个青菜'
    } else if (!hasSoup) {
      role = 'soup'
      text = '再配个汤更完整'
    }
    if (!role) {
      this.setData({ suggest: null })
      return
    }

    const picks = this.pickByRole(role, 3)
    const cat = picks.length ? (picks[0].category || '') : ''
    this.setData({
      suggest: {
        role: role,
        text: text,
        names: picks.map(d => ({ _id: d._id, name: d.name })),
        empty: role === 'veg' ? '菜库里还没上架素菜，先去加一道' : '菜库里还没上架汤，先去加一道',
        cat: cat,
        go: cat ? '去挑一道' : '去菜库'
      }
    })
  },

  /**
   * 从菜库里按「荤 / 素 / 汤」挑几道（久没做过的排前面）。
   * 只看上架的菜，且跳过今晚已经在桌上的，免得推荐一道桌上已有的。
   */
  pickByRole(role, n) {
    const last = this._lastMap || {}
    const onIds = {}
    ;(this.data.cards || []).forEach(c => { onIds[c.dishId] = true })
    return (this.data.allDishes || [])
      .filter(d => !onIds[d._id] && roleOf(d) === role)
      .sort((a, b) => {
        const la = last[a._id] || ''
        const lb = last[b._id] || ''
        if (la === lb) return 0
        return la < lb ? -1 : 1
      })
      .slice(0, n)
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

  /** 「今晚在家吃」那一行点了就去家庭页 —— 谁在家吃是在那页拨的开关，这里只是显示 */
  goFamily() {
    wx.switchTab({ url: '/pages/family/family' })
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

  /**
   * 把桌上这道换成同类的另一道。
   *
   * 以前想换口味只能「先撤掉 → 跳菜库 → 再找一道」，多走两趟。
   * 复用决策器那套挑法：同类优先、久没做过的排前面、跳过今晚已经在桌上的；
   * 换的动作 = 撤掉旧记录 + 加进新的（记录按 date + dishId 唯一）。
   * 口味条件用决策器里最后一次选的（没开过面板就是「随便」）。
   */
  async onSwapDish() {
    const h = this.data.how
    if (!h || !h.dishId || this.data.busy) return
    const raw = (this._dishMap || {})[h.dishId]
    if (!raw) {
      toast('这道菜已经不在菜库里了，先撤掉吧')
      return
    }
    const used = {}
    ;(this.data.cards || []).forEach(c => { used[c.dishId] = true })
    // 当前这道**不**从排除表里拿掉：换一道不能换成它自己
    const taste = TASTES.filter(t => t.key === this.data.dec.taste)[0] || TASTES[0]
    const d = this.pickCandidate(roleOf(raw), taste, used)
    if (!d) {
      toast('这一类没有别的可换了')
      return
    }

    try {
      this.setData({ busy: true })
      await db.removeFromTonight(this.data.today, h.dishId)
      await db.addToTonight(d, this.data.today)
      this.setData({ how: null, busy: false })
      const records = await db.getRecordsByDate(this.data.today)
      this.applyRecords(records)
      wx.vibrateShort({ type: 'light', fail: () => {} })
      toast('换成「' + d.name + '」了')
    } catch (err) {
      console.error('[tonight] 换一道失败', err)
      this.setData({ busy: false })
      toast('换不了，请重试')
    }
  },

  /** 弹层里的「从今晚撤掉」 */
  async onRemoveFromHow() {    const h = this.data.how
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

  /** 建议条右边的按钮：跳菜库，并带上「要挑的那一类」的筛选 */
  onSugTap() {
    const s = this.data.suggest
    if (s && s.cat) wx.setStorageSync(config.KEYS.FOCUS_CAT, s.cat)
    wx.switchTab({ url: '/pages/dishes/dishes' })
  },

  /** 点建议里的某个菜名：跳菜库并直接打开这道菜的详情（tabBar 页面只能靠本地缓存交接） */
  onSugDish(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.setStorageSync(config.KEYS.FOCUS_DISH, id)
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
    const sizes = sizeOptions(this.data.eatCount)
    // 第一档就是「N 人（今天在家的）」，每次打开都重新按开关算一遍并选中它；
    // 想按别的份量做，旁边两个档还在，点一下就行。
    this.setData({
      sizes: sizes,
      'dec.size': sizes[0].home ? 'home' : this.data.dec.size,
      'dec.open': true
    }, () => this.rollAll())
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
    const sizes = this.data.sizes || SIZES
    const size = sizes.filter(s => s.key === this.data.dec.size)[0]
      || sizes.filter(s => s.key === 's2')[0] || sizes[sizes.length - 1]
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

    // 人数管菜量：搭配要的比人数多就按人数砍（见 trimToSize 的说明）
    const final = picks.length > total ? trimToSize(picks, total) : picks

    await attachImgUrls(final)
    this.setData({ 'dec.picks': final })
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
      role: roleOf(d),
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
    // 当前这道也要继续排除：以前这里把它从表里删掉，于是「换一个」有可能
    // 又摇回同一道菜 —— 用户点一下看着像没反应（2026-10-12 顺手修的）

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
