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
    loading: false,
    editingId: '',      // 正在改名的分类 _id（空 = 新增模式）
    editingOld: '',     // 改名前的老名字，用来把名下的菜一起改过来
    editingFocus: false // 点「编辑」后把光标送进输入框
  },

  onLoad() {
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

  /** 点某行的「编辑」：把名字填进上面的输入框，按钮变成「保存」 */
  onEdit(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({ editingId: id, editingOld: name, newName: name, editingFocus: true })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  onCancelEdit() {
    this.setData({ editingId: '', editingOld: '', newName: '', editingFocus: false })
  },

  onInputFocusBlur() {
    // focus 只用于「点编辑时把光标送进去」，用一次就要复位，否则下次点编辑不再触发
    this.setData({ editingFocus: false })
  },

  /** 新增 / 改名 共用一个提交入口 */
  async onSubmit() {
    const name = (this.data.newName || '').trim()
    const editingId = this.data.editingId
    if (!name) return toast(editingId ? '请输入新的分类名' : '请输入分类名称')
    if (this.data.categories.some(c => c.name === name && c._id !== editingId)) {
      return toast('该分类已存在')
    }

    // ---- 改名：分类文档 + 名下所有菜的 category 一起改 ----
    if (editingId) {
      const old = this.data.editingOld
      if (old === name) {
        this.onCancelEdit()
        return toast('名字没变')
      }
      wx.showLoading({ title: '改名中', mask: true })
      try {
        await db.updateCategory(editingId, { name: name })
        const moved = await db.moveDishesCategory(old, name)
        wx.hideLoading()
        this.setData({ editingId: '', editingOld: '', newName: '', editingFocus: false })
        toast(moved ? '已改名，' + moved + ' 道菜跟着改了' : '已改名')
        this.load()
      } catch (err) {
        wx.hideLoading()
        console.error('[category] 改名失败', err)
        toast('改名失败')
      }
      return
    }

    // ---- 新增 ----
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
