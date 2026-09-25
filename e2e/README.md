# E2E Tests（Chrome 扩展 · Playwright）

用 Playwright 驱动**真实构建出的 MV3 包**做端到端验证。

## 现状（请先读这段）

| 项                                                                           | 状态                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 夹具（加载扩展、取扩展 ID、解锁管理页、读写 `storage.local`、PING 内容脚本） | 已写好：`e2e/harness.ts` + `e2e/global-setup.ts`                                                                                                                                                                                       |
| 用例                                                                         | 8 个 `*.spec.ts` 共 44 条：站点规则 6 / 密码条目 6 / 会话 6 / 安全 6 / 备份回环 6 / 侧边栏 6 / 导入导出与工具 5 / 跨子域档位 3                                                                                                         |
| CI                                                                           | **push 到 `main` + 所有 PR + 手动**：`.github/workflows/e2e.yml`（2026-09-22 接入），文档与图片类改动按 `paths-ignore` 跳过。**观察期**：job 带 `continue-on-error`，跑红不挡合并，runner 上连跑两次全绿后去掉那一行才算真门禁         |
| 本机（macOS 13）能否跑通                                                     | **能**，但要自备 Chromium 系构建：Playwright 1.63 拒绝在 macOS 13 装 chromium，改下载 Chrome for Testing 并设 `E2E_EXECUTABLE_PATH`                                                                                                    |
| 首次真实绿色运行                                                             | 2026-09-21：`e2e/site-rules.spec.ts` 6/6；同日把另外 6 个作废 spec 全部重写，全量为 40 passed / 1 skipped（Chrome for Testing 153.0.8010.52，macOS 13 x64，4.0 分钟）                                                                  |
| 复跑稳定性                                                                   | 本地**两次全量绿灯**：09-21 那次 40 passed / 1 skipped（4.0 分钟），09-22 修好提示计数竞态后复跑同样 40 / 1（20.4 分钟）。中间那次大面积红已定位为上一轮遗留进程抢 CPU。**ubuntu runner 上一次都还没跑过**，逐条证据见下「复跑稳定性」 |

### 复跑稳定性：本地两次全量绿灯，中间那次「大面积红」是我自己造的

那次 40/1 全绿之后 `expectSuccessToastFor` 的计数竞态已修（见下「成功提示按文案断言」），
随后的一次全量复跑大面积红，当时的现场记录如下：

- 全量复跑（同一份代码、同一台机器）：**29 passed / 11 failed / 1 skipped，49.5 分钟**——
  对比全绿那次的 4.0 分钟，同样的 41 条慢了 12 倍。跑的时候机器 load 116→228、
  swap 用掉 5.2GB / 6GB、8GB 物理内存只剩 200MB。
- 11 条红灯**全部是等待超时，没有一条是断言不符**：3 条卡在解锁夹具那 30s（失败时的
  可访问性快照仍停在锁定页）、2 条卡在导出的 `download` 事件（20s 动作超时）、
  5 条卡在侧边栏夹具、1 条提示未出现、1 条整条用例 90s 超时。

**这批红灯后来被证明是环境，而且环境是我自己制造的。** 被单独拎出来「仍然红」的那条
侧边栏用例，用一次性探针沿三个边界量了一遍（站点内容脚本 → 后台 SW → 面板页），现场是：

- `.current-url` 不是「值为空串」，而是**根本还没挂载**——探针每 500ms 读一次，
  前 25 次全部「waiting for locator」超时，直到 `+31s` 才第一次读到
  `site-rules.e2e.test`。侧边栏首屏要跑会话校验 + 解密，头部在首屏完成前不渲染。
- 面板没有被关闭：`window.close` 的包装记录是 `no-close-call`，`page` 的 `close` 事件
  一次没触发，SW 侧收到的消息只有 `SIDEPANEL_PRELOAD` / `GET_INITIAL_DATA`，
  没有 `HIDE_SIDEPANEL`。先前「激活竞态」「渲染进程被回收」两种猜测都不成立。
- 清理时发现 4 个**上一轮 e2e 调用遗留的 runner shell**（ppid=1、已跑 64 分钟、
  每个约 20% CPU、没有浏览器子进程），正在持续抢 CPU。kill 之后 load 从 68 掉到 44。

