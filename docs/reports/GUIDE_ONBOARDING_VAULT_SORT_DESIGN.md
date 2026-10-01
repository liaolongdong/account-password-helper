# 身份库排序 / 新手指引 / Options 文档中页 / 侧边栏秒开 —— 设计定稿

日期：2026-10-01　基线：`feature-dev` @ `447a909`（= `origin/main`，PR #104）

本文件是本轮四件事的设计契约，实现阶段的代码注释按全路径引用它。落点依据 `docs/README.md`「新增文档该放哪」第 2 条（技术判断依据，必须入库）。

## 0. 基线与分支动作

开工前仓库状态经过一次整理，这些事实决定了后面每一条的参照代码位置：

- `feature-dev` 原在 `2c84b07`（release 3.13.0），落后 `origin/main` 35 个提交且零独有提交，已 `merge --ff-only origin/main` 到 `447a909`。
- 本地 `main` 用 `git fetch origin main:main` 同步到 `447a909`（非快进会被拒）。
- 删除 4 个已合并分支：`chore-deps-adm-zip`、`docs-structure`、`fix-e2e-tooltip-and-stale-locator`、`fix-operation-tip-pointer-trap`（均先验过 `git cherry` 零未合入补丁）。
- `fix-table-overflow-tooltip-pointer-trap` 内容已全在 main，但被 worktree `/private/tmp/aph-e2efix` 占用，未删。
- 保留的 `Feature-pa` 含一笔**不在 main** 的旧提交 `c9ae76d`（2026-05-11，4a 堡垒机账号框识别与 keypress 填充，FormDetector/InputFiller +206 行）；`feature-blog` 含 7 笔不在 main 的 blog 文档提交。本轮不并入、不删除。
- 远端同名分支与 `origin/feature-dev`（落后本地 35 个提交）未动，推送需单独授权。

关键结论：逐张折叠与四档排序（`42e406d`）、聚光式新手引导（`779bbfd`）现在都在工作树里，本轮是在它们之上做优化，不是重做。

## 1. 决策记录（用户拍板）

| #   | 议题           | 拍板结果                                                         |
| --- | -------------- | ---------------------------------------------------------------- |
| 1   | 基线分支       | 先把各分支最新代码并进 `feature-dev`，统一在 dev 开发            |
| 2   | 拖拽排序       | 做「整套自定义固定顺序」，推翻 2026-09-30 的否决结论             |
| 3   | 折叠态按钮错位 | A1 占位不隐藏（眼睛按钮常驻 + `visibility: hidden`）             |
| 4   | 拖拽实现       | B1 原生 HTML5 DnD，零新依赖                                      |
| 5   | 指引承载形态   | Options 内置完整文档中页（一级视图 + `#guide` 深链）             |
| 6   | 初次安装       | `onInstalled` 的 install 分支自动打开管理页                      |
| 7   | 侧边栏内容缺口 | 引导新增「打开侧边栏」步骤 + 当场 `sidePanel.open()`             |
| 8   | 风格统一口径   | 强调色跟随 `--aph-primary`，幕布与深色卡底保持固定               |
| 9   | 秒开验证深度   | 闭包对拍 + 守卫测试 + 无头计时（三档全做）                       |
| 10  | 对外文档       | 本轮只改守卫强制词条，README / 官网 / CWS 缓到发布前统一刷       |
| 11  | 新增词条落点   | 复用 `help.json` + `options.json` 子键，不新建命名空间           |
| 12  | 富文本渲染     | 本轮连 `HelpDialog.vue` 的 8 组 `v-html` 一起换成 `RichText.vue` |

## 2. 身份信息库

### 2.1 折叠态按钮错位

`components/options/IdentityVaultDialog.vue:186-192` 的眼睛按钮当前是 `v-if="cardHasSecret(entry) && !isCollapsed(entry.id)"`。卡片一折叠该按钮整个卸载，`.identity-card__actions`（`:798`，`gap: 4px`）右对齐，导致 chevron 在最左、随槽位数变化整体横移；含机密与不含机密的卡之间同样错开。

改法：去掉 `v-if`，按钮常驻渲染，在「折叠态」或「本卡无机密字段」时挂 `.is-void`，样式给 `visibility: hidden`。动作行恒为 5 槽，任何状态、任何卡型下五个按钮的 x 坐标一致。选 `visibility: hidden` 而非 `opacity: 0` 的理由是它同时把元素移出 Tab 序与无障碍树，不需要额外 `aria-hidden` 或禁用逻辑。

顺带同一文件 `:755` 的 `.identity-card { background: white }` 换成 `var(--aph-surface-2)`。`assets/theme/tokens.css` 的 6 套方案（default / green / pink / mauve / orange / slate）每套都重写 `--aph-surface-2`，纯白卡在粉、紫主题下与周围 `--aph-surface` 脱节。

### 2.2 第五档 `manual` 与拖拽

档位侧真实符号：`utils/identity/types.ts:20` 的 `IdentitySortMode`、`utils/identity/constants.ts:56` 的 `IDENTITY_SORT_MODES`（`as const satisfies readonly IdentitySortMode[]`）、`:72` 的 `isIdentitySortMode`、`utils/storageKeys.ts:35` 的 `IDENTITY_SORT_MODE: 'identity_sort_mode'`、`utils/storage/identityCrud.ts:365` 的 `getIdentitySortMode`。

- `IdentitySortMode` 加 `'manual'`，`IDENTITY_SORT_MODES` 追加到末位，默认值仍是 `updated`。
- `utils/identity/sort.ts:68` 的 `COMPARATORS` 是 `satisfies Record<IdentitySortMode, …>` 映射表，新增档位不登记就编译失败——这条守卫是 2026-09-30 评审立的，本轮正好被新档位用上，不要改成 if 链。
- `manual` 档不走时间/文本比较，按 `orderIndexOf(id)` 排。`IdentitySortContext` 加注入点 `orderIndexOf`，保持 `sort.ts` 零存储依赖（与既有 `titleOf` / `locale` 同构，调用点在 `composables/useIdentityVault.ts:91` 的行内 ctx）。未登记 id 返回极大值，经 `tieBreak` 落到末尾，保证新建条目不会因为不在数组里而消失。
- 落盘：新键 `IDENTITY_MANUAL_ORDER: 'identity_manual_order'`，明文 `string[]`，读写函数放 `utils/storage/identityCrud.ts`，**不得进 `utils/storage/configManager.ts`**。后者被 `composables/useSidepanelData.ts:5` 静态 import，属侧边栏首屏闭包（2026-09-25 实测过同一 chunk 8183 → 7847 字节的教训）。上限 30 条，写放大可忽略。
- 读取收窄：非 `string[]`、重复 id、超长一律回落空数组，脏数据不炸 UI。删除条目在下次保存时 prune；`.aphid` / 明文导入产生的新 id 追加尾部。

交互：

- 抓握把手渲染在**最左**（`el-checkbox` 之前），仅在 `sortMode === 'manual'` 时出现。档位是全局态，所有卡片同时变化，不会造成卡间错位，动作行槽位数也不受影响——这是把手不塞进 `.identity-card__actions` 的原因。
- `draggable` 只挂把手，不挂整卡，避免与文字选中和按钮点击抢事件。`dragover` 给目标卡加 `.is-drop-before` / `.is-drop-after` 指示线，`drop` 调 `moveIdentity()` 重算数组并落盘，`dragend` 清指示类。
- 键盘可达性：把手 `tabindex="0"` + `role="button"` + `aria-label`，`Alt+↑ / Alt+↓` 上移下移一位，`aria-live="polite"` 播报「已移动到第 n 位」。
- 与筛选互斥：有搜索词或类别过滤时，只在**可见子集**内重排，按可见项在全局数组中的原位置回写，隐藏项位置不动。切走档位再切回，数组保留（视图偏好语义，与现有四档一致）。
- `.identity-toolbar__sort` 现宽 104px 是 headless 量出的四档下限，五档需重新量，不要凭审美改。

词条：`identity.sort.manual` 与把手、移动播报的 aria 文案，中英同步。取词守卫的真身在 `tests/utils/identitySort.test.ts:160-167`——它按 `IDENTITY_SORT_MODES` 动态拼 `identity.sort.<mode>` 并断言中英文非空（该文件 `:157-159` 注释写明：`i18nBundles.test.ts` 的静态扫描提不到动态键，只能靠这条双向校验），第五档一登记即被自动覆盖。同文件 `:48` 用 `toEqual(['updated','created','category','title'])` 精确锁死档位数组，追加 `'manual'` 必然让它变红，需同步改写——这条不是缺陷，它正是「档位集合单一真源」的守卫本体。另有一处**不会变红但会静默漏测**：`tests/utils/identityCrud.sortMode.test.ts:56` 的「合法档位原样读回」写死同一份四档字面量数组，加档后旧断言仍绿，第五档的落盘读回却没人验，必须把 `'manual'` 补进去。下拉选项由 `components/options/IdentityVaultDialog.vue:428` 的 `IDENTITY_SORT_MODES.map` 生成，无需手工加 `el-option`。

边界：条目 payload、`.aphid` 结构、加密格式、导出顺序一律不动（`rows` 仍恒为 `load()` 建立的 updateTime 基准序，档位只重排 `filteredRows`）。回滚路径就是删掉那个键。

## 3. 新手引导

### 3.1 内容硬伤（已逐条对代码核验）

