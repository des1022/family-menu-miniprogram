const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const { toast, confirm } = require('../../utils/util.js')

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
    members: [],
    eatCount: 0,
    dishCount: 0,

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
      await db.ensureMyMember().catch(e => console.warn('[family] 成员初始化失败', e))
      const [members, dishes] = await Promise.all([
        db.getMembers().catch(() => []),
        db.getAllDishes().catch(() => [])
      ])
      const me = await db.getMyMember().catch(() => null)
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
        eatCount: db.countEatTonight(members),
        dishCount: dishes.length
      })
    } catch (e) {
      console.error('[family] 加载失败', e)
      toast('加载失败，下拉重试')
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
      const [dishes, records, categories, members] = await Promise.all([
        db.getAllDishes(),
        db.getAllRecords(),
        db.getCategories(),
        db.getMembers()
      ])
      const payload = {
        app: 'family-menu',
        version: '1.1.0',
        exportedAt: new Date().toISOString(),
        dishes: dishes,
        records: records,
        categories: categories,
        members: members
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
          fail: () => toast('已保存到本地，可稍后再试分享')
        })
      } else {
        wx.setClipboardData({
          data: json,
          success: () => toast('已复制备份内容到剪贴板')
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('[family] 导出失败', e)
      toast('导出失败，请重试')
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
