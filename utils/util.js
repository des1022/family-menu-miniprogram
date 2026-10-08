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

/** 二次确认弹窗 */
function confirm(content, title = '提示', confirmText = '确定') {
  return new Promise(resolve => {
    wx.showModal({
      title,
      content,
      confirmText,
      confirmColor: '#D9714E',
      cancelColor: '#8B8178',
      success: res => resolve(!!res.confirm),
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
 * 把云开发/网络错误整理成一行人话，直接能显示给用户看。
 * 出问题时报错信息太重要了 —— 不要吞掉它，否则只能干看着「请重试」。
 */
function errText(e) {
  if (!e) return '未知错误'
  const code = e.errCode || e.code || ''
  const msg = e.errMsg || e.message || String(e)
  let hint = ''
  if (code === -502005 || /not exist|不存在/i.test(msg)) {
    hint = ' → 集合还没建，去云开发控制台新建，权限设「所有用户可读写」'
  } else if (code === -501001 || /permission|denied|权限/i.test(msg)) {
    hint = ' → 集合权限不对，应设为「所有用户可读写」'
  } else if (code === -502001 || code === -501000 || /timeout|网络|network|fail/i.test(msg)) {
    hint = ' → 像是网络超时，稍后重试'
  }
  return (code ? '[' + code + '] ' : '') + msg + hint
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

module.exports = {
  toast,
  showLoading,
  hideLoading,
  confirm,
  formatTime,
  formatPrice,
  randomStr,
  pad,
  sleep,
  errText,
  parseTags,
  parseIngredients
}