| 词条                          | 现状主张                                           | 与实现不符之处                                                                                                            |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `onboarding.add.desc`         | 下次打开该网站，插件按域名自动匹配**并填好**       | 内联填充需点击钥匙图标（`help.gb.7`），自动填充要在偏好设置开「自动触发登录」（`help.gb.2`）                              |
| `onboarding.health.desc`      | 重复、过弱、已到更新期、长期未更换                 | 「已到更新期」与「长期未更换」同义重复，且漏掉占 20 分的「常见泄露密码（离线字典）」（`help.fs.6`）                       |
| `onboarding.personalize.desc` | 主题色、语言、悬浮按钮的显示与**位置**都在这一处切 | 偏好面板无位置项（`help.gc.2` / `help.fc.5`），位置靠页面拖拽吸附（`entrypoints/content/floatingButtons/DragHandler.ts`） |
| `onboarding.welcome.desc`     | 「日常用侧边栏就够了」                             | 8 步里无任何一步讲侧边栏，承诺悬空——由 3.2 兑现，不靠删文案回避                                                           |

其余断言经核验为准确，不改：`empty.desc` 的导入前额度预览（`help.gd.10`）、`search.desc` 的批量改标签/删除/导出（`help.gd.6`）、`data.desc` 的 `.aph` 需主密码（`help.fd.6`）、`health` 的 0–100 分、6 款主题色（`help.gb.6`）。

### 3.2 新增「打开侧边栏」步骤

`utils/onboardingTour.ts:100-109` 的 `TOUR_STEPS` 从 8 步增至 9 步。新步 id 取 `sidepanel`，**插在 `add` 之后**（`utils/onboardingTour.ts` 里 `pickSteps` 保持数组次序，位置即呈现次序）：紧跟「先放第一条进去」形成「存 → 取」闭环，也让 `welcome.desc` 那句「日常用侧边栏就够了」在第 3 屏就兑现，而不是拖到末步。全剧本 8→9，实际呈现由 7 步增至 8 步（`empty` 与 `search` 仍二选一）。

新步 `anchor: null` + `prefer: 'center'`——侧边栏不在 Options 的 DOM 里，聚光灯圈不到，只能整屏幕布 + 卡内动作按钮。卡内放「立即打开侧边栏」，复用既有 `MessageType.SHOW_SIDEPANEL` → `entrypoints/background/messageRouter.ts:405` 的同步 `sidePanel.open()` 路径（`:373` 已注明必须同步调用以保住用户手势链）。`trigger` 新增 `'tour'` 档（`utils/perfMetrics.ts:39` 联合类型加一项）：该字段只作为字符串标签写进性能环形缓冲（`:154-160`、`:272`），无穷举分支，加档零风险；而这一路径的打开对象是管理页所在标签页，与悬浮按钮/快捷键不同，混入 `'content'` 会污染 §5.3 的分档读数。

两处**核验后确认无需改动**（设计阶段曾假设要改，实测不成立，留此免得实施时重复调查）：

- 发送方闸门 `EXTENSION_CONTEXT_COMMANDS`（`messageRouter.ts:325-337`，`SHOW_SIDEPANEL` 已在列）只要求 `sender.id === chrome.runtime.id`（`isExtensionContextSender`，`:311-313`），Options 页今天就通过；`tests/background/senderValidation.test.ts:655-656` 的 `internalSender` 正是这一形状，`:661` 已在遍历清单内。background 侧零改动。
- `getTabIdSync`（`sidePanelManager.ts:132-134`）取 `sender.tab?.id`，Options 发消息时 `sender.tab` 即它自己的标签页 → 侧边栏挂在管理页旁边。不试图把它改成「猜上一个网站标签页」：那要在 `open()` 前 `await tabs.query`，直接违反 `:373` 的同步手势约束。

新步打开后侧边栏显示的是**全库而非本站**，成因链已逐环核验：项目未申请 `tabs` 权限（`wxt.config.ts:93-109`），扩展自身页面的 `tabs.query` 拿不到 `url`（该事实记录在 `entrypoints/background/optionsPageManager.ts:31-35`），于是 `composables/useSidepanelData.ts:360-373` 不给 `currentDomain` 赋值，而 `utils/passwordFilter.ts:68` 的 `if (!ctx.domain) return true;` 使「本站」退化为不过滤。对新库用户这恰好是想要的效果——一屏看完全部条目，搜索与收藏就在眼前。但两点必须承认并写进文案：头部域名行为空（`components/sidepanel/SidepanelHeader.vue:73-78`）、此刻点填充会落到 `fill.injectFailed` / `scriptNotReady`（`composables/useSidepanelFill.ts:277-301`，content script 不能注入 `chrome-extension:` 页）。所以卡片只讲「浏览 / 搜索 / 收藏」，不讲「在这里试填充」，并补一句「换到任意网站页面，侧边栏只显示该站账号」。

降级：`sidePanel.open()` reject、或运行时无该 API（`messageRouter.ts:412-415` 已有 `!chrome.sidePanel` 分支），卡片内改为显示 `Ctrl+Shift+L` 文案（`wxt.config.ts:126-130` 的 `toggle_sidepanel`），不静默吞错。

必须一并改写的既有断言共五处，其中一处是**编码了设计不变量**的守卫，不能只把期望值一改了事：

- `tests/utils/onboardingTour.test.ts:169-170`：`pickSteps(TOUR_STEPS, () => false)` 断言结果为 `['welcome']`。新步同样无锚点，裁剪后必然保留，期望值改写为 `['welcome', 'sidepanel']`。
- 同文件 `:172-175`：`empty` / `search` 互斥的两条 `toEqual` 全序列，都要在 `add` 之后插入 `'sidepanel'`。
- `tests/utils/onboardingTour.test.ts:202-207`：「**欢迎步是唯一无锚点步**，且排在最前并居中」直接 `toHaveLength(1)`。这条守卫的本意是「不许出现来历不明的无锚点步」，而新步的无锚点是结构性的（侧边栏不在 Options 的 DOM 里，聚光灯无法圈定）。处置方式是把「唯一」换成**显式白名单**：断言无锚点步的 id 集合恰为 `['welcome', 'sidepanel']`、两者 `prefer` 均为 `center`、欢迎仍排首位。这样守卫继续有牙，将来再冒出第三条无锚点步照样会红；直接把这条用例删掉是不可接受的。
- `tests/composables/useOnboardingTour.dom.test.ts:149`：硬断言 `['welcome','add','search','health']`，按新顺序改写。
- `tests/composables/useOnboardingTour.dom.test.ts:174`：同一文件里还有一处 `toEqual(['welcome'])`（无锚点态），与上面第 1 条同因变红，一并改写。

进度计数不受影响：`components/options/OnboardingTour.vue:206-207` 的 `counterCurrent` / `counterTotal` 由 `tour.total` 派生，8→9 步无需改组件。

### 3.3 样式统一

按「强调色跟随、幕布固定深色」执行：`components/options/OnboardingTour.vue` 中与主色、描边、进度条、光环相关的硬编码改走 `--aph-primary` / `--aph-primary-rgb`；深色卡底 `#182034` / `#0b101f` / `#0d1424`、幕布、`#fff` 文字属聚焦对比的功能必需，保持固定。改完跑 `tests/architecture/reducedMotionCoverage.test.ts` 与 `shadowTokenCoverage.test.ts` 两条既有守卫。

## 4. Options 文档中页与产品说明链接

### 4.1 安装即开管理页

`entrypoints/background.ts:35-50` 的 `onInstalled` 里，仅 `reason === 'install'` 分支调用既有 `openOptionsPage()`（`entrypoints/background/optionsPageManager.ts:97`，已做并发去重，内部 `runtime.getURL('options.html')` + `tabs.create`）。零新增权限（`wxt.config.ts:93-109` 现有权限集足够，`tabs.create` 不需要 `tabs` 权限）。`update` / `chrome_update` / `shared_module_update` 不开页。

调用位置放在该钩子所有既有初始化动作**之后**，失败只 `logger.warn`：开页失败不得连带废掉 `markInstalledBrowserSessionReady` / `freezeLegacyFillDefaults` / `initBackgroundConfig` / 跨平台预热。回归测试断言三件事：install 开页、update 不开页、抛错被吞且后续初始化仍执行。

**实施偏离（两条，均为核验后的更正，不是妥协）**：

- 实际写的是 `void openOptionsPage();`，**没有** `.catch(logger.warn)`。读实现确认 `doOpenOptionsPage` 自己 try/catch 全覆盖并 `logger.error`（`optionsPageManager.ts:132-135`），`openOptionsPage` 因此永不 reject——加 `.catch` 是为不可能发生的场景写兜底，属死代码。
- 回归测试的第三条改成断言「install 分支的调用次序」：`tests/background/installOpensOptionsPage.test.ts` 记录 `markInstalledBrowserSessionReady → initBackgroundConfig → openOptionsPage`，即"开页排在既有初始化之后"这条约束本身被固化，比模拟一个 callee 不可能抛的异常更有意义；另两条断言为 update / `chrome_update` 都不开页，且预热照旧触发。

链路闭合结果：装完自动落到设主密码页 → 设完进表格页 → 引导按 `entrypoints/options/App.vue:1276-1287` 的 `isAuthenticated && !tableLoading` 自动播放。决策 6 不含「引导覆盖设密阶段」，因此 setup 页不加 `data-tour` 锚点，改由 4.3 的第 ④ 个链接落点保证设密时能翻完整说明。

### 4.2 `#guide` 一级视图

