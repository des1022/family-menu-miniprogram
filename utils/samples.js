/**
 * 示例菜库：新家庭一键填充用。
 *
 * 背景：家庭共享类 App 最大的失败点是「初始化门槛太高——要手动录入太多食谱」，
 * 所以这里内置 12 道最家常的菜，让新用户 30 秒就能开始用，之后再按自家口味增删。
 *
 * 字段与 dishes 集合一致：name / category / ingredients / tags / desc / status / favorite
 */
const SAMPLE_DISHES = [
  {
    name: '番茄炒蛋',
    category: '热菜',
    ingredients: '番茄,鸡蛋,葱,白糖',
    tags: '家常;10分钟内;简单',
    desc: '国民下饭菜，番茄要炒出沙才好吃',
    status: 1,
    favorite: 1
  },
  {
    name: '蒜蓉小青菜',
    category: '素菜',
    ingredients: '小青菜,蒜,盐',
    tags: '家常;10分钟内;简单',
    desc: '大火快炒，出锅前再放盐',
    status: 1,
    favorite: 1
  },
  {
    name: '红烧肉',
    category: '热菜',
    ingredients: '五花肉,冰糖,生抽,老抽,八角,姜',
    tags: '家常;慢炖;中等',
    desc: '炒糖色是关键，小火炖 40 分钟收汁',
    status: 1,
    favorite: 0
  },
  {
    name: '可乐鸡翅',
    category: '热菜',
    ingredients: '鸡翅,可乐,生抽,姜',
    tags: '家常;半小时;简单',
    desc: '小孩最爱，收汁到粘稠',
    status: 1,
    favorite: 0
  },
  {
    name: '冬瓜排骨汤',
    category: '汤羹',
    ingredients: '排骨,冬瓜,姜,盐',
    tags: '家常;慢炖;简单',
    desc: '排骨先焯水，汤色才清',
    status: 1,
    favorite: 0
  },
  {
    name: '清蒸鲈鱼',
    category: '热菜',
    ingredients: '鲈鱼,姜,葱,蒸鱼豉油',
    tags: '家常;15分钟;简单',
    desc: '水开后蒸 8 分钟，别蒸老',
    status: 1,
    favorite: 0
  },
  {
    name: '凉拌黄瓜',
    category: '素菜',
    ingredients: '黄瓜,蒜,香醋,香油',
    tags: '家常;10分钟内;简单',
    desc: '拍碎比切片入味',
    status: 1,
    favorite: 0
  },
  {
    name: '土豆丝',
    category: '素菜',
    ingredients: '土豆,青椒,干辣椒,醋',
    tags: '家常;10分钟内;简单',
    desc: '切好过一遍水，炒出来才爽脆',
    status: 1,
    favorite: 0
  },
  {
    name: '青椒肉丝',
    category: '热菜',
    ingredients: '猪里脊,青椒,生抽,淀粉',
    tags: '家常;15分钟;简单',
    desc: '肉丝先用淀粉抓一下更嫩',
    status: 1,
    favorite: 0
  },
  {
    name: '紫菜蛋花汤',
    category: '汤羹',
    ingredients: '紫菜,鸡蛋,虾皮,香油',
    tags: '家常;10分钟内;简单',
    desc: '关火后再淋蛋液，蛋花才漂亮',
    status: 1,
    favorite: 0
  },
  {
    name: '蛋炒饭',
    category: '主食',
    ingredients: '隔夜饭,鸡蛋,葱,火腿',
    tags: '家常;10分钟内;简单',
    desc: '隔夜饭最合适，粒粒分明',
    status: 1,
    favorite: 0
  },
  {
    name: '手擀面',
    category: '主食',
    ingredients: '面粉,水,盐',
    tags: '家常;半小时;中等',
    desc: '和面稍硬，醒 20 分钟再擀',
    status: 1,
    favorite: 0
  }
]

module.exports = { SAMPLE_DISHES }
