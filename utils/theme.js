/**
 * 主题模式：跟随系统 / 浅色 / 深色
 *
 * 颜色本体都在 app.wxss 的 CSS 变量里；这里只负责算出页面根节点的 class。
 * - 跟随系统：不加 class，由 app.wxss 的 `@media (prefers-color-scheme: dark)` 接管
 * - 浅色 / 深色：加 .theme-light / .theme-dark 强制覆盖
 */

const KEY = 'fm_theme_mode'

const MODES = [
  { value: 0, label: '跟随系统' },
  { value: 1, label: '浅色' },
  { value: 2, label: '深色' }
]

function getMode() {
  const v = Number(wx.getStorageSync(KEY))
  return v === 1 || v === 2 ? v : 0
}

function setMode(v) {
  const mode = Number(v) === 1 || Number(v) === 2 ? Number(v) : 0
  wx.setStorageSync(KEY, mode)
  emit()
  return mode
}

/** 页面根节点的 class（跟随系统时返回空串） */
function className() {
  const m = getMode()
  if (m === 1) return 'theme-light'
  if (m === 2) return 'theme-dark'
  return ''
}

function systemDark() {
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      return (wx.getAppBaseInfo().theme || 'light') === 'dark'
    }
    return (wx.getSystemInfoSync().theme || 'light') === 'dark'
  } catch (e) {
    return false
  }
}

/** 当前是否处于深色（含跟随系统时的实际结果） */
function isDark() {
  const m = getMode()
  if (m === 1) return false
  if (m === 2) return true
  return systemDark()
}

/** 系统主题变化通知（跟随系统时页面需要重绘） */
const listeners = []

function emit() {
  listeners.slice().forEach(fn => {
    try {
      fn(getMode())
    } catch (e) {
      console.error('[theme] 监听器异常', e)
    }
  })
}

function subscribe(fn) {
  listeners.push(fn)
  return function unsubscribe() {
    const i = listeners.indexOf(fn)
    if (i > -1) listeners.splice(i, 1)
  }
}

let bound = false
function bindSystemTheme() {
  if (bound) return
  bound = true
  try {
    if (typeof wx.onThemeChange === 'function') {
      wx.onThemeChange(() => {
        if (getMode() === 0) emit()
      })
    }
  } catch (e) {
    console.warn('[theme] 系统主题监听不可用', e)
  }
}

module.exports = {
  MODES,
  getMode,
  setMode,
  className,
  isDark,
  subscribe,
  bindSystemTheme
}
