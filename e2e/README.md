# E2E Tests（Chrome 扩展 · Playwright）

用 Playwright 驱动**真实构建出的 MV3 包**做端到端验证。

## 现状（请先读这段）

| 项                                                                           | 状态                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 夹具（加载扩展、取扩展 ID、解锁管理页、读写 `storage.local`、PING 内容脚本） | 已写好：`e2e/harness.ts` + `e2e/global-setup.ts`                          |
| 已真实覆盖的用例                                                             | `e2e/site-rules.spec.ts` 6 条：站点规则表单/存储 4 条 + 内容脚本消费 2 条 |
| 其余 6 个 `*.spec.ts`                                                        | 原有实现整体作废，文件内只保留 TODO 清单并显式 `test.skip`                |
| CI                                                                           | **未接入**，`pnpm test:e2e` 不在 `lint` / `test` / `build` 任何门禁里     |
| 本机（macOS 13）能否跑通                                                     | **不能**，原因见下                                                        |

### 为什么本机跑不了

`--load-extension` 只对 Chromium 系构建有效。本机实测（Google Chrome 152.0.7977.83）：

- `context.serviceWorkers()` 为空；`Target.getTargets` 里没有任何 `chrome-extension://` 目标；
  临时 profile 的 `Default/Secure Preferences` 中扩展条目数为 **0**；
- 再加 `--enable-unsafe-extension-debugging` 结果不变；
- 而 `pnpm exec playwright install chromium` 被 Playwright 1.63 直接拒绝：
  `Playwright does not support chromium on mac13`。

品牌版 Google Chrome 自 135 起忽略 `--load-extension`，所以「拿系统 Chrome 跑扩展测试」这条路
并不存在。夹具因此优先读 `E2E_EXECUTABLE_PATH`，退路才是 `E2E_CHANNEL`。

> 结论：这套夹具**只经过 `playwright test --list` 与 lint/typecheck 校验，没有一次真实的绿色运行**。
> 首次在有 Chromium 的机器上跑，请预留调时间。

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

接入 CI 前需先确认两件事：扩展 E2E 会明显拉长流水线，且需要 `xvfb`（或有头 Chromium）；
`test:e2e` 目前刻意不进 `pnpm build`/`lint` 门禁，避免把未验证的套件变成红灯来源。
