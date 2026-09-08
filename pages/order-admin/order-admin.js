const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { formatTime, formatPrice, toast, confirm } = require('../../utils/util.js')

Page({
  data: {
    allOrders: [],
    showList: [],
    filter: -1,      // -1 = 全部
    loading: true
  },

  onLoad() {
    // 未通过管理密码验证时不允许进入
    if (!getApp().globalData.adminPwd) {
      toast('请先通过管理密码验证')
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.load()
  },

  onShow() {
    if (getApp().globalData.adminPwd) this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh())
  },

  async load(silent = false) {
    if (!silent) this.setData({ loading: true })
    try {
      const orders = await db.getOrders()
      const decorated = orders.map(o => Object.assign({}, o, {
        timeText: formatTime(o.createTime),
        statusText: config.ORDER_STATUS_TEXT[o.status] || '待制作',
        totalPriceText: formatPrice(o.totalPrice)
      }))
      this.setData({ allOrders: decorated }, () => this.buildList())
    } catch (e) {
      console.error('[order-admin] 加载订单失败', e)
      toast('加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  buildList() {
    const { allOrders, filter } = this.data
    const showList = filter === -1
      ? allOrders
      : allOrders.filter(o => o.status === filter)
    this.setData({ showList })
  },

  onFilter(e) {
    this.setData({ filter: Number(e.currentTarget.dataset.s) }, () => this.buildList())
  },

  /** 修改订单状态 */
  async onChangeStatus(e) {
    const { id } = e.currentTarget.dataset
    const status = Number(e.currentTarget.dataset.status)
    try {
      await db.updateOrderStatus(id, status)
      toast(config.ORDER_STATUS_TEXT[status])
      this.load(true)
    } catch (err) {
      console.error('[order-admin] 状态更新失败', err)
      toast('更新失败')
    }
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id
    const ok = await confirm('确定删除这条订单吗？删除后不可恢复。', '删除订单', '删除')
    if (!ok) return
    try {
      await db.removeOrder(id)
      toast('已删除')
      this.load(true)
    } catch (err) {
      console.error('[order-admin] 删除订单失败', err)
      toast('删除失败')
    }
  }
})
