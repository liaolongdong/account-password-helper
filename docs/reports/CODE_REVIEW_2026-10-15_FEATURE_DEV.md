# feature-dev 分支深度代码评审与安全评审报告

- **评审日期**：2026-10-15
- **评审范围**：`main...feature-dev`（33 个提交，106 文件，+5679/-310）**及工作区未提交改动**（`entrypoints/background/messageRouter.ts`，+11/-1）
- **评审方式**：CodeReview 子代理全量深读 + 人工逐条复核（所有 P1/P2 均回源验证，非转述）+ 自动化验证
- **评审维度**：正确性 / 安全 / 完整性与质量（功能回归、i18n、规范、测试覆盖、性能路径）

## 验证结果

| 检查项   | 命令                            | 结果                                                     |
| -------- | ------------------------------- | -------------------------------------------------------- |
| 类型检查 | `pnpm typecheck`                | ✅ 通过                                                  |
| Lint     | `pnpm lint`（--max-warnings 0） | ✅ 通过                                                  |
| 单测全量 | `pnpm test:run`                 | ❌ **1 failed / 3026 passed（233 文件）**——失败项即 P1-1 |

失败测试：`tests/background/fillByIdFailureFeedback.test.ts > 目标 frame 未注入：补发固定文案，异常原文不进提示条`。该测试是工作区未提交改动**自带的安全守卫用例，当前为红**，直接钉死 P1-1。

## 变更概览（5 条主线）

1. **Content 填充链路**：新增页面内回执胶囊 `FillAckChip`、写后复检（`InputFiller` 三档 outcome）、手机号+验证码填充与账号回退、`tel`/`cell` 整词判定、填充目标按值形状×字段语义排序。
2. **影子 DOM 穿透总闸**：`penetrateShadowEnabled` 全局偏好 + 站点规则只能收窄不能反向打开；进偏好面板，翻转即重检测。
3. **工具栏图标会话状态**：`actionIcon.ts` 以「最新期望态 + 单飞收敛循环」切换钥匙/挂锁，状态唯一来源 `isSessionValid`。
4. **静默失败显性化**：锁定失败 / 排序落盘失败 / 空筛选态 / 填充失败均补可动作反馈（对应提交 `8a92bc3`）。
5. **动效令牌与无障碍**：`--aph-duration-*` 三档令牌收口硬编码时长，弹窗与偏好面板补齐键盘可达（role/aria/方向键/Esc）。

---

## 🔴 P1（合并 main 前必须修复）

### P1-1【安全｜未提交改动】FILL_BY_ID 异常原文直接进页面提示条——注释、测试、代码三者矛盾

- 位置：`entrypoints/background/messageRouter.ts` L815（工作区未提交）
- 现象：注释写明「载荷用固定串而非 errorMsg——错误消息可能夹带 URL 等页面可控内容，不进提示条」，且同批改动的 `handleFillById` 两个拒绝分支都规范地使用 `tl()` 固定文案；唯独 catch 分支写了 `void showPageNotice(tabId, errorMsg)`，把 `chrome.tabs.sendMessage` 的原始异常文本下发进页面 DOM。
- 证据：`pnpm test:run` 全量中唯一失败项即本仓库自带守卫用例，实测泄漏内容为 `"Could not establish connection. Receiving end https://evil.example/"`。
- 影响：内部错误细节（URL、连接信息，潜在含扩展上下文与页面地址）泄漏到宿主页面 DOM，违反「DOM 视为不可信上下文、不外泄内部信息」的隐私基线；渲染侧虽已做 textContent + 截长防护（无 XSS），但信息暴露面本身不合规。
- 修复：改为 `void showPageNotice(tabId, tl('bg.router.fillFailed'))`，与 L817 `sendResponse` 复用同一固定串；改后该测试应转绿。

### P1-2【正确性】手机号与右键菜单两条填充路径回执恒报「已填充」，绕过本次新增的 verified/unverified 语义

