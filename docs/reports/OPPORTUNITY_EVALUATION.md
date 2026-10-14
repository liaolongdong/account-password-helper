# 四轴机会清单（功能 / 体验 / 动效 / 曝光）— 2026-10-14

> **口径日期** 2026-10-14，代码基线 `feature-dev` 工作树（`package.json` 3.16.0，tag `v3.16.0` 已发）。
> **本文只出方案，不写功能代码。** 按 `AGENTS.md`「必须暂停并询问确认的情况」，凡影响功能、交互、
> 外观、默认值、对外承诺的条目一律标注「需拍板」；未标注的只是我判断可直接做的候选，仍需你点头才开工。
> **不重烧冷饭**：上一轮四轴波次已产出 `FEATURE_CANDIDATES_EVALUATION.md`（C1–C6 与已否决表）、
> `LANDING_MOTION_PROPOSAL.md`（§10 结算表）、`docs/operations/exposure-status.md`（🟡 待决策表）。
> 本文只收两类内容：**本轮新证据支撑的增量**，以及**前置条件已经变化的旧条目**。旧结论若维持，
> 我在文末 §6 逐条写明「沿用、不重开」。

## 0. 本轮取证方式

四路并行调研 + 本人复核。凡是写进本文的缺陷断言，都自己回到文件或行号看过，不采信子智能体的转述。
判据有效性给过正向对照（例如「llms.txt 是否被 HTML 引用」这条，同一把尺子在 `sitemap.xml` 上命中 4 个文件）。

一处诚实边界：Chrome 真机行为（tel-only 登录页的实际命中率、动效对 `blockingMs` 的实际影响、
商店实际服务版本）本轮**没有实测**，见 §7。

---

## 1. 三个 P0：证据最硬、性价比最高

### F-1 手机号 + 短信验证码登录页目前「填不进去」

这条是本轮最意外的发现：**能力写了一半，入口一个没接，判定门还把它挡在外面。**

- 检测侧是有的。`entrypoints/content/formSelectors.ts:88-98` 定义了 `MOBILE_SELECTORS`，主形态就是
  `input[type="tel"]`；`FormDetector.ts:422-430` 会真的把手机号框收进 `mobileFields`。
- 但填充入口的判定门不认它。`FormDetector.ts:1304` 与 `:1415` 的「表单就绪」条件都是
  `usernameFields.length > 0 || passwordFields.length > 0`，`mobileFields` 与 `verifyCodeFields`
  单独存在时**不满足**。而 `USERNAME_SELECTORS`（`formSelectors.ts:7-21`）只覆盖
  `type="text"` / `type="email"` 且名字含 user/account/login/mobile/phone 的输入框，**不含 `type="tel"`**。
  两类选择器的交集只在 `text` 型上，所以一个 `<input type="tel">` 的手机号登录页，按现在的代码就是
  「没有登录表单」。
- 消息类型与 handler 都在，发送方为零。`utils/types.ts:133` 与 `:334` 定义了 `FILL_MOBILE_CODE` 和
  `FillMobileCodeData { mobile, code }`；`FormDetector.ts:1200-1203` 有 case，`:1555-1573` 有
  `fillMobileCode()` 实现。全仓 grep `FILL_MOBILE_CODE` 只有这三处 + 文档，**0 个发送方、0 条测试**。
- 而且实现本身有三处不能就这样上线：`code` 字段收了不用（注释写「验证码需用户手动获取」）；
  `sendResponse({ success: true })` 是无条件返回的，没找到字段也说成功；`FILL_PASSWORD` / `FILL_TOTP`
  都回传结构化 `FillResult`，这一支不回，失败就地引导（`FillFailurePrompt`）接不到。

**为什么值得做**：国内站点的主流登录形态就是手机号 + 短信码，而本扩展所有填充路径（侧边栏 / 内联下拉 /
右键 / 快捷键）都以「有密码框」为隐含前提。这不是锦上添花，是**主流程上的一整块空白**。落地后它同时是
商店文案里一个竞品差异点（「手机号验证码登录页也能一键带出号码」）。

**建议方案（分两步，各自拍板）**

1. **先修判定门，不动填充语义**：把就绪条件从 `username || password` 扩成
   `username || password || (mobile > 0 && verifyCode > 0)`。
   刻意**不允许** `mobile` 单独成立——否则搜索框、注册表单、收货地址页都会被判成登录页并弹出悬浮按钮，
   这是误触发面的主要风险。`FormDetector.ts:951` 已有 `hasUsernameFields && hasVerifyCodeFields && !hasPasswordFields`
   这一形状可以复用，不是新造判据。
