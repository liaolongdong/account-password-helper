# 商店截图流水线（store-shots）

用脚本生成 Chrome 应用商店的产品截图，**中英各一套、每套 14 张**，输出到
`assets/cws-store/screen-*.png`（2560×1600 = 1280×800 @2x）；母版再经
`export-upload.mjs` 派生出商店截图槽实际接受的 1280×800 无 alpha 版本，输出到
`assets/cws-store/upload/`（见下文「上传尺寸」）。
同一套脚本还负责两个演示动图（`record.mjs` 的 `login` / `totp` 两个场景），输出到
`docs/demo-login*.webp`、`docs/demo-login.gif` 与 `docs/demo-totp*.webp`、
`docs/demo-totp.gif`（见下文「演示动图」）。

Dashboard 里中文页与 English (United States) 页的截图槽位**互相独立、不会继承**，
所以两套都要上传；英文版文件名带 `-en` 后缀。

## 为什么是脚本化截图，而不是真机截屏

- macOS 的窗口级截屏（`screencapture -l`）需要「屏幕录制」权限，沙箱/CI 拿不到；
- 真机截图会把作者的真实账号、真实邮箱带进商店素材；
- 商店文案受关键字堆砌政策约束，**图片里的文字同属商店元数据**，脚本里的标题带文案可以随文案定稿一起 review 和复跑。

流程是：CDP 驱动本地 Chrome → 加载解压扩展 → 注入占位演示数据 → 页面级截图 →
用 `sharp` 合成品牌标题带。占位数据全部是 `example.com`，不含任何真实凭据。

## 前置

```bash
pnpm install          # 需要 sharp（已是项目依赖）
pnpm build            # 截图里的版本徽章取自构建产物的 manifest.version
```

构建后**确认版本号与即将提交商店的包一致**，否则又会出现「截图版本与商店版本不符」。

## 复现步骤

Chrome 137+ 已不再支持 `--load-extension`，因此扩展改由 CDP 的
`Extensions.loadUnpacked` 动态加载，需要 `--enable-unsafe-extension-debugging`。

```bash
cd <repo>

# 1) 起演示站（本地 HTTPS，按域名合成 favicon；证书自签名、落在系统临时目录）
node scripts/store-shots/demo-server.mjs &

# 2) 启动 Chrome：演示域名映射到本地 HTTPS 端口，关掉代理（否则会 502），
#    并放开后台标签的节流/遮挡降频（截图时侧边栏必须待在后台标签里）
PROFILE="$(mktemp -d)"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check \
  --no-proxy-server --window-size=1440,805 \
  --ignore-certificate-errors \
  --host-resolver-rules="MAP *.example.com 127.0.0.1:8443" \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  about:blank &
```

然后按**语言**跑三批。每批的 `seeded` / `prefs` 用同一个 profile，`firstrun` 必须换
**全新 profile**（图 6 需要「还没设主密码」的首启状态）：

```bash
# —— 中文页 ——
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" zh   # 首次运行会设主密码 + 导入 10 条 + 收藏 2 条 + 轮换 1 条密码
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded    zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs     zh
node scripts/store-shots/record.mjs  "$PWD/.output/chrome-mv3" zh login  # 一键登录动图（webp + gif）
node scripts/store-shots/record.mjs  "$PWD/.output/chrome-mv3" zh totp   # 两步验证接力动图（webp + gif）
# 换全新 profile 重新起 Chrome，再跑：
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun  zh

# —— 英文页 ——（英文的标签/备注与中文不同，必须换全新 profile 重新 seed）
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" en
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded    en
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs     en
node scripts/store-shots/record.mjs  "$PWD/.output/chrome-mv3" en login  # 一键登录动图（webp）
node scripts/store-shots/record.mjs  "$PWD/.output/chrome-mv3" en totp   # 两步验证接力动图（webp）
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun  en
```

> ⚠️ 演示页必须用**域名**访问（`admin.example.com` / `console.example.com`）而不是
> `127.0.0.1`：条目按精确域名匹配，用 IP 打开侧边栏会退化成「列出全部条目」，
> 失去「命中该站点账号」的演示效果。
>
> ⚠️ 访问地址的 scheme + host 必须和条目网址一致：Chrome 的 favicon 缓存按
> `CanonicizeURL`（清掉 path/query，但**保留 scheme 与 port**）建索引，条目写
> `https://admin.example.com` 而页面用 `http://…:8777` 打开，图标就命中不了缓存，
> 截图里只剩通用地球图标。这也是演示站走 HTTPS、端口只由 `--host-resolver-rules`
> 在解析层替换（地址栏保持干净的 `https://<host>`）的原因。
>
> 域名清单集中在 `demo-hosts.mjs`（seed 的条目网址、capture 的访问地址、预热清单
> 共用一份）；`SHOT_PORT` 只改 `demo-server.mjs` 的监听端口，改了要同步改
> `--host-resolver-rules`。

