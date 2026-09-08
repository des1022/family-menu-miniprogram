const db = require('../../utils/db.js')
const { toast } = require('../../utils/util.js')

/**
 * 底部悬浮球：实时显示今日已选份数（watch 当日 records），点击进入点单清单
 */
Component({
  data: {
    totalNum: 0,
    dishCount: 0
  },

  lifetimes: {
    attached() {
      this.refresh()
    },
    detached() {
      if (this._watcher && this._watcher.close) this._watcher.close()
    }
  },

  methods: {
    refresh() {
      const date = db.todayStr()
      if (this._date !== date) {
        if (this._watcher && this._watcher.close) this._watcher.close()
        this._watcher = db.watchRecordsByDate(date, docs => this.apply(docs))
        this._date = date
      }
    },

    apply(docs) {
      const total = docs.reduce((s, r) => s + (r.num || 0), 0)
      this.setData({ totalNum: total, dishCount: docs.length })
    },

    goList() {
      if (this.data.totalNum === 0) {
        toast('今天还没点菜哦')
        return
      }
      wx.navigateTo({ url: '/pages/confirm/confirm' })
    }
  }
})
