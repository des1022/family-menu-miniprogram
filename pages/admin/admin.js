const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { deleteDishImage } = require('../../utils/image.js')
const { toast, confirm, formatPrice } = require('../../utils/util.js')

const ALL_CAT = '全部'
const OFF_CAT = '已下架'   // 状态筛选项：把下架的菜单独收在一处

/** 菜品管理：列表 / 上下架 / 编辑 / 删除（免密码，家庭私有小程序） */
Page({
  data: {
    allDishes: [],
    groups: [],
    catOptions: [ALL_CAT],
    moveCats: [],
    filterCat: ALL_CAT,
    loading: false,
    selecting: false,
    selectedMap: {},
    selectedCount: 0,
    showMovePicker: false
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
      const moveCats = Array.from(new Set(cats.map(c => c.name).concat(fromDishes)))
      // 「已下架」只作为筛选胶囊存在，不能当成可移动的目标分类
      const catOptions = [ALL_CAT].concat(moveCats).concat([OFF_CAT])
      const decorated = dishes.map(d => Object.assign({}, d, { priceText: formatPrice(d.price) }))
      this.setData({ allDishes: decorated, catOptions: catOptions, moveCats: moveCats },
        () => this.buildGroups())
    } catch (e) {
      console.error('[admin] 加载菜品失败', e)
      toast('加载失败，请检查云环境配置')
    } finally {
      this.setData({ loading: false })
    }
  },

  buildGroups() {
    const { allDishes, filterCat, selectedMap, selecting } = this.data
    let list = allDishes
    if (filterCat === OFF_CAT) {
      list = list.filter(d => Number(d.status) !== config.DISH_STATUS.ON)
    } else if (filterCat !== ALL_CAT) {
      list = list.filter(d => d.category === filterCat)
    }
    const map = {}
    list.forEach(d => {
      const key = d.category || '未分类'
      if (!map[key]) map[key] = { name: key, dishes: [] }
      map[key].dishes.push(d)
    })
    const groups = Object.keys(map).map(k => map[k])
    // 批量模式下带上选中态
    groups.forEach(g => g.dishes.forEach(d => { d.checked = !!(selecting && selectedMap[d._id]) }))
    this.setData({ groups: groups })
  },

  /* ==================== 批量操作 ==================== */

  enterSelect() {
    this.setData({ selecting: true, selectedMap: {}, selectedCount: 0 }, () => this.buildGroups())
  },

  exitSelect() {
    this.setData({ selecting: false, selectedMap: {}, selectedCount: 0 }, () => this.buildGroups())
  },

  toggleSelect(id) {
    const map = Object.assign({}, this.data.selectedMap)
    if (map[id]) delete map[id]
    else map[id] = true
    this.setData({ selectedMap: map, selectedCount: Object.keys(map).length }, () => this.buildGroups())
  },

  onRowTap(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.selecting) this.toggleSelect(id)
    else this.onEdit(e)
  },

  onToggleCheck(e) {
    if (this.data.selecting) this.toggleSelect(e.currentTarget.dataset.id)
  },

  onLongPressRow(e) {
    if (!this.data.selecting) {
      this.setData({ selecting: true }, () => this.toggleSelect(e.currentTarget.dataset.id))
    }
  },

  onToggleSelectAll() {
    const { selectedMap, allDishes } = this.data
    if (Object.keys(selectedMap).length === allDishes.length) {
      this.setData({ selectedMap: {}, selectedCount: 0 }, () => this.buildGroups())
    } else {
      const map = {}
      allDishes.forEach(d => { map[d._id] = true })
      this.setData({ selectedMap: map, selectedCount: allDishes.length }, () => this.buildGroups())
    }
  },

  _selectedIds() {
    return Object.keys(this.data.selectedMap)
  },

  batchSetStatus(next) {
    const ids = this._selectedIds()
    if (!ids.length) return toast('请先勾选菜品')
    wx.showLoading({ title: '处理中', mask: true })
    Promise.all(ids.map(id => db.updateDish(id, { status: next })))
      .then(() => {
        wx.hideLoading()
        toast(next === config.DISH_STATUS.ON ? '已批量上架' : '已批量下架')
        this.exitSelect()
        this.loadDishes(true)
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[admin] 批量上下架失败', err)
        toast('操作失败')
      })
  },

  onBatchOn() { this.batchSetStatus(config.DISH_STATUS.ON) },
  onBatchOff() { this.batchSetStatus(config.DISH_STATUS.OFF) },

  onBatchMove() {
    if (!this._selectedIds().length) return toast('请先勾选菜品')
    if (!this.data.moveCats.length) return toast('没有其它分类可选')
    this.setData({ showMovePicker: true })
  },

  onPickMoveTarget(e) {
    const target = e.currentTarget.dataset.name
    const ids = this._selectedIds()
    this.setData({ showMovePicker: false })
    wx.showLoading({ title: '移动中', mask: true })
    Promise.all(ids.map(id => db.updateDish(id, { category: target })))
      .then(() => {
        wx.hideLoading()
        toast('已移到「' + target + '」')
        this.exitSelect()
        this.loadDishes(true)
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[admin] 批量改分类失败', err)
        toast('操作失败')
      })
  },

  closeMovePicker() {
    this.setData({ showMovePicker: false })
  },

  onBatchDelete() {
    const ids = this._selectedIds()
    if (!ids.length) return toast('请先勾选菜品')
    const ok = confirm('删除 ' + ids.length + ' 道菜？删除后不可恢复（图片一并删除）。', '批量删除', '删除')
    if (!ok) return
    wx.showLoading({ title: '删除中', mask: true })
    const jobs = ids.map(id => {
      const dish = this.data.allDishes.find(d => d._id === id)
      return db.removeDish(id).then(() => dish && dish.image ? deleteDishImage(dish.image) : null)
    })
    Promise.all(jobs)
      .then(() => {
        wx.hideLoading()
        toast('已删除 ' + ids.length + ' 道')
        this.exitSelect()
        this.loadDishes(true)
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[admin] 批量删除失败', err)
        toast('删除失败')
      })
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