**只重截一张**用 `autosave` 模式（需先按同一语言 `seed`，不必重跑整批）：保存弹窗的版式
最容易随文案或界面语言微调而需要重拍，为此重跑三批不值得。

```bash
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" autosave en
```

## 十四张图的卖点与标题带文案

标题带文案的合规约束与商店四个字段完全一致：**零竞品品牌名、零绝对化表述**
（不得写「零联网 / 100% offline / 数据不出浏览器」——扩展每 6 小时有一次
不携带用户数据的匿名版本检查）。改文案后重跑 `capture.mjs` 即可，文案表在
`copy.mjs`（中英各一份，`capture.mjs` 与 `record.mjs` 共用），两个动图分别取其中
`login` 与 `handoff` 一条，改了要一并重跑 `record.mjs`。

| 文件（英文加 `-en`）            | 卖点           | 标题带（中文）                                           |
| ------------------------------- | -------------- | -------------------------------------------------------- |
| `screen-1-one-click-login.png`  | 一键登录       | 一键登录：填充 → 勾选「记住我」→ 自动点击登录            |
| `screen-2-totp.png`             | TOTP 两步验证  | TOTP 两步验证：验证码和密码住在一起，不用摸手机          |
| `screen-3-multi-env.png`        | 多环境账号     | 多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚 |
| `screen-4-security-audit.png`   | 离线安全体检   | 离线安全体检：0-100 分给密码健康打分，全程本机计算       |
| `screen-5-preferences.png`      | 主题与双语     | 6 款主题 + 中英文双语界面，即时切换无需刷新              |
| `screen-6-local-encryption.png` | 本地加密       | 本地加密：密码只存在你的浏览器里，加密后落盘             |
| `screen-7-favorites.png`        | 收藏置顶       | 收藏常用账号：星标置顶，再一键只看收藏                   |
| `screen-8-detail-drawer.png`    | 条目详情       | 条目详情：备注、两步验证活码、修改历史一屏看全           |
| `screen-9-inline-fill.png`      | 页内填充面板   | 页内填充面板：在输入框旁边直接挑账号                     |
| `screen-10-floating-button.png` | 页面悬浮按钮   | 页面悬浮按钮：登录页随手唤起填充面板                     |
| `screen-11-auto-save.png`       | 自动保存凭证   | 自动保存登录凭证：提交时弹窗确认，自动去重               |
| `screen-12-import-backup.png`   | 导入导出与备份 | 导入导出与加密备份：数据随时能带走                       |
| `screen-13-generator.png`       | 密码生成器     | 密码生成器双模式：随机字符或助记词组                     |
| `screen-14-trash.png`           | 回收站         | 回收站与修改历史：误删可恢复，改错能回滚                 |

> **`screen-12` 刻意只拍「数据管理」下拉，不拍导入弹窗**：导入弹窗的格式单选里有
> 「Chrome 密码」这一项，属商店图片文字禁用的竞品品牌名；下拉里的九个入口
> （导入 / 下载模板 / 导出 / 导出 JSON / 加密备份导出 / 加密备份导入 / 备份到邮箱 /
> 一键去重 / 回收站）不含品牌名，且一屏就能覆盖导出与备份两个能力。

> 商店每个语言页的截图上限是 **5 张**，这里是 14 张候选，**最终选哪 5 张由上传时定**。
> 脚本这边的建议是 `screen-1 / 2 / 3 / 4 / 9`：前四张各占一个独立卖点（一键登录、
> 两步验证、多环境、安全体检），`screen-9` 与 `screen-10` 是仅有的两张展示**页内**
> 体验的，和其余「侧边栏 / 管理页」构图互补，辨识度最高。
> 需要换掉某张时，`screen-7`（收藏 + 标签 + 网站图标）、`screen-8`（详情抽屉，信息密度
> 最高）与 `screen-13`（生成器面板）是首选替补；`screen-6`（本地加密）画面最朴素、
> 且该主张在摘要与说明里已有文字承载，最先可舍弃。

## 上传尺寸（1280×800）

Dashboard 的截图槽只接受 **1280×800 或 640×400** 的 JPEG / 24 位 PNG，**带 alpha 通道的
PNG 会被判格式无效**。母版是 2560×1600 的 RGBA，直接上传会失败，所以要派生一份上传图：

```bash
node scripts/store-shots/export-upload.mjs   # → assets/cws-store/upload/screen-*-1280x800.png
```

