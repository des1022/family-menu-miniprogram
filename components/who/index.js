/**
 * 「你是家里的哪位？」选择弹层
 *
 * 用途：本机认不出「我是谁」时（换了客户端打开、清过缓存），
 * 让用户从已有成员里指认自己，而不是默默新建一条 —— 后者会让家庭里
 * 不断多出「未命名」成员（2026-10-08 真机反馈的 bug）。
 *
 * 用法：
 *   <who show="{{whoShow}}" members="{{whoList}}"
 *        bindpick="onWhoPick" bindcreate="onWhoCreate" bindclose="onWhoClose"/>
 *   members 每项需要：{ _id, color, initial, nickname }
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    members: { type: Array, value: [] }
  },

  methods: {
    onPick(e) {
      this.triggerEvent('pick', { id: e.currentTarget.dataset.id })
    },
    onCreate() {
      this.triggerEvent('create')
    },
    onClose() {
      this.triggerEvent('close')
    },
    noop() {}
  }
})
