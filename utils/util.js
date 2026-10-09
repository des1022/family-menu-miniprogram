/**
 * 通用工具函数
 */

/** 轻量 toast（非阻塞） */
function toast(title, icon = 'none', duration = 1500) {
  wx.showToast({ title, icon, duration, mask: false })
}

function showLoading(title = '加载中') {
  wx.showLoading({ title, mask: true })
}

function hideLoading() {
  wx.hideLoading()
}

/**
 * 取当前页面挂着的自绘弹窗（页面 wxml 里的 `<ui-dialog id="uiDialog"/>`）。
 * 拿不到就返回 null，由调用方退回原生 wx.showModal —— 这样即使哪个页面漏挂了组件，
 * 功能也不会挂掉，只是样式回退。
 */
function getDialog() {
  try {
    const pages = getCurrentPages()
    const page = pages && pages[pages.length - 1]
    if (!page || typeof page.selectComponent !== 'function') return null
    const c = page.selectComponent('#uiDialog')
    return c && typeof c.open === 'function' ? c : null
  } catch (e) {
    return null
  }
}

/**
 * 「这操作会不会丢东西」的兜底判断。
 * 目的：全站 15 处 confirm 不用一处处改就能自动上砖红样式。
 * 判不准时调用方可以显式传 opts.danger 覆盖。
 */
const DANGER_RE = /删|撤|移除|清空|清掉|丢掉|去掉|下架|重置/

function isDangerous(text) {
  return DANGER_RE.test(String(text || ''))
}

/**
 * 二次确认弹窗（自绘，方案 D 暖橙卡；拿不到组件时退回原生）
 * @param {string} content 正文
 * @param {string} title   标题
 * @param {string} confirmText 确定按钮文字
 * @param {{danger?:boolean, cancelText?:string}} [opts] danger 不传则按文案自动判断
 * @returns {Promise<boolean>}
 */
function confirm(content, title = '提示', confirmText = '确定', opts = {}) {
  const danger = opts.danger === undefined ? isDangerous(title + ' ' + confirmText) : !!opts.danger
  const dlg = getDialog()
  if (dlg) {
    return dlg.open({
      title,
      content,
      confirmText,
      cancelText: opts.cancelText || '取消',
      danger
    })
  }
  return new Promise(resolve => {
    wx.showModal({
      title,
      content,
      confirmText,
      confirmColor: danger ? '#C94A3F' : '#D9714E',
      cancelColor: '#8B8178',
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
}

/**
 * 只有一个「知道了」的提示弹窗（替掉散落各处的 wx.showModal({showCancel:false})）
 * 正文里的 \n 会真的换行。
 */
function alert(content, title = '提示', confirmText = '知道了') {
  const dlg = getDialog()
  if (dlg) {
    return dlg.open({ title, content, confirmText, showCancel: false })
  }
  return new Promise(resolve => {
    wx.showModal({
      title,
      content,
      showCancel: false,
      confirmText,
      confirmColor: '#D9714E',
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/** 补零 */
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 等一会儿（批量写入时用来避开频率限制） */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 云开发错误码 → 一句人话。
 * 出问题时报错必须看得懂：原来的实现直接把一整段英文文档链接糊在弹窗上，
 * 手机上根本没法读。
 */
const ERR_HINTS = {
  '-502005': '集合还没建 —— 去云开发控制台新建，权限设「所有用户可读写」',
  '-501001': '没有权限 —— 集合权限要设为「所有用户可读写」',
  '-502001': '网络超时或不稳定，稍后再试',
  '-501000': '云环境没找到 —— 检查 utils/config.js 里的 ENV_ID',
  '-502003': '云开发资源不可用 —— 确认环境状态正常、没被回收',
  '-502002': '请求参数不对（多半是本机时间不准）',
  '-502004': '云开发资源超配额，等一会儿或查看资源用量'
}

/**
 * 把云开发/网络错误整理成一行人话。
 * @returns {string} 例如「-502005：集合还没建 —— 去云开发控制台新建，权限设「所有用户可读写」」
 */
function errText(e) {
  if (!e) return '未知错误'
  const code = String(e.errCode || e.code || '')
  const raw = String(e.errMsg || e.message || e || '')
  if (ERR_HINTS[code]) return code + '：' + ERR_HINTS[code]
  if (/not exist|不存在/i.test(raw)) return '集合还没建 —— 去云开发控制台新建，权限设「所有用户可读写」'
  if (/permission|denied/i.test(raw)) return '没有权限 —— 集合权限要设为「所有用户可读写」'
  if (/timeout|network/i.test(raw)) return '网络超时或不稳定，稍后再试'
  const one = raw.split('\n')[0]
  return one.length > 80 ? one.slice(0, 80) + '…' : one
}

/** 时间格式化：9月4日 12:30 */
function formatTime(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay) return `今天 ${hm}`
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${md} ${hm}`
  return `${md} ${hm}`
}

/** 价格格式化：整数不带小数，小数保留两位 */
function formatPrice(val) {
  const n = Number(val) || 0
  return Number(n.toFixed(2)).toString()
}

/** 生成随机文件名后缀 */
function randomStr(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** 标签串解析："微辣;15分钟" -> ["微辣","15分钟"] */
function parseTags(raw) {
  return String(raw || '')
    .split(/[,，;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** 食材串解析：支持中英文逗号/顿号/分号/空格分隔 */
function parseIngredients(raw) {
  return String(raw || '')
    .split(/[,，、;；\/|\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 做法步骤解析：每行一步。
 *
 * 用户可能自己写「1. 番茄切块」这种编号 —— 这里会把行首编号去掉，
 * 由界面统一重新编号，避免显示成「1 1. 番茄切块」。
 * 只在编号后面跟着编号分隔符或空白时才去掉，所以「300克面粉」不会被误伤。
 */
function parseSteps(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^\d+\s*[.、．)）:：]\s*/, '').replace(/^\d+\s+/, '').trim())
    .filter(Boolean)
}

module.exports = {
  toast,
  showLoading,
  hideLoading,
  confirm,
  alert,
  formatTime,
  formatPrice,
  randomStr,
  pad,
  sleep,
  errText,
  parseTags,
  parseIngredients,
  parseSteps
}
