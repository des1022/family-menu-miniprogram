const config = require('./utils/config.js')
const { initCloud } = require('./utils/cloud.js')

App({
  globalData: {
    nickname: ''      // 本机昵称（备注署名用）
  },

  onLaunch() {
    // 初始化云开发环境（未配置 ENV_ID 时仍可启动，仅云能力不可用）
    initCloud()

    try {
      this.globalData.nickname = wx.getStorageSync(config.KEYS.NICKNAME) || ''
    } catch (e) {
      this.globalData.nickname = ''
    }
  }
})
