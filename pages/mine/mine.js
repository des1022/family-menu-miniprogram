const config = require('../../utils/config.js')
const { toast, confirm } = require('../../utils/util.js')

Page({
  data: {
    nickname: ''
  },

  onShow() {
    this.setData({ nickname: getApp().globalData.nickname || '' })
  },

  /** 失焦即保存昵称 */
  onNicknameBlur(e) {
    const nickname = (e.detail.value || '').trim()
    wx.setStorageSync(config.KEYS.NICKNAME, nickname)
    getApp().globalData.nickname = nickname
    this.setData({ nickname: nickname })
    if (nickname) toast('昵称已保存')
  },

  /** 清空本地缓存 */
  async onClearCache() {
    const ok = await confirm('将清除本机昵称和引导记录，不会影响云端菜品与点单数据。确定继续？', '清空本地缓存', '清空')
    if (!ok) return
    wx.removeStorageSync(config.KEYS.NICKNAME)
    wx.removeStorageSync(config.KEYS.GUIDE_SHOWN)
    getApp().globalData.nickname = ''
    this.setData({ nickname: '' })
    toast('已清空本地缓存')
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  goCategory() {
    wx.navigateTo({ url: '/pages/category/category' })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  }
})
