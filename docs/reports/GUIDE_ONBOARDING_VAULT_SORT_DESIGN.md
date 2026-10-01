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

### 5.3 无头计时

场景矩阵：会话有效 / 会话失效或未验证 / 扩展冷启动（SW 未起）/ 快速重启（保活中）/ 引导播放期间打开侧边栏 / 2000 条大库。指标取 FCP、首个非白屏帧、首屏窗口内 >50 ms 长任务之和。真机路径按既有结论：stable 已废 `--load-extension`、MCP 浏览器带 `--disable-extensions`，需克隆 profile + `--app` + 手动开开发者模式。

两条口径边界必须写进交付说明，不得含糊：`sidePanel.open()` 的浏览器 UI 侧冷启动延迟无头量不到（`e2e/harness.ts:322` 已记录 Playwright 点不到工具栏，自动化只能走内容脚本 `SHOW_SIDEPANEL`）；Windows 慢磁盘与杀软扫描在这台 Mac 上实测不了，只能用「全量预热 + 常驻保活」的静态断言加现有 e2e 覆盖代替，标为未验证。

AGENTS.md 对侧边栏只有「<1 s、无白屏」一句，没有三段数值阈值表。实测数据交用户决定是否入档，实现阶段不擅自修改 AGENTS.md 的性能章节。

**实测（2026-10-01）**：六场景的打开耗时在这台机器上量不出来，三条路都堵着——本机 Playwright 缺 chromium 二进制（装它要解压官方 zip）、chrome-devtools MCP 的浏览器带 `--disable-extensions`、stable Chrome 已废 `--load-extension`。因此这一档换成两条本机跑得动的量：

| 量                                                   | 结果                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 首屏 eager 资源集合是否因本轮变厚                    | 否。34 文件 / 276,658 B，清单内没有本轮任何新增模块名（已固化为 §5.2 第 2 条守卫）                 |
| HelpDialog 的 `v-html` → `parseRichText` 纯 CPU 成本 | 中英各 81 条、合计 162 条全量解析 **0.60 ms**（均值，±2.41% rme，840 样本）；单语言 81 条 ≈0.30 ms |

第二行取的是 `parseRichText` 的纯字符串成本（`vitest bench`，jsdom），与 DOM 后端无关，可直接外推到浏览器；**挂载环节的读数刻意不采信**——量具里每条都要 `createApp()` 起一个独立 app 根，而真实的 `RichText.vue` 是 HelpDialog 里的子组件，两者不可比。产出的 DOM 节点数与 `v-html` 完全一致（同一批 `<b>` / `<code>`），不新增布局成本；帮助弹窗一次只渲染一个分组（最多 15 条），按单条 3.7 µs 折算约 0.06 ms。

仍未验证并如实标注：六场景的 FCP / 首个非白屏帧 / 首屏窗口内 >50 ms 长任务之和；Windows 慢磁盘与杀软扫描路径。

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
- `pnpm test:run` → **178 文件 / 2126 例全绿**，Duration 353.21s（基线 2045/173，本轮 +81 例 / +5 文件，全部来自新增守卫：`richText` ×2、`identityCardActions`、`identityCrud.manualOrder`、`installOpensOptionsPage`，以及 §5.2 扩写的 `sidepanelClosure`）。对外长文档仍写 2041/172，属决策 10 的「发布前统一刷」，本轮刻意不动。
- `pnpm build` → 0，58.5 s，Σ 2.07 MB / zip 732.78 kB；`pnpm build:firefox` → 0，29.0 s。
- `pnpm exec prettier --check` 对本次改动的 md / json / ts 全部通过。其中 `docs/README.md` 的 `reports/` 行改为通配枚举（`PERF_*`、`*_EVALUATION.md`、`*_DESIGN.md`），这样新报告不再需要改文档地图；该行显示宽度小于同列最大值，因此 prettier 只按列宽重新对齐两张表的中缝，未改动其它单元格文本。

重建后复测首屏集合：sidepanel **34 文件 / 276,658 B**、popup **44 文件 / 292,679 B**，与 §5.1 的字节表逐字节一致；`tests/architecture/sidepanelClosure.test.ts` 17 例全绿，`EAGER_ALLOW_LIST` **无需刷新**——即本轮全部改造（含 `RichText.vue` 这个被两个入口共用的模块）没有给侧边栏或 popup 的 eager 预加载增加任何一个文件。

仍未验证（与 §5.3 同一份清单，不得当成已通过）：六场景的无头耗时（本机 Playwright chromium 缺位、MCP 浏览器带 `--disable-extensions`、stable Chrome 已废 `--load-extension`，`sidePanel.open()` 的浏览器 UI 侧冷启动延迟本就无头量不到）；Windows 慢磁盘与杀软扫描路径；折叠态与拖拽的真机视觉核验（仅有 DOM 断言）。