- `entrypoints/options/App.vue` 的视图分支优先级改为 `location.hash === '#guide'` **高于** `isAuthenticated` 判断，使 Setup / Verify 阶段也进得去（免认证可见是这一节的关键）。命名空间安全：该文件今天完全不读 `location.hash`（实测 grep 零命中），既有「打开管理页并编辑/新增/查有效期」那批 `OPEN_OPTIONS_AND_*` 指令走的是 `openOptionsAndSendMessage`（`messageRouter.ts:500`）的**消息预填**通道而非 URL 片段，`#guide` 不与它们抢地盘。
- 新组件 `components/options/GuideView.vue`，`defineAsyncComponent` 懒加载（照 `App.vue:321` 引导那处的形态），左章节导航 + 右正文 + 顶部返回。章节：产品说明摘要 / 快速上手 / 基础使用 / 数据管理 / 高级配置 / 常见问题 / 快捷键。
- 深链 `#guide/<sectionId>`，sectionId 用稳定英文 id（`product` / `gs` / `gb` / `gd` / `gc` / `faq` / `shortcut`），`hashchange` 监听 + 滚动定位；返回时清 hash 落回原视图。

  **实施订正**：落地的章节次序是 `product / gs / gb / gd / gc / shortcut / faq`——`shortcut` 排在 `faq` **之前**。理由不是审美：左侧目录必须与正文滚动次序一致，而正文把快捷键表放在常见问题之前（FAQ 收尾是 HelpDialog 与文档中页共同的收尾位）。上面这行按设计阶段的手写次序把 `faq` 排在 `shortcut` 前，若照抄就会得到「目录最后一项指向页面中部」的错位目录；`SECTIONS` 数组因此同时充当次序与滚动锚点的单一真源。

- 命令面板加一条「打开使用指引」（`App.vue:1022-1190` 的 `buildPaletteActions`），`:1207` 引导期间 `canOpen` 禁用面板的既有约束保持不变。
- HeaderBar 右侧辅助组（`components/options/HeaderBar.vue:243`）在 Compass「新手引导」旁加「使用指引」图标按钮。

内容单一真源：正文全量复用 `utils/i18n/locales/{zh-CN,en}/help.json` 的 42 条操作指引与 38 条 FAQ 与 4 条快捷键词条，新增的只有「产品说明摘要」那一小段，写进 `options.json` 的 `options.guide.*` 子键。不新建命名空间——新建必须同步改 `tests/utils/i18nBundles.test.ts:31-58` 的 `BUNDLE_NAMESPACES` 静态清单，且 options bundle 会把新词条整体拉进 Options 首屏。

刻意保留的重复：GuideView 内仍写 `helpItems('help.gs', 11)` 这样的**字面量**，与 `components/sidepanel/HelpDialog.vue:119` 等 8 处形态一致（实测调用点共 8 个：`help.gs` 11 / `help.gb` 14 / `help.gd` 11 / `help.gc` 6 / `help.fs` 9 / `help.fb` 9 / `help.fd` 7 / `help.fc` 13）。原因：项目用的是自研扁平 i18n（`utils/i18n/index.ts` 只导出 `t` / `useI18n`，没有 vue-i18n 的 `tm`，`messagesCache` 是模块私有），运行时按前缀枚举键名需要给 i18n 核心加新导出——为省两个数字去动跨入口的 i18n 边界不值。

实施订正两点：其一，上面的 8 个分组数里 `help.gb` 已随 §4.4 从 14 提到 **15**，两侧逐组一致（gs 11 / gb 15 / gd 11 / gc 6 / fs 9 / fb 9 / fd 7 / fc 13），合计口径是「43 条操作指引 + 38 条 FAQ + 4 条快捷键」，不是设计阶段的 42。其二，重复的不只是字面量，`helpItems(prefix, count)` 这只一行的本地 helper 也在两个文件各写一份——同样刻意不抽：HelpDialog 挂在 sidepanel 的懒加载路径上，为一个一行函数再拆一个模块等于给侧边栏多一个 chunk（首屏预算守卫按文件计数，多一个基名就要多登记一格），而这份重复的**风险面**已被 `HELP_ITEM_SOURCES` 的跨面分组数比对覆盖，抽与不抽都不影响「改了 N 忘了补文案」会不会变红。

但这条守卫**今天只扫单个文件**：`tests/utils/i18nBundles.test.ts:318` 把来源写死成 `HELP_DIALOG_SOURCE = 'components/sidepanel/HelpDialog.vue'`，`:323-324` 只读这一个文件。照现状加 GuideView，第二处字面量完全不进守卫，「改了 N 忘了补文案」会在文档中页静默渲染裸 key——正是本文件 `:294-301` 那条「清单漏登记 → 该文件的 key 永不校验」所防的失效模式。所以本轮把单一常量改成列表 `HELP_ITEM_SOURCES = [HelpDialog.vue, GuideView.vue]` 并逐文件循环，保留每个文件各自的「扫不到调用即显式提醒」断言（`:328`）。改完两处字面量一致才是被强制的性质，而不是仅靠人盯。

新文件的扫描清单登记（两个都要做，否则静默漏校验）：

- `components/options/GuideView.vue` 挂进 options bundle 口径的清单。现有两份（`IDENTITY_GRAPH_FILES` `:120-126`、`ONBOARDING_GRAPH_FILES` `:137`）都映射到 `BUNDLE_NAMESPACES.options`，但按职责命名，把文档中页塞进任何一份都是错位；新建 `GUIDE_GRAPH_FILES` + 对应 `it(...)` 分支，并同步 `:303-315` 那条「六份清单里的每个文件都真实存在」的展开列表与用例名（六 → 七）。
- `components/RichText.vue` 加进 `HELP_DIALOG_FILES`（`:94`）。它自身不调 `t()`（文案由调用方传入），与同列的 `components/ShortcutKeyCap.vue` 同理——`:91-93` 注释写明「纳入扫描是为了防止后续回归」。它落在 `components/` 根目录，不在 `SIDEPANEL_OWNED_DIRS`（`:277`，只有 `entrypoints/sidepanel` 与 `components/sidepanel`）的强制认领范围内，所以**不会有测试提醒**，必须手动加。

### 4.3 富文本渲染与链接落点

新抽 `components/RichText.vue`：只把白名单 `<b>` / `<code>` 解析为 VNode，其余内容一律走文本节点（自然转义）。单测覆盖 `<img onerror=…>`、`<script>`、未闭合标签、嵌套标签的降级结果。按决策 12，本轮把 `components/sidepanel/HelpDialog.vue` 的 8 组 `v-html` 一并替换（实测 8 对 `eslint-disable` / `eslint-enable vue/no-v-html`，对应 8 个 `helpItems` 分组），使 `tests/architecture/lintBypassInventory.test.ts` 记录的旁路不增反减；替换属渲染内部改造，须保持 HelpDialog 输出的 DOM 结构与文本不变，并复跑侧边栏相关测试。

链接：`utils/urls.ts` 新增 `PRODUCT_DOCS_URL`，字符串与 `HelpDialog.vue:38` 现硬编码 `https://liaolongdong.github.io/account-password-helper/` 完全一致，:38 改引常量（纯替换、行为不变）。`entrypoints/sidepanel/App.vue:739` 的 repo 硬编码属无关改动，本轮不动。四个新落点：GuideView 顶/底「查看完整在线说明」、引导末步一句带链接、HeaderBar「使用指引」按钮、`components/options/MasterPasswordSetupView.vue` 底部一行。

**一处必须点名的可见变化**：HelpDialog 的 `<code>` 胶囊样式从本轮起**首次生效**。原先 `.help-section code` 写在 `scoped` 块里，编译成 `.help-section code[data-v-xxx]`（旧构建产物 `benchmarks/.artifacts/*/HelpDialog-*.css` 可核对），而 `v-html` 生成的节点不带 `data-v`，这条规则从未命中，`<code>` 一直按纯文本呈现。摘掉 `v-html` 后规则挪进非 scoped 块（`.el-dialog.help-dialog .help-section code`），`RichText` 生成的 `<code>` 同样不带 `data-v`，于是粉字灰底胶囊真的画出来了，与 GuideView 用同一套配色。DOM 结构与文本仍然逐节点一致——变化的只有样式。这是还原原作者意图、也是决策 12「连 HelpDialog 一起换」的直接后果；若判定不该出现，撤法是删掉这两处规则而不是回退渲染器。

### 4.4 文档同步（按决策 10 收窄）

本轮必改的是守卫强制项：`help.gb` 加一条「使用指引页」并把 N 由 14 提到 15，中英词条 + **两处**字面量（`components/sidepanel/HelpDialog.vue:146` 与 GuideView 对应分组）同步，否则 §4.2 改造后的 `HELP_ITEM_SOURCES` 守卫红；`help.gd.9` 现写死「顺序可按最近修改 / 创建时间 / 类别 / 标题切换」，加第五档后必须改写。README / README.en / ARCHITECTURE(.en) / index.html / en.html / CWS_FILL_CONTENT / llms.txt 留到发布前统一刷。

manifest 描述这条路走不通：`public/_locales/*/messages.json` 的 `extensionDescription` 中文 131/132、英文 130/132 已满，叠加 3.8.0 因关键词堆砌被 CWS 驳回，新功能不写进 manifest。

## 5. 侧边栏秒开

### 5.1 闭包对拍

从 `.output/chrome-mv3/sidepanel.html` 正则取 `modulepreload` / `script src` / `stylesheet` 首屏闭包（与后台 `extractSidePanelAssetUrls` 同口径），逐文件字节 + 文件数 + 总和。两次构建同机串行窗口内比，只采信相对差（本机噪声地板约 ±300 ms 级别，开跑前确认 CPU idle）。

