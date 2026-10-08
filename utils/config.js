/**
 * 全局配置：云环境、本地缓存键、业务常量
 * 部署时只需要修改 ENV_ID 一项
 */
module.exports = {
  // 云开发环境 ID
  ENV_ID: 'cloudbase-d6gm6blmkdb5a57ee',

  // 云存储中菜品图片存放目录（必须以 / 结尾）
  DISH_IMAGE_DIR: 'dish-images/',

  // 图片压缩阈值：宽度 <= 800px，单张 <= 200KB
  MAX_IMAGE_WIDTH: 800,
  MAX_IMAGE_SIZE: 200 * 1024,

  // 本地缓存键（只存本机相关的东西：我是谁、主题偏好、引导是否看过）
  KEYS: {
    MEMBER_ID: 'fm_member_id',    // 本机对应的家庭成员文档 _id
    THEME: 'fm_theme_mode',       // 0 跟随系统 / 1 浅色 / 2 深色
    GUIDE_SHOWN: 'fm_guide_shown',
    NICKNAME: 'fm_nickname'       // 兼容旧版本，读一次后迁移到成员表
  },

  // 菜品上架状态
  DISH_STATUS: { OFF: 0, ON: 1 },

  // 点单记录：0 = 草稿，1 = 已确认（确认后清空不删，锁定进日历）
  RECORD_CONFIRMED: { DRAFT: 0, CONFIRMED: 1 },

  // 常吃：1 = 手动收藏
  FAVORITE: { NO: 0, YES: 1 },

  // 今晚在家吃
  EAT_TONIGHT: { NO: 0, YES: 1 },

  // 家庭成员头像色（按加入顺序循环取）
  MEMBER_COLORS: ['#D9714E', '#7E9A5C', '#C79A3C', '#8C7AA8', '#5C8FA8', '#C9576E', '#4F9367', '#B0708A'],

  // 成员口味 / 忌口可选标签
  TASTE_OPTIONS: ['少辣', '不吃香菜', '不吃青椒', '不吃葱', '不吃姜', '忌海鲜', '忌牛羊肉', '喜清淡', '爱吃肉', '无辣不欢'],

  // 编辑页预设标签（分号拼接存入 dish.tags）
  TAG_GROUPS: [
    { name: '辣度', options: ['不辣', '微辣', '中辣', '特辣'] },
    { name: '难度', options: ['简单', '中等', '较难'] },
    { name: '时长', options: ['10分钟内', '15分钟', '半小时', '慢炖'] },
    { name: '菜系', options: ['家常', '川湘', '粤式', '北方', '汤羹', '甜品'] }
  ],

  // 菜库状态胶囊
  CAT_FAV: '__favorite__',
  CAT_RECENT: '__recent__',

  // 菜库 / 列表布局
  LAYOUT: { GRID: 0, LIST: 1 },

  // 云开发客户端单次读取上限（默认 20，最大 100）
  PAGE_SIZE: 100
}
