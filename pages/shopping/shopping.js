const db = require('../../utils/db.js')
const shop = require('../../utils/shopping.js')
const theme = require('../../utils/theme.js')
const { toast, confirm, pad } = require('../../utils/util.js')

Page({
  data: {
    themeCls: '',
    date: '',
    dateText: '',
    dishCount: 0,

    groups: [],
    buyCount: 0,
    doneCount: 0,
    pct: 0,
    lastBy: '',
    stapleCount: 0,
    showStaples: false,

    loading: true,
    add: { open: false, name: '', qty: '' }
  },

  onLoad(options) {
    const date = (options && options.date) || db.todayStr()
    const parts = date.split('-')
    this.setData({
      date: date,
      dateText: Number(parts[1]) + '月' + Number(parts[2]) + '日'
    })
  },

  onShow() {
    this.setData({ themeCls: theme.className() })
    this.loadAll()
  },

  onHide() {
    this.detach()
  },

  onUnload() {
    this.detach()
  },

  detach() {
    if (this._watcher && this._watcher.close) this._watcher.close()
    this._watcher = null
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [records, dishes, stored] = await Promise.all([
        db.getRecordsByDate(this.data.date).catch(() => []),
        db.getAllDishes().catch(() => []),
        db.getShopping(this.data.date).catch(() => [])
      ])

      const dishMap = {}
      dishes.forEach(d => { dishMap[d._id] = d })
      this._dishMap = dishMap

      // 今晚的菜 → 食材名（派生项）
      const ing = db.buildIngredientList(records, dishMap)
      const derivedNames = ing.map(i => i.name)

      await db.syncShoppingFromDishes(this.data.date, derivedNames)

      const list = await db.getShopping(this.data.date)
      this.setData({ dishCount: records.length, loading: false })
      this.render(list)
      this.attachWatcher()
    } catch (e) {
      console.error('[shopping] 加载失败', e)
      this.setData({ loading: false })
      toast('加载失败，下拉重试')
    }
  },

  attachWatcher() {
    if (this._watcher) return
    this._watcher = db.watchShopping(this.data.date, docs => this.render(docs))
  },

  /** 按货架分组渲染；常备调料默认折叠 */
  render(list) {
    const visible = (list || []).filter(i => Number(i.hidden) !== 1)
    const normal = visible.filter(i => Number(i.staple) !== 1)
    const staples = visible.filter(i => Number(i.staple) === 1)

    const map = {}
    normal.forEach(i => {
      if (!map[i.group]) map[i.group] = []
      map[i.group].push(i)
    })

    const groups = shop.GROUPS
      .filter(g => map[g] && map[g].length)
      .map(g => ({
        name: g,
        items: map[g]
          .slice()
          .sort((a, b) => (Number(a.done) - Number(b.done)))
          .map(i => ({
            _id: i._id,
            name: i.name,
            qty: i.qty || '',
            done: Number(i.done) === 1,
            byName: i.byName || '',
            manual: Number(i.manual) === 1
          }))
      }))

    // 常备展开时，作为一个额外分组接在最后
    if (this.data.showStaples && staples.length) {
      groups.push({
        name: '常备调料',
        items: staples
          .slice()
          .sort((a, b) => (Number(a.done) - Number(b.done)))
          .map(i => ({
            _id: i._id,
            name: i.name,
            qty: i.qty || '',
            done: Number(i.done) === 1,
            byName: i.byName || '',
            manual: Number(i.manual) === 1
          }))
      })
    }

    const buyCount = normal.length + staples.length
    const doneCount = visible.filter(i => Number(i.done) === 1).length
    const lastBy = (visible.filter(i => Number(i.done) === 1 && i.byName).slice(-1)[0] || {}).byName || ''

    this.setData({
      groups: groups,
      stapleCount: staples.length,
      buyCount: buyCount,
      doneCount: doneCount,
      pct: buyCount ? Math.round((doneCount / buyCount) * 100) : 0,
      lastBy: lastBy
    })
  },

  /* ==================== 交互 ==================== */

  async onToggle(e) {
    const id = e.currentTarget.dataset.id
    let target = null
    this.data.groups.forEach(g => {
      g.items.forEach(i => { if (i._id === id) target = i })
    })
    if (!target) return

    let me = null
    try { me = await db.getMyMember() } catch (err) { me = null }
    const byName = target.done ? '' : ((me && me.nickname) || '')

    try {
      await db.updateShoppingDone(id, !target.done, byName)
      wx.vibrateShort({ type: 'light', fail: () => {} })
      const list = await db.getShopping(this.data.date)
      this.render(list)
    } catch (err) {
      console.error('[shopping] 勾选失败', err)
      toast('操作失败，请重试')
    }
  },

  async onLongPress(e) {
    const id = e.currentTarget.dataset.id
    const manual = Number(e.currentTarget.dataset.manual) === 1
    let name = ''
    this.data.groups.forEach(g => {
      g.items.forEach(i => { if (i._id === id) name = i.name })
    })
    const ok = await confirm('把「' + (name || '这一项') + '」从清单里去掉？', '去掉', '去掉')
    if (!ok) return
    try {
      if (manual) await db.removeShoppingItem(id)
      else await db.hideShoppingItem(id)
      const list = await db.getShopping(this.data.date)
      this.render(list)
    } catch (err) {
      console.error('[shopping] 删除失败', err)
      toast('操作失败，请重试')
    }
  },

  onToggleStaples() {
    this.setData({ showStaples: !this.data.showStaples }, () => {
      db.getShopping(this.data.date).then(list => this.render(list)).catch(() => {})
    })
  },

  onOpenAdd() {
    this.setData({ add: { open: true, name: '', qty: '' } })
  },

  closeAdd() {
    this.setData({ 'add.open': false })
  },

  onAddNameInput(e) {
    this.setData({ 'add.name': e.detail.value })
  },

  onAddQtyInput(e) {
    this.setData({ 'add.qty': e.detail.value })
  },

  async onConfirmAdd() {
    const name = String(this.data.add.name || '').trim()
    if (!name) {
      toast('先写要买什么')
      return
    }
    try {
      await db.addShoppingItem(this.data.date, name, String(this.data.add.qty || '').trim())
      this.setData({ add: { open: false, name: '', qty: '' } })
      toast('已加进清单')
      const list = await db.getShopping(this.data.date)
      this.render(list)
    } catch (e) {
      console.error('[shopping] 添加失败', e)
      toast('添加失败，请重试')
    }
  },

  async onClearDone() {
    const n = this.data.doneCount
    if (!n) return
    const ok = await confirm('把已买的 ' + n + ' 项从清单里清掉？', '清空已买', '清空')
    if (!ok) return
    try {
      await db.clearShoppingDone(this.data.date)
      const list = await db.getShopping(this.data.date)
      this.render(list)
      toast('已清空')
    } catch (e) {
      console.error('[shopping] 清空失败', e)
      toast('清空失败，请重试')
    }
  },

  onCopy() {
    const lines = []
    this.data.groups.forEach(g => {
      g.items.forEach(i => {
        if (!i.done) lines.push('· ' + i.name + (i.qty ? '  ' + i.qty : ''))
      })
    })
    if (!lines.length) {
      toast('没有还没买的东西')
      return
    }
    wx.setClipboardData({
      data: '要买的东西（' + this.data.dateText + '）\n' + lines.join('\n'),
      success: () => toast('已复制，可以发给买菜的人')
    })
  },

  noop() {}
})