2. **再接入口**：侧边栏行操作与内联下拉补「填手机号」，把 `fillMobileCode` 改成回传 `FillResult`，
   失败走既有 `FillFailurePrompt`。条目数据无需新增字段（`username` 存手机号即可），
   **不改存储结构、不改加密格式**，这是它成本可控的关键。

**成本**：中低（一个 content 侧改动 + 两个入口 + 中英文案 + 测试）。
**需拍板**：是。第 1 步会改变「哪些页面出现悬浮按钮」，属用户可见行为。
**验证**：新增 content 单测（tel-only / tel+code / text-mobile 三类页面的判定表）、`FillFailurePrompt`
一条集成用例、e2e 一条真机填充、六场景首屏耗时无回归。

### F-2 按 URL 粒度匹配与保存：唯一「用户在主动要」的功能

- `gh issue list --state open` 实测只有 2 条 open issue，且指向同一件事：#68 要按 `IP:Port` 存与匹配，
  #52 要同域名不同 SPA 路由分别存账号。
- 代码侧明确拒绝：`utils/domain.ts:471` 把 URL 归一到 hostname、忽略路径，端口只在 local-dev 分支生效。
- 已闭 issue 里 #89（600 条新增卡顿）与 #1（邮箱备份）都已实现，不重复。

这是本轮唯一有**外部需求证据**的功能缺口，因此排在第二。但它比 F-1 重：匹配口径是全站公共地基，
消费点必须显式传档位（`resolveMatchTier` 三档口径），改它会牵动判重、跨子域徽章、自动保存、
README / 商店 / `llms.txt` 里「三档」的对外承诺。

**两档路线，我推荐前者**

- (a) **站点规则加可选 `pathPrefix` 字段**：不写字段 = 今天行为，向后兼容；把「粒度」做成 per-site 覆盖
  而不是第四档全局档位。与已落地的「本站填充方式覆盖」同一形态，认知成本最低。
- (b) 全局第四档「按路径匹配」：改动面更大，且要让所有判重口径跟着变，风险不划算。

**需拍板**：是（行为 + 对外承诺）。**做前必读**：两条 issue 正文的完整复现场景本轮没逐字读完。

### F-3 身份信息库「存得下、填不出」，且文档读起来比代码强

- 本轮实测：`identity` 相关符号在 `entrypoints/content/`、`entrypoints/sidepanel/`、`entrypoints/popup/`、
  `utils/fillEntry.ts` 里**零引用**；grep 命中的只有 i18n 文案（`identity.json:65` 讲 CVV「只在必要时填」）。
- 但 `README.md` 的「核心优势 / 横向对比 / 使用场景」把「网页表单要填姓名、证件号、银行卡」列为场景。
  读者会理解成"能自动填表单"，而实现只有存储 + 掩码查看 + 复制。

**这是全仓唯一一处「对外表述强于实际能力」的地方**，必须二选一，不能拖着：

- 路线 A（补能力）：分两档。
  - **最小档**（零 content 改动、一天内）：侧边栏 / 内联下拉增加身份库入口，逐字段一键复制，
    复用既有剪贴板限时清除与机密字段掩码策略。用户从「打开管理页 → 找卡片 → 看明文」四步变一步。
  - **完整档**（需安全评审）：姓名 / 电话 / 地址做表单填充。银行卡与 CVV **明确不进自动填充路径**
    （`identity.form.cvvWarning` 已有的口径要落到实现上）。
- 路线 B（收文案）：把 README / 商店里那句改成「存 + 一键复制」。

**需拍板**：是，且**必须**拍——留白就是留着一条可能被商店审核或用户质疑的过度表述。

---

## 2. 缺陷型清单（属"写错 / 半截 / 静默"，不是新功能）

这几条我建议优先于任何新功能：它们不改产品方向，只是将已经承诺的东西兑现。

- **D-1 `pricing.md:17` 写「Unlimited password entries」，而 `README.md:334` 明确上限 2000 条**。
  定价页是全站意图最强的页面之一，机器可读镜像与自己的 FAQ 互相矛盾。
  `pricing.html` / `pricing.en.html` 已核对**没有**这句，只有 `pricing.md` 错。→ 改 `pricing.md`，可直接做。