- 位置：`entrypoints/content/FormDetector.ts` L1687-L1712（`fillMobileCode`）、L1207-L1212（`CONTEXT_MENU_FILL`）
- 现象：`showFillAck(field, outcome?)` 中 outcome 缺省落 `'filled'`。四条填充路径里账号密码、TOTP 两条正确分档，手机号与右键菜单两条不传 outcome；且手机号走 `setInputValueNative` 连写后复检都没有。`contextMenuTarget.ts` 内部已算出 `verified`，但 `ContextMenuFillResult` 类型在边界上把它丢了。
- 证据：`tests/content/formDetector.fillAck.test.ts` 对手机号/右键两例只断言锚点、未断言档位（账号密码/TOTP 两例用 `toEqual([field, 'verified'])` 钉死），测试与实现同时留洞。
- 同源头问题：`FILL_MOBILE_CODE` 分支（L1199-L1201）无条件回 `{ success: true }`——即使一个字段都没写进去，发起方仍收到成功。
- 影响：站点异步改写/清空 value 时用户看到假的乐观回执，恰是本次改造自己定义的场景（模块注释：「这一档真正需要用户看一眼」）；三处通道回执口径自相矛盾。
- 修复：手机号路径接入 `setInputValueWithStrategies` 并传 outcome；`ContextMenuFillResult` 透出 `verified`；`FILL_MOBILE_CODE` 响应以实际写入结果为准；补两条档位断言测试。

### P1-3【规范】FormDetector 同目录兄弟模块使用 `@/` 别名导入，违反项目导入约定

- 位置：`entrypoints/content/FormDetector.ts` L29-L35
- 现象：AGENTS.md 规定「同目录文件使用 `./`」。同一 import 块内新增的 `FillAckChip`/`contextMenuTarget`/`domUtils` 用了正确的 `./`，而本次新增/改动的 `formSelectors`、`InputFiller`、`CheckboxHandler`、`LoginFormAnalyzer`、`types`、`PasswordVisibilityToggle` 六处用了 `@/entrypoints/content/...`。
- 影响：口径分裂无工具拦截（`tests/architecture/` 43 个守卫均不校验此项），目录整体移动/重命名时别名路径需全仓搜索。
- 修复：六处改回 `./`；可在 `tests/architecture/` 增补一条源码扫描守卫防回归。

---

## 🟡 P2（建议同批或紧随修复）

| #    | 位置                                                                  | 问题                                                                                                                                                                                                                                             | 建议                                                                                                                                                 |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | `composables/useSidepanelFill.ts` L453-455                            | TOTP 路径忽略 `response.outcome`，侧边栏恒报「验证码填充成功」，而页面胶囊同批已按 unverified 显示「请核对」——动态码时效短，两通道各说一套                                                                                                       | 与账号密码路径 L351 同口径：`t(response.outcome === 'unverified' ? 'fill.fillCheck' : 'fill.totpFillSuccess')`，或新增 `fill.totpFillCheck` 中英同步 |
| P2-2 | `entrypoints/content/FormDetector.ts` L519-526                        | `maybeTriggerTotpHandoff` 在 `await GET_PENDING_TOTP` 后缺 `disposed` 门，与本文件 L119-122 自立的「await 续体不得在销毁后动作」约定（detectForms/siteRuleListener/fillPassword 均已设门）不一致；destroy 后在途响应会重建胶囊单例且再无清理路径 | await 后补 `if (this.disposed                                                                                                                        |     | !field.isConnected) return;` |
| P2-3 | `entrypoints/content/floatingButtons/settingsPanelView.ts` L1096-1101 | `updateConfig` 回灌路径用 `!!config[key]` 读开关，绕过本文件自述的单点真源 `isSwitchOn`（penetrateShadow「未写=开」口径）；当前被调用方默认合并掩盖，任一调用方漏合并即复现「面板显示关、引擎按开跑」分叉                                        | 改用 `isSwitchOn(key, config)`，并补一条 `updateConfig` 口径测试                                                                                     |
| P2-4 | `entrypoints/content/InputFiller.ts`                                  | 写后复检使三策略全失败的最坏路径每字段多付约 300ms（2×(50+100)），老式 jQuery/Angular Material 站点账号+密码两字段串联接近 1s                                                                                                                    | 非缺陷，是需显式预算的新代价；建议注释/文档标明确认，或首策略 verified 时缩短复检窗                                                                  |
| P2-5 | `composables/useSidepanelFill.ts` L392/L464                           | `catch (error: any)` 且 L394 直接 `error.message.includes(...)`；`no-explicit-any` 全仓已关所以 lint 不拦，但 AGENTS.md 要求新增代码不用 `any`                                                                                                   | `catch (error: unknown)` + `instanceof Error` 收窄（零成本）                                                                                         |

