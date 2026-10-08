const { initCloud } = require('./utils/cloud.js')
const theme = require('./utils/theme.js')

App({
  globalData: {},

  onLaunch() {
    initCloud()
    theme.bindSystemTheme()
  }
})
