# E2E Tests（Chrome 扩展 · Playwright）

用 Playwright 驱动**真实构建出的 MV3 包**做端到端验证。

## 现状（请先读这段）

| 项                                                                           | 状态                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 夹具（加载扩展、取扩展 ID、解锁管理页、读写 `storage.local`、PING 内容脚本） | 已写好：`e2e/harness.ts` + `e2e/global-setup.ts`                                                                                    |
| 已编写且未被 skip 的用例                                                     | `e2e/site-rules.spec.ts` 6 条：站点规则表单/存储 4 条 + 内容脚本消费 2 条                                                           |
| 其余 6 个 `*.spec.ts`                                                        | 原有实现整体作废，文件内只保留 TODO 清单并显式 `test.skip`                                                                          |
| CI                                                                           | **仅手动触发**：`.github/workflows/e2e.yml` 只有 `workflow_dispatch`，不在 `lint` / `test` / `build` 任何门禁里，也不响应 push/PR   |
| 本机（macOS 13）能否跑通                                                     | **能**，但要自备 Chromium 系构建：Playwright 1.63 拒绝在 macOS 13 装 chromium，改下载 Chrome for Testing 并设 `E2E_EXECUTABLE_PATH` |
| 首次真实绿色运行                                                             | 2026-09-21：`e2e/site-rules.spec.ts` 6/6 通过（Chrome for Testing 153.0.8010.52，macOS 13 x64）                                     |

### 为什么不能用系统 Chrome

`--load-extension` 只对 Chromium 系构建有效。本机实测（品牌版 Google Chrome 152/153）：

- `context.serviceWorkers()` 为空；`Target.getTargets` 里没有任何 `chrome-extension://` 目标；
  临时 profile 的 `Default/Secure Preferences` 中扩展条目数为 **0**；
- 再加 `--enable-unsafe-extension-debugging` 结果不变。

品牌版 Google Chrome 自 135 起忽略 `--load-extension`，所以「拿系统 Chrome 跑扩展测试」这条路
并不存在。夹具因此优先读 `E2E_EXECUTABLE_PATH`，退路才是 `E2E_CHANNEL`。

macOS 13 剩下的唯一障碍是 Playwright 自己的分发矩阵（`pnpm exec playwright install chromium`
报 `Playwright does not support chromium on mac13`），而不是测试本身。绕开办法是手动取
Chrome for Testing——它是 Chromium 系构建，`--load-extension` 照常生效：

```bash
V=153.0.8010.52   # 与 https://googlechromelabs.github.io/chrome-for-testing/ 对齐
curl -o chrome-mac-x64.zip \
  "https://cdn.npmmirror.com/binaries/chrome-for-testing/$V/mac-x64/chrome-mac-x64.zip"
unzip -q chrome-mac-x64.zip   # 直连 storage.googleapis.com 也可，只是慢一个量级
export E2E_EXECUTABLE_PATH="$PWD/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
```

> 结论：夹具已被真实浏览器验证过一轮（含扩展加载、Options 解锁、内容脚本 PING、storage 落盘）。
> 但只有 `site-rules` 一个 spec 未被 skip，覆盖面仍是「F1 站点规则链路」，不代表全产品。

## 怎么跑

```bash
# 1) 拿到 Chromium 系构建（任选其一）
pnpm exec playwright install chromium            # macOS 14+ / Linux / CI
#   或下载 Chrome for Testing，指向其可执行文件

# 2) 运行（默认每次重跑 pnpm build 以保证产物新鲜）
pnpm test:e2e
E2E_EXECUTABLE_PATH=/path/to/Chromium.app/Contents/MacOS/Chromium pnpm test:e2e
E2E_HEADLESS=0 pnpm test:e2e                     # 有头模式，观察真实窗口
E2E_SKIP_BUILD=1 pnpm test:e2e                   # 复用已有 .output/chrome-mv3
pnpm exec playwright test site-rules -g "落盘"    # 只跑单条
```

扩展若没被加载，`resolveExtensionId` 会抛出带上述排查顺序的错误，而不是干等 30 秒超时。

## 设计约束

- **没有 `webServer`**：被测页面来自 `chrome-extension://<id>/…`；WXT dev server 只提供模块源，
  在那个 http 源上 `chrome.*` 根本不存在。产物新鲜度由 `globalSetup` 负责。