## 🟢 正面评价（后续重构不得丢失）

1. **FillAckChip 零敏感暴露**：只渲染两枚固定 i18n 文案、全程 `textContent`，closed shadow，reposition 监听 attach/detach 严格对称（含 `capture: true` 成对），rAF/hide 定时器均收口，`destroyFillAckChip()` 已挂入 `FormDetector.destroy()`；字段脱离文档主动隐藏。
2. **消息路由安全密度高**：`isFrameFillable` 统一门控全部凭证类消息（FILL_BY_ID / GET_INLINE_TOTP / FILL_TOTP_BY_ID / GET_MATCHING_ACCOUNTS）；`resolveTrustedContentUrl` 以 `sender.tab.url` 覆盖自报 URL 且 fail-closed；`DELEGATE_PAGE_NOTICE` 拒绝 `window.postMessage` 形态、投递目标只取 sender 推导 + 固定 frameId 0；GET_MATCHING_ACCOUNTS 对跨域 iframe 返回空列表而非锁定态，不泄露条目存在性。
3. **actionIcon 并发收敛干净**：「最新期望态 + 单飞循环」根治快速锁定/解锁交错时 `setIcon` 完成顺序回卷旧档位的竞态；`_appliedState` 仅成功置位、`finally` 收口 draining、失败不冒泡进锁定链路；SW 冷启动经 `refreshActionIcon()` 以 storage 为事实来源对齐，符合 MV3 内存不可信原则。图标资源实存、`skipConsistencyCheck` 选项签名核对无误。
4. **穿透总闸优先级设计正确**：全局 `!== false` && 站点规则只能收窄；`SHADOW_ROOT_SCAN_BUDGET=6000` 限流 + 截断留日志；来自 storage 的选择器先过 `isValidCssSelector` 再 try/catch，非法即安全返回空集；storage 监听仅在状态**翻转**时重检测，避免无关配置写入引发全量重扫。
5. **无障碍与动效令牌闭环**：`--aph-duration-*` 三档令牌替换散落硬编码；`DELETE_ANIMATION_MS=200` 与 CSS `fade-out var(--aph-duration-mid) forwards` 同节奏且把不一致后果写得有界可验证；减弱动效档覆盖有 `reducedMotionCoverage`/`motionTokenWiring` 架构守卫。
6. **双语 i18n 机械化守卫到位**：`i18nBundles.test.ts`（文件清单/key 集/前缀/依赖图 t() key 落位）+ `i18nLiteParity.test.ts`（LITE_MESSAGES zh/en key 集与非空）+ `PANEL_MESSAGES` 用 `Record<PanelLocale, Record<...>>` 编译期强制对齐；本次新增 `message.lockFailed`、`identity.sort.saveFailed` 中英均已成对。
7. **侧边栏秒开 SLA 未被回归**：`SHOW_SIDEPANEL`/`TOGGLE_SIDEPANEL` 分支在 `openSidePanelAndRespond` 前仅同步调用（`getTabIdSync`/`isSidePanelOpen`），无新增 `await`；本次改动未触碰加密、存储结构、权限与 host_permissions。
8. **运行时代码零裸 `console`**（logger.ts 封装层除外，符合规范）。

## 结论与建议

**当前状态不建议直接合并 main。** 阻塞项：

1. **P1-1**（有自带红测试钉死，改一行为 `tl('bg.router.fillFailed')` 即绿）；
2. **P1-2**（本次新功能的核心语义在 4 条路径中 2 条失真，且测试同步留洞）；
3. **P1-3**（导入口径，机械修复）。

P2 五项建议随同一批收尾（P2-1 与 P1-2 同语义，一并做完才自洽）。修复后最小验证集：`pnpm typecheck && pnpm lint && pnpm test:run`（重点：`fillByIdFailureFeedback` / `formDetector.fillAck` / `i18nBundles` / `i18nLiteParity` / `settingsPanelView.keyboard` / `reducedMotionCoverage`），涉及入口/消息路由行为变化时补跑 `pnpm build`。

其余未列入问题的变更（文档/落地页/SEO/博客封面的 dateModified 同步、CWS 文案、`public/icon/locked` 资产、`generate-icons.mjs`）经抽查与代码事实一致，无功能风险。