- **D-2 `penetrateShadow` 全局默认 `true`，但 UI 里根本没有总闸**。`configManager.ts` 存它、
  `types.ts:437` 定义它、`FormDetector.ts:539/1423` 消费它（还顺带门控填充失败引导气泡），
  而 `SiteRulesDialog.vue` 只有**逐站点规则级**开关，悬浮按钮设置面板没有这一项。
  结果是：用户既关不掉影子 DOM 穿透，也关不掉因此出现的气泡。→ 补开关属新增可见设置项，**需拍板**；
  或先在文档写明「只能逐站点关闭」，后者是纯文案。
- **D-3 收藏是乐观更新，失败不回滚**。`entrypoints/sidepanel/App.vue:699-710` 先 `entry.favorite = true`
  并报「已收藏」，`persistMetadata` 的 `.catch`（`:685-687`）只 `logger.error` + 弹「操作失败」，
  星标停在已翻转态 → 界面与落盘发散，刷新后"复活"。→ 回滚 + 文案区分「没保存成功」，可直接做。
- **D-4 锁定失败全静默**。`composables/useSessionLock.ts:59-61` 的 catch 只记日志。
  用户点「立即锁定」后没有任何反应——这是**安全语义上最不该静默**的一条。→ 可直接做。
- **D-5 身份库手动排序落盘失败只说「本次会话内仍生效」**（`composables/useIdentityVault.ts:401`），
  刷新后顺序悄悄复原。→ 改成可重试提示，可直接做。
- **D-6 英文用户会收到中文报错**。`composables/useSidepanelFill.ts:367-370`：非 `no_form` 分支把
  content 侧 `tl()` 产出的中文 `rawMsg` 直接弹给 UI。违反「所有可见文案中英成对」的项目承诺。→ 可直接做。
  **已做（bf44d0d），但取证时只看到消费侧这一半**：真正的违规面有两处。① 回复侧——
  `entrypoints/background/messageRouter.ts` 另有 **15 条**硬编码中文 `message:`（frame 拒绝、会话锁定、
  缺参数、tabId 取不到等），它们同样会进 UI；② 根因不是「忘了翻」而是**启动竞态**——
  `utils/i18n-lite.ts` 的 `currentLiteLocale` 初值 `zh-CN`，要等 `initLiteI18n()` 里 fire-and-forget 的
  `getStoredLocale()` 才切档，所以 SW 冷启动后第一批回话必然是中文。修法因此是「谁回复谁不再措辞」：
  回复侧全部走 `tl()`，跨上下文的 `FillResult` 只传结构化的 `reason` / `outcome`，文案一律由消费侧
  自己的语言包出。守卫 `tests/architecture/crossContextReplyLanguage.test.ts` 分别钉两端。
- **D-7 `prefers-reduced-motion` 有两族漏网**：`entrypoints/popup/App.vue` 整个文件没有 reduce 块
  （`:668`、`:790` 的 `:active scale(0.99)` 不降级）；`SidepanelHeader.vue:198/318/358` 同形。
  守卫 `tests/architecture/reducedMotionCoverage.test.ts` 只查 hover 与关键帧、**不查 `:active`**，
  所以这是守卫的盲区而不是实现疏漏。→ 补块 + 给守卫加 `:active` 判据，可直接做（属补齐既有约束）。
  **已做（1fea3d9），但落点与预判不同**：加完 `:active` 判据与第三个样式落点后，这三处不是「补减弱档」
  而是**带理由登记进例外表**——位移量都在 1px / 5% 以内，且 `.add-site-plus:active`、`.session-pill:active`
  除了缩放**没有别的按压反馈**，关掉等于让减弱档用户按下去什么都看不见。登记表由 `exceptionProblems`
  自检「仍在赦免违规」，补上兜底后条目不删即变红，所以「故意不写」与「忘了写」不会混成同一种状态。
- **D-8 Options 空态与侧边栏不对称**。`components/options/PasswordTable.vue:7` 的
  `:empty-text="t('common.noData')"` 对「空库」和「筛选后为空」给同一句、没有「清空筛选」出口；
  而侧边栏四态各有 CTA（`SidepanelAuthView.vue:498-565`）。→ 可直接做（纯增引导，不改交互）。
  **前提有误（已按真实形状做，8a92bc3）**：整库为空时父级渲染 `EmptyGuide`，`PasswordTable` 在
  `v-else` 分支上根本不渲染，所以这个空态**只有一种真实形状**——库里有条目、筛选把这一页筛空。
  因此补的是「没有符合条件的条目 + 清空筛选」出口（搜索 / 收藏 / 标签 / 站点四者任一非空即点亮），
  而不是把两句文案分开。