母版逻辑尺寸本来就是 1280×800（`deviceScaleFactor: 2`），所以这一步是严格的 2:1
整数倍降采样，不存在非整数重采样把小字糊掉的问题；alpha 用白底压平，输出 3 通道 PNG。
中英各 14 张全部导出（约 5.8MB，单张 ≤300KB，商店单文件上限 5MB），上传时任选 5 张。

- **重截母版后要复跑这一步**，否则 `upload/` 与母版不同步。
- 脚本对母版尺寸做了断言：不是 2560×1600 就报错中止，不静默产出比例失真的素材。
- 官网 `index.html` 与 README 继续引用高清母版，**只有商店截图槽取 `upload/`**。

## 演示动图

```bash
node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" zh login  # docs/demo-login.webp + docs/demo-login.gif
node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" zh totp   # docs/demo-totp.webp + docs/demo-totp.gif
node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" en login  # docs/demo-login-en.webp
node scripts/store-shots/record.mjs "$PWD/.output/chrome-mv3" en totp   # docs/demo-totp-en.webp
```

前置与 `capture.mjs` 相同（演示站在跑、Chrome 已启动、**同一 profile 已按同一语言
seed**）。英文必须换全新 profile 重新 seed，否则动图里混着中文标签。gif 只在中文批
产出（推广文档引用 `.gif` 路径），英文只出 webp。

### `login`：一键登录（侧边栏）

四个关键帧都是扩展自己的真实链路，脚本不代填任何字段：空白登录页 + 侧边栏命中本站
3 个账号 → 光标落到「填充并登录」图标 → 点击之后（填充、自动勾选「记住我」、自动点击
登录，页面进入 `Signing in...`）→ 站点受理完成。第 3、4 帧是整幅页面而不是双栏——
**填充成功后产品会自己收起侧边栏**（`FormDetector` 在填充成功 300ms 后发
`HIDE_SIDEPANEL`），双栏构图到那里就散了。

### `totp`：两步验证接力（页内填充面板）

六帧全部整幅构图（面板本就注入在页面里，收起后又回到一张干净的登录页），站点是
`console.example.com`，条目是带 TOTP 密钥的 `ops@example.com`：页内面板展开 →
方向键 + 回车选中（账号密码由扩展填入）→ 点 Sign in 进 `Signing in...` →
**同一标签页**跳 `demo-2fa.html`，扩展把活码胶囊锚到验证码框右内缘 → 点胶囊「填入」
→ 点 Verify 出 `Verified · demo environment`。

- **为什么这一条不走侧边栏**：接力标记 `SET_PENDING_TOTP` 受
  `isTrustedInternalSender` 门控，该判定要求 `sender.tab === undefined`。真侧边栏满足
  （它不是标签页），但流水线只能把 `sidepanel.html` 开成标签页，消息会被判「未授权的
  请求来源」（同一门控也拒掉了 `GET_INITIAL_DATA`）。页内面板走 `FILL_BY_ID`，由内容
  脚本发起、不经该门控，`handleFillById` 在填充成功且条目有 TOTP 时同样记录接力标记
  ——**不需要为了拍图伪造任何扩展状态**。
- **必须复用同一个标签页**：`pending_totp_tabs` 按 tabId + hostname 精确比对，新开标签
  不命中，所以帧 4 用 `Page.navigate` 而不是 `newTab`。
- **胶囊在 closed Shadow DOM 里**，页面 JS 取不到内部节点，`elementFromPoint` 只会重定向
  到宿主 `aph-totp-handoff-root`。落点靠沿验证码框中线从右往左扫出胶囊右缘 R，再按固定
  版式回推「填入」按钮中心（R−34）；重试偏移只往左试（−38 / −30），绝不往右滑进关闭
  按钮——关掉后本页生命周期内不再提示，这条素材就废了。
- **面板是否真的展开**同样不能查宿主是否存在（触发图标与面板共用一个宿主），改为只扫
  输入框**下方**区域命中点数。

### 两批共用的坑

- **为什么是关键帧而不是逐帧录屏**：页面级 CDP 抓不到系统指针，而侧边栏作为标签页处于
  后台时不产出动画帧。点击落点由合成阶段叠加的光标表示，坐标取自被点元素的
  `getBoundingClientRect()`。
- **`?demo=status`**：演示页只在带这个查询参数时渲染状态条（`Signing in...` →
  `Signed in · demo environment`；验证码页是 `Verifying...` → `Verified · demo
environment`）。不带参数时卡片高度不变，`screen-1`、`screen-2` 与 `screen-11`
  的版式不受影响。
