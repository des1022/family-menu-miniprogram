/**
 * 全局配置：云环境、本地缓存键、业务常量
 * 部署时只需要修改 ENV_ID 一项
 */
module.exports = {
  // TODO 替换为你的云开发环境 ID（微信开发者工具 → 云开发 → 环境 → 环境 ID）
  ENV_ID: 'family-menu-0gxxxxxxxxxx',

  // 云存储中菜品图片存放目录（必须以 / 结尾）
  DISH_IMAGE_DIR: 'dish-images/',

  // 图片压缩阈值：宽度 <= 800px，单张 <= 200KB
  MAX_IMAGE_WIDTH: 800,
  MAX_IMAGE_SIZE: 200 * 1024,

  // 本地缓存键
  KEYS: {
    NICKNAME: 'fm_nickname',
    GUIDE_SHOWN: 'fm_guide_shown'
  },

  // 菜品上架状态
  DISH_STATUS: { OFF: 0, ON: 1 },

  // 点单记录：0 = 草稿，1 = 已确认（确认后清空不删，锁定进日历）
  RECORD_CONFIRMED: { DRAFT: 0, CONFIRMED: 1 },

  // 常吃：1 = 手动收藏
  FAVORITE: { NO: 0, YES: 1 },

  // 编辑页预设标签（分号拼接存入 dish.tags）
  TAG_GROUPS: [
    { name: '辣度', options: ['不辣', '微辣', '中辣', '特辣'] },
    { name: '难度', options: ['简单', '中等', '较难'] },
    { name: '时长', options: ['10分钟内', '15分钟', '半小时', '慢炖'] },
    { name: '菜系', options: ['家常', '川湘', '粤式', '北方', '汤羹', '甜品'] }
  ],

  // 首页「常吃」虚拟分类
  CAT_FAV: '__favorite__',

  // 云开发客户端单次读取上限（默认 20，最大 100）
  PAGE_SIZE: 100
}
