# 商店截图流水线（store-shots）

用脚本生成 Chrome 应用商店的产品截图，**中英各一套、每套 6 张**，输出到
`assets/cws-store/screen-*.png`（2560×1600 = 1280×800 @2x）。

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

# 1) 托管演示登录页 / 2FA 页（脚本目录里）
(cd scripts/store-shots && python3 -m http.server 8777 --bind 127.0.0.1 &)

# 2) 启动 Chrome：演示域名映射到本地，并关掉代理（否则会 502）
PROFILE="$(mktemp -d)"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check \
  --no-proxy-server --window-size=1440,805 \
  --host-resolver-rules="MAP admin.example.com 127.0.0.1, MAP console.example.com 127.0.0.1" \
  about:blank &
```

然后按**语言**跑三批。每批的 `seeded` / `prefs` 用同一个 profile，`firstrun` 必须换
**全新 profile**（图 6 需要「还没设主密码」的首启状态）：

```bash
# —— 中文页 ——
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" zh   # 首次运行会设主密码 + 导入 8 条
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded    zh
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs     zh
# 换全新 profile 重新起 Chrome，再跑：
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun  zh

# —— 英文页 ——（英文的标签/备注与中文不同，必须换全新 profile 重新 seed）
node scripts/store-shots/seed.mjs    "$PWD/.output/chrome-mv3" en
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" seeded    en
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" prefs     en
node scripts/store-shots/capture.mjs "$PWD/.output/chrome-mv3" firstrun  en
```

> ⚠️ 演示页必须用**域名**访问（`admin.example.com` / `console.example.com`）而不是
> `127.0.0.1`：条目按精确域名匹配，用 IP 打开侧边栏会退化成「列出全部条目」，
> 失去「命中该站点账号」的演示效果。脚本会用上表两个域名拼 URL，
> 需要改端口/域名时用环境变量 `SHOT_PORT` / `SHOT_HOST_ADMIN` / `SHOT_HOST_CONSOLE`。

## 六张图的卖点与标题带文案

标题带文案的合规约束与商店四个字段完全一致：**零竞品品牌名、零绝对化表述**
（不得写「零联网 / 100% offline / 数据不出浏览器」——扩展每 6 小时有一次
不携带用户数据的匿名版本检查）。改文案后重跑 `capture.mjs` 即可，文案表在
`capture.mjs` 的 `COPY` 常量里（中英各一份）。

| 文件（英文加 `-en`）            | 卖点          | 标题带（中文）                                           |
| ------------------------------- | ------------- | -------------------------------------------------------- |
| `screen-1-one-click-login.png`  | 一键登录      | 一键登录：填充 → 勾选「记住我」→ 自动点击登录            |
| `screen-2-totp.png`             | TOTP 两步验证 | TOTP 两步验证：验证码和密码住在一起，不用摸手机          |
| `screen-3-multi-env.png`        | 多环境账号    | 多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚 |
| `screen-4-security-audit.png`   | 离线安全体检  | 离线安全体检：0-100 分给密码健康打分，全程本机计算       |
| `screen-5-preferences.png`      | 主题与双语    | 6 款主题 + 中英文双语界面，即时切换无需刷新              |
| `screen-6-local-encryption.png` | 本地加密      | 本地加密：密码只存在你的浏览器里，加密后落盘             |

> 商店每个语言页的截图上限是 **5 张**，这里有 6 张候选：上传时按需取舍，
> `screen-6`（本地加密，画面最朴素、且该主张在摘要与说明里已有文字承载）
> 是最先可以舍弃的一张。

## 文件

| 文件              | 作用                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `cdp.mjs`         | 极简 Chrome DevTools Protocol 客户端（原生 WebSocket）           |
| `shot.mjs`        | 加载扩展、设备指标、截图、合成标题带、中英文文案的标题带版式     |
| `seed.mjs`        | 切语言 + 设主密码 + 导入 8 条占位账号（演示数据内联在本文件里）  |
| `capture.mjs`     | 截图入口，`seeded` / `prefs` / `firstrun` 三种模式 × `zh` / `en` |
| `demo-login.html` | 演示登录页（「一键登录」的已填充 + 已勾选状态）                  |
| `demo-2fa.html`   | 演示两步验证页（配合侧边栏活码展示「验证码和密码在一起」）       |

演示账号内联在 `seed.mjs` 的 `DEMO_CSV_ZH` / `DEMO_CSV_EN`：覆盖
开发/预发/生产/测试/运维/设计/文档/沙箱（英文为 Dev/Staging/Prod/QA/Ops/Design/Docs/Sandbox）
八类标签，其中 `ops@example.com` 带 TOTP 密钥（图 2 的活码来源），
`dev@example.com` 故意用常见泄露密码（让图 4 的安全体检有可展示的发现项）。
改演示数据直接改这两个常量。
