---
type: cover
density: per-article
style: flat-geometric
palette: brand-token (#409eff 晴空蓝)
image_count: 4
source: imgs/blog-covers/*.svg
output: imgs/blog-cover-*.png (1600×900, pnpm covers:render)
consumers: docs/blog/{zh,en}/*.md frontmatter image + og:image + blog/index.html 卡片
---

# 博客封面系列设计规格

四张封面共用一套令牌与版式，保证「同一系列」的视觉一致性；中英文文章共用同一张图，
因此封面上的文字只放**中文主标 + 语言中立的技术关键字/数字**，英文读者读关键字无障碍。

## 共享令牌（对齐 `assets/theme/tokens.css`）

| 角色       | 浅底封面（01/02）                                        | 深底封面（03/04）                                |
| ---------- | -------------------------------------------------------- | ------------------------------------------------ |
| 背景渐变   | `#f8fbff → #ecf5ff`                                      | `#0d1b34 → #17305c`                              |
| 品牌主色   | `#409eff`                                                | `#409eff`                                        |
| 主色深端   | `#337ecc`                                                | `#337ecc`                                        |
| 主色浅端   | `#66b3ff`                                                | `#66b3ff`                                        |
| 主标题字色 | `#1f2937`                                                | `#ffffff`                                        |
| 辅助文字   | `#6b7280`                                                | `#a9bfe0`                                        |
| 卡片描边   | `#d9ecff`                                                | `#2a4a80`                                        |
| 胶囊底/字  | `#ecf5ff` / `#337ecc`                                    | `#409eff` @16% + `#66b3ff` @42% 描边 / `#cfe3ff` |
| 语义点     | `#f56c6c / #e6a23c / #67c23a`（EP 红黄绿，浏览器交通灯） | 同左                                             |

深浅分档逻辑：**概览/体验篇用浅底（01、02），底层技术篇用深底（03、04）**。
深底胶囊不用 `rgba()`，而是 `fill="#409eff" fill-opacity="0.16"` + `stroke="#66b3ff" stroke-opacity="0.42"`，改主色时只需动一处。

### 派生色（不来自 tokens.css，仅封面体系内部使用）

项目 UI 只有浅底主题，深底封面需要的「面板 / 描边 / 内层」颜色在此固定，改图时不要临时取色：

| 用途                      | 色值                                | 出现位置                         |
| ------------------------- | ----------------------------------- | -------------------------------- |
| 深底主图形色              | `#8fb4ff`                           | 迭代点阵、锁梁、放大镜、虚线脊柱 |
| 深底面板 / 次级行         | `#0f1e3d` / `#1e3a6b`               | 输入框、列表行、密文块底         |
| 深底卡片渐变与描边        | `#1e3564 → #16264b`，描边 `#2a4a80` | 04 四张卡片                      |
| 深底证据行分隔线          | `#23406e`                           | 03 左栏底部                      |
| 深底正文 / 胶囊字         | `#a9bfe0` / `#cfe3ff`               | 说明行、卡片标签                 |
| 浅底表盘与骨架行          | `#f4f9ff` / `#dcebff` / `#b8d4f5`   | 02 秒表与浏览器骨架              |
| 提速闪电（EP warning 系） | `#ffd04b → #e6a23c`                 | 02 闪电                          |
| 钥匙孔内圈                | `#3b86e8`                           | 01 保险块（取主色渐变中段）      |
| 系列标                    | `#9ca3af`（= `--aph-text-muted`）   | 右上 `技术博客 0N / 04`          |

## 共享版式

- 画布 1600×900，安全边距 96px（OG 卡与列表小图裁切后文字仍完整）。
- 左上品牌角标：52×52 主蓝圆角块 + 白色钥匙记号（`assets/icons/icon.svg` 同骨架）+ 27px 产品名。
- 右上系列标：24px `技术博客 0N / 04`。
- 文字层级：H1 84px/700 → 关键字行 38px/600 主色 → 说明行 28px 辅助色 → 胶囊 27px/500（高 56、圆角 28、左右内距 26、间距 16）。
- 01/02/03 为「左文字 + 右插画」双栏（文字栏 x 96–860，插画栏 x 880–1504）；
  04 因主体是「四个功能」卡片带，改为「上文字横排 + 下方四卡带」，其余令牌完全一致。
- 字体栈：`'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Arial,sans-serif`，
  由 `scripts/render-blog-covers.mjs` 以 2× 超采样栅格化，中文无乱码、边缘平滑。
- 左栏底部固定一条「证据行」：细分隔线 + 26px 源码路径 / 仓库地址，既补留白又把可核对信息放上封面。
- 验收尺寸：`blog/index.html` 列表卡以 **200×120 + object-fit:cover** 展示（等效可见区 x 50–1550），
  已按该尺寸实测：四张主标题、品牌角标、关键字行均可读；胶囊与证据行属次级信息，缩略图下不要求可读。

## Illustration 1 — blog-cover-01-local-first

**Position**: `docs/blog/{zh,en}/01-local-first-password-manager.md` 封面 + og:image
**Purpose**: 传达「零云端 / 本地加密 / 为开发者而生」的立项动机
**Text**: H1 `零云端 · 本地加密`；关键字 `AES-256-GCM · PBKDF2 600,000×`；说明 `数据不出浏览器，多环境账号不串号`；胶囊 `精确域名匹配` `一键登录` `内置 TOTP` `GPL-3.0 开源`；证据行 `github.com/liaolongdong/account-password-helper`
**Visual Content**: 划掉的云（零云端）→ 浏览器窗口内品牌钥匙保险块（复用 `assets/icons/icon.svg` 骨架）→ 虚线落到笔记本（数据只在本机）→ 盾牌对勾（安全体检）与 `</>`（为开发者而生）
**Filename**: blog-cover-01-local-first.svg → ../blog-cover-01-local-first.png

## Illustration 2 — blog-cover-02-sub-second-sidepanel

**Position**: `02-mv3-sidepanel-sub-second-open.md` 封面 + og:image
**Purpose**: 把「秒开 SLA」这件抽象的性能目标变成可核对的数字
**Text**: H1 `侧边栏 1 秒内打开`；关键字 `双层保活 · 四层预热 · 三路竞速`；说明 `白屏的四段来源，四套对策`；胶囊 `20–50ms 缓存快路径` `非阻塞 CSS` `手势链不 await`；表盘大字 `<1s`；证据行 `entrypoints/background/backgroundServices.ts`
**Visual Content**: 秒表（表盘直接标 `<1s` SLA，取消指针以免与数字争读）+ 运动弧线 → 闪电与速度线 → 浏览器窗口右侧高亮侧边栏列表
**Filename**: blog-cover-02-sub-second-sidepanel.svg → ../blog-cover-02-sub-second-sidepanel.png

## Illustration 3 — blog-cover-03-webcrypto

**Position**: `03-webcrypto-encryption-in-practice.md` 封面 + og:image
**Purpose**: 呈现「口令 → 派生 → 密文」的加密管线与关键参数
**Text**: H1 两行 `Web Crypto` / `加密实战全拆解`；关键字 `PBKDF2-SHA256 · 600,000 次迭代`；说明 `密钥派生 → 字段级加密 → 会话生命周期`；胶囊 `AES-256-GCM` `字段级加密` `12B 随机 IV` `0 第三方加密库`；证据行 `utils/encryption.ts`
**Visual Content**: 迭代点阵（标注 `600,000×`）汇入挂锁 → 箭头 → 密文块流出 → 盾牌对勾作为挂锁角标（认证加密）；注脚 `主密码 → 派生密钥 → 字段级密文`；电路走线背景
**Filename**: blog-cover-03-webcrypto.svg → ../blog-cover-03-webcrypto.png

## Illustration 4 — blog-cover-04-login-flow-details

**Position**: `04-login-flow-details.md` 封面 + og:image
**Purpose**: 一图说清「这批更新加了什么、没加什么」
**Text**: H1 `四个新功能 · 四段实现笔记`；关键字 `0 新增设置开关 · 仅 +1 权限 · 632 项自动化测试`；说明 `每个功能都撞上一个 Chrome 扩展特有的坑`；卡片标签 `右键填充` `内联面板` `全站搜索` `只读详情`
**Visual Content**: 四张等宽卡片横带（带 01–04 序号），各配一个功能微缩图形（右键菜单 + 光标 / 输入框上方翻转面板 / 本站-全站分段控件 + 放大镜 / 列表 + 只读抽屉），虚线脊柱串联
**Filename**: blog-cover-04-login-flow-details.svg → ../blog-cover-04-login-flow-details.png