- **D-9 落地页 `#showcase` 的 slides 由 JS 注入**，禁用 JS / 部分 AI 爬虫抓到的是空区块。
  上轮 B1 的 `html.js` 门控只解决了 `.reveal` 隐形，没覆盖这块。→ 首帧静态化（纯 CSS/HTML），可直接做。
- **D-10 JSON-LD 缺 `datePublished`**（`index.html` / `en.html` 实测 `aggregateRating` 与 `datePublished`
  各 0 命中）。`datePublished` 该补。**`aggregateRating` 我建议先不加**，理由见 §5-S-2。
- **D-11 `index.html` 无 `<main>` landmark；`<noscript>` 只兜移动端导航样式、无文字兜底。**
  **半做（49e133d）**：文字兜底已补（body 里紧接页头一条 `<noscript>`，说明哪些区块需要 JS、
  纯文摘要在 `llms.txt`），`<main>` landmark **本轮不动**——它要包住页头之后的全部正文，
  实测代价是 ~2119 行 body 整体重排缩进，`<!-- prettier-ignore -->` 的两处（首帧 slide、
  兜底段）还会被 prettier 抢走排版；收益只有一个 landmark，而页内已有 10 个锚点导航可跳。
  要做就是独立任务，不随任何功能波次夹带。
- **D-12 `llms.txt` 没被任何对外 HTML 引用**。全 `*.html` 扫描只有 `docs/prototypes/landing-motion-lab.html`
  一处（同把尺子在 `sitemap.xml` 上命中 `index` / `en` / `compare` / `compare.en` 四个文件，判据有效）。

> 落地页 / `llms.txt` 仍写 `v3.15.2` 而 `package.json` 与 tag 已到 `3.16.0`——这条**已登记**在
> `exposure-status.md` 2026-10-14 的 🟡 项里，卡在商店 production 审批闸门（商店实际服务版本本地核不到），
> 本文不重开。

---

## 3. 动效：只列「地基」「补齐」「前置条件变了」

上轮 §10 结算表把 A 档 6/9、B 档 4/5 落了，**C 档（扩展内 UI）整体没做**。所以扩展内动效不是空白，
是已经有一份带红线的清单没执行。本文只补三件上轮没写的事：

- **M-0 动效令牌层从来不存在**。`assets/theme/tokens.css` 的 69 个 `--aph-*` 里没有任何 duration/ease
  变量（落地页的 `--dur-*` 是 `index.html:711-720` 私有）。**这是所有扩展内动效的前置**：先建
  `--aph-duration-fast/mid/slow` + `--aph-ease-out`，把散落的 `.2s/.25s/.3s` 与两种 `cubic-bezier` 收敛。
  纯内部、可证行为等价，但要同步 `utils/theme.ts` 的 Shadow DOM 内联令牌集合（`shadowTokenCoverage` 测试强制）。
  **已做（1fea3d9），范围比提案小一半，且是刻意的**：只建三档 duration（取值 = 改动前各处的实际字面值
  0.15s / 0.2s / 0.3s，因此换令牌本身零视觉变化），**`--aph-ease-out` 不建**——本轮没有需要收敛缓动的落点，
  先建再找消费者就是造注释。`SHADOW_NEUTRAL_TOKENS` **故意不镜像**：内容脚本的影子样式继续写字面时长，
  否则整条动效链被拖进跨上下文同步面（`shadowTokenCoverage` 也因此无需改）。新增守卫
  `tests/architecture/motionTokenWiring.test.ts` 守的是「令牌名写错时整条 transition 当场作废且浏览器不报错」
  这一条唯一的静默失效路径。