变体设计：把 `utils/storage/configManager.ts:490-537` 的 `getOnboardingTourState` / `saveOnboardingTourState` 摘掉（或照 `utils/vaultPageSize.ts` 先例下沉成叶子模块）再构建一次。指纹字面量用 `onboarding_tour_state`，判据是 `grep -l` 命中的文件是不是被预加载的那个 chunk。

不预设结论：`composables/useSidepanelData.ts:5` 确实静态 import 了 configManager，但这两只函数只同文件内调用 `createConfigStore`，tree-shaking 本该摇掉。2026-09-25 那次翻车是 configManager 顶部 import 了 options-only 模块（`buildPagerItems`），属传递引用而非同文件。到底有没有撑大，只有对拍能定。

若命中，修法是把两只函数下沉成叶子模块，复跑对拍取字节证据。

**实测（2026-10-01，`447a909` 之上本轮改造后的单次构建）**：

| 指标                                  | 值                                                        |
| ------------------------------------- | --------------------------------------------------------- |
| sidepanel eager JS（HTML 点名预加载） | 34 文件 / 276,658 B                                       |
| popup eager JS                        | 44 文件 / 292,679 B                                       |
| sidepanel 最大几块                    | `i18n` 71,648 B、`icon` 47,718 B、`configManager` 8,422 B |
| `sidepanel.html` 本体                 | 7,983 B                                                   |
| 构建产物总量 / zip                    | 2.07 MB / 732.78 kB                                       |

指纹结果与设计假设**相反，需要如实记下**：`onboarding_tour_state` / `identity_sort_mode` / `identity_manual_order` 三条键名字面量只出现在 `storageKeys-*.js`（1,621 B，本就 eager，因为三入口共用同一份键名表），但 `getOnboardingTourState` / `saveOnboardingTourState` 的函数体**没有被 tree-shaking 摇掉**——它们的指纹 `新手引导状态` 出现在被 sidepanel 预加载的 `configManager-dnIasvLB.js` 尾部，约 550 B（该 chunk 8,422 B 的 6.5%、eager 总量的 0.2%）。

成因：`configManager` 只成**一个**共享 chunk（sidepanel / popup / options 三份 HTML 引用同一个 hash），说明 rolldown 是按「跨入口可达导出的并集」切块，不是按单入口用量切块。所以只要 Options 用得到，这段就一定跟着侧边栏一起下载。

处置：**本轮不下沉成叶子模块**。0.2% 的量级换不动一次存储边界文件的导出搬迁（要动 `configManager.ts` 与全部 mock 它的测试），且这段自 `779bbfd`（2026-09-29）起就在 main 上，不属本轮引入的回归。留作独立改造项：若真要削，目标应当是整块 `configManager`（8.4 KB）而不是它尾部的 0.5 KB。

### 5.2 守卫测试

扩既有 `tests/architecture/sidepanelClosure.test.ts`：断言首屏闭包文件集合 ⊆ 允许清单；断言 options-only 字面量（`onboarding_tour_state`、`identity_sort_mode`、新增 `identity_manual_order`）不出现在被预加载的 chunk 里。无产物时干净跳过——CI 的 test job 不跑 build，且 `describe.skipIf` 的收集期回调仍会执行，读 IO 必须放进 `it`。

**实施后的口径订正**：上面「options-only 字面量不出现在被预加载的 chunk 里」按字面量写，而 §5.1 实测证明这三条键名恰好住在被预加载的 `storageKeys-*.js` 里——键名表是三入口共用的。拿字面量出现当泄露信号会**必然误报**，还会诱导后人把 `IDENTITY_*` 键从共用表拆出去，那才是真回归。落地因此换成两条真能判的：

1. **归属**（沿用既有）：按 chunk 文件名前缀排除身份域模块，按代码形态排除 `.aphid`；
2. **预算**（本轮新增 `EAGER_ALLOW_LIST`）：入口 HTML 点名的每个 chunk 基名必须在清单内，同名出现次数不得超上限——`css-*` 是 Element Plus 匿名块，光靠名字挡不住「首屏多引了一个组件」，只能靠计数；`total` 与 `bases` 上限之和互为对账；另有无产物自检证明匹配规则吃得住 hash 变体（`tokens-BG44T6k-`、`a11y-ihm-cz4H`）、不误放相近前缀（`tag` vs `tagUtils`），并断言清单里不含 `GuideView` / `RichText` / `OnboardingTour` / `identity` 任何基名。

### 5.3 秒开计时（真机有头，2026-10-01 把「量不出来」换成了实测）

场景矩阵：会话有效 / 会话失效或未验证 / 扩展冷启动（SW 未起）/ 快速重启（保活中）/ 引导播放期间打开侧边栏 / 2000 条大库。指标取 FCP、首个非白屏帧、首屏窗口内 >50 ms 长任务之和。

**原先堵路的三个前提已解除**：品牌版 Google Chrome 自 135 起忽略 `--load-extension`（`e2e/README.md` 已记录）、chrome-devtools MCP 的浏览器确实带 `--disable-extensions`，但都不是死路——本机按 `e2e/README.md` 的既有办法手动取 Chrome for Testing 153.0.8010.52（Chromium 系构建，`--load-extension` 照常生效），把 `E2E_EXECUTABLE_PATH` 指过去；Playwright 1.63 在 macOS 13 拒绝装自己的 chromium 这一节也只影响它自己的分发，不影响借道 CFT。量具是 `benchmarks/measure-sidepanel-open.mjs`：有头模式启动 CFT，`--load-extension` 加载 `.output/chrome-mv3` 打包件，侧边栏以 docked 形态打开，经 CDP `Target.attachToTarget{flatten:false}` + `sendMessageToTarget` 直连面板执行探针脚本（面板是扩展自己的页面，不是宿主页面，因此不需要克隆 profile、也不需要手动开开发者模式）。

**两档分开跑，一行数据不混两档**：

- **干净档**（无 trace，`--repeat 3`）管耗时三项。开启 `devtools.timeline` 的浏览器级 trace 本身有开销，绝不能在秒开 SLA 的判定里掺进去。
- **trace 档**（`--repeat 3 --trace`）只管 >50 ms 长任务那一列。

| 场景           | 就绪    | 铺满        | FP          | FCP         | tFCP     | 首屏窗口 | 窗内主线程忙 | 占用率 | >50 ms 之和（中位/最坏） | 单条最长（中位/最坏） |
| -------------- | ------- | ----------- | ----------- | ----------- | -------- | -------- | ------------ | ------ | ------------------------ | --------------------- |
| s1 会话有效    | 362 ms  | 658.5 ms    | 332 ms      | 332 ms      | 392 ms   | 460.5 ms | 421.9 ms     | 93.3%  | 202.9 / 342.9 ms         | 104.7 / 197.3 ms      |
| s2 会话失效    | 260 ms  | 253 ms      | 280 ms      | 280 ms      | 290 ms   | 82 ms    | 69.9 ms      | 78.8%  | 39.2 / 78.4 ms           | 39.2 / 78.4 ms        |
| s3 冷启动      | 430 ms  | 628 ms      | 408 ms      | 408 ms      | 510 ms   | 504.1 ms | 414 ms       | 82.1%  | 246.8 / 701.9 ms         | 137.7 / 295.9 ms      |
| s4 快速重启    | 272 ms  | 476 ms      | 284 ms      | 284 ms      | 388 ms   | 510.7 ms | 477.9 ms     | 88.0%  | 293.5 / 345 ms           | 130.3 / 171.6 ms      |
| s5 引导播放中  | 441 ms  | 610.5 ms    | 388 ms      | 460 ms      | 320 ms   | 371.1 ms | 355.4 ms     | 95.4%  | 190 / 367.1 ms           | 98.8 / 170.4 ms       |
| s6 2000 条大库 | 1275 ms | **2315 ms** | **1728 ms** | **1728 ms** | 见下方注 | 619.6 ms | 603.7 ms     | 96.6%  | 571.6 / 573.8 ms         | 226.6 / 249.5 ms      |

列口径：**就绪 / 铺满 / FP / FCP** 取干净档三样本中位数，全部是文档相对时刻（`performance` 时间线，不含点击工具栏到 Chrome 创建面板那段 UI 侧延迟）；**就绪** = `sp-data-ready`（数据到手、骨架已在），**铺满** = `sp-list-rendered`（列表真正画完，用户感知的「开完了」），**FP** = `first-paint` 即首个非白屏帧，**FCP** = `first-contentful-paint`；**tFCP / 首屏窗口 / 窗内主线程忙 / 占用率 / >50 ms 之和 / 单条最长** 全部来自 trace 档。

「首屏窗口」= `sp-main-start` → `sp-list-rendered`（面板自己打的 PerformanceMark，走 trace 里的 `blink.user_timing` 事件），「占用率」= 该窗口内主线程 `RunTask` 时间之和（越界任务裁到窗口末）÷ 窗口宽度。s2 的**铺满 < 就绪**是真实形态而非噪声：会话失效态下空列表先画完（`sp-list-rendered` 反而早于 `sp-data-ready`，两档合计 5 个 s2 样本的 `dataToRender` 全为负，−7.3 ～ −187.3 ms）；同理 `sp-list-rendered` 是脚本层标记（渲染函数返回），落在屏幕上的那一帧（FP / FCP）在其之后，所以 s2 出现「铺满 253 ms 而 FP 280 ms」并不矛盾。

