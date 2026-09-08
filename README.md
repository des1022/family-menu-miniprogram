# 家庭菜单 · 微信小程序版

> 家里几个人共用、数据实时同步的家庭点菜小程序。
> 由 `family-order` 底座改造而来，功能对齐 Android 版 `family-menu-android`（菜品库/点单/日历/常吃/标签/食材清单），纯本地使用的**体验版路线：全程 0 元**。

## 当前状态（批一）

- ✅ 菜品库：录菜（拍照/相册 + 压缩上传云存储）、食材、标签、上下架、分类管理
- ✅ 首页点菜：分类/常吃/标签筛选、搜索、±份数（直写云端 records，**全家实时同步**）
- ✅ 今日点单清单：份数、备注、删除、清空（保留已确认）、确认点单（锁定进日历）
- ✅ 菜单日历：月视图、当日标记、当日明细弹层、**一键复用到今日**
- ⏳ 批二：分享海报（4 模板）、饮食统计、食材清单导出、批量管理

## 部署（10 分钟，全程免费）

1. **领免费云环境**：打开 [微信公众平台](https://mp.weixin.qq.com) → 你的小程序 → 「云开发」→ 开通并创建环境（免费体验环境，未发布上线阶段持续免费）→ 复制**环境 ID**
2. **改环境 ID**：本目录 `utils/config.js` 第 9 行 `ENV_ID` 替换为上一步的环境 ID
3. **开发者工具打开**：微信开发者工具 → 导入本目录（AppID 用你自己的小程序；project.config.json 里默认 `touristappid` 为测试号，可先跑通再换）
4. **建集合 + 设权限**：控制台「数据库」新建 3 个集合（若不存在）：`dishes`、`records`、`categories`。
   每个集合 → 权限设置 → 选 **「所有用户可读，仅创建者可读写」**（推荐，够用）；
   若希望家人也能改别人录的菜/删别人点的单，选「所有用户可读写」（私有体验版可接受）。
5. **加体验成员**：mp 后台「成员管理 → 体验成员」添加家人微信号（个人主体上限 15 人）
6. **真机体验**：工具上传开发版 → 后台「版本管理」设为体验版 → 家人扫体验二维码即可用

> 上线说明：只要**不提交审核/不发布**，免费环境就一直免费用；哪天想公开发布，转 19.9 元/月套餐即可（数据不丢）。

## 集合结构

| 集合 | 关键字段 |
| --- | --- |
| dishes | name/category/image(fileID)/price/desc/**ingredients**/**tags**(分号分隔)/**favorite**/status |
| records | date(YYYY-MM-DD)/dishId/**dishName**/**dishImage**(冗余防删丢历史)/num/remark/**confirmed** |
| categories | name/sort |

## 目录

```
family-menu-miniprogram/
├── pages/        index(点菜) calendar(日历) confirm(点单清单) mine dish-edit admin category
├── components/   dish-row(菜品行+步进) cart-bar(今日点单悬浮球) empty skeleton
├── utils/        config(ENV_ID) cloud(初始化) db(数据层+watch) image(压缩上传) util
└── app.{js,json,wxss}
```

## Roadmap

- 批二：海报生成（温馨/简约/节日/可爱）、食材清单导出、饮食统计、批量管理、数据备份导出
- 可选：从 Android 版导出 JSON 导入（一次性迁移老菜谱）
