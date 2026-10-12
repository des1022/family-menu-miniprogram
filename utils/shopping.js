/**
 * 采购清单的纯逻辑：食材 → 货架分组、常备判断
 *
 * 分组对齐逛超市的动线；常备调料默认折叠，避免每次都被一堆「盐油酱醋」淹没。
 */

const GROUPS = ['蔬菜', '肉蛋', '水产', '调味', '主食', '其他']

const RULES = [
  {
    group: '蔬菜',
    keys: ['青菜', '白菜', '菠菜', '生菜', '油菜', '菜', '黄瓜', '番茄', '西红柿', '土豆', '萝卜',
      '茄子', '辣椒', '青椒', '彩椒', '洋葱', '葱', '姜', '蒜', '豆角', '豆芽', '芹菜', '韭菜',
      '冬瓜', '南瓜', '丝瓜', '苦瓜', '莲藕', '藕', '山药', '西兰花', '花菜', '蘑菇', '香菇',
      '木耳', '玉米', '豌豆', '毛豆', '豆腐']
  },
  {
    group: '肉蛋',
    keys: ['五花肉', '排骨', '里脊', '肉', '猪', '牛', '羊', '鸡翅', '鸡腿', '鸡胸', '鸡', '鸭',
      '蛋', '香肠', '培根', '火腿', '腊肠']
  },
  {
    group: '水产',
    keys: ['鱼', '虾', '蟹', '贝', '蛎', '鱿鱼', '海带', '紫菜', '蛤']
  },
  {
    group: '调味',
    keys: ['盐', '糖', '冰糖', '醋', '酱油', '生抽', '老抽', '蚝油', '油', '料酒', '黄酒', '花椒',
      '八角', '桂皮', '香叶', '干辣椒', '胡椒', '孜然', '五香粉', '淀粉', '生粉', '面粉',
      '味精', '鸡精', '香油', '芝麻油', '豆瓣酱', '甜面酱', '番茄酱', '咖喱', '蜂蜜', '辣酱', '老干妈']
  },
  {
    group: '主食',
    keys: ['米', '饭', '面', '馒头', '饺', '包子', '粉', '年糕', '吐司', '面包']
  }
]

/** 常备：家里基本一直有的调料，默认折叠 */
const STAPLES = ['盐', '糖', '油', '生抽', '老抽', '醋', '料酒', '淀粉', '生粉', '味精', '鸡精', '香油', '芝麻油', '胡椒']

function groupOf(name) {
  const s = String(name || '')
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i]
    for (let j = 0; j < rule.keys.length; j++) {
      if (s.indexOf(rule.keys[j]) > -1) return rule.group
    }
  }
  return '其他'
}

function isStaple(name) {
  const s = String(name || '')
  return STAPLES.some(k => s.indexOf(k) > -1)
}

function groupIndex(group) {
  const i = GROUPS.indexOf(group)
  return i === -1 ? GROUPS.length : i
}

/**
 * 分组图标。
 *
 * 写完整路径字面量（不是拼字符串）—— tools/lint.py 会检查 /assets/icons/ 下的图是否真的存在，
 * 拼接出来的它查不到。前四个直接复用菜库那套分类图标（蔬菜 / 水产 / 主食 / 其他），
 * 「肉蛋」和「调味」是这次新画的（shop-meat / shop-season），颜色和那套对齐：
 * 肉蛋用和 cat-hot 同一个陶土红（都是「荤」的意思），调味用 sec-tag 那个深琥珀。
 */
const GROUP_ICONS = {
  '蔬菜': '/assets/icons/cat-veg.png',
  '肉蛋': '/assets/icons/shop-meat.png',
  '水产': '/assets/icons/cat-fish.png',
  '调味': '/assets/icons/shop-season.png',
  '主食': '/assets/icons/cat-staple.png',
  '其他': '/assets/icons/cat-def.png',
  '常备调料': '/assets/icons/shop-season.png'
}

function groupIcon(group) {
  return GROUP_ICONS[group] || GROUP_ICONS['其他']
}

module.exports = { GROUPS, groupOf, isStaple, groupIndex, groupIcon }
