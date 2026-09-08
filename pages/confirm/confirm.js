const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { toast, confirm } = require('../../utils/util.js')

/** 今日点单清单：份数 / 备注 / 删除 / 清空 / 确认（云 records 实时同步） */
Page({
  data: {
    list: [],        // records + priceText
    totalNum: 0,
    totalDish: 0,
    totalPriceText: '0',
    empty: true,
    isToday: true,
    ingredientCount: 0
  },

  onLoad() {},

  onShow() {
    this.load()
  },

  onHide() {
    this.detachWatcher()
  },

  onUnload() {
    this.detachWatcher()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    const date = db.todayStr()
    try {
      const records = await db.getRecordsByDate(date)
      this.apply(records)
      this.attachWatcher(date)
    } catch (e) {
      console.error('[confirm] 加载失败', e)
      toast('加载失败，下拉重试')
    }
  },

  attachWatcher(date) {
    if (this._watcher && this._date === date) return
    this.detachWatcher()
    this._watcher = db.watchRecordsByDate(date, docs => this.apply(docs))
    this._date = date
  },

  detachWatcher() {
    if (this._watcher && this._watcher.close) this._watcher.close()
    this._watcher = null
  },

  apply(records) {
    // 冗余了 dishName/dishImage，无需 join；但补充最新价格/食材信息需 join 菜品——批1 直接用记录冗余
    const list = records.map(r => Object.assign({}, r, {
      priceText: (Number(r.price) || 0) > 0 ? String(Number(r.price)) : ''
    }))
    const totalNum = list.reduce((s, r) => s + (r.num || 0), 0)
    const total = list.reduce((s, r) => s + (r.num || 0) * (Number(r.price) || 0), 0)
    this.setData({
      list: list,
      empty: list.length === 0,
      totalNum: totalNum,
      totalDish: list.length,
      totalPriceText: total > 0 ? String(Number(total.toFixed(2))) : '0',
      isToday: this._date === db.todayStr()
    })
  },

  async onInc(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.list.find(item => item._id === id)
    if (!row) return
    try {
      await db.updateRecordNum(id, (row.num || 0) + 1)
    } catch (err) {
      toast('操作失败')
    }
  },

  async onDec(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.list.find(item => item._id === id)
    if (!row) return
    try {
      if ((row.num || 0) <= 1) {
        await db.removeRecord(id)
      } else {
        await db.updateRecordNum(id, row.num - 1)
      }
    } catch (err) {
      toast('操作失败')
    }
  },

  async onRemove(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.list.find(item => item._id === id)
    const name = row ? row.dishName : '这道菜'
    const ok = await confirm('把「' + name + '」从今日点单中删除？', '删除菜品', '删除')
    if (!ok) return
    try {
      await db.removeRecord(id)
    } catch (err) {
      toast('删除失败')
    }
  },

  /** 备注编辑：showModal editable（基础库 2.17.1+） */
  onEditRemark(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.list.find(item => item._id === id)
    if (!row) return
    wx.showModal({
      title: '给「' + row.dishName + '」加备注',
      editable: true,
      placeholderText: '例如：少放辣 / 不加香菜',
      content: row.remark || '',
      success: res => {
        if (!res.confirm) return
        const text = (res.content || '').trim().slice(0, 40)
        db.updateRecordRemark(id, text).catch(() => toast('备注保存失败'))
      }
    })
  },

  async onClearAll() {
    const draftCount = this.data.list.filter(r => !r.confirmed).length
    if (draftCount === 0) {
      toast('没有可清空的草稿')
      return
    }
    const ok = await confirm(
      '已确认过的菜单会保留在日历，仅清空本次未确认的新选（' + draftCount + ' 道）。确定清空吗？',
      '清空今日点单', '清空'
    )
    if (!ok) return
    try {
      const result = await db.clearDrafts(db.todayStr())
      if (result.kept > 0) {
        toast('已保留 ' + result.kept + ' 道已确认菜单')
      } else {
        toast('已清空')
      }
    } catch (e) {
      console.error('[confirm] 清空失败', e)
      toast('清空失败')
    }
  },

  async onConfirmOrder() {
    if (this.data.empty) return
    const ok = await confirm(
      '确认后菜单锁定进日历，之后清空也不会删除它。现在确认吗？',
      '确认点单', '确认'
    )
    if (!ok) return
    try {
      await db.markConfirmed(db.todayStr())
      wx.showModal({
        title: '点单完成 🎉',
        content: '今天的菜单已记录到日历。之后可去日历一键复用，或生成海报分享（海报功能即将上线）。',
        showCancel: false,
        confirmText: '好的',
        success: () => {
          wx.switchTab({ url: '/pages/index/index' })
        }
      })
    } catch (e) {
      console.error('[confirm] 确认失败', e)
      toast('确认失败，请重试')
    }
  },

  noop() {}
})
