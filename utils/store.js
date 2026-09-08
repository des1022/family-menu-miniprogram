/**
 * 极简事件总线：用于购物车变更时通知各页面/组件刷新
 */
const events = {}

function on(name, fn) {
  if (!events[name]) events[name] = []
  events[name].push(fn)
}

function off(name, fn) {
  if (!events[name]) return
  if (!fn) {
    delete events[name]
    return
  }
  events[name] = events[name].filter(item => item !== fn)
}

function emit(name, payload) {
  const list = events[name] || []
  list.slice().forEach(fn => {
    try {
      fn(payload)
    } catch (e) {
      console.error('[store] 事件处理异常', name, e)
    }
  })
}

module.exports = { on, off, emit }