**长任务那一列为什么只能走 trace**：页面内 `PerformanceObserver('longtask')` 这条路在本机被三条实测证伪——`context.addInitScript` 不在 docked 面板里执行；attach 之后再注入，观察器落在文档相对 515–873 ms，晚于 `sp-mounted`；`buffered: true` 不回填观察器建立之前已结束的任务。第四条是顺带发现而非证伪：CDP `Runtime.evaluate` 里直接跑的 400 ms 忙等根本不产生 longtask 条目，改成由页内 `setTimeout` 发起同样的忙等才加回来一条越过 300 ms 判据的条目。量具把这条固化成 `--longtask` 档的阳性对照（`measure-sidepanel-open.mjs:122-123`，判据 `ltTeeth` 见 `:957`；注释与实测不符的订正单独提交为 `5ac5094`），但**本轮表里那两档跑的都是 `--trace`、没有开 `--longtask`**，所以长任务那一列并不由这条对照担保——它由下一段的 FCP 对表与重叠自检担保，且六场景的 `traceLongSumMs` 中位读数 39.2–571.6 ms 全部非零。trace 路线的代价是浏览器级 `disabled-by-default-devtools.timeline` 分类——它记录的是整台机器的任务，且这笔代价随负载走而非恒定：本机 21–35% idle 时它把面板 `docToMain` 从干净档的 106–210 ms 抬到 960–3034 ms（4–15×），而本次 trace 档（开跑前 `top` 记到 idle 40.1%）只量到 93–200 ms，与干净档无差别。两档仍然分开跑、耗时判定只认干净档，不是因为 trace 一定慢，而是因为负载不可控时它可能慢一个数量级。

**归因自检必须每场景都过**（不过就整列作废，不采信）：trace 里 `firstContentfulPaint` 相对 `sp-main-start` 的偏移必须等于探针的 `fcpMs − docToMainMs`；主线程 `RunTask` 区间必须两两不重叠（重叠即重复计数）。本次六场景最差 |Δ| = 4.0 ms（阈值 25 ms，16 个可对比样本，`s3#3` 因探针 FCP 为 null 不参与对表）、重叠数全为 0、每场景汇总位 `traceAttributionOk`（量具里定义为「worst |Δ| ≤ 25 且 `traceOverlaps === 0`」，见 `measure-sidepanel-open.mjs:934-938`）六条全为 `true`。选线程的依据也是实测而非猜测：`performance.mark()` 在 trace 里是 `ph:'I'` 且 `e.name` 即标记名（`args.data.entryName` 只出现在匿名 `UserTiming::Measure` 上，只认后者会一条都匹配不到），标记所在 `pid/tid` 即面板主线程，同 pid 还会发 Compositor / ChildIOThread / ServiceWorker 线程的 `RunTask`，不筛线程会虚增约 290 ms 并冒出假的 327.9 ms 长任务。

**读数怎么读**：以「铺满」这个用户感知完成时刻判，s1–s5 是 **253–658.5 ms**（就绪 260–441 ms），全部 <1 s；首个非白屏帧与 FCP 都在 280–460 ms，即「打开即有内容」，没有白屏窗口。真正的结论在占用率那一列——首屏窗口内主线程占用 s1–s5 为 **78.8%–95.4%**、s6 为 **96.6%**，也就是说侧边栏的那不到 1 s 不是「线程空闲、只是在等 IO」，而是主线程几乎排满。这条把「无卡顿」的含义讲实了：窗口里已经没有空闲余量去吸收额外的主线程工作，因此任何把数据就绪时刻推后的因素（更大的库、慢磁盘、杀软扫描）都会 1:1 反映到端到端耗时上——s6 大库就是已经越线的例子。后两者在本机测不了，仍是未验证项（见下方口径边界）。

**s6 大库未达标，如实记**：干净档就绪 1275 ms、铺满中位 **2315 ms**（三个样本 1540 / 2315 / 3306 ms，没有一条进 1 s）、FCP 1728 ms，三条都超 1 s，`fcpUnder1000ms:false` / `totalUnder1000ms:false`。trace 档独立佐证了同一件事——三个样本里唯一「列表铺满后才采样」的那一个（DOM 7685 节点 / 210 行，`sp-list-rendered` @1108 ms）FCP = 1244 ms，同样 >1 s；另外两个样本在 3439 节点 / 90 行的中途状态就采了样，FCP 读数（388 / 432 ms）与干净档不同态，因此 **s6 那一行的 trace 档 FCP 不入表、不作达标依据**，只有窗口 / 占用率 / 长任务三项可比（96.6% 占用、>50 ms 之和 571.6 ms、单条最长 249.5 ms）。这是 2000 条密文夹具 + 每页 100 行的既有成本，成本归属与 AGENTS.md「管理页（Options）首屏 SLA」一节把大头点给**数据层**（全库解密 + 整包 IO）是同一件事——那张三段阈值表管辖的是管理页而非侧边栏，这里只借用它的归属结论，不声称侧边栏受那三段数字约束。本轮的五档排序与文档中页改造没有新增首屏文件（§5.1 / §10 的 eager 集合复测为 34 文件 / 276,658 B，逐字节一致）。**不因此放宽阈值、也不擅自改 AGENTS.md 的性能章节**，未达标事实交由用户决定是否入档。

**样本级异常清单（不藏）**：trace 档 `s2#1` 整样本失败（`page.waitForTimeout: Target page, context or browser has been closed`），故 s2 只有 2 个有效样本；`s3#3` 是离群样本（首帧与 FCP 读数均为 null、就绪 1456.3 ms、`sp-list-rendered` @1968 ms、窗口内占用 90.4%），并且它是两档合计 35 条有读数的样本里**唯一一条视口为 `[0, 0]`** 的（其余 34 条都是 360×666，仅 `s1#3` 是 360×669）——面板采样时还没拿到尺寸，足以同时解释 null 与偏高。但它对表里那一行的影响只在「最坏」那一列：s3 的 >50 ms 之和 701.9 ms、单条最长 295.9 ms 正是这条贡献的，而中位列（窗口 504.1 ms、窗内忙 414 ms、占用 82.1%、之和 246.8 ms、单条最长 137.7 ms）全部来自 `s3#2`——三样本取中值时离群端点动不了中位数。跑 trace 档时本机 idle 仅 40.1%（Qoder 自身在占 CPU），同机噪声地板按项目记忆约 ±300 ms，所以离群样本只标注、不剔除，也不拿任何单样本的绝对值当 SLA 判定——SLA 只认干净档的三样本中位数。另有 4 个样本（`s3#1`、`s4#2`、`s4#3`、`s5#2`）的 DOM 快照落在 `sp-list-rendered` 之前（149 节点，只有面板外壳），这些样本的 FCP 仍是有效的首帧读数，但与 DOM 规模相关的读数（节点数、行数）只在同一渲染状态下才可比，所以 s6 那一行单独按「铺满态样本」报，见上一段。干净档同样有 2 个这种早采样样本（`s1#1`、`s5#3`，均为 149 节点的外壳态、没读到 `sp-list-rendered`），因此这两场景的「铺满」中位数是 2 个样本的中位数（658.5 / 610.5 ms），标注取样数，不补插值。**两档的耗时可以互验而不互替**：本次 trace 档的 `docToMain` 中位与干净档同量级（93–200 vs 106–210 ms），s1–s5 的 trace 档 FCP（290–510 ms）与干净档（280–460 ms）方向一致，所以表里两列各记各的，谁也不覆盖谁；判定秒开 SLA 只认干净档。

**口径边界（沿用并保持）**：`sidePanel.open()` 的浏览器 UI 侧冷启动延迟无头量不到（`e2e/harness.ts:322` 已记录 Playwright 点不到工具栏，自动化只能走内容脚本 `SHOW_SIDEPANEL`），本量具同样是从内容脚本触发路径计时，量的是「面板进程起来到列表铺满」这一段，不含用户点击工具栏图标到 Chrome 决定创建面板的那段 UI 侧延迟；Windows 慢磁盘与杀软扫描在这台 Mac 上实测不了，只能用「全量预热 + 常驻保活」的静态断言加现有 e2e 覆盖代替，**这两条仍是未验证项**。AGENTS.md 对侧边栏只有「<1 s、无白屏」一句，没有三段数值阈值表，实测数据交用户决定是否入档，实现阶段不擅自修改 AGENTS.md 的性能章节。

**同一节的另外两条本机读数（保留，与计时无关）**：

| 量                                                   | 结果                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 首屏 eager 资源集合是否因本轮变厚                    | 否。34 文件 / 276,658 B，清单内没有本轮任何新增模块名（已固化为 §5.2 第 2 条守卫）                 |
| HelpDialog 的 `v-html` → `parseRichText` 纯 CPU 成本 | 中英各 81 条、合计 162 条全量解析 **0.60 ms**（均值，±2.41% rme，840 样本）；单语言 81 条 ≈0.30 ms |

第二行取的是 `parseRichText` 的纯字符串成本（`vitest bench`，jsdom），与 DOM 后端无关，可直接外推到浏览器；**挂载环节的读数刻意不采信**——量具里每条都要 `createApp()` 起一个独立 app 根，而真实的 `RichText.vue` 是 HelpDialog 里的子组件，两者不可比。产出的 DOM 节点数与 `v-html` 完全一致（同一批 `<b>` / `<code>`），不新增布局成本；帮助弹窗一次只渲染一个分组（最多 15 条），按单条 3.7 µs 折算约 0.06 ms。

