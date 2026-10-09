/**
 * 统一确认弹窗（方案 D · 暖橙卡）
 *
 * 为什么要自绘：原来全站用 `wx.showModal`（微信原生弹窗），它的样式**完全由微信决定**，
 * 代码里改不了 —— 灰底、系统字、圆角很小，和产品自己的视觉体系对不上。
 *
 * 用法（页面里挂一次就行）：
 *   wxml:  <ui-dialog id="uiDialog"/>
 *   json:  "usingComponents": { "ui-dialog": "/components/ui-dialog/index" }
 *   然后直接 `utils/util.js` 的 `confirm()` / `alert()` 就会自动走到这里，
 *   业务代码一行都不用改（util 通过 getCurrentPages() 找到当前页的 #uiDialog）。
 *
 * 直接调也支持：
 *   const r = await this.selectComponent('#uiDialog').open({ title, content, confirmText, danger: true })
 *
 * 约定：
 *   - `danger: true` → 砖红卡片 + 垃圾桶图标（会丢东西的操作）
 *   - `showCancel: false` → 只有一个按钮（提示类信息）
 *   - 点遮罩 = 取消（提示类不响应）
 */
Component({
  data: {
    show: false,
    title: '',
    content: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    showCancel: true,
    icoWarm: '/assets/icons/dlg-warm.png',
    icoBad: '/assets/icons/dlg-danger.png'
  },

  methods: {
    /**
     * 打开弹窗
     * @returns {Promise<boolean>} 点确定 resolve(true)，取消/关闭 resolve(false)
     */
    open(opt) {
      const o = opt || {}
      // 上一个还没关就被顶掉：先按「取消」结掉，避免调用方永远 await 不到
      if (this._resolve) this._finish(false)

      return new Promise(resolve => {
        this._resolve = resolve
        this.setData({
          show: true,
          title: o.title || '提示',
          content: o.content || '',
          confirmText: o.confirmText || '确定',
          cancelText: o.cancelText || '取消',
          danger: !!o.danger,
          showCancel: o.showCancel !== false
        })
      })
    },

    onOk() {
      this._finish(true)
    },

    onCancel() {
      // 只有一个按钮时，点遮罩不该把它关掉（那是提示，不是选择）
      if (!this.data.showCancel) return
      this._finish(false)
    },

    _finish(val) {
      const r = this._resolve
      this._resolve = null
      this.setData({ show: false })
      if (r) r(val)
    },

    noop() {}
  }
})
