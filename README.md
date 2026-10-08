# 家庭菜单 · 微信小程序版

> 家里几个人共用、数据实时同步的**餐桌计划本**。
> 原生小程序 + 微信云开发，部署走 GitHub Actions，**体验版路线：全程 0 元**。

## 它想解决什么

不是外卖，也不是菜谱社区。家里每天真正难的是三件事：

1. **今晚吃什么**（决策疲劳）→「今晚」页 + 帮我选一顿
2. **谁做、谁买、几个人吃**（分工看不见）→ 成员 + 今晚在家吃开关 + 谁点的菜
3. **吃过什么**（没记录）→ 日历色点 + 本月回顾

## 当前状态

| 模块 | 说明 |
| --- | --- |
| 🍚 今晚 | 未点/已点两态 · 今晚在家吃人数 · 帮我选一顿（洗牌，久没做过的优先）· 缺什么建议 · 食材清单 · 确认这顿饭 |
| 📖 菜库 | 搜索（菜名/食材）· 网格/列表切换 · 全部/★常吃/本周没吃/分类 · 点卡片弹层加入今晚 · 收藏 · 编辑 |
| 📅 日历 | 日期格**菜品色点** · 当天一桌菜 + 再做一次 · 本月回顾（最常吃三道 / 分类占比 / 小建议） |
| 👨‍👩‍👧 家庭 | 成员（头像色/昵称/口味忌口/今晚在家吃开关）· 菜品管理 · 分类管理 · 数据备份导出 · 外观三档 |
| 🎨 外观 | 浅色「陶土与木桌」+ 深色「墨绿夜色」，跟随系统 / 手动三档 |
| ✨ 冷启动 | 菜库为空时可一键填入 12 道家常菜 |

## 部署（10 分钟，全程免费）

1. **领免费云环境**：微信公众平台 → 你的小程序 → 「云开发」→ 创建环境 → 复制**环境 ID**
2. **改环境 ID**：`utils/config.js` 里的 `ENV_ID`
3. **建集合 + 设权限**：控制台「数据库」新建 4 个集合：`dishes`、`records`、`categories`、`members`；
   每个集合权限设为 **「所有用户可读写」**（家庭内多人共享场景需要，安全靠体验成员白名单）
4. **加体验成员**：mp 后台「成员管理 → 体验成员」添加家人微信号（个人主体上限 15 人）
5. **上传版本**：Actions 手动触发 `deploy-miniprogram`
   - `mode=upload` → 上传新版本（之后到后台「版本管理」设为体验版）
   - `mode=preview` → 出预览二维码（artifact 下载 `preview-qr.png`）
   需要在仓库 Secrets 里配好 `MP_APPID`、`MP_PRIVATE_KEY`

> 只要不提交审核 / 不发布，免费云环境一直免费；哪天想公开发布，转 19.9 元/月即可（数据不丢）。

## 集合结构

| 集合 | 关键字段 |
| --- | --- |
| dishes | name / category / image(fileID) / desc / ingredients / tags(分号分隔) / favorite / status |
| records | date / dishId / dishName / dishImage（冗余，防删菜丢历史）/ num（保留但恒为 1）/ remark / confirmed / **byId / byName / byColor（谁点的）** |
| categories | name / sort |
| members | **nickname / color / tastes(分号分隔) / eatTonight** · `_openid` 云端自动写入 |

## 目录

```
family-menu-miniprogram/
├── pages/      tonight(今晚) dishes(菜库) calendar(日历) family(家庭)
│              dish-edit(菜品编辑) admin(菜品管理) category(分类) poster(海报)
├── components/ empty skeleton
├── assets/icons/        线性图标（PNG，深浅两套色调）
├── utils/      config cloud db theme util samples image poster
├── tools/      lint.py  本机静态自检（无开发者工具时的兜底）
└── docs/       design/（设计稿）dev-notes/（开发日志）新电脑接续指南.md
```

## 开发自检

本机不装微信开发者工具，改动后用：

```bash
python tools/lint.py
```

检查：JS 语法、JSON 可解析、页面四件套齐全、WXML 无方法调用、事件处理函数存在、
组件路径、图片资源（含动态拼接）、跳转目标注册、require 路径。

## 设计文档

`docs/design/` 下：新设计提案 · 配色方向对比 · 背景色候选 · 深色模式设计稿。

## Roadmap（批二）

- 「帮我选一顿」完整版（参数：荤素搭配 / 口味 / 人数；单条换一个）
- **可勾选采购清单**（勾选 / 手动加项 / 货架分组 / 常备过滤 / 多人实时）
- 口味忌口冲突提示 · 点菜留言
- 做法步骤（录入手艺）
- 大字号模式 · 删除可撤销 · 弱网重试提示