仍未验证并如实标注：Windows 慢磁盘与杀软扫描路径；`sidePanel.open()` 浏览器 UI 侧那一段延迟；s6 大库的 >1 s 尚未解决（本轮不修，理由是它不属本轮改造引入，且修法在数据层）。

## 6. 明确不做

- 不引入 `sortablejs` / `vuedraggable` 等拖拽依赖。
- 不给 `MasterPasswordSetupView.vue` 加 `data-tour` 锚点、不把引导提前到设密阶段。
- 不改身份库条目 payload、`.aphid` 结构、加密格式、导出顺序。
- 不改 manifest `permissions` / `host_permissions` / CSP，不写 `extensionDescription`。
- 不动 `entrypoints/sidepanel/App.vue:739` 的 repo URL 硬编码。
- 不并入 `Feature-pa` 的 4a 堡垒机改动与 `feature-blog` 的 blog 文档。
- 不在本轮刷对外长文档。

## 7. 会红的测试与要改的断言

| 测试                                                                              | 触发原因                                      | 处置                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/utils/i18nBundles.test.ts`                                                 | 三处同时受影响                                | `:320-345` 的 `helpItems` 守卫改成扫 `HELP_ITEM_SOURCES` 列表；新增 `GUIDE_GRAPH_FILES` 并同步 `:303` 的「六份清单」展开与用例名；`HELP_DIALOG_FILES`（`:94`）加 `RichText.vue`。`help.gb` 14→15 靠这些字面量与词条同步才不会红 |
| `tests/utils/identitySort.test.ts:48`                                             | `toEqual` 精确锁死四档数组                    | 追加 `'manual'`（这条就是档位集合的守卫本体，改写期望值而非删除）                                                                                                                                                               |
| 同文件 `:160-167`                                                                 | 第五档需有非空词条                            | 补 `identity.sort.manual` 中英即自动通过                                                                                                                                                                                        |
| `tests/utils/identityCrud.sortMode.test.ts:56`                                    | 写死四档字面量做落盘读回                      | **不会变红**的静默漏测点：必须手动补 `'manual'`，否则第五档落盘无人验证                                                                                                                                                         |
| `tests/composables/useIdentityVault.test.ts`                                      | manual 档与 `moveIdentity`                    | 新增用例，不改断言口径                                                                                                                                                                                                          |
| `tests/utils/onboardingTour.test.ts:169-170`                                      | 无锚点态期望 `['welcome']`                    | 改为含新步 id 的两项                                                                                                                                                                                                            |
| 同文件 `:202-207`                                                                 | 「欢迎步是唯一无锚点步」`toHaveLength(1)`     | 改成显式白名单断言（见 §3.2），不删用例                                                                                                                                                                                         |
| `tests/utils/onboardingTour.test.ts` 其余                                         | 步骤 8 → 9、tip 唯一性、四向对齐回归          | 补 `onboarding.sidepanel.*` 中英（title/desc 两段，可选 tip）                                                                                                                                                                   |
| `tests/composables/useOnboardingTour.dom.test.ts:149`、`:174`                     | 硬断言步骤序列与无锚点态                      | 按新顺序改写                                                                                                                                                                                                                    |
| `tests/background/senderValidation.test.ts:661`                                   | 需确认 Options 发 `SHOW_SIDEPANEL` 的放行范围 | **预期直接绿**：§3.2 已核验 `isExtensionContextSender` 只认 `sender.id`，代码与断言都不动；红则说明误改了 `EXTENSION_CONTEXT_COMMANDS`                                                                                          |
| `tests/utils/perfMetrics.test.ts`                                                 | `trigger` 联合类型加 `'tour'`                 | 预期通过（用例只断言既有档，无穷举分支）                                                                                                                                                                                        |
| `tests/architecture/lintBypassInventory.test.ts`                                  | HelpDialog 摘掉 8 处 `eslint-disable`         | 旁路清单收缩，断言随之更新                                                                                                                                                                                                      |
| `tests/architecture/sidepanelClosure.test.ts`                                     | 新增 options-only 字面量守卫                  | 扩断言                                                                                                                                                                                                                          |
| `tests/architecture/reducedMotionCoverage.test.ts`、`shadowTokenCoverage.test.ts` | 引导样式改动                                  | 预期通过，红则说明减动效分支或令牌口径被漏写                                                                                                                                                                                    |

`tests/components/identitySortSelect.dom.test.ts` 不在名单里：它只断言 tooltip 不插包装节点（`:37-63`），与档位数量无关。但它开头那段注释（`:6-11`）记录了 `.identity-toolbar__sort` 104px 的推导过程——第五档加宽后要按同一口径重量，别只改 CSS 不重算预算。

## 8. 验收矩阵

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:style`、`pnpm test:run`（含加密 / 存储 / 会话 / 消息路由全量）
- `pnpm build` 与 `pnpm build:firefox`（涉及 onInstalled 行为、manifest 生成、侧边栏闭包）
- `pnpm exec prettier --check` 对新增与改动的文档、JSON
- 侧边栏闭包对拍按 §5.1 跑两次构建并留字节表
- 折叠态与四种卡型（有机密/无机密 × 展开/折叠）的动作行对齐，用 DOM 测试断言槽位数恒为 5
- `RichText.vue` 的安全边界单测：`<img onerror=>` / `<script>` / 未闭合标签 / 嵌套标签四例，断言输出里没有真实元素节点、只有文本
- 引导新步 `sidepanel` 在无 `chrome.sidePanel` 的环境走降级分支；且 `pickSteps` 后它排在 `add` 之后
- 身份库 manual 档的落盘、脏数据回落、导入后追加、过滤态回写四条边界各一例测试
- `#guide` 免认证可见：Setup / Verify 阶段带 hash 能进文档中页，返回时清 hash 落回原视图

## 9. 实施顺序（分波，每波独立可验证）

拆波原则：先把「行为不变的结构改造」与「新增交互」分开，把唯一需要实测量级的秒开核实留在最后，因为它的结论依赖前面所有波次的产物形态。

| 波次                | 内容                                                                                                                                                                                                                                                                                                     | 出口条件                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 身份库对齐       | §2.1 五个槽位常驻 + `background: white` 换 `var(--aph-surface-2)`，纯 CSS/DOM，不改排序与数据                                                                                                                                                                                                            | 四种卡型对齐断言绿；`pnpm lint:style` 绿                                                                                                                                            |
| W2 身份库手动排序   | §2.2 第五档 `manual`（types → constants → storageKeys → sort.ts → identityCrud → useIdentityVault → 弹窗）+ 拖拽/键盘两条写入路径                                                                                                                                                                        | `identitySort.test.ts`（含 `:48` 档位数组改写）与 `useIdentityVault` 用例绿，`satisfies` 不报缺档；`identityCrud.sortMode.test.ts:56` 的字面量数组补 `'manual'`                     |
| W3 引导内容         | §3.1 四处硬伤逐条改写 + 核心高频功能前置，中英 key 集对称                                                                                                                                                                                                                                                | `i18nBundles` 与 `onboardingTour` 用例绿                                                                                                                                            |
| W4 引导新步         | §3.2 `sidepanel` 步插在 `add` 之后：`TOUR_STEPS` 8→9、`trigger` 加 `'tour'`、`onboarding.sidepanel.*` 中英、降级文案。background 零改动（§3.2 已核验闸门今天就读 `sender.id`）                                                                                                                           | `onboardingTour.test.ts` 的 `:169-170`、`:172-175`、`:202-207` 三处按白名单口径改写后绿；`useOnboardingTour.dom:149`、`:174` 改写后绿                                               |
| W5 引导样式         | §3.3 强调色相关硬编码换 `--aph-primary` / `--aph-primary-rgb`，功能必需的深色保持固定                                                                                                                                                                                                                    | `reducedMotionCoverage` 与 `shadowTokenCoverage` 绿                                                                                                                                 |
| W6 富文本与文档中页 | 依序：§4.3 前半 `RichText.vue` → §4.3 HelpDialog 8 组替换 → §4.2 `GuideView` + `#guide` 视图优先级 + 两处入口按钮 → §4.2 的扫描清单登记（`GUIDE_GRAPH_FILES` / `HELP_ITEM_SOURCES` / `RichText.vue` 进 `HELP_DIALOG_FILES`）→ §4.3 后半 `PRODUCT_DOCS_URL` 与 4 处链接 → §4.1 `onInstalled` 自动开管理页 | HelpDialog 输出 DOM/文本与替换前一致；`lintBypassInventory` 旁路清单收缩；`i18nBundles` 三条改造后的守卫都覆盖到新文件；install 开页 / update 不开页 / 抛错不影响既有初始化三条断言 |
| W7 秒开核实         | §5.1 闭包对拍（两次构建 + `onboarding_tour_state` 指纹）→ §5.2 守卫扩展 → §5.3 无头计时 6 场景                                                                                                                                                                                                           | 字节表与计时表回填本文件 §5；未达标只报绝对毫秒，不放宽 AGENTS.md 阈值                                                                                                              |
| W8 收口             | §4.4 文档同步（`help.gb` 14→15、`help.gd.9` 改写）→ 全量五道门禁 → `pnpm build` / `build:firefox`                                                                                                                                                                                                        | AGENTS.md「完成标准」四条逐条对照                                                                                                                                                   |

三条顺序约束值得单独说明：