- **`workers: 1` 且不并行**：持久化上下文 + 全局 `storage.local` 并行会互踩。
- **每个用例一个全新临时 profile**（`mkdtemp`，结束即删）：用例之间不共享数据，也绝不触碰
  开发者日常 Chrome 的 profile。旧实现的 `storageState` 落盘方案已废弃——对密码管理器而言，
  把会话快照写到磁盘是不必要的风险面；`e2e/.auth/` 也已进 `.gitignore`。
- **文案定位统一走 `e2e/i18n.ts`**：从 `utils/i18n/locales/{zh-CN,en}` 读真实文案，编译成中英并集
  正则。切换语言不会让测试失效；产品改名时测试与 UI 一起暴露，而不是静默失配。
- **成功提示按文案而不是类名断言**：`ElMessage` 会把相邻动作的提示叠放在屏（解锁主密码的 3s 提示
  经常还活着），`locator('.el-message--success')` 一次命中两个节点，撞 strict mode 造成假红灯——
  首轮真机运行 3 条红灯全是这个原因，而被测功能其实是对的。统一走 `expectSuccessToast(page, key)`，
  顺带把断言从「有个绿条」收紧成「绿条说的是这件事」。
- **测试页面固定在 `*.e2e.test`** 并由 `page.route` 直接 fulfill：内容脚本会注入，但不需出网、
  不依赖 DNS。
- **可观测性靠内容脚本自带的 `PING`**：它回 `fieldsDetected`，是断言「规则是否真被消费」的稳定
  口径，比等待注入 UI 出现要可靠。

## 待补清单（按优先级）

1. 填充失败就地引导的完整回路：气泡 → Background → 选项页弹窗，含未解锁时挂起、解锁后自动续上；
2. 侧边栏秒开回归：骨架屏 → 真实 UI 无空白、SW 冷启动路径；
3. 备份 / 导入导出回环（需要真实的 `.aph` 产物；`e2e/fixtures/` 下的占位文件不能用于断言）；
4. 密码条目增删改、会话与锁定、安全设置各项 —— 见各文件头部 TODO 列表；
5. 加密 / 改主密码等破坏性用例绝不允许指向真实 profile（夹具已保证每用例独立临时目录）。

## 调试

```bash
pnpm exec playwright test --ui                   # 交互界面，可看回放与快照
pnpm exec playwright test --trace on             # 需要时开启 trace
pnpm exec playwright show-trace trace.zip
```

## 在 CI 上跑

`.github/workflows/e2e.yml` 是一个**只有 `workflow_dispatch`** 的工作流：Actions 页面手动 Run workflow，
它装 Playwright Chromium、把 `E2E_EXECUTABLE_PATH` 指向该构建、跑 `pnpm test:e2e`，失败时上传
`test-results/`（含首次重试的 trace）。

它**不响应 push / PR**，因此永远不会把未验证的套件变成门禁红灯。连续手动跑绿之后，再决定是否补
`push:` / `pull_request:` 触发；扩展 E2E 会明显拉长流水线（每次都要先 `pnpm build`），这是接入前必须
先量过的成本。

### 为什么 `playwright` 与 `@playwright/test` 都要留着

`pnpm why playwright` 显示它同时是直接 devDependency 和 `@playwright/test` 的传递依赖，看起来冗余——
但删掉直接声明会让 CI 的工作流当场失败：

- pnpm 默认的隔离布局只把**直接**依赖链接到 `node_modules/` 根（`ls -l` 可见
  `playwright -> .pnpm/playwright@1.63.0/node_modules/playwright`），传递依赖只落在 `.pnpm/node_modules/`
  这一隐藏目录里，而它只在 `.pnpm` **内部**发起的 require 的解析路径上；
- `e2e.yml` 里解析 Chromium 可执行文件用的是从仓库根执行的 `node -e "require('playwright')…"`，
  因此只可能命中根链接。直接依赖一删，这一步变成 `MODULE_NOT_FOUND`。

两个包都声明了同名 `playwright` bin，所以 `.bin/playwright` 不是保留它的理由，别拿这条当依据。
若要减掉这份重复，可行的替代方案是把那行改成 `require('@playwright/test').chromium.executablePath()`
再删直接依赖——但那会把「解析浏览器路径」这件事绑到测试运行器包上，收益只有一个依赖条目，不值得。