- **M-1 `transition: all` 是性能负债，不是风格**。两处热点：
  `entrypoints/content/floatingButtons/styles.ts:304` 的基态全属性过渡（注释自认）、
  `components/options/PasswordTable.vue:620-627` 对**每一行** `transition: all 0.3s` + hover
  `translateY(-2px)` + `box-shadow`。默认每页 100 行时，这条直接压在 `AGENTS.md` 的 `blockingMs < 200ms`
  预算上。**收窄成显式属性列表属性能修复**，但必须先给前后同法对照数据再谈收益（§7）。
  **已做一半，且性能收益未量化**：`PasswordTable.vue` 的每行 `all 0.3s` 换成 `transform / box-shadow /
background-color` 三项（真实动机是正确性的——`all` 会连 `.new-item` 的 `border-bottom` 宽度一起补间，
  新增行那条下划线是「长出来」的），令牌化后写 `var(--aph-duration-slow)`。**没有跑同一方法的 blockingMs
  前后对照**，因此本条不得当作性能结论引用。影子树那侧（`styles.ts:304` 等）与其余 **20 处**
  `transition: all` 按现状保留：它们跑在用户网页的 Shadow DOM 里、每处只挂一两个元素，不在 100 行的
  热路径上，改动换来的收益不足以抵回归风险。
- **M-2 删除一行会横向飞 800px**（`PasswordTable.vue:656`，`translateX(800px)` 1s）。
  这条上轮登记为 C3，判过「不影响交互」；改成 160ms 淡出 + 轻微位移即可，成本极低。
  **已做（1fea3d9），取值与提案不同**：改成 `var(--aph-duration-mid)`（0.2s，不是 160ms——三档里没有这一档，
  为一条动画再造一档不值），位移**直接去掉**而不是「轻微位移」，并补 `forwards`；同时把
  `usePasswordManagement.ts` 的 `DELETE_ANIMATION_MS` 从 1000ms 改成 200ms 与 CSS 对齐——原来定时器比动画
  晚 800ms，行摘除前会有一帧从透明弹回。
- **M-3 内容脚本四缺 reduce 块**（`styles.ts`、`SavePasswordPrompt`、`InlineFillDropdown`、
  `TotpHandoffCapsule`）+ shake 两处（`MasterPasswordVerifyDialog:218`、`PasswordVerifyView:275`）。
  上轮 C2/C4，与 D-7 同源，是整批里最便宜的一族。
  **前提基本不成立**：逐个 `grep -c prefers-reduced-motion` 复核，六处里有五处**早就带着减弱档**
  （`floatingButtons/styles.ts` 1、`SavePasswordPrompt.ts` 2、`InlineFillDropdown.ts` 1、
  `components/options/MasterPasswordVerifyDialog.vue` 1、`components/options/PasswordVerifyView.vue` 1——
  后两个的真实路径也不在本文原写的 `components/common/` 与 `components/sidepanel/` 下，
  `TotpHandoffCapsule.ts` 同理，真身在 `entrypoints/content/inlineDropdown/`）。
  唯一真缺的是胶囊那处 3px 入场上浮，已随本波补上（见 §7 台账 `M-3` 行）。

**新增、上轮没提的两条**

- **M-4 填充 / 复制成功在页面内没有回执**。toolbar badge 已有 `✓ / !`（`quickFillHandler.ts:155-165`），
  但用户眼睛在页面上而不在工具栏。兄弟站有 `confirm-pop`（变绿 + 弹一下）这一语汇，本仓缺。
  红线：只动 transform/opacity；Shadow DOM 内写 keyframes；`AnimationController.ts` 是 setTimeout 假时长
  （不监听 `animationend`），做回执要顺带把「动效与状态解耦」这条改正，否则动效只是装饰层。
- **M-5 扩展图标状态可视化**：全仓 **0 处 `action.setIcon`**，而 `assets/icons/variants/` 已有 5 个矢量变体。
  「工具栏图标一眼看出会话是否锁定」是零新权限、高感知的安全感表达。
  **需拍板**：改可见外观，且要先生成多尺寸产物（`public/icon/` 目前只有静态 16–128）。

**沿用、不复活**：上轮判死的 A3（三档匹配扫描带，撞调性红线）、A8（步骤连线 SVG，与既有错峰重叠）
维持不做。**需拍板才动**：B5 / D12 秒开演示带——它的否决理由「数字要先由 `benchmarks/` 跑出可复现口径」
现在**部分失效**：三段 SLA 口径与六场景计时都已落进 `AGENTS.md`。可以写成「按 1 秒内出界面调优、骨架先行」
这类可核实表述，**但仍禁止裸写 `<1s` 承诺**（跨批次绝对值不采信）。C5 侧边栏列表入场、C6 换肤交叉过渡
直接对抗秒开预算与主题一致性，维持「先方案后实施」。

