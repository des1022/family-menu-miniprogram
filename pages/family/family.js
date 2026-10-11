const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const build = require('../../utils/version.js')
const { toast, confirm, alert, errText } = require('../../utils/util.js')

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
    // 版本标记：真机排查用 —— 一眼看出跑的是哪一版构建。
    // 取自 utils/version.js（CI 每次构建写入），和后台上传的版本号是同一个数
    ver: build.version,
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
      // 「关于」那行放小程序自己的 logo，深浅共用一张（自己是带底色的方块图标）
      logo: '/assets/icons/app-logo.png'
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

  /** 认错了身份：把「我」改挂到这条成员上 */
  async onClaimMe() {
    const edit = this.data.edit
    if (!edit || !edit.id) return
    const nickname = edit.nickname || '这位成员'
    const ok = await confirm(
      '改完之后，「我」就代表本机登录的你：你点的菜记在 TA 头上，今晚在不在家吃也按 TA 算。',
      '把「我」改成「' + nickname + '」？',
      '就是 TA'
    )
    if (!ok) return
    try {
      await db.claimMember(edit.id)
      this.setData({ sheet: false })
      toast('好了，「我」现在是 ' + nickname)
      this.loadAll()
    } catch (e) {
      console.error('[family] 改「我」失败', e)
      toast('没改成，再试一次')
    }
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
        version: build.version,
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
  /** 备份：导出 / 导入 二选一 */
  onBackup() {
    wx.showActionSheet({
      itemList: ['导出备份文件', '从备份文件恢复'],
      success: (res) => {
        if (res.tapIndex === 0) this.onExport()
        else if (res.tapIndex === 1) this.onImport()
      },
      fail: () => {}
    })
  },

  /**
   * 从备份恢复。
   * 小程序没有「文件选择器」，只能从聊天记录里挑文件（wx.chooseMessageFile）——
   * 所以操作路径是：先把导出的备份 JSON 发到微信「文件传输助手」，再回这里选它。
   */
  onImport() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file) return

        let payload = null
        try {
          payload = JSON.parse(wx.getFileSystemManager().readFileSync(file.path, 'utf-8'))
        } catch (e) {
          console.error('[family] 备份解析失败', e)
          alert('请选择由本小程序「导出备份文件」生成的 .json 文件。', '这个文件读不了')
          return
        }

        if (!payload || payload.app !== 'family-menu') {
          alert('备份文件里应该有 app: "family-menu" 这个标记，但没找到。', '不是本小程序的备份')
          return
        }

        const summary = [
          '菜品 ' + ((payload.dishes || []).length) + ' 道',
          '点单记录 ' + ((payload.records || []).length) + ' 条',
          '分类 ' + ((payload.categories || []).length) + ' 个',
          '采购项 ' + ((payload.shopping || []).length) + ' 条'
        ].join(' · ')
        const when = payload.exportedAt ? String(payload.exportedAt).slice(0, 10) : '未知'

        confirm(
          '备份日期：' + when + '\n' + summary + '\n\n只补进现在缺的，已有的菜和记录不会被覆盖。',
          '恢复这份备份？',
          '开始恢复',
          { danger: false }
        ).then(ok => { if (ok) this.doRestore(payload) })
      },
      fail: (e) => {
        if (e && /cancel/i.test(e.errMsg || '')) return
        console.error('[family] 选择文件失败', e)
        toast('没能选中文件，请重试')
      }
    })
  },

  async doRestore(payload) {
    wx.showLoading({ title: '正在恢复…', mask: true })
    try {
      const rep = await db.restoreBackup(payload, (text) => {
        wx.showLoading({ title: text, mask: true })
      })
      wx.hideLoading()
      await this.loadAll()
      alert([
          '菜品 +' + rep.dishes + ' 道',
          '点单记录 +' + rep.records + ' 条',
          '分类 +' + rep.categories + ' 个',
          '采购项 +' + rep.shopping + ' 条',
          rep.members ? '成员 +' + rep.members + ' 位' : '',
          rep.skipped ? '跳过已存在 ' + rep.skipped + ' 条' : '',
        rep.failed ? '⚠️ 有 ' + rep.failed + ' 条没写进去' : ''
      ].filter(Boolean).join('\n'), '恢复完成')
    } catch (e) {
      wx.hideLoading()
      console.error('[family] 恢复失败', e)
      alert(errText(e), '恢复没成功')
    }
  },

  onAbout() {
    alert(
      '家里人自己用的餐桌计划本。\n数据存在你自己的微信云开发环境，随时可从「数据备份与恢复」导出取走，也能从备份文件恢复回来。',
      '家庭菜单 · 体验版'
    )
  },

  noop() {}
})
