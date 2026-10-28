/**
 * 「今天做哪种口味？」选择弹层
 *
 * 用途：点菜（加进今晚）时，如果这道菜在编辑页填过口味，就先问一句做哪种 ——
 * 选中的口味记在**点单记录**上（同一道菜今天做中辣，下次可能就是微辣）。
 * 没有填过口味的菜根本不会弹这一层，不多一次点击。
 *
 * 用法：
 *   <flavor-pick show="{{flavorPick.show}}" title="{{flavorPick.name}}"
 *                options="{{flavorPick.options}}" current="{{flavorPick.current}}"
 *                bindpick="onFlavorPick" bindclear="onFlavorClear" bindclose="onFlavorClose"/>
 *   e.detail.flavor = 选中的口味（clear 时为空串）
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    // 菜名，放在标题里，确认一下没点错菜
    title: { type: String, value: '' },
    options: { type: Array, value: [] },
    // 已选的口味（改口味时高亮它）
    current: { type: String, value: '' }
  },

  methods: {
    onPick(e) {
      this.triggerEvent('pick', { flavor: e.currentTarget.dataset.v || '' })
    },
    onClear() {
      this.triggerEvent('clear', { flavor: '' })
    },
    onClose() {
      this.triggerEvent('close', {})
    },
    noop() {}
  }
})
