const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { toast, confirm, errText } = require('../../utils/util.js')

function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0) : '家'
}

function splitTastes(raw) {
  return String(raw || '').split(/[,，;；]+/).map(s => s.trim()).filter(Boolean)
}

Page({
  data: {
    themeCls: '',
    ico: {},
    // 版本标记：真机排查用 —— 一眼看出跑的是哪一版构建
    ver: '1.1.1',
    members: [],
    eatCount: 0,
    dishCount: 0,

    // 身份认领（本机认不出「我是谁」时用）
    myId: '',
    whoShow: false,
    whoList: [],

    themeModes: theme.MODES,
    themeMode: 0,
    isDark: false,

    tasteOptions: config.TASTE_OPTIONS,
    sheet: false,
    edit: { id: '', isNew: true, isMe: false, nickname: '' },
    tasteMap: {}
  },

  onShow() {
    this.applyTheme()
    this.loadAll()
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  applyTheme() {
    this.setData({
      themeCls: theme.className(),
      themeMode: theme.getMode(),
      isDark: theme.isDark(),
      ico: this.buildIco()
    })
  },

  buildIco() {
    const n = theme.isDark() ? '-d' : ''
    return {
      bowl: '/assets/icons/bowl' + n + '.png',
      folder: '/assets/icons/folder' + n + '.png',
      download: '/assets/icons/download' + n + '.png',
      gear: '/assets/icons/gear' + n + '.png'
    }
  },

  async loadAll() {
    try {
      // 认领「我是谁」：认不出来会返回 null（换客户端 / 清过缓存），下面弹「你是哪位」
      let me = null
      try {
        me = await db.ensureMyMember()
      } catch (e) {
        console.warn('[family] 成员初始化失败', e)
      }
      const [members, dishes] = await Promise.all([
        db.getMembers().catch(() => []),
        db.getAllDishes().catch(() => [])
      ])
      if (!me) me = await db.getMyMember().catch(() => null)
      const myId = me ? me._id : ''

      const rawTastes = {}
      members.forEach(m => { rawTastes[m._id] = m.tastes || '' })
      this._rawTastes = rawTastes

      this.setData({
        members: members.map(m => ({
          _id: m._id,
          color: m.color || config.MEMBER_COLORS[0],
          nickname: m.nickname || '',
          initial: initialOf(m.nickname),
          tasteText: splitTastes(m.tastes).join(' · '),
          eatTonight: Number(m.eatTonight) !== config.EAT_TONIGHT.NO,
          isMe: m._id === myId
        })),
        myId: myId,
        // 认不出我是谁、但家里已经有人了 → 问一句，绝不自动新建
        whoShow: !myId && members.length > 0 && !this._whoDismissed,
        whoList: members.map(m => ({
          _id: m._id,
          color: m.color || config.MEMBER_COLORS[0],
          initial: initialOf(m.nickname),
          nickname: m.nickname || ''
        })),
        eatCount: db.countEatTonight(members),
        dishCount: dishes.length
      })
    } catch (e) {
      console.error('[family] 加载失败', e)
      toast('加载失败，下拉重试')
    }
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
      console.error('[family] 认领成员失败', err)
      toast('没选上，再试一次')
    }
  },

  async onWhoCreate() {
    try {
      await db.createSelfMember(this.data.whoList.length)
      this.setData({ whoShow: false })
      toast('已加入，点自己那条改个名字吧')
      this.loadAll()
    } catch (err) {
      console.error('[family] 新建成员失败', err)
      toast('没建成，再试一次')
    }
  },

  onWhoClose() {
    // 本次会话内不再自动弹（点提示条还能重新打开）
    this._whoDismissed = true
    this.setData({ whoShow: false })
  },

  /** 认不出身份时，成员区顶部给一行提示，点了重新弹选择 */
  onOpenWho() {
    if (!this.data.myId && this.data.whoList.length) {
      this._whoDismissed = false
      this.setData({ whoShow: true })
    }
  },

  /* ==================== 今晚在家吃 ==================== */

  async onToggleEat(e) {
    const id = e.currentTarget.dataset.id
    const m = this.data.members.filter(x => x._id === id)[0]
    if (!m) return
    const next = !m.eatTonight
    try {
      await db.updateMember(id, { eatTonight: next ? config.EAT_TONIGHT.YES : config.EAT_TONIGHT.NO })
      this.loadAll()
    } catch (err) {
      console.error('[family] 切换失败', err)
      toast('操作失败，请重试')
    }
  },

  /* ==================== 成员编辑 ==================== */

  onOpenEdit(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      this.setData({
        sheet: true,
        tasteMap: {},
        edit: { id: '', isNew: true, isMe: false, nickname: '' }
      })
      return
    }
    const m = this.data.members.filter(x => x._id === id)[0]
    if (!m) return
    const raw = (this._rawTastes || {})[id] || ''
    const tastes = splitTastes(raw)
    const map = {}
    tastes.forEach(t => { map[t] = true })
    this.setData({
      sheet: true,
      tasteMap: map,
      edit: { id: id, isNew: false, isMe: m.isMe, nickname: m.nickname }
    })
  },

  closeSheet() {
    this.setData({ sheet: false })
  },

  onNickInput(e) {
    this.setData({ 'edit.nickname': e.detail.value })
  },

  onToggleTaste(e) {
    const t = e.currentTarget.dataset.t
    const map = Object.assign({}, this.data.tasteMap)
    if (map[t]) delete map[t]
    else map[t] = true
    this.setData({ tasteMap: map })
  },

  async onSaveMember() {
    const edit = this.data.edit
    const nickname = String(edit.nickname || '').trim()
    if (!nickname) {
      toast('先给 TA 起个名字吧')
      return
    }
    const tastes = Object.keys(this.data.tasteMap)
    try {
      if (edit.isNew) {
        const count = this.data.members.length
        await db.addMember({
          nickname: nickname,
          color: config.MEMBER_COLORS[count % config.MEMBER_COLORS.length],
          tastes: tastes.join(';'),
          eatTonight: config.EAT_TONIGHT.YES
        })
      } else {
        await db.updateMember(edit.id, { nickname: nickname, tastes: tastes.join(';') })
      }
      this.setData({ sheet: false })
      toast('已保存')
      this.loadAll()
    } catch (e) {
      console.error('[family] 保存成员失败', e)
      toast('保存失败，请重试')
    }
  },

  async onRemoveMember() {
    const edit = this.data.edit
    const m = this.data.members.filter(x => x._id === edit.id)[0]
    const ok = await confirm('把「' + ((m && m.nickname) || '这位成员') + '」从家庭里移除？\n（TA 点过的菜会保留）', '移除成员', '移除')
    if (!ok) return
    try {
      await db.removeMember(edit.id)
      this.setData({ sheet: false })
      toast('已移除')
      this.loadAll()
    } catch (e) {
      console.error('[family] 移除成员失败', e)
      toast('移除失败，请重试')
    }
  },

  /* ==================== 外观 ==================== */

  onPickTheme(e) {
    const v = Number(e.currentTarget.dataset.v)
    theme.setMode(v)
    this.applyTheme()
  },

  /* ==================== 管理入口 ==================== */

  goManage() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  goCategory() {
    wx.navigateTo({ url: '/pages/category/category' })
  },

  /** 数据备份导出：写成本地 JSON 文件，再通过微信「发送给朋友」传出去 */
  async onExport() {
    try {
      wx.showLoading({ title: '正在打包', mask: true })
      const [dishes, records, categories, members, shopping] = await Promise.all([
        db.getAllDishes().catch(() => []),
        db.getAllRecords().catch(() => []),
        db.getCategories().catch(() => []),
        db.getMembers().catch(() => []),
        db.getAllShopping().catch(() => [])
      ])
      const payload = {
        app: 'family-menu',
        version: '1.1.1',
        exportedAt: new Date().toISOString(),
        dishes: dishes,
        records: records,
        categories: categories,
        members: members,
        shopping: shopping
      }
      const json = JSON.stringify(payload, null, 2)
      const name = 'fm-' + db.todayStr().replace(/-/g, '') + '.json'
      const fs = wx.getFileSystemManager()
      const filePath = wx.env.USER_DATA_PATH + '/' + name
      fs.writeFileSync(filePath, json, 'utf8')
      wx.hideLoading()

      if (typeof wx.shareFileMessage === 'function') {
        wx.shareFileMessage({
          filePath: filePath,
          fileName: '家庭菜单备份-' + db.todayStr() + '.json',
          // 未认证小程序转发文件也可能被拦 → 兜底复制到剪贴板，别让备份走到死路
          fail: () => this.copyBackup(json)
        })
      } else {
        this.copyBackup(json)
      }
    } catch (e) {
      wx.hideLoading()
      console.error('[family] 导出失败', e)
      toast('导出失败，请重试')
    }
  },

  /** 备份兜底：分享文件走不通时，直接把 JSON 复制到剪贴板（未认证小程序没有转发能力） */
  copyBackup(json) {
    wx.setClipboardData({
      data: json,
      success: () => toast('已复制备份内容，粘到文件里保存即可'),
      fail: () => toast('备份内容已生成，但复制失败，请再试一次')
    })
  },

  /** 数据连接自检：手机上没有控制台，出问题时靠这个定位是哪个集合的事 */
  async onDiag() {
    wx.showLoading({ title: '检查中', mask: true })
    try {
      const rows = await db.pingAllCollections()
      wx.hideLoading()
      const bad = rows.filter(r => !r.ok)
      wx.showModal({
        title: bad.length ? '有 ' + bad.length + ' 个集合有问题' : '数据连接正常',
        content: rows.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + '\n     ' + r.info).join('\n'),
        showCancel: false,
        confirmText: '知道了'
      })
    } catch (e) {
      wx.hideLoading()
      console.error('[family] 自检失败', e)
      wx.showModal({
        title: '自检没跑成',
        content: errText(e),
        showCancel: false,
        confirmText: '知道了'
      })
    }
  },

  onAbout() {
    wx.showModal({
      title: '家庭菜单 · 体验版',
      content: '家里人自己用的餐桌计划本。\n数据存在你自己的微信云开发环境，随时可从「数据备份导出」取走。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  noop() {}
})