杀掉残留进程后复跑整个 `sidepanel.spec.ts`：**6 passed / 3.6 分钟**（单条 16.5-49.5s），
没有改任何断言、没有上调任何超时。随后全量复跑：**40 passed / 1 skipped / 20.4 分钟**
（单条最长 56.3s，含此前 20s 超时的两条导出回环，实测 54.1s / 56.3s）。所以那 11 条红灯
与「导出下载 20s 超时」是同一类问题：600k 次 PBKDF2 的固定成本叠在一台被抢占、正在 swap
的机器上，而不是夹具写错了。

结论与处置：

- **超时预算一个字都不上调**（那等于把 hang 也调成绿）。`openSidepanelOnSite` 的 30s
  轮询只是把「等首屏」这件事显式化，并把读到的值放进失败输出，便于区分
  「没挂载」与「激活没落到位」；面板页被关掉则原样抛出，不吞成「没挂载」。
- 本地证据现在是「两次全量绿灯」，但**离可靠门禁还差 runner 那一格**：CI 用的是 ubuntu 上
  Playwright 分发的 Chromium，本地是 macOS x64 的 Chrome for Testing，同一内核不同构建，
  本工作流无法在本机预跑。因此 CI job 仍挂在 `continue-on-error` 的观察期，
  等它在 runner 上连跑两次全绿才转正。
- 复跑前的固定动作：`ps -Ao pid,etime,%cpu,command | grep -i "chrome-mac-x64\|aph-e2e-profile"`
  确认上一轮没有残留，必要时按 PID 收掉。残留进程会把下一次的红全部染成「环境红」，
  这比任何一条用例失败都更浪费排查时间——本轮就是这么绕了一圈弯路。

### 那 1 条 skip 是什么

`session-management.spec.ts` 的「空闲自动锁定的触发回路」：触发源是
`chrome.idle.onStateChanged('idle')`，由浏览器按真实无操作时长派发，测试既没有时钟控制，
也没有办法「什么都不做满 5 分钟」。编排本身（状态判定 → 锁会话 → 通知各上下文）已由
`tests/background/idleLock.test.ts` 覆盖，设置项落盘由 `security.spec.ts` 覆盖。
这条占位是**故意留着**的——它在 CI 输出里以 `-` 出现，比悄悄删掉更容易被下次评审看见。
其余 spec 没有 `test.only` / `test.fixme`，也没有不给原因的 skip。

### 侧边栏只能以 Tab 形态被驱动，由此有三条已知偏离

`chrome.sidePanel` 面板没有可寻址 URL，Playwright 拿不到它，所以 `openSidepanelOnSite`
打开的是 `chrome-extension://<id>/sidepanel.html` 这个普通 Tab，并把假站点 Tab `bringToFront()`，
让 `currentDomain` 与填充目标仍解析到站点。偏离逐条写在 `sidepanel.spec.ts` 末尾，最关键的一条是：
Tab 形态的 `sender.tab` 不为空，必然命中 `isTrustedInternalSender` 的拒绝分支，
因此「快速添加」那条用例断言的是**保存被拒 + 落盘 0 条**（fail-closed 的正确行为，不是缺陷），
成功路径由 `tests/background/quickAddHandler.test.ts` 覆盖。

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

> 结论：这套夹具已被真实浏览器验证过——扩展加载、Options 解锁、内容脚本 PING、storage 落盘、
> 侧边栏 Tab 形态、导出下载与导入回环都在内。覆盖面是产品主干，不是全产品：
> 弹窗（Popup）、内容脚本的悬浮按钮 / 内联下拉全样式、以及需要真实空闲事件的自动锁定仍无 E2E。

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
- **成功提示按文案断言，且判据以「基线归零」为准**：`ElMessage` 会把相邻动作的提示叠放，
  `locator('.el-message--success')` 一次命中两个节点会撞 strict mode（首轮真机 3 条假红灯即此）。
  改成按文案计数（`expectSuccessToastFor`）后又踩到第二个坑，而且更隐蔽：**「动作前先数、动作后要求
  条数变多」是错的**——快照里的旧提示 3s 后就过期，动作一旦慢过它们的剩余寿命，计数只会 `3 → 1`，
  永远超不过快照值，于是「条目确实存下来了」被报成「没有出现成功提示」。表现为机器空闲时全绿、
  负载高时随机红（真机第二轮 2 条红灯）。现在动作前先 `toHaveCount(0)` 等旧提示散场，基线恒为 0，
  判据与过期时刻脱钩；代价是连续同种动作每次多等约 3 秒。这条竞态用一次性探针正向验证过：
  人为把动作拖到 3.5s，修复前必现 `Expected: > 1 / Received: 0`，修复后转绿，而库里条目数始终正确。
