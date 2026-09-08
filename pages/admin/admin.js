const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { deleteDishImage } = require('../../utils/image.js')
const { toast, confirm, formatPrice } = require('../../utils/util.js')

const ALL_CAT = '全部'

/** 菜品管理：列表 / 上下架 / 编辑 / 删除（免密码，家庭私有小程序） */
Page({
  data: {
    allDishes: [],
    groups: [],
    catOptions: [ALL_CAT],
    filterCat: ALL_CAT,
    loading: false
  },

  onShow() {
    this.loadDishes(true)
  },

  onPullDownRefresh() {
    this.loadDishes(true).then(() => wx.stopPullDownRefresh())
  },

  async loadDishes(silent) {
    if (!silent) this.setData({ loading: true })
    try {
      const dishes = await db.getAllDishes()
      const cats = await db.getCategories()
      const fromDishes = Array.from(new Set(dishes.map(d => d.category).filter(Boolean)))
      const catOptions = [ALL_CAT].concat(
        Array.from(new Set(cats.map(c => c.name).concat(fromDishes)))
      )
      const decorated = dishes.map(d => Object.assign({}, d, { priceText: formatPrice(d.price) }))
      this.setData({ allDishes: decorated, catOptions: catOptions }, () => this.buildGroups())
    } catch (e) {
      console.error('[admin] 加载菜品失败', e)
      toast('加载失败，请检查云环境配置')
    } finally {
      this.setData({ loading: false })
    }
  },

  buildGroups() {
    const { allDishes, filterCat } = this.data
    let list = allDishes
    if (filterCat !== ALL_CAT) {
      list = list.filter(d => d.category === filterCat)
    }
    const map = {}
    list.forEach(d => {
      const key = d.category || '未分类'
      if (!map[key]) map[key] = { name: key, dishes: [] }
      map[key].dishes.push(d)
    })
    const groups = Object.keys(map).map(k => map[k])
    this.setData({ groups: groups })
  },

  onFilter(e) {
    this.setData({ filterCat: e.currentTarget.dataset.cat }, () => this.buildGroups())
  },

  async onToggleStatus(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const next = Number(status) === config.DISH_STATUS.ON ? config.DISH_STATUS.OFF : config.DISH_STATUS.ON
    try {
      await db.updateDish(id, { status: next })
      toast(next === config.DISH_STATUS.ON ? '已上架' : '已下架')
      this.loadDishes(true)
    } catch (err) {
      console.error('[admin] 状态更新失败', err)
      toast('操作失败')
    }
  },

  onEdit(e) {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + e.currentTarget.dataset.id })
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id
    const image = e.currentTarget.dataset.image
    const name = e.currentTarget.dataset.name
    const ok = await confirm('确定删除「' + name + '」吗？删除后不可恢复。', '删除菜品', '删除')
    if (!ok) return
    wx.showLoading({ title: '删除中', mask: true })
    try {
      await db.removeDish(id)
      await deleteDishImage(image)
      toast('已删除')
      this.loadDishes(true)
    } catch (err) {
      console.error('[admin] 删除失败', err)
      toast('删除失败')
    } finally {
      wx.hideLoading()
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  },

  goCategory() {
    wx.navigateTo({ url: '/pages/category/category' })
  },

  noop() {}
})
