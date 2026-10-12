const theme = require('../../utils/theme.js')

/**
 * 深浅两套图标。
 *
 * 路径全部写成完整字面量（不做字符串拼接）—— tools/lint.py 会静态校验
 * 「代码里引用的图标文件是否真的存在」，拼出来的路径它校验不到。
 */
const ICONS = {
  light: {
    bowl: '/assets/icons/empty-bowl.png',
    basket: '/assets/icons/empty-basket.png',
    cal: '/assets/icons/empty-cal.png',
    plate: '/assets/icons/empty-plate.png'
  },
  dark: {
    bowl: '/assets/icons/empty-bowl-d.png',
    basket: '/assets/icons/empty-basket-d.png',
    cal: '/assets/icons/empty-cal-d.png',
    plate: '/assets/icons/empty-plate-d.png'
  }
}

/**
 * 空态占位。
 *
 * 图标按场景传（bowl 碗 / basket 菜篮 / cal 日历 / plate 盘子），
 * 深浅两套图由组件自己按当前主题挑，页面不用管。
 */
Component({
  properties: {
    ico: { type: String, value: 'bowl' },
    text: { type: String, value: '' },
    sub: { type: String, value: '' }
  },

  data: {
    icoSrc: ''
  },

  lifetimes: {
    attached() {
      this.syncIco()
    }
  },

  pageLifetimes: {
    // 从「家庭 → 外观」改完主题回来时要跟着换
    show() {
      this.syncIco()
    }
  },

  methods: {
    syncIco() {
      const set = theme.isDark() ? ICONS.dark : ICONS.light
      this.setData({ icoSrc: set[this.data.ico] || set.bowl })
    }
  }
})