粒子 / 拖尾 / 开场动画 / 字符翻滚：沿用上轮调性红线，不做。

---

## 4. 可达性（键盘）：三条「纯补齐」

- **A-1 悬浮按钮设置面板是纯鼠标孤岛**。整个 `floatingButtons/` 目录 `tabindex` 命中 0、`keydown` 命中 0，
  `settingsPanelView.ts:695/713/721` 的三个 `div.switch`、`:730` 的 `div.slider`、`:668` 的色板、
  `:703-705` 的填充模式全是非原生控件。它跑在用户的真实网页上，键盘用户完全无法配置。（反例：
  `InlineFillDropdown` 是完整 combobox + `aria-activedescendant` + Esc，`InlineFillDropdown.ts:1311-1315/2079-2103`——同目录两种水准。）
- **A-2 两个「正在输密码时弹出」的界面没有键盘出口**。`SavePasswordPrompt.ts` 与 `FillFailurePrompt.ts`
  均 0 个 `keydown` / Esc、无弹窗 autofocus。用户在登录页输密码的中途被弹窗打断，却只能用鼠标。
- **A-3 侧边栏键盘复制密码被注释搁置**（`entrypoints/sidepanel/App.vue:641`「Ctrl+Shift+C 复制密码 暂不需要」），
  键盘流只能复制用户名。

> A-1 / A-2 已于本波落地，交付形态与两处刻意的不做：A-1 = 控件补 `role` + `tabindex` + Enter/空格/方向键，
> 选中态补 `aria-checked` / `aria-pressed` / `aria-valuenow`，焦点轮廓一律 `:focus-visible`；A-2 = Esc 出口 +
> 摘掉内联 `outline: none`。**autofocus 两条都刻意没做**——它们出现在用户敲密码的中途，抢走焦点会让
> 「填完密码紧接着敲短信验证码」这类流程的按键落空，代价大于读屏少一次播报；该取舍由
> `tests/content/promptKeyboardExit.test.ts` 的 `document.activeElement` 断言钉住。

A-1 / A-2 属「补齐既有约束、不改交互语义」，可放在波次 1；A-3 是新增快捷键，需拍板
（`commands` API 无 `update()`，manifest 命令是静态的，这条要先确认实现路径）。

---

## 5. 曝光 / SEO / 商店转化

### S-1 技术面（本文 §2 的 D-9 – D-12 都归这里）

补 `datePublished`、首帧静态化 showcase、加 `<main>`、noscript 补文字、`llms.txt` 在页脚或
`<head>` 里给一条引用。全部不改设计、不动视觉，成本一小时内。

### S-2 `aggregateRating`：支持但不建议

查证结果要如实说：Google 的[评价摘要文档](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)**把「软件应用」列为支持评分的类型**，
「自利评价」那套限制是针对 `LocalBusiness` / `Organization` 写的。所以加 `aggregateRating` 不违规。
但我仍不建议现在加，三条实际理由：① 同一文档要求「被标记的评分必须在页面上对用户可见」，
现在页面上没有任何评分呈现，标上去等于要求新增一块 UI；② 数据源只有商店那几个真实评分，
`ratingCount` 会长期停在个位数，星级反而削弱可信度；③ 它变成一个**新的漂移源**——本仓已经因为
Users 徽章的取数链（`shields` 只读商店文本节点）吃过一次「节点缺失≠仓库故障」的排查。
等评分数上两位数且页面真的展示评分时再加。

### S-3 商店文案：新增量要等 F-1 落地

- 中文 Name 30/45 的 15 字符留白、英文 Name 42/45 补不满（只剩 3 字符），都是 keyword-stuffing 驳回后
  **刻意**的结果，不改。摘要 131/130（上限 132）已满。
- 英文长说明余量约 2,100 字符（13,870 / 16,000）。F-1（手机号 + 验证码）与 F-3 最小档落地后，
  按「一个卖点只有一个归属小节」回填【功能全览】，**不进摘要**，不新增小节。
- 商店截图本轮核对**已是 2026-10-13 重渲版**（`assets/cws-store/upload/` 28 张、`screen-*.png` 同日 mtime），
  `exposure-status.md` 里「12 张 v2.12.0 旧截图」那条残留风险可以销账。
