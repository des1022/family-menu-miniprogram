Component({
  properties: {
    count: {
      type: Number,
      value: 4
    }
  },

  observers: {
    'count': function (count) {
      const items = []
      for (let i = 0; i < count; i++) items.push(i)
      this.setData({ items })
    }
  },

  data: {
    items: [0, 1, 2, 3]
  }
})
