const db = require('../../utils/db.js')
const { toast, confirm } = require('../../utils/util.js')

/** showActionSheet 的 Promise 封装 */
function actionSheet(itemList) {
  return new Promise(resolve => {
    wx.showActionSheet({
      itemList,
      success: res => resolve(res.tapIndex),
      fail: () => resolve(-1)
    })
  })
}

Page({
  data: {
    categories: [],
    newName: '',
    loading: false
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

  async load() {
    this.setData({ loading: true })
    try {
      const [cats, dishes] = await Promise.all([
        db.getCategories(),
        db.getAllDishes()
      ])
      // 统计每个分类下的菜品数
      const categories = cats.map(c => Object.assign({}, c, {
        count: dishes.filter(d => d.category === c.name).length
      }))
      this.setData({ categories })
    } catch (e) {
      console.error('[category] 加载分类失败', e)
      toast('加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e) {
    this.setData({ newName: e.detail.value })
  },

  async onAdd() {
    const name = (this.data.newName || '').trim()
    if (!name) return toast('请输入分类名称')
    if (this.data.categories.some(c => c.name === name)) {
      return toast('该分类已存在')
    }
    try {
      await db.addCategory(name, this.data.categories.length)
      this.setData({ newName: '' })
      toast('已添加')
      this.load()
    } catch (e) {
      console.error('[category] 添加分类失败', e)
      toast('添加失败')
    }
  },

  /**
   * 删除分类：
   * 1. 分类下无菜品 → 直接删
   * 2. 分类下还有菜品 → 先选择目标分类转移，再删
   */
  async onDelete(e) {
    const { id, name } = e.currentTarget.dataset
    let dishes = []
    try {
      dishes = await db.getAllDishes()
    } catch (err) {
      return toast('读取菜品失败')
    }
    const inCat = dishes.filter(d => d.category === name)

    if (inCat.length > 0) {
      const others = this.data.categories.filter(c => c.name !== name)
      if (!others.length) {
        return toast('请先新增一个分类，用于转移该分类下的菜品')
      }
      const pick1 = await actionSheet(['转移到其他分类', '取消'])
      if (pick1 !== 0) return

      const pick2 = await actionSheet(others.map(c => c.name))
      if (pick2 < 0) return
      const target = others[pick2].name

      const ok = await confirm(
        `「${name}」下还有 ${inCat.length} 道菜，将全部转移到「${target}」，然后删除该分类。`,
        '删除分类',
        '转移并删除'
      )
      if (!ok) return

      wx.showLoading({ title: '处理中', mask: true })
      try {
        await db.moveDishesCategory(name, target)
      } catch (err) {
        wx.hideLoading()
        console.error('[category] 菜品转移失败', err)
        return toast('菜品转移失败')
      }
    } else {
      const ok = await confirm(`确定删除分类「${name}」吗？`, '删除分类', '删除')
      if (!ok) return
      wx.showLoading({ title: '删除中', mask: true })
    }

    try {
      await db.removeCategory(id)
      wx.hideLoading()
      toast('已删除')
      this.load()
    } catch (err) {
      wx.hideLoading()
      console.error('[category] 删除分类失败', err)
      toast('删除失败')
    }
  }
})