- Featured 提名文案中英三题齐备，每 6 个月一次的节奏未变。

### S-4 README

- **缺独立 Changelog 节**（只有 `CHANGELOG.md` 链接）。GitHub 流量的人先看首屏再看历史，
  加「最近三个版本要点」是低成本、直接服务停留时长的一条。
- 首屏结构（居中封面带 + 8 徽章 + 指标带 + 动图 + 四 CTA + 12 项目录）、中英 H2 逐行 1:1、
  star 引导语、ToC、Contributing、License 都已具备——**这些不缺，别再提**。
- **社会证明文字段我建议不加**。Users 徽章动态显示（实测现值 131、rating 5/5），
  但把它写成静态正文就成了第 49 个需要跟刷的数字落点，与本仓「数字只采信串行实测」的口径冲突。

### S-5 已治理面（不重开）

`compare.html` / `compare.en.html` 已有 `ItemList` / `FAQPage` / `BreadcrumbList` / `SoftwareApplication`；
博客 12 个 HTML 全部带 JSON-LD；`sitemap.xml` 20 个 loc 逐字核验存在；`robots.txt` 显式放行 11 个 AI 爬虫；
GitHub Topics 20 个、Discussions 已开。hreflang 三件套与 og 双语图齐备。

---

## 6. 明确不重开（已拍板项，列出来是为了别下次再提）

云端 / 跨设备同步、在线泄露检测（HIBP）、常驻占宽的组织形态（左栏 / 树 / 侧抽屉，1276px 列宽地板是硬前置）、
紧急访问 / 遗产继承、「快捷键自动登录」作为对外卖点、Passkey 管理（大版本议题）、
popup 改直开侧边栏、侧边栏行操作图标顺序、站点规则导出加密、`WRAP_KEY` 移进 `storage.session`。

---

## 7. 建议波次

**波次 1｜零行为方向变化，可直接开工**（约一个下午）
D-1 pricing.md 口径 · D-3 收藏回滚 · D-4 锁定失败提示 · D-5 排序落盘提示 · D-6 中英兜底 ·
D-7 + M-3 reduce 块与守卫加 `:active` 判据 · D-8 Options 空态出口 · D-9 showcase 首帧静态 ·
D-10 `datePublished` · D-11 landmark/noscript · D-12 llms.txt 引用 · M-0 动效令牌 · M-1 `transition:all` 收窄 ·
M-2 删除行动效 · A-1 / A-2 键盘补齐 · S-4 README Changelog 节。

> **波次 1 交付台账（2026-10-15，`feature-dev`，8 笔代码/文案提交 + 本报告，均未推）**
>
> | 提交      | 覆盖条目                     | 落点                                                                                                     |
> | --------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
> | `bf44d0d` | D-6                          | 后台 15 条硬编码中文走 `tl()`；`FillResult` 补 `reason` / `outcome`；侧边栏不再透传回复串                |
> | `8a92bc3` | D-3 / D-4 / D-5 / D-8        | 收藏失败回滚 + 专属文案、锁定失败报错、排序落盘失败提示、表格空态「清空筛选」出口                        |
> | `1fea3d9` | M-0 / M-1 / M-2 / D-7        | 三档时长令牌、删除动画时序对齐 200ms、`transition: all` 显式化、reduce 守卫加 `:active` 与第三个样式落点 |
> | `0c922bf` | A-1 / A-2                    | 设置面板与两个弹窗的键盘可达（`role` / `tabindex` / 键盘操作 / ARIA / `:focus-visible` / Esc）           |
> | `49e133d` | D-9 / D-10 / D-11(半) / D-12 | 首帧写进服务字节、`datePublished`、`<noscript>` 文字兜底、`llms.txt` 入口                                |
> | `85aa12c` | D-1                          | `pricing.md` 免费档口径按代码重写                                                                        |
> | `1d31699` | S-4                          | README 中英「更新日志」小节 + 目录锚点 + 日期戳                                                          |
> | `ca1f50a` | M-3                          | `TotpHandoffCapsule.ts` 的 3px 入场上浮补减弱档                                                          |
>
> M-3 的六处里五处本已带减弱档（见 §3 M-3 的复核结果），唯一缺的那处即 `ca1f50a`。
>
> **验证口径**（都在含 `ca1f50a` 的这棵树上跑的）：`pnpm typecheck` / `pnpm lint` /
> `pnpm exec stylelint "**/*.{vue,css,scss}" --no-cache` 全 rc=0；
> `pnpm exec vitest run --no-file-parallelism` 串行 **224 文件 / 2947 例 / 0 跳过 / 138.09s**，rc=0；
> `pnpm build`（`.output/account-password-helper-3.16.0-chrome.zip` 770,602 B）与
> `pnpm build:firefox`（`.output/firefox-mv2/` 202 文件）均成功，产物目录两侧同为 202 文件。
> 对外测试数（219 文件 / 2888 例的 48 处落点）**刻意未随本波刷新**——按既定政策它跟在整个批准范围
> （含波次 2）末尾一次性对齐，避免「分支上数对了、合并后又不算」的反复。
> 未做：M-1 的 `blockingMs` 前后对照（见 §9），A-1 / A-2 的真浏览器键盘走查（jsdom 层已钉，
> 焦点环的实际绘制与影子树内 Tab 序列未在真 Chrome 里走过）。

