const config = require('../../utils/config.js')
const db = require('../../utils/db.js')
const poster = require('../../utils/poster.js')
const { toast, confirm } = require('../../utils/util.js')
const theme = require('../../utils/theme.js')

const VARIANTS = [
  { key: 'WARM', label: '温馨' },
  { key: 'MINIMAL', label: '简约' },
  { key: 'FESTIVE', label: '节日' },
  { key: 'CUTE', label: '可爱' }
]

Page({
  data: {
    variants: VARIANTS,
    variant: 'WARM',
    // 标题默认不是写死的「今天的家庭菜单」，而是每次进页面随机挑一句温馨话
    title: '',
    footer: '今晚吃这些，幸福！',
    date: '',
    dateText: '',
    eatCount: 0,
    themeCls: '',      // 以前这页没绑主题，强制深色时不跟随
    empty: false,
    generating: true,
    saving: false,
    dispH: 500
  },

  onShow() {
    this.setData({ themeCls: theme.className() })
  },

  onLoad(options) {
    const date = (options && options.date) || db.todayStr()
    this._date = date
    this._lines = []
    this.setData({
      date: date,
      dateText: poster.dateCNFull(date),
      title: poster.randomPhrase()
    })
  },

  onReady() {
    this.loadLines()
  },

  async loadLines() {
    try {
      const [records, members] = await Promise.all([
        db.getRecordsByDate(this._date),
        db.getMembers().catch(() => [])
      ])
      if (!records.length) {
        this.setData({ empty: true, generating: false })
        return
      }
      this._lines = records.map(r => ({
        dishName: r.dishName,
        dishImage: r.dishImage,
        num: r.num
      }))
      // 海报副信息要写「今晚 N 人在家吃」，用家里那份开关算出来的数
      this.setData({ eatCount: db.countEatTonight(members) })
      this.render()
    } catch (e) {
      console.error('[poster] 加载失败', e)
      toast('加载失败')
      this.setData({ generating: false })
    }
  },

  /** 换一句温馨话 */
  onShuffleTitle() {
    const next = poster.randomPhrase(this.data.title)
    this.setData({ title: next }, () => this.render())
  },

  async render() {
    this.setData({ generating: true })
    try {
      const query = wx.createSelectorQuery()
      query.select('#posterCanvas').fields({ node: true }).exec(async res => {
        if (!res[0] || !res[0].node) {
          toast('画布初始化失败')
          return
        }
        const canvas = res[0].node
        const H = await poster.drawPoster(canvas, this._lines, {
          title: this.data.title || poster.randomPhrase(),
          footer: this.data.footer || '今晚吃这些，幸福！',
          date: this.data.dateText,
          variant: this.data.variant,
          eatCount: this.data.eatCount
        })
        const dispW = wx.getSystemInfoSync().windowWidth - 32
        this.setData({ generating: false, dispH: Math.round(dispW * H / 1080) })
      })
      query.exec && query.exec(() => {})
    } catch (e) {
      console.error('[poster] 渲染失败', e)
      this.setData({ generating: false })
      toast('渲染失败')
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value.slice(0, 12) }, () => this.debouncedRender())
  },

  onFooterInput(e) {
    this.setData({ footer: e.detail.value.slice(0, 16) }, () => this.debouncedRender())
  },

  onSwitchVariant(e) {
    this.setData({ variant: e.currentTarget.dataset.key }, () => this.render())
  },

  debouncedRender() {
    if (this._t) clearTimeout(this._t)
    this._t = setTimeout(() => this.render(), 250)
  },

  async onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const query = wx.createSelectorQuery()
      query.select('#posterCanvas').fields({ node: true }).exec(async res => {
        const canvas = res[0].node
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: r => {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => {
                this.setData({ saving: false })
                toast('已保存到相册')
              },
              fail: err => {
                this.setData({ saving: false })
                if (err.errMsg && err.errMsg.indexOf('auth') > -1) {
                  confirm('请在设置中允许保存图片到相册', '需要相册权限', '去设置')
                    .then(ok => { if (ok) wx.openSetting() })
                } else {
                  toast('保存失败')
                }
              }
            })
          },
          fail: () => {
            this.setData({ saving: false })
            toast('导出失败')
          }
        })
      })
      query.exec && query.exec(() => {})
    } catch (e) {
      this.setData({ saving: false })
      toast('导出失败')
    }
  },

  noop() {}
})