1. **W6 必须早于 W7。** `RichText.vue` 同时被 sidepanel 的 `HelpDialog` 与 options 的 `GuideView` 引用，按既有不变量「被 ≥2 个入口 import 的模块一定被拆成独立 chunk」，侧边栏首屏闭包大概率 +1 文件。W7 若先跑，量到的是改造前的闭包，结论作废；对拍时把这一条单列进字节表。
2. **W6 的清单登记是「不会变红」的那一步，必须当次做。** `RichText.vue` 在 `components/` 根、`GuideView.vue` 在 `components/options`，两者都落在 `SIDEPANEL_OWNED_DIRS`（`tests/utils/i18nBundles.test.ts:277`，只含 `entrypoints/sidepanel` 与 `components/sidepanel`）之外——`:294-301` 那条强制认领的用例管不到它们，没有任何测试会因为漏登记而变红，后果是新文件的 `t()` key 永不校验（该文件 `:63-65` 注释记录的 `QuickAddDialog.vue` 漏检事故就是同一形状）。
3. **W4 不碰 background，因此可以独立回滚。** 新步只改 `utils/onboardingTour.ts` + `OnboardingTour.vue` + `composables/useOnboardingTour.ts` + 词条 + 四组测试断言；一旦 §5.1 对拍显示侧边栏闭包被撑大，责任只在 W6 的 `RichText` / `GuideView`，不必回头怀疑 W4。

## 10. 门禁终态（2026-10-01，W8 收口实测）

全部在 `feature-dev` 工作树上跑，退出码逐条取自命令本身而非管道尾部：

- `pnpm typecheck`（`tsc --noEmit`）→ 0；`pnpm lint`（`eslint . --max-warnings 0`）→ 0。
- `pnpm exec stylelint "**/*.{vue,css,scss}" --no-cache` → 无输出（刻意不用 `--cache`：缓存会掩盖 recess-order 违规，这是 09-26 那一轮踩过的）。
- `pnpm test:run` → **178 文件 / 2126 例全绿**（基线 2045/173，本轮 +81 例 / +5 文件，全部来自新增守卫：`richText` ×2、`identityCardActions`、`identityCrud.manualOrder`、`installOpensOptionsPage`，以及 §5.2 扩写的 `sidepanelClosure`）。四个提交落地后在终态树复跑一次同样 178/2126 全绿、Duration 44.64 s；本节先前记的 353.21 s 是并发负载下的同批数据——绝对时长随机器负载浮动，只有用例数是判据。对外长文档仍写 2041/172，属决策 10 的「发布前统一刷」，本轮刻意不动。量具（`53b6ecb` + 注释订正 `5ac5094`）入树、本节订正尚未提交的工作树状态下，五道门禁再整体复跑一遍：`typecheck` / `lint` / `prettier --check . --no-cache` / `test:run` / stylelint `--no-cache` 退出码逐条为 0，用例数仍是 178 文件 / 2126 例（绝对时长随机器负载浮动，这一轮不再记 Duration）。
- `pnpm build` → 0，Σ 2.07 MB / zip 732.78 kB；`pnpm build:firefox` → 0。首次记录的两条耗时（58.5 s / 29.0 s）同样是并发负载下的读数，终态树静置复跑为 4.7 s / 5.0 s，产物 Σ 与 zip 字节数两次一致。
- `pnpm exec prettier --check` 对本次改动的 md / json / ts 全部通过，收口时另跑了一次全仓 `pnpm format:check` → 0。其中 `docs/README.md` 的 `reports/` 行改为通配枚举（`PERF_*`、`*_EVALUATION.md`、`*_DESIGN.md`），这样新报告不再需要改文档地图；该行显示宽度小于同列最大值，因此 prettier 只按列宽重新对齐两张表的中缝，未改动其它单元格文本。**本轮 `format:check` 唯一一次红是在量具上**：`benchmarks/measure-sidepanel-open.mjs` 是全仓门禁覆盖（`prettier --check .` 无 glob、`.prettierignore` 不含 `.mjs`）但 lint-staged 的 glob 不含 `.mjs` 的那种文件，只能人工过一遍——处理方式是对该单文件 `prettier --write` 后 `node --check` 复验，不使用会改写整仓的 `pnpm format`。

### 10.1 提交拆分（`feature-dev`，基线 `447a909`，全部未推送）

| 提交      | 范围                                                                                                      | 规模               |
| --------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| `2c34ad8` | §2 身份库：五档排序与 `manual` 落盘、拖拽与键盘双路、动作行恒五槽                                         | 14 files +1200 −31 |
| `0db7205` | §4.3 富文本白名单：`richText.ts` / `RichText.vue` / 分组图标与键帽抽件、HelpDialog 换渲染器、豁免清单归零 | 12 files +659 −244 |
| `d967413` | §3 + §4.1 + §4.2：`#guide` 文档中页、引导第九步与侧边栏实开、安装即开管理页、`--tour-accent` 跟随换肤     | 17 files +1581 −90 |
| `c617b7a` | §5.2 eager 预算守卫 + 本文件与 `docs/ARCHITECTURE.{md,en.md}` / `docs/README.md` 回灌                     | 5 files +568 −28   |
| `1d8b3a1` | §10 门禁耗时口径订正 + 上面四行的首次登记                                                                 | 1 file +16 −3      |
| `024a1cd` | §10.2 两轴评审回灌五条：GuideView link 按钮 `:deep` 抵消、四处文案/文档口径、删两条死词条                 | 9 files +42 −7     |
| `53b6ecb` | §10.4 秒开量具 `benchmarks/measure-sidepanel-open.mjs`（纯测量脚本，不进任何入口的产物）                  | 1 file +1184 −0    |
| `5ac5094` | 量具注释订正：阳性对照是页内 `setTimeout` 忙等 400 ms、判据下限 ≥300 ms（四处 JSDoc，零逻辑改动）         | 1 file +4 −4       |
| 本提交    | §5.3 六场景读数 + §10 / §10.3 / §10.4 收口（即本文件这次改动）                                            | 1 file             |

拆分依据是**稳定职责**而非波次编号：`manual` 档只碰身份域，白名单解析器被侧边栏与管理页共用，
文档中页与引导/安装同属「管理页的可见入口」这一条链，守卫与文档则只记录前三者已经造成的事实。
每个提交单独 `git add` 明确的文件清单。husky 的 lint-staged 在前六个提交里各跑一遍并全过；
`53b6ecb` 与 `5ac5094` 是唯二两次它没匹配到任务的提交——其 glob 是 `*.{ts,vue,js}` / `*.{css,scss,vue}` /
`*.{json,md}`，**不含 `.mjs`**（提交时原话为 `lint-staged could not find any staged files matching configured tasks`），
所以那份量具的格式与检查全靠人工跑（`node --check` + `pnpm exec prettier --write` 与 `--check --no-cache`
单文件，而全仓 `format:check` 覆盖 `.mjs`，本轮红过一次就是它）。

重建后复测首屏集合：sidepanel **34 文件 / 276,658 B**、popup **44 文件 / 292,679 B**，与 §5.1 的字节表逐字节一致；`tests/architecture/sidepanelClosure.test.ts` 17 例全绿，`EAGER_ALLOW_LIST` **无需刷新**——即本轮全部改造（含 `RichText.vue` 这个被两个入口共用的模块）没有给侧边栏或 popup 的 eager 预加载增加任何一个文件。

仍未验证（与 §5.3 同一份清单，不得当成已通过）：Windows 慢磁盘与杀软扫描路径；`sidePanel.open()` 浏览器 UI 侧那一段延迟（量具走内容脚本 `SHOW_SIDEPANEL` 触发路径）；s6 2000 条大库的 >1 s 未解决（干净档就绪 1275 ms / 列表铺满中位 2315 ms / FCP 1728 ms，三条都超，本轮不修也不放宽阈值）。**六场景的 FCP / 首个非白屏帧 / 首屏窗口内 >50 ms 长任务之和已在 §5.3 用有头真机量完并给出读数，不再是未验证项**；折叠态与拖拽的真机视觉核验（仅有 DOM 断言）。

### 10.2 两轴评审回灌（2026-10-01，基线 `447a909`）

评审按规范轴与需求轴并行出报告，每条结论都回到代码 / 构建产物 / 词条复核过一遍才落地。

**成立并已修（5 项）**

1. `GuideView.vue` 的「修改快捷键」按钮是 `link type="primary"`，踩中 Options 全局实心主色背景陷阱：构建产物里 `[data-v-1712090a] .el-button--primary{background:var(--aph-primary)}` 与 EP 的 `.el-button.is-link{background:0 0}` 权重同为 (0,2,0)，而 `options.html` 把 `options-*.css` 排在 `css-ZSOkJyjJ.css` **之后**，全局那条胜出 → 主色文字压在同色背景上不可见。补 `:deep(.el-button--primary.is-link)` 抵消，与 `SiteRulesDialog` / `PasswordHealthDialog` / `IdentityFormDialog` 同一写法；用 `:deep()` 而不是给 `.guide-note__btn` 直接补声明，是因为前者编译后 (0,3,0)，不依赖本组件异步 CSS 与 `options.css` 的先后。
2. `help.gb.15` 宣称「页内『查看完整在线说明』是唯一指向站外的超链接」与实现不符：`GuideView.vue:13-20` 标题旁的版本号也指向 GitHub Releases。中英改为「两处」并列点名。
3. `onboarding.sidepanel.desc` 中文「侧边栏就在这排旁边展开」指代不明（该步刻意无锚点、卡片落在页面中央），且与英文 "docks beside this tab" 不同口径 → 改「就在当前标签页旁边展开」。
4. `options.guide.intro` 中英各一条从未被任何 `t()` 引用（两份 `options.json` 的 377 行）→ 删除，不留死文案。
5. `docs/ARCHITECTURE.{md,en.md}` 的「入口三处」漏计两条页内链接（设主密码页底部、引导末步文档行）→ 补写，并说明它们同属 `#guide` 深链这一类，不改变免认证可达的口径。

