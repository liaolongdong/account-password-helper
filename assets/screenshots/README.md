# 演示页面截图（已退役）

> ⚠️ **本目录已不再被 `index.html` 引用，文件也禁止再作为商店 / 官网 / README 素材使用。**

## 为什么退役

这里的 12 张图摄于 `v2.12.0`（2026-07-29），并且**画面里含真实凭据**：真实 GitHub 用户名、
真实邮箱、当时的 TOTP 活码，以及 `06-sidepanel-fill.png` 自动保存弹窗中的明文密码。
此外 `01-master-password.png` 还带着已删除的「严禁……后果自负」旧声明。

文件本身与历史提交按当时的决定保留未删，但**任何公开表面都不要再引用它们**。

## 现在的做法

`index.html` 的「功能演示」轮播改从 `assets/cws-store/screen-*.png` 取图，这批图由
`scripts/store-shots/` 脚本化生成：CDP 驱动本地 Chrome 加载解压扩展 → 注入
`example.com` 占位数据 → 页面级截图 → 合成品牌标题带，中英各一套、每套 14 张。

- 生成方式、场景清单与文案口径见 [`scripts/store-shots/README.md`](../../scripts/store-shots/README.md)
- 重新截图后无需改动 `index.html` 的文件名（轮播按语言自动选择 `-en` 后缀那一套）

## 旧文件名对照（仅供追溯）

`01-master-password` / `02-password-list` / `03-excel-import` / `04-excel-export` /
`05-add-account` / `06-sidepanel-fill` / `07-floating-button` / `08-session-validity` /
`09-totp-code` / `10-health-check` / `11-inline-fill` / `12-theme-skin`
