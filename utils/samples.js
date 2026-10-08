/**
 * 示例菜库：新家庭一键填充用。
 *
 * 背景：家庭共享类 App 最大的失败点是「初始化门槛太高——要手动录入太多食谱」，
 * 所以这里内置 12 道最家常的菜，让新用户 30 秒就能开始用，之后再按自家口味增删。
 *
 * 字段与 dishes 集合一致：name / category / ingredients / tags / desc / status / favorite / steps
 *
 * steps：做法步骤，**每行一步**（和用户在编辑页里填的格式一致）。
 */
const SAMPLE_DISHES = [
  {
    name: '番茄炒蛋',
    category: '热菜',
    ingredients: '番茄,鸡蛋,葱,白糖',
    tags: '家常;10分钟内;简单',
    desc: '国民下饭菜，番茄要炒出沙才好吃',
    steps: '鸡蛋打散加一点盐，热锅多油炒到刚凝固就盛出\n番茄去皮切块，下锅加半勺糖炒出红汁\n倒回鸡蛋翻匀，撒葱花出锅',
    status: 1,
    favorite: 1
  },
  {
    name: '蒜蓉小青菜',
    category: '素菜',
    ingredients: '小青菜,蒜,盐',
    tags: '家常;10分钟内;简单',
    desc: '大火快炒，出锅前再放盐',
    steps: '小青菜洗净沥干，蒜切末\n热锅冷油爆香蒜末\n下青菜大火翻炒 1 分钟，出锅前再放盐',
    status: 1,
    favorite: 1
  },
  {
    name: '红烧肉',
    category: '热菜',
    ingredients: '五花肉,冰糖,生抽,老抽,八角,姜',
    tags: '家常;慢炖;中等',
    desc: '炒糖色是关键，小火炖 40 分钟收汁',
    steps: '五花肉切块，冷水下锅焯出血沫，捞出冲净\n锅里放冰糖小火炒到枣红色，下肉块翻炒上色\n加姜片、八角、生抽老抽，倒热水没过肉\n小火炖 40 分钟，最后开大火收汁',
    status: 1,
    favorite: 0
  },
  {
    name: '可乐鸡翅',
    category: '热菜',
    ingredients: '鸡翅,可乐,生抽,姜',
    tags: '家常;半小时;简单',
    desc: '小孩最爱，收汁到粘稠',
    steps: '鸡翅两面各划两刀，煎到两面金黄\n加姜片、生抽，倒可乐没过鸡翅\n中小火煮 15 分钟，大火收汁到粘稠',
    status: 1,
    favorite: 0
  },
  {
    name: '冬瓜排骨汤',
    category: '汤羹',
    ingredients: '排骨,冬瓜,姜,盐',
    tags: '家常;慢炖;简单',
    desc: '排骨先焯水，汤色才清',
    steps: '排骨冷水下锅焯水，捞出洗净\n加姜片和足量清水，大火烧开转小火炖 40 分钟\n放冬瓜块再炖 15 分钟，加盐调味',
    status: 1,
    favorite: 0
  },
  {
    name: '清蒸鲈鱼',
    category: '热菜',
    ingredients: '鲈鱼,姜,葱,蒸鱼豉油',
    tags: '家常;15分钟;简单',
    desc: '水开后蒸 8 分钟，别蒸老',
    steps: '鲈鱼洗净打花刀，鱼身铺姜片\n水开后上锅蒸 8 分钟，倒掉盘里的水\n铺葱丝，淋蒸鱼豉油，浇一勺热油',
    status: 1,
    favorite: 0
  },
  {
    name: '凉拌黄瓜',
    category: '素菜',
    ingredients: '黄瓜,蒜,香醋,香油',
    tags: '家常;10分钟内;简单',
    desc: '拍碎比切片入味',
    steps: '黄瓜拍碎切段，撒盐腌 5 分钟倒掉水\n加蒜末、香醋、香油拌匀\n冰箱冷藏 10 分钟更好吃',
    status: 1,
    favorite: 0
  },
  {
    name: '土豆丝',
    category: '素菜',
    ingredients: '土豆,青椒,干辣椒,醋',
    tags: '家常;10分钟内;简单',
    desc: '切好过一遍水，炒出来才爽脆',
    steps: '土豆切细丝，清水冲掉淀粉沥干\n热油爆香干辣椒，下土豆丝大火快炒\n加青椒丝、沿锅边淋一勺醋，放盐炒匀',
    status: 1,
    favorite: 0
  },
  {
    name: '青椒肉丝',
    category: '热菜',
    ingredients: '猪里脊,青椒,生抽,淀粉',
    tags: '家常;15分钟;简单',
    desc: '肉丝先用淀粉抓一下更嫩',
    steps: '里脊切丝，加生抽、淀粉抓匀腌 10 分钟\n热油下肉丝滑散，变色盛出\n下青椒丝炒软，倒回肉丝翻匀调味',
    status: 1,
    favorite: 0
  },
  {
    name: '紫菜蛋花汤',
    category: '汤羹',
    ingredients: '紫菜,鸡蛋,虾皮,香油',
    tags: '家常;10分钟内;简单',
    desc: '关火后再淋蛋液，蛋花才漂亮',
    steps: '紫菜撕小块放碗里，加虾皮\n锅里水烧开，关火后打圈淋入蛋液\n倒进碗里，加盐和几滴香油',
    status: 1,
    favorite: 0
  },
  {
    name: '蛋炒饭',
    category: '主食',
    ingredients: '隔夜饭,鸡蛋,葱,火腿',
    tags: '家常;10分钟内;简单',
    desc: '隔夜饭最合适，粒粒分明',
    steps: '鸡蛋打散，热锅炒成蛋块盛出\n下火腿丁炒香，倒隔夜饭压散炒匀\n倒回鸡蛋，加盐和葱花翻匀出锅',
    status: 1,
    favorite: 0
  },
  {
    name: '手擀面',
    category: '主食',
    ingredients: '面粉,水,盐',
    tags: '家常;半小时;中等',
    desc: '和面稍硬，醒 20 分钟再擀',
    steps: '面粉加水和一点盐揉成稍硬的面团\n盖湿布醒 20 分钟，再揉一遍\n擀成薄片叠起切条，抖散下锅煮 3 分钟',
    status: 1,
    favorite: 0
  }
]

module.exports = { SAMPLE_DISHES }