**评审提出但证伪（2 项）**

- 「GuideView 八个章节」：`SECTIONS` 与模板里的 `id="guide-sec-*"` 实测都是 7 个，`help.gb.15` 写的「七章」正确。
- 「新增 `manual` 档后要重测排序触发器的 104px 预算」：五档中文最长仍是 4 字（`手动排序` 与既有的 `最近修改` / `创建时间` 同宽），英文 `Manual` 短于既有的 `Category`，按标签构造即可判预算不变，无需再开 headless。

**判断后保留（3 项）**

- `#d6336c` / `#f3f4f6` 在两处非 scoped 块里重复：取值是从 HelpDialog 原先那条（从不命中的）规则里搬来的，不是新造色；两处分属 sidepanel 与 options 两个入口，为一枚 `<code>` 胶囊新增 `--aph-*` 令牌会把只服务富文本的配色推进全局主题层。
- `tests/components/identityCardActions.dom.test.ts` 用 `new Function` 求值模板 `:class` 原文：仓库禁令针对不可信内容，这里的字符串是本仓自己的 SFC 源文件；改成在测试里重写一份判定逻辑，恰恰是这份守卫要防的漂移。
- GuideView 的快捷键一节与 HelpDialog 内容重叠：两处读同一份语言包，重叠在词条层而非代码层，删任一处等于删用户可见内容。

**回灌后的门禁复跑**：`pnpm typecheck` / `pnpm lint` / `pnpm format:check` 全仓均为 0，`pnpm exec stylelint components/options/GuideView.vue --no-cache` 0（`--cache` 会掩盖 recess-order，见项目记忆），`pnpm test:run` 178 文件 / 2126 例全绿（与 §10 同一批数，本轮五条改动全是文案 / 样式 / 文档，没有用例增删），`pnpm build` 与 `pnpm build:firefox` 均 0，chrome zip 732.78 kB → **732.71 kB**（删掉两条死词条、加进一小段 CSS，净额为负）。`tests/architecture/sidepanelClosure.test.ts` 对着重建后的产物复跑 **17 例全绿、0 skip**，`EAGER_ALLOW_LIST` 仍无需刷新。第 1 项的修法在产物层可核对：`.output/chrome-mv3/assets/GuideView-*.css` 里是 `[data-v-…] .el-button--primary.is-link{background-color:#0000;border-color:#0000}`，(0,3,0) 压得住全局那条 (0,2,0)。

### 10.3 link 按钮的真机像素复核（2026-10-01，补 §10.2 第 1 项）

§10.2 第 1 项当时只核到构建产物层——产物里那条规则存在，证明的是「写进去了」，不是「用户看得见」。这一节补像素级证据，量具在 `benchmarks/.artifacts/link-check/`（`verify.mjs` 主测、`aa-mode.mjs` 验残余、`png.mjs` 纯 stdlib 解 PNG，都不进产品代码）：Chrome for Testing 153 无头 + 当前 `.output/chrome-mv3` 打包件（扩展 ID `jpicbhkekckfiihfhbkibjpnfblmjlfd`，由绝对路径 sha256 前 32 位 0–f→a–p 映射而来），打开 `options.html#guide/shortcut`，对按钮矩形**内缩 1 px** 后截图采样。

判据一律取漆出来的像素，不拿 `getComputedStyle` 当结论——computed 只会回吐你写进去的那串，正是这次要防的自证。`scrollIntoView` 会挪版面，所以每次采样前重取矩形并记 `scrollY`（复用旧矩形实测让同一按钮的前景占比从 0.24 跳到 0.45）。

**先给量具装牙（A 道：两个已知终态走同一套采样）**

| 对照组                       | 漆底      | 色桶数 | 前景像素占比 | 最亮/最暗桶对最大对比 |
| ---------------------------- | --------- | ------ | ------------ | --------------------- |
| 主色字压主色底（应判不可见） | `#409eff` | 1      | 0            | 1                     |
| 主色字压白底（应判可见）     | `#ffffff` | 66     | 0.4594       | 2.78                  |

坏那一侧给出 `bucketCount 1 / foregroundShare 0 / maxPairContrast 1`，判据才真的能把「字与底同色」判死；两条都过，下面的读数才算数。

**B/C/D 三道实测（本轮修完的那颗「前往修改」）**

- **C 像素**：漆底 `#f8fbff`（`.guide-view` 的 `var(--aph-surface-2)`）、64 个色桶、前景像素占比 **0.5521**、CSS 声明色对漆底对比 **2.68**、桶间最大对比 2.65。文字确实在画。
- **D 红绿**：把全局那条陷阱规则手动请回来（`background-color:#409eff !important`），同一盒子立刻退化成 **7 个色桶、前景占比 0.0069、最大对比 1**，与 A 道坏对照同形；撤掉注入后连拍与首拍逐字节相同（`aa-mode.mjs` 五张：注入前两张、注入一张、撤掉后两张，`identical_1_2` / `identical_4_5` / `identical_1_4` 全为真），说明注入没改变文字抗锯齿模式、没留残余。该脚本 2026-10-01 复跑一次，五张哈希与首轮逐字节一致（as-built / after-remove 同为 `39bc56f51eaf…`，与磁盘上 `btn-as-built.png`、`btn-after-remove.png` 的 md5 同一串），注入态仍是 `426904a4bb5f…`；读数仍是 `#f8fbff` / 64 桶 / 占比 0.5521 / 最大对比 2.65 与 `#409eff` / 7 桶 / 0.0069 / 1。
- **B 计算样式**：`backgroundColor: rgba(0,0,0,0)`、`color: rgb(64,158,255)`、`borderTopColor: rgba(0,0,0,0)`——级联落定后实心背景确实被抵消掉了。

顺带采了富文本改造后首次生效的 `<code>` 胶囊（GuideView 与侧边栏 HelpDialog 各 38 枚，读数一致）：漆底 `#f3f4f6`、前景占比 0.1257、CSS 色对漆底对比 **4.19**、桶间最大对比 3.44。

**六档换肤下的同一算式**：文字色取各档 `--el-color-primary`，底取各档 `--aph-surface-2`，用 WCAG 2.1 相对亮度公式直接从 `assets/theme/tokens.css` 算（口径可复算：逐档取这两个令牌、sRGB 线性化后 `(L1+0.05)/(L2+0.05)`）。蓝档算出的 2.68 与 C 道真机读数一致，可作这条算式的外校点。

| 档         | 文字 / 底             | 对比 |
| ---------- | --------------------- | ---- |
| 蓝（默认） | `#409eff` / `#f8fbff` | 2.68 |
| 绿         | `#69b599` / `#fafdfc` | 2.37 |
| 粉         | `#d87998` / `#fdf9fb` | 2.83 |
| 紫         | `#ad84cd` / `#fcfafd` | 2.91 |
| 橙         | `#e28e65` / `#fefbf9` | 2.46 |
| 灰蓝       | `#7f92b4` / `#fafbfc` | 3.04 |

**必须如实标注的余留问题**：六档全部低于 WCAG AA 对正文文本的 4.5:1，只有灰蓝勉强过「大字 3:1」那条线，而这颗按钮是 12px、按 AA 只能算正文。再往上提对比度要动的是换肤体系的主色本身，同受影响的不止这一颗按钮（管理页里所有以主色作文字色的元素同一档位同一数值），属独立决策，本轮不擅自改。本轮实际把状态从「同色不可见」推进到「可见但对比偏低」。

### 10.4 秒开计时的量具与订正（2026-10-01，把 §5.3 的「未验证」划掉）

§5.3 原来写的是「六场景的打开耗时在这台机器上量不出来」，本轮用 `benchmarks/measure-sidepanel-open.mjs`（本波新增，已提交为 `53b6ecb`）量出来了，两处口径同时改写到该节。量具走 Chrome for Testing 153.0.8010.52 有头 + `--load-extension`，与 `e2e/` 既有夹具同一个入口（`E2E_EXECUTABLE_PATH`），不新造第二条浏览器启动路径。

写量具的过程中被实测推翻四条初始假设。前两条的判据与读数写在 §5.3 的归因自检段里：`performance.mark()` 在 trace 里落成的事件形状（`ph:'I'` + `e.name`，而不是 `args.data.entryName`）、面板主线程要靠 mark 所在 `tid` 认而不是把同 pid 的所有 `RunTask` 加起来。后两条属量具自身的接线问题，只在此处记形态：`Tracing` 是浏览器级单例（s4 一场开两次面板必须先收尾上一段），`Tracing.dataCollected` 监听器按 `startTrace` 重复注册会让 chunk 翻倍——这两条加上「不筛线程」那条，是此前「占用率 >100%」假象的成因，出现时先怀疑量具而不是被测代码。它们共同构成本节数字可信的前提。

两条不改口径的说明：**干净档与 trace 档分开跑**，前者出耗时、后者出长任务，任何一行不混两档；**AGENTS.md 的性能章节一个字没动**，s6 大库未达标按原样记为未达标，是否入档由用户决定。s6 的 >1 s 与身份库五档、文档中页无关（eager 集合复测 34 文件 / 276,658 B 未变），成本在数据层，本轮不修。