**波次 2｜需你逐条点头**
F-1（含就绪门）· F-3 最小档 · D-2 总闸 · M-4 页面内回执 · M-5 图标状态 ·
B5 秒开带的表述形态 · A-3 复制密码快捷键 · F-3 路线 A/B 的选择。

**波次 3｜设计稿先行，不在实现范围**
F-2 URL 粒度匹配 · 上轮 C1 生物识别解锁与 C2 恢复码（维持「先安全设计后实现」）。

---

## 8. 待你回答的决策点（2026-10-15 已全部拍板）

1. **F-3 走 A（补能力）还是 B（收文案）？** → **走 A**，「做，推荐最优的实现方案」。
2. **F-1 的就绪门是否接受「mobile + verifyCode 同时存在才成立」？** → **做**，并追问「这个没有实现吗？」
   （答：`FillResult` 一侧确实没有——本轮已把 `reason` / `outcome` 结构化，就绪门接在其上）。
3. **F-2 是否要按路线 (a) 做 per-site 路径覆盖？** → **做 (a)**，前置条件：先读完 #68 / #52 正文。
4. **D-2 是补总闸开关，还是只在文档写明「只能逐站点关」？** → **补总闸开关**。
5. **M-5 图标状态与 B5 秒开带，这两处对外可见的改动做不做？** → **都做**；B5 仍禁止裸写 `<1s` 承诺。
6. **波次 1 是否现在就开工？** → **开工**；§2 缺陷清单与 §3 动效「按照你推荐的最优方案」。

---

## 9. 未验证项（不作为结论使用）

- tel-only 页面在真实站点上的选择器命中率未抽样——F-1 落地前应先抽 3–5 个目标站验 `detectForms`。
- M-1 收窄 `transition: all` 能否真的降低 `blockingMs` 未实测；要做就前后同法对照，不写主观感受。
  本波只做了「不再补间无关属性」的正确性收窄，**性能收益未量化，不得对外引用**。
- A-1 / A-2 的键盘路径全部由 jsdom 层守卫钉住（可聚焦 / 可操作 / 可感知 / 有出口），
  **真 Chrome 里的 Tab 序列与焦点环绘制没有走过**：影子树内的 tab 顺序、`outline-offset` 在
  宿主页面深浅底色上的实际可见性、以及 Esc 兜底在真实登录页与页面自身 Esc 语义之间的抢序，
  都需要一次手工走查。
- `#showcase` 首帧已用「摘掉页内全部 6 个 `script` 的副本 + headless Chrome 截图」验过渲染
  （图、STEP 01、标题、描述完整出现，不是空区块）；但 `<noscript>` 那条文字兜底**没有**用同法验过
  ——摘脚本不等于「脚本被禁用」，`<noscript>` 子节点在 JS 开启时不入渲染树，只有服务字节级守卫
  （逐字比对字典）覆盖它。
- 商店实际服务的版本本地核不到（受 `environment: production` 审批闸门约束）。
- 本文行号取自 2026-10-14 的那次读取；波次 1 已落 8 笔提交，行号会随之后移，续做波次 2 前
  按 `git log` 重新对一遍再引用。

Sources:

- [评价摘要（Review、AggregateRating）结构化数据 | Google 搜索中心](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
- [如何添加结构化数据：商品摘要](https://developers.google.cn/search/docs/appearance/structured-data/product-snippet?authuser=0&hl=zh-tw)