- **测试页面固定在 `*.e2e.test`** 并由 `page.route` 直接 fulfill：内容脚本会注入，但不需出网、
  不依赖 DNS。
- **可观测性靠内容脚本自带的 `PING`**：它回 `fieldsDetected`，是断言「规则是否真被消费」的稳定
  口径，比等待注入 UI 出现要可靠。
- **解锁夹具等的是「界面就绪」而不是「HTML 到达」**：`page.goto` 的 `domcontentloaded` 只保证
  HTML 落地，Vue 尚未挂载。旧写法进门先探「有没有 setup 按钮 / verify 按钮」，两个探不到就
  悄悄返回一个还没解锁的页面，症状是后续用例随机红。现在先 `or()` 等三态之一出现（已解锁头部 /
  设置主密码 / 验证主密码），走完对应分支后再以「已解锁头部可见」收尾，见 `onboardAndUnlock`。
- **侧边栏以 Tab 形态驱动，并在使用前把站点 Tab 提到前台**：见上文「三条已知偏离」。
  `openSidepanelOnSite` 还要等 `#app-loading` 骨架屏消失——它是 `position:fixed; inset:0` 的兄弟节点，
  没淡出干净会吃掉整页点击。
- **公共定位器只有一份，收在 `harness.ts`**：`footerPrimary` / `toast` / `rowOf` / `allRows` /
  `openHeaderMenu` 系列此前在四个 spec 里各写一遍，改一处要全仓搜。只收「定义完全相同」的那些；
  `backup-restore` 的 `openDataMenu`（等状态条）与 `security` 的 `openSecurityDialog`（不等）
  读条件本就不同，强行合并等于顺手改掉一个 spec 的就绪断言，保持各自本地。

## 待补清单（按优先级）

1. Popup 入口的完整回路（与侧边栏共享数据面，但入口独立、没有 `sidePanel.open()` 那层手势约束）；
2. 内容脚本的注入式 UI：悬浮按钮显示/隐藏、内联下拉面板的开合与键盘导航——当前只经 `PING`
   断言字段检测结果，没有点过注入的按钮；
3. 侧边栏秒开回归：骨架屏淡出 → 真实 UI 无空白、SW 冷启动路径（`openSidepanelOnSite` 已等骨架屏
   消失，但没有把「<1s」变成断言）；
4. 空闲自动锁定（见上文「那 1 条 skip」）：需要能注入时钟的夹具，或改用可缩短的最小档位；
5. 加密 / 改主密码等破坏性用例绝不允许指向真实 profile（夹具已保证每用例独立临时目录）。

## 调试

```bash
pnpm exec playwright test --ui                   # 交互界面，可看回放与快照
pnpm exec playwright test --trace on             # 需要时开启 trace
pnpm exec playwright show-trace trace.zip
```

## 在 CI 上跑

`.github/workflows/e2e.yml` 与 `ci.yml` 同一触发口径：**push 到 `main`、所有 PR、外加 `workflow_dispatch`
手动复跑**。它装 Playwright Chromium、把 `E2E_EXECUTABLE_PATH` 指向该构建、跑 `pnpm test:e2e`
（`globalSetup` 先 `pnpm build`），失败时上传 `test-results/`（含首次重试的 trace）。
文档、博客与图片类改动按 `paths-ignore` 跳过——被测面就是整个扩展源码，所以用「排除法」而不是
白名单：白名单会在新增源码目录时静默漏跑。

两条接入时没有消除、只是被如实记录的偏差：

- CI 用的是 Playwright 分发的 Chromium（ubuntu），本机验证用的是 Chrome for Testing（macOS x64）。
  同一内核不同构建、不同平台，本工作流无法在本机预跑；
- 接进 PR 门禁 ≠ 成为必过检查。是否 required 由仓库的分支保护规则决定，那一步不在本文件里，
  也不在本地能验证的范围内。

成本要如实说：这个任务比 `ci.yml` 里任何一个都慢，而且**耗时对机器状态极其敏感**——本机 41 条用例
两次全绿分别用了 4.0 分钟和 20.4 分钟，被残留进程抢占的那次是 49.5 分钟（见上「复跑稳定性」），
CI 上还要加装浏览器与一次完整构建。`workers=1` 不可并行——持久化上下文加全局 `storage.local` 并行会互踩。

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