- **帧停留时长**：`login` 为 `1.4 / 1.2 / 2 / 2.4` 秒（一轮约 7 秒），`totp` 为
  `1.5 / 1.4 / 1.3 / 2.2 / 1.6 / 2.1` 秒（一轮约 10 秒），改 `record.mjs` 的 `SCENES`。
- **ffmpeg 两个坑**：concat 清单最后一行要重复一次末帧，否则末帧时长塌成 40ms；
  webp 必须 `-fps_mode passthrough`，否则帧率被重采样、节奏全乱。

## 文件

| 文件                | 作用                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `cdp.mjs`           | 极简 Chrome DevTools Protocol 客户端（原生 WebSocket）                         |
| `shot.mjs`          | 加载扩展、设备指标、等待动画收敛、截图、合成标题带、favicon 预热               |
| `demo-hosts.mjs`    | 演示域名清单与页面地址构造（seed 条目网址 / 预热 / 截图共用一份）              |
| `demo-server.mjs`   | 本地 HTTPS 演示站：托管演示页并按 Host 合成站点图标（证书落在临时目录）        |
| `seed.mjs`          | 切语言 + 设主密码 + 导入 10 条占位账号 + 收藏 + 改密码造历史（可传自备 CSV）   |
| `capture.mjs`       | 截图入口，`seeded` / `prefs` / `firstrun` 三种模式 × `zh` / `en`               |
| `export-upload.mjs` | 把 `screen-*.png` 母版派生成商店收的 1280×800 无 alpha 图，输出到 `upload/`    |
| `record.mjs`        | 演示动图入口，`login`（4 帧）/ `totp`（6 帧）两场景 → `docs/demo-*.{webp,gif}` |
| `copy.mjs`          | 标题带文案表（中英各一份），`capture.mjs` 与 `record.mjs` 共用                 |
| `demo-login.html`   | 演示登录页（「一键登录」的已填充 + 已勾选状态；状态条由 `?demo=status` 开启）  |
| `demo-2fa.html`     | 演示两步验证页（`screen-2` 的活码展示；`totp` 动图的接力目标页）               |

演示账号内联在 `seed.mjs` 的 `DEMO_CSV_ZH` / `DEMO_CSV_EN`，各 **10 条**、行序严格一致
（两个商店页演示的是同一批账号）：覆盖开发 / 预发 / 生产 / 测试 / 运维 / 设计 / 文档 /
沙箱八类标签，其中 `admin.example.com` 有 3 条（主账号 + 只读 + 客服），让图 1、图 9 的
「匹配 3 个账号」有真实候选。标签列用引号包住逗号（`"生产,重要"`）来演示**多标签**，
导入后按逗号切成两个标签。另有两类刻意留下的可展示项：`ops@example.com` 带 TOTP 密钥
（图 2 与图 8 的活码来源），`dev@example.com` 用常见泄露密码、design/wiki 两条共用同一密码
（让图 4 的安全体检有发现项）。

除导入外 `seed.mjs` 还会做三件事，都是为了让特定小节渲染出来：

- **收藏**（默认 `qa-bot@example.com`、`designer@example.com`，`SHOT_FAVORITE_USERS` 覆盖）：
  图 7 的星标置顶与「只看收藏」筛选。刻意避开带 TOTP 的 `ops`——它的卡片多两个操作图标，
  会把标签挤成「运…」「重…」，在商店截图里像渲染故障。
- **改密码**（默认 `ops@example.com`，`SHOT_HISTORY_USERS` 覆盖，连改两次留两条历史）：
  图 8 抽屉里的「密码修改历史」小节是 `v-if="historyList.length > 0"`，
  只导入不改密的话整节不渲染。
- **移入回收站**（默认 `intern@example.com`，`SHOT_TRASH_USERS` 覆盖）：
  图 14 的回收站要有内容才拍得出「30 天内可恢复」。刻意选不在其它画面重点位置的
  文档类条目，删掉不会让多环境 / TOTP / 体检那几张少掉关键行。

改演示数据直接改那几个常量；想用**真实导出样本**拍图，把 CSV 路径作为第三个参数传入
（`node seed.mjs <extDir> zh /path/to/demo.csv`），此时务必同步传
`SHOT_FAVORITE_USERS` / `SHOT_HISTORY_USERS` / `SHOT_TRASH_USERS`，并确认样本已脱敏——这些内容会进商店素材。

> ⚠️ 演示页的 CSS 选择器一律收在 `.card` 作用域内（`h1` / `label` / `input` / `button` 等
> 元素选择器不要裸写）。注入到页面上的保存提示框、悬浮按钮**不在 Shadow DOM 内**，
> 宿主的裸 `button { width: 100% }` 会把提示框按钮挤到换行——这是实测踩过的坑。
