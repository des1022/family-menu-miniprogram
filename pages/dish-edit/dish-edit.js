const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const { chooseImage, uploadDishImage, deleteDishImage } = require('../../utils/image.js')
const { toast, showLoading, hideLoading, parseTags } = require('../../utils/util.js')

const NEW_CAT_FLAG = '＋ 新增分类…'

Page({
  data: {
    isEdit: false,
    dishId: '',
    form: {
      name: '',
      category: '',
      image: '',
      price: '',
      desc: '',
      ingredients: '',
      steps: '',
      status: config.DISH_STATUS.ON
    },
    selectedTags: [],
    selectedMap: {},
    tagGroups: config.TAG_GROUPS,
    newCategory: '',
    showNewCat: false,
    categories: [],
    pickerRange: [],
    pickerIndex: 0,
    oldImage: '',     // 编辑时记录原图，替换后删除云存储旧图
    saving: false
  },

  onLoad(options) {
    if (options && options.id) {
      this.setData({ isEdit: true, dishId: options.id })
      wx.setNavigationBarTitle({ title: '编辑菜品' })
    }
    this.loadCategories()
    if (this.data.isEdit) this.loadDish(options.id)
  },

  /** 读取分类列表，末尾追加「新增分类」选项 */
  async loadCategories() {
    try {
      const cats = await db.getCategories()
      const names = cats.map(c => c.name)
      this.setData({
        categories: names,
        pickerRange: names.concat([NEW_CAT_FLAG])
      })
    } catch (e) {
      console.warn('[dish-edit] 分类加载失败', e)
      this.setData({ pickerRange: [NEW_CAT_FLAG] })
    }
  },

  async loadDish(id) {
    try {
      const list = await db.getAllDishes()
      const dish = list.find(item => item._id === id)
      if (!dish) {
        toast('菜品不存在')
        return
      }
      this.setData({
        form: {
          name: dish.name || '',
          category: dish.category || '',
          image: dish.image || '',
          price: dish.price ? String(dish.price) : '',
          desc: dish.desc || '',
          ingredients: dish.ingredients || '',
          steps: dish.steps || '',
          status: typeof dish.status === 'number' ? dish.status : config.DISH_STATUS.ON
        },
        oldImage: dish.image || '',
        selectedTags: parseTags(dish.tags),
        selectedMap: (function (arr) { const m = {}; arr.forEach(x => { m[x] = true }); return m })(parseTags(dish.tags))
      })
    } catch (e) {
      console.error('[dish-edit] 加载菜品失败', e)
      toast('加载失败')
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    let value = e.detail.value
    if (field === 'newCategory') {
      this.setData({
        newCategory: value,
        'form.category': value
      })
      return
    }
    this.setData({ [`form.${field}`]: value })
  },

  /** 分类下拉：选中末项时展开手动输入 */
  onCategoryPick(e) {
    const index = Number(e.detail.value)
    const name = this.data.pickerRange[index]
    if (name === NEW_CAT_FLAG) {
      this.setData({ showNewCat: true, 'form.category': '', newCategory: '' })
    } else {
      this.setData({ showNewCat: false, 'form.category': name, newCategory: '' })
    }
  },

  /** 标签点选 / 取消（selectedMap 供 wxml 判断选中态） */
  onToggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.selectedTags.slice()
    const idx = list.indexOf(tag)
    if (idx > -1) list.splice(idx, 1)
    else list.push(tag)
    const map = {}
    list.forEach(item => { map[item] = true })
    this.setData({ selectedTags: list, selectedMap: map })
  },

  onStatusChange(e) {
    this.setData({
      'form.status': e.detail.value ? config.DISH_STATUS.ON : config.DISH_STATUS.OFF
    })
  },

  /** 选择图片 → 压缩 → 上传云存储 */
  async onChooseImage() {
    try {
      const files = await chooseImage(1)
      if (!files || !files.length) return
      showLoading('上传中')
      const fileID = await uploadDishImage(files[0])
      this.setData({ 'form.image': fileID })
      hideLoading()
      toast('图片已上传')
    } catch (e) {
      hideLoading()
      console.error('[dish-edit] 图片上传失败', e)
      toast('图片上传失败，请重试')
    }
  },

  async onSave() {
    if (this.data.saving) return
    const { form, isEdit, dishId, oldImage } = this.data
    const name = (form.name || '').trim()
    const category = (form.category || '').trim()

    if (!name) return toast('请填写菜品名称')
    if (!category) return toast('请选择或输入菜品分类')
    if (!form.image) return toast('请上传菜品图片')

    const price = form.price === '' || form.price === null ? 0 : Number(form.price)
    if (isNaN(price) || price < 0) return toast('价格请填写数字')

    const payload = {
      name,
      category,
      image: form.image,
      price,
      desc: (form.desc || '').trim(),
      ingredients: (form.ingredients || '').trim(),
      steps: (form.steps || '').trim(),
      tags: this.data.selectedTags.join(';'),
      status: form.status
    }

    this.setData({ saving: true })
    showLoading('保存中')
    try {
      if (isEdit) {
        await db.updateDish(dishId, payload)
        // 换过图才删除旧图，避免误删
        if (oldImage && oldImage !== form.image) {
          await deleteDishImage(oldImage)
        }
      } else {
        await db.addDish(payload)
      }
      hideLoading()
      toast('保存成功')
      setTimeout(() => wx.navigateBack(), 700)
    } catch (e) {
      hideLoading()
      console.error('[dish-edit] 保存失败', e)
      toast('保存失败，请重试')
    } finally {
      this.setData({ saving: false })
    }
  },

  onCancel() {
    wx.navigateBack()
  }
})
