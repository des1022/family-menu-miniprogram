const { formatPrice } = require('../../utils/util.js')

Component({
  properties: {
    dish: { type: Object, value: {} },
    num: { type: Number, value: 0 }
  },

  observers: {
    'dish': function (dish) {
      if (!dish) return
      this.setData({
        priceText: formatPrice(dish.price),
        favorite: dish.favorite === 1,
        tagList: (dish.tags || '').split(/[,，;；]+/).filter(Boolean).slice(0, 3)
      })
    }
  },

  data: {
    priceText: '0',
    favorite: false,
    tagList: []
  },

  methods: {
    onAdd() {
      this.triggerEvent('add', { dish: this.data.dish })
    },
    onDec() {
      this.triggerEvent('dec', { dish: this.data.dish })
    },
    onPreview() {
      const url = this.data.dish.image
      if (!url) return
      wx.previewImage({ urls: [url], current: url })
    }
  }
})
