# 使用指引页返回按钮与导航阅读体验改造设计（2026-10-01）

> 起点是用户的一张截图：Options「使用指引」文档中页（`#guide`），红框圈住吸顶条左端的
> 「返回密码管理」按钮，并指出按钮右侧到导航之间那条空带；诉求写的是「这里的返回按钮是不是
> 可以再优化一下，还有使用指引页面」。范围经追问定为「大：再加导航与阅读体验」六项。
>
> 本文只覆盖这一轮；上一轮（文档中页首建、身份库五档、引导第九步）的记录在
> `docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md`，本轮对它 §10.2 第 1 项与 §10.3
> 的余留问题有订正，见文末「对上一轮记录的订正」。

## 1. 先定位，再谈观感：那条空带是真的布局缺陷

把用户看到的「空白」当成审美问题就会改错。构建产物里这几行是事实来源
（`.output/chrome-mv3/assets/GuideView-*.css`，改造前）：

```css
.guide-bar {
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  position: sticky;
  top: 0;
}
.guide-layout {
  align-items: flex-start;
  gap: 28px;
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 24px 56px;
}
```

条带内容按视口全宽铺开，正文列却限宽 1080px 居中。1430 CSS px 的窗口下
`(1430 − 1080) / 2 = 175`，返回按钮贴在视口左缘（x=24），下方的目录在居中列里（x=199），
两者左边缘差 175px——截图里那条「纯 gutter」不是留白审美问题，是基准线不统一。

同一轮还查出四处：

| 现象               | 根因                                                               |
| ------------------ | ------------------------------------------------------------------ |
| 目录高亮往下滚不动 | 高亮只读 `props.section`，等于只有点击才亮，滚动不跟随             |
| FAQ 段没有落点     | 正文里 FAQ 有四个 `h3` 子组，目录只到 `faq` 一级，跳进去还要自己找 |
| 魔法值散落         | `1080px` 出现在 2 处、`68px` 出现在 3 处，条带一改高就全体错位     |
| 一行约 65 个中文字 | 正文列 854px / 13px 字号，中文可读行宽上限约 40～55 字             |

## 2. 六项改动

| #   | 改动                                                                                                                                                    | 为什么这样改                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 条带内容收进与正文同一根基准线：新增 `.guide-bar__inner`，与 `.guide-layout` 共享 `max-width: var(--guide-measure)` 并各自 24px 侧边距                  | 条带背景与下边框仍全宽（视觉上仍是通栏），只有内容对齐；两列同基准后 175px 空洞消失                                                                                                         |
| 2   | 返回按钮改为手写 ghost 胶囊（`--aph-surface` 底 + `--aph-text-secondary` 描边 + `ArrowLeft` 图标 + `aria-keyshortcuts="Esc"`），右侧加 `<kbd>Esc</kbd>` | EP 默认白底细边按钮压在 `surface-2` 上几乎无对比，而它是这层全屏遮罩唯一的出口；键帽把「Esc 可退出」这个已存在但不可见的行为显形。描边不吃 `surface-line`（对条带仅 1.10～1.13），口径见 §5 |
| 3   | 目录改成跟随滚动的高亮：`utils/guideNav.ts` 出数据与纯函数 `pickActiveId`，组件用 rAF 节流的 scroll 监听 + 吸顶条实测高度当折线                         | 数据与判定纯函数化才能被单测钉住（jsdom 无布局，量不出真实 top）；折线取实测高度，不复制 CSS 里的常量                                                                                       |
| 4   | 目录给 FAQ 补四个子项（`faq-s/b/d/c`），正文对应四个 `h3` 锚点                                                                                          | 层级用「缩进 + 小一号字」表达，文案复用 `help.group*`，不另拟一套名字                                                                                                                       |
| 5   | 阅读宽度与字号：`--guide-measure: 940px` → 正文列 696px、14px/1.8；`scroll-padding-top` 取代逐章节 `scroll-margin-top`                                  | 696px 在 14px 下约 49 个中文字一行（改前 854px/13px ≈ 65 字）；再窄会切坏快捷键行与列表缩进，故止步于此                                                                                     |
| 6   | 页内主色文字全部退到中性文本色：「修改快捷键」由 `el-button link type="primary"` 换成与返回按钮同一套 ghost 形态；版本号、目录点亮态、文末链接同批      | 主色作文字色在六档主题下 2.37～3.04，低于 AA 正文 4.5:1；不动换肤体系的主色，只把这一页的文字色换成中性色即可达标                                                                           |

项 6 顺带把上一轮记在 §10.3 的「余留问题」在本页关掉了：不再需要为 `link type="primary"`
保留 `:deep(.el-button--primary.is-link)` 那段抵消，该 `:deep` 块随本次改造删除。

**一处用户可见的删除要单独点名**：文末原本还有一颗 `el-button`「返回密码管理」，本波起不再重复
——吸顶条常驻可见（滚动时它就在顶上），`Esc` 也能退出并另有键帽显形，文末那颗是同一动作的第二份
落点。删掉后 `.guide-footer` 只剩「查看完整在线说明」一条链接。这是**交互出口数量**的变化，
不是纯样式改动，因此写在这里而不是藏在 diff 里。

## 3. 导航数据与守卫链

`utils/guideNav.ts` 导出三组东西：

- `GUIDE_SECTIONS`：七个一级章节，FAQ 带四个 children，label 全部走 `labelKey` 间接寻址
  （复用 `help.group*` / `help.shortcutTitle` / `help.faqTitle` 与 `options.guide.sectionProduct`）；
- `GUIDE_ANCHORS`：把两层摊平成滚动跟随用的 11 个锚点；
- `pickActiveId(anchors, foldY, atBottom)`：纯函数，取最后一个已越过折线的锚点，
  滚到底时强制点亮最后一个（否则末章因剩余滚动距离不足而点不亮），空数组返回 `''`；
- `guideFoldY(barHeight)` 与 `GUIDE_FOLD_SLACK` / `GUIDE_FOLD_TOLERANCE`：折线算式收到一处，
  好让「折线必须严格低于点击落点」这条不变量能被单测钉住（真机翻车过程见 §6 缺陷 3）。

守卫是 `tests/utils/guideNav.test.ts` 的 10 例，其中一条是这轮的关键：

```ts
expect(bodyAnchorIds()).toEqual(GUIDE_ANCHORS.map(anchor => anchor.id));
```

`bodyAnchorIds()` 用正则从 `GuideView.vue` 源码里抓 `id="guide-sec-*"` 的**出现顺序**。
目录顺序必须等于正文滚动顺序——否则「往下滚高亮往上跳」这种错不会被任何功能测试抓到。
另外 9 例覆盖一级/子级 id 集合、`pickActiveId` 的五种边界（越过、恰好等于折线、未越过回退到首章、
`atBottom`、空输入），以及折线配对三条：`guideFoldY(55) > 55 + GUIDE_FOLD_SLACK`（把容差改回 0 即红）、
CSS 里 `--guide-fold-slack: 12px` + `scroll-padding-top: calc(var(--guide-bar-h) + var(--guide-fold-slack))`
两行原文、`--guide-bar-h: 55px` 与本用例所用条高同值——JS 常量与 CSS 值分家正是这轮踩到的坑。

`labelKey` 字面量搬进 `utils/guideNav.ts` 后，i18n 依赖图必须一起登记，否则那七个章节 label
从此不再被校验：`tests/utils/i18nBundles.test.ts` 的 `GUIDE_GRAPH_FILES` 增加
`'utils/guideNav.ts'`，该文件的字面量由 `extractI18nKeys` 的第二种形态（`labelKey: '…'`）认领。
口径要说准：`HELP_ITEM_SOURCES` 是另一条守卫（逐文件比对 `helpItems(prefix, N)` 的分组计数），
成员仍是 `HelpDialog.vue` 与 `GuideView.vue` 两个组件，**不含** `utils/guideNav.ts`——
那里没有 `helpItems` 调用，把它塞进那份清单只会让扫描器读一个不该读的文件。

## 4. 滚动跟随的实现取舍

| 点             | 做法                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 折线在哪       | `guideFoldY(barRef 实测高度)` = 条高 + `GUIDE_FOLD_SLACK(12)` + `GUIDE_FOLD_TOLERANCE(1)`；CSS 侧 `scroll-padding-top: calc(var(--guide-bar-h) + var(--guide-fold-slack))` 取同一档，两处由 `guideNav.test.ts` 钉住（1px 容差是必需的，理由见 §6 缺陷 3）                    |
| 事件频率       | `passive: true` 监听 + `requestAnimationFrame` 节流（同一帧多次 scroll 只量一次），卸载时 `cancelAnimationFrame`                                                                                                                                                             |
| 点击导航       | `goToSection` 立即置高亮并开 `SCROLL_SUPPRESS_MS = 900` 抑制窗口，避免平滑滚动途经中间章节时高亮被跟随逻辑一路带走                                                                                                                                                           |
| 浏览器前进后退 | 导航项是原生 `<a href="#guide/…">`，跳转交给浏览器，父级 `hashchange` 回传 `section`，组件只 `watch` props；前进/后退因此天然可用，无需自己维护历史                                                                                                                          |
| 未锚定时       | `activeId` 初值取 `props.section ?? GUIDE_SECTIONS[0].id`，`onMounted` 再量一次，首屏不会「目录一个都不亮」                                                                                                                                                                  |
| 祖先是否同亮   | **否决**：滚到 FAQ 子组时不把父项 `faq` 一起点亮。`pickActiveId` 返回单个 id，点亮态是「一处」而不是「一条链」，代价是父项在子组滚动期间不亮；换来的是判定纯函数化、`is-active` 只有一处、不需要在组件里再做一次父子归并。目录层级已由缩进与字号表达，父项的位置感不依赖点亮 |

## 5. 对比度：算式与逐元素读数

中性文字色全主题一致、品牌色逐档覆盖（`assets/theme/tokens.css` 头部注释即为此约定），
因此「元素 → 前景令牌 / 背景令牌」这张表一旦钉住，六档数字就能复算。口径：sRGB 线性化后
`(L1 + 0.05) / (L2 + 0.05)`，阈值取 AA 正文 4.5:1、大字 3:1、非文本控件边界 3:1（1.4.11）。
量具为第 6 节的真机级联读数（纯令牌算式 `contrast.mjs` 只作预筛，已弃用），
21 项 × 6 档共 **126 行**：判定项 **15 项 × 6 = 90 行全部过线**，区间 **4.63～14.34**；
其余 36 行是装饰性底色 / 描边（只报数，理由见下方余留项 1、2）。
**采样前提**：每档换肤后等底色 / 描边 / 文字三个读数连续两次相同才取值（实测非首档需要 253～264 ms，
理由见 §6 量具第 4 条）——同批元素在「落定」前后差 ≤0.06，不影响任何一条判据，但差值本身要记账。

位移一览（「六档区间」= 该元素在 sky/green/pink/mauve/orange/slate 下的最小～最大值）：

| 元素                                         | 改前（漆色对漆色）                                                                        | 改后                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 返回按钮文字                                 | EP 默认白底细边，用户截图可见「与条带几乎融为一体」                                       | `--aph-text-primary` 对 `--aph-surface` **12.78～13.45**                                                                    |
| 三枚胶囊描边（返回 / 在线说明 / 修改快捷键） | `--aph-surface-line` 对条带 1.10～1.13，悬浮换 `--aph-primary-border` 反而洗到 1.12～1.19 | 静止 `--aph-text-secondary` **4.63～4.72**、悬浮加深到 `--aph-text-primary`，边界常驻                                       |
| 在线说明文字（条带 / 文末）                  | `--aph-primary` 对 `surface-2` = 2.37～3.04                                               | 条带胶囊 `--aph-text-primary` 对 surface **12.78～13.45**；文末 `--aph-text-secondary` 对 surface-2 **4.63～4.72** + 下划线 |
| 目录链接静止 / 点亮                          | 静止 4.66 一档不变；点亮 `--aph-primary` 对 `bg-hover` = 2.14～2.78                       | 点亮改 `--aph-text-primary` 对 `--aph-primary-bg` **13.19～13.74**                                                          |
| 版本号                                       | `--aph-text-muted` 对 `surface-2` = 2.43～2.48                                            | `--aph-text-secondary` **4.63～4.72**                                                                                       |
| 快捷键「未分配」提示                         | `--aph-text-muted` = 2.43～2.48                                                           | `--aph-text-secondary` **4.63～4.72**                                                                                       |
| `<code>` 胶囊                                | `#d6336c` 对 `#f3f4f6` = 4.19                                                             | `#c2255c`（同色系深一档）= **5.14**                                                                                         |

悬浮态刻意**不让文字吃主色**：`--aph-primary` 对 `--aph-primary-bg` 只有 2.53，比静止态更差，
所以悬浮只动底色与描边，主色交给图标承担（图标旁有文字标签，不承担唯一信息）。
描边在悬浮时**加深**到 `--aph-text-primary`，不再走 `--aph-primary-border`——后者对条带 1.12～1.19，
等于「手一碰就把边界洗掉」。

三条必须如实标注的余留项：

1. **胶囊底色对条带背景 1.07～1.11**（`--aph-surface` vs `--aph-surface-2`）：底色本身确实只是淡着色。
   把 tokens.css 里全部 8 个浅色填充候选（`surface` / `surface-line` / `surface-hover` /
   `primary-bg` / `primary-bg-hover` / `bg-zebra` / `bg-hover` / `border-light`）对 `surface-2`
   逐档算一遍，区间只有 **1.01～1.13**——换肤体系里没有中间调。
   「能不能被认成一个可点区域」这件事因此由**描边**承担：静止态 `--aph-text-secondary` 对条带实测
   **4.63～4.72**（三枚胶囊同一数值，六档全过 1.4.11 的 3:1）。此前担心的「等于常驻焦点环」实测不成立——
   1px 实线中性描边就是表单控件的常规边界，而焦点另有 `:focus-visible` 的 2px 主色外环表达，两者不打架。
2. **两处主色左规够不到 3:1**（真机漆面读数，此前按 `--aph-primary` 对 `surface-2` 估的 2.37～3.04 偏高）：
   目录点亮项左规 **2.27～2.88**、警示条左规 **2.22～2.80**（逐档：2.49 / 2.22 / 2.57 / 2.63 / 2.26 / 2.80，
   最大落在灰蓝而非紫——初稿写的 2.63 是把紫当成了上限）。两枚左规的**来历不同**，别混为一谈：
   目录那条 `border-left` 在 HEAD 就有（本轮只是将点亮色由主色文字换成左规 + 浅底 + 加粗），
   警示条那条 3px 主色左规是**本波新加的**（HEAD 的 `.guide-warn` 只有底色与圆角、没有左规）。
   两者都属装饰：点亮项另有 `font-weight: 600` 与主色浅底，警示条另有整段底色变化与文字，
   因此不违反「不仅用颜色表达状态」。要把左规本身拉过 3:1，
   只能给六档主题各配一支**加深**的主色变体（tokens.css 现在只有 `--aph-primary` 与更浅的 `-hover` 两个方向），
   属换肤体系的横切改动、影响所有页面，超出本轮「文档中页」范围，故只报数不改。
3. **两处与侧边栏 `HelpDialog` 的同名元素出现了色差**：`<code>` 胶囊（HelpDialog 仍 4.19）与
   `.help-shortcut-warn`（仍 `--aph-text-muted`）。本轮范围是文档中页，改动 HelpDialog 属另一页
   的视觉变化，按规则需单独确认，故此处只记录不顺手改。

## 6. 真机验证

量具 `benchmarks/.artifacts/guide-ux/verify.mjs`（本地、不入库）：Playwright 1.63.0 +
**Chrome for Testing 152.0.7977.75**。本机 `pnpm exec playwright install chromium` 在 macOS 13/x64
被拒；自己下 mac-x64 官方 zip 时 `curl` 在 87.5 MB / 202 MB 处超时截断（zip 已删），
最后**只读借用**兄弟仓 `cross-origin-proxy/.test-tmp/chrome-mac-x64/` 里的同名二进制，
经 `E2E_EXECUTABLE_PATH` 注入。`launchPersistentContext` + `--load-extension=.output/chrome-mv3`，
与 `e2e/` 既有夹具同一入口口径，扩展 ID 由绝对路径 sha256 前 32 位 0–f→a–p 映射
（`jpicbhkekckfiihfhbkibjpnfblmjlfd`）。

三道判据与落定读数：

- **A 几何**：1430×900 与 800×900 两档各量返回按钮左边缘、条带内容列左边缘、目录左边缘。
  读数：两档都是「条带内容列与布局列同左（245 / 0），按钮与目录再各进 24px 内边距到同一根线上
  （269 / 24）」；条带实高 **55px**（已回灌 `--guide-bar-h`，此前 CSS 声明 68px、实画 53px 两头都错）；
  正文列 **696px @14px ≈ 49.7 字/行**（窄档 752px ≈ 53.7 字）；
  `overflowX`（`scrollWidth − clientWidth`）在 `.guide-view` 与 `.guide-layout` 两道上**都为 0**；
  返回按钮命中测试 `backHit=true`（`elementFromPoint` 落在按钮自身）。
- **B 高亮跟随**：真实鼠标点击三个导航项，断言该链接点亮、`location.hash` 更新、目标章节落在吸顶条下沿之外
  （三处 `headingTop` 66.5～67.3、`barBottom` 55、`belowBar` 全 true）。
  程序化滚到 `faq-b` 正文中央 → 点亮 `#guide/faq-b`；滚到底 → 点亮末项 `#guide/faq-c`；
  Esc → `.guide-view` 消失且 `.options-page` 回来。落点后现在**硬断言**「点到的那节就是亮着的那节」，
  不再只记录布尔值（原因见下方第 3 条缺陷）。
- **C 对比度**：真实级联落定后逐元素读漆面值，前景按 `color` / `background` / `border` 三种取法，
  背景按「从**父级**往上找第一个 alpha>0 的祖先」计算，六档各 21 项、共 126 行；
  判定项 90 行全部过线（4.63～14.34），36 行装饰项按第 5 节口径只报数。
  判具自检把「主色字压主色底」喂进同一套算式，必须给出 1.00（实测 `badPair=1`、
  `sameColorAsPainted=true`），否则整份读数作废。

量具自己会静默说谎的四处，都是先修量具、才敢信它报的数：

1. 描边 / 底色行原先从**元素自身**往上找背景，等于拿描边和自己的底比 → 六档恒报 1.00～1.11 的假数。
   加 `bgFrom: 'parent'` 后才是「胶囊边界 vs 它所坐的条带」这一真实问题。
2. 命中测试坐标取自元素变量而非 `rect()` 返回值 → `elementFromPoint` 收到非有限数直接崩。
3. 第一轮 `overflowX` 探针根本不存在，横向溢出是靠截图看出「800px 窗口里内容宽 848」才补的判据。
4. **换肤后 `sleep(120)` 就采样**：这三枚胶囊自己声明了 `transition: background-color/border-color .2s`
   （目录链接与版本号同理），改 `data-theme` 会让变量整体换值、底色用 200 ms 插值过去，
   120 ms 恰好取在半程。证据是漆面值对不上令牌——green 档 `--aph-surface` 是 `#eef7f4`，
   旧报告读出的却是 `rgb(238,247,245)`，且新读数为 `rgb(236,246,247)`，
   后者正是 sky `#e8f4fd` → green 的 2/3 处。改成「底色/描边/文字连续两次读数相同才落定」后，
   各轮实测首档 68～72 ms、其余五档 253～264 ms 落定（轮询步长 60 ms，跨轮只差几毫秒，别当阈值读）；
   126 行里 26 行随之变动，幅度 ≤0.06，
   判定结论一条没变（区间仍 4.63～14.34）。**首档不会翻车、后五档才会**，这类偏差最容易漏。
   修完连跑两次做确定性自检：`geometry` / `navClicks` / `scrollFollow` / `atBottom` / `keyboardEsc`
   与 126 行对比度**逐字段完全相同**——这条判据不成立时，上面所有读数都不能采信。

真机像素揪出的三个缺陷（都不是看代码能看出来的）：

| #   | 症状                                                                                                                           | 根因                                                                                                                                                                                                                | 修法                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 800px 窗口 `.guide-layout` 实测宽 848，横溢 48px                                                                               | 缺省 `content-box` 下 `width:100%` + 左右 24px 内边距 = 总宽恒比视口多 48                                                                                                                                           | `.guide-bar__inner`、`.guide-layout` 改 `box-sizing: border-box`，让 940 就是那根 940                                                                                                                                                                                                                       |
| 2   | 导航 sticky 偏移与 `scroll-margin-top` 写死 68px，而真机量到条带只有 53px（HEAD 口径：10px×2 内边距 + 32px 行高 + 1px 下边框） | 两处 68 是与内容无关的估值，条带内容一变就整体失准                                                                                                                                                                  | 折线改读**实测**条高；CSS 声明收成 `--guide-bar-h: 55px` 单点（本波加了 32px 胶囊与 Esc 键帽，行高变 34 → 20+34+1=55，与真机一致），12px 余量另收进 `--guide-fold-slack` 与 JS 常量配对                                                                                                                     |
| 3   | 点 `#guide/faq-d` 后高亮停在**上一节**（`faq-b`），三处点击里只有这处翻车                                                      | 折线 = 条高 + 12 与 `scroll-padding-top` 是同一个数，落点带亚像素抖动（67.1 > 67）被严格 `<=` 判成「没越过」；抑制窗口 900ms 到期后，最后一发 `scroll` 事件把高亮抢了回去——翻不翻车取决于平滑滚动耗时，属于靠运气绿 | 折线加 1px 容差（`GUIDE_FOLD_TOLERANCE`），并把折线算式收进 `guideFoldY()` 由测试钉住。红绿证据：把容差改回 0 → `expected 67 to be greater than 67` 单测红、真机 `faq-d.isActive=false`；恢复容差 → guideNav 套件全绿（那次对拍时 9 例、补齐 `--guide-bar-h` 配对后 10 例）、真机三处点击全 `isActive=true` |

产物：`benchmarks/.artifacts/guide-ux/report.json` 与五张截图（宽档全页、条带特写、宽档滚动中、
窄档全页、窄档目录特写）。

## 7. 门禁与产物

静态门禁按 AGENTS.md 矩阵**全量**重跑（不是只对改动文件跑），产物侧对重建后的 `.output` 复跑闭包守卫：

| 门禁     | 命令                                                        | 读数                                                                                |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 类型     | `pnpm typecheck`                                            | 0                                                                                   |
| Lint     | `pnpm lint`（`--max-warnings 0`）                           | 0                                                                                   |
| 样式     | `pnpm exec stylelint '**/*.{vue,css,scss}' --no-cache`      | 0（`--cache` 会掩盖 recess-order；本轮正是全仓跑才抓到引导那处属性序违规）          |
| 格式     | `pnpm exec prettier --check . --no-cache`                   | 0（全仓）                                                                           |
| 测试     | `pnpm test:run`                                             | **179 文件 / 2136 例全绿**（本波 +1 文件 / +10 例，全在新的 `guideNav.test.ts`）    |
| 构建     | `pnpm build` / `pnpm build:firefox`                         | 均 0；chrome zip **733,313 B（733.31 kB）**，上一波入库基线 732.71 kB → 净 +0.60 kB |
| 产物闭包 | `tests/architecture/sidepanelClosure.test.ts`（对重建产物） | 17 例全绿、0 skip                                                                   |

`EAGER_ALLOW_LIST` 本波**被动刷新**过一次，读数口径要写清楚：
指引页把最后两颗 `el-button` 换成原生 `<button>` 后，EP 组件在跨入口共享 chunk 里的归属变了，
rolldown 重切 vendor 块——`browser-*`（14,035 B）与 `event-*`（745 B）不再被 HTML 点名，
并进了两只都以 `icon` 命名的块（42,269 + 19,663 = 61,932 B）。
对拍用同一 `node_modules` 的隔离 worktree（HEAD 已清理）：

|                  | HEAD                | 本波                |
| ---------------- | ------------------- | ------------------- |
| `sidepanel.html` | 34 文件 / 276,658 B | 33 文件 / 276,818 B |
| `popup.html`     | 44 文件 / 292,679 B | 43 文件 / 292,895 B |

请求数各**少 1**、字节各 +160 / +216（+0.06% / +0.07%，重切带来的压缩开销），首屏没有变厚。
所以红的是「按基名计数的口径」，不是预算本身；守卫里 `total` 跟着实测往下收（34→33、44→43），
`icon` 上限 1→2，`browser` / `event` 两格删除——新增一个 eager 文件仍然会红，牙没磨钝
（`mustStayLazy` 清单里 `GuideView` / `OnboardingTour` / `RichText` 等仍在原位）。

`pnpm build:firefox` 已补跑：0，`.output/firefox-mv2` 总大小 2.08 MB（与 chrome 侧同一批 chunk，
按既有约定不出 zip）。本波没有未跑的门禁项。

入库拆成三个提交，各自可单独审查：`236226b` 是导航与阅读体验本体（`GuideView.vue`、新增的
`utils/guideNav.ts` 与它的 10 例守卫、两份 `help.json` 的 `help.gb.15`、`i18nBundles.test.ts` 的依赖图
登记、`sidepanelClosure.test.ts` 的 eager 清单被动刷新）；`41b8b8e` 是第 9 节引导末步那一行；
本提交只回灌文档（本文、`docs/ARCHITECTURE.md` / `.en.md` 的第 31 节两条，以及上一轮
`GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md` §10.2 / §10.3 的订正指针）。

## 8. 对上一轮记录的订正

`docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md`：

- §10.2 第 1 项写的「补 `:deep(.el-button--primary.is-link)` 抵消」在本轮被撤销——那颗按钮
  不再是 `el-button`，`:deep` 块随之删除，抵消链没有残留（另有三处 dialog 仍在用该写法，不受影响）。
- §10.3「必须如实标注的余留问题」中「这一页」的部分已关闭：本页不再有以主色作文字色的元素，
  90 项判定项（正文级 4.5:1 / 大字级 3:1）在六档全部过线。该节列出的**管理页其它位置**
  （以主色作文字色的元素）不受本轮影响，余留问题对它们仍然成立，因此 §10.3 保留为历史记录，
  只在本节说明适用范围收窄。

## 9. 同一波内的第二处反馈：引导末步的文档退路行

用户接着贴了第二张截图（引导第 8/8 步），红框圈住卡片底部的
「想不起哪一步了？完整说明一直在：页内使用指引 · 在线说明」，问「换行为什么是居中，向左对齐是不是更好」。

这不是审美偏好题，是**折行落点**题。`.tour__docs` 原先写死 `text-align: center`，
中文按字折行，于是第二行只剩「明」这类孤字，视觉上像掉出来一个字；英文更糟——
`white-space` 默认值会把 `<a>` 里的 "online guide" 从中间劈开。卡片里其余文字（`.tour__desc`）
不写 `text-align`、继承左对齐，只有 `.tour__hint` 是右对齐，这一行居中反而成了唯一的异类。

改两处，都在 `components/options/OnboardingTour.vue`：

```css
.tour__docs { … text-align: left; }        /* 与卡片其余正文同侧 */
.tour__docs-link { … white-space: nowrap; } /* 折点只落在两枚链接之间，不劈开词 */
```

**验证方式与它的边界**（必须说清，别把探针当截图）：引导只在 `isAuthenticated` 为真的视图里可回放
（`entrypoints/options/App.vue:44` 的 `v-if` 挂着整块 `HeaderBar`，回放入口在其菜单里），
无头夹具里没有已建库的登录态，因此**没有**取真机第 8 步的截图。改为量「盒子等价的合成页」：
`benchmarks/.artifacts/tour-docs/{probe.html,run.mjs}`（本地、不入库）用构建产物里读到的真实盒子参数
复刻卡片——`.tour__card` 宽 340px、`padding: 18px 20px 16px`、`box-sizing: border-box`，
这一行 11px / line-height 1.6、`.tour__docs-sep` 左右 4px，文案直接取
`utils/i18n/locales/{zh-CN,en}/onboarding.json` 的 `docsLead` / `docsGuide` / `docsOnline` 原文。

| 档位  | 对齐   | 行数 | 各行左偏移        | 链接被劈开        |
| ----- | ------ | ---- | ----------------- | ----------------- |
| zh-CN | center | 2    | [25.2, **164.5**] | [false, **true**] |
| zh-CN | left   | 2    | [20, 20]          | [false, false]    |
| en    | center | 2    | [21.3, **104.1**] | [**true**, false] |
| en    | left   | 2    | [20, 20]          | [false, false]    |

左偏移从「第二行悬在中间」变成两行同一条 20px 线（= 卡片左内边距），
两种语言都被劈开的那枚链接都复原为整串。这份读数在**另一份 CFT** 上复跑过一次：§6 那轮借用的是
`cross-origin-proxy/.test-tmp` 里的 152.0.7977.75，这次用的是 `node_modules/.cache/chrome-for-testing`
里的 153.0.8010.52，四行读数逐字符相同——折行与对齐不随这两版变化。
产物侧再核对一遍构建 CSS：
`.output/chrome-mv3/assets/OnboardingTour-*.css` 里是
`.tour__docs[…]{…;text-align:left;…}` 与 `.tour__docs-link[…]{…;white-space:nowrap;…}`。

残余风险：合成页量的是折行与对齐，量不到真机上那层聚光遮罩与入场动画期间的排版；
若后续要一张真机第 8 步截图，需要先给夹具建一次带主密码的登录态。

## 10. 评审回灌：三枚胶囊合并成 `.guide-pill`

两轴评审提的重复代码成立，而且证据很硬：**把描边令牌从 `--aph-surface-line` 换成
`--aph-text-secondary` 这一处改动，需要在三个选择器里各写一遍**
（`.guide-bar__back` / `.guide-bar__online` / `.guide-note__btn`），三块的
`color` / `cursor` / `background` / `border` / `transition` 及 `:hover` / `:focus-visible` 完全同形。

合并后：

- `.guide-pill`（+ `:hover` / `:focus-visible`）承担形态，模板里三枚各写 `class="guide-… guide-pill"`；
- 条带两枚的几何并成一条 `.guide-bar__back, .guide-bar__online`（`inline-flex` / 32px / `0 12px` / 圆角 8px），
  `.guide-bar__online` 只留 `text-decoration: none`；
- `.guide-note__btn` 只留自己那一圈尺寸（`2px 8px` / 12px / 圆角 6px），
  刻意**不**给它加 `display`——它是行内按钮，写成 `inline-flex` 会改基线；
- `prefers-reduced-motion` 的名单从三条并成一条 `.guide-pill`（图标与版本号的 `color` 过渡仍单列）。

行为等价怎么证：合并前后各跑一次 §6 的真机核验，`navClicks` / `scrollFollow` / `atBottom` / `keyboardEsc`
四组读数**逐字段相同**，126 行漆面对表 100 行完全一致、26 行变动 ≤0.06——那 26 行正是 §6 量具第 4 条
（换肤未落定）修掉前后该有的差，合并前那份因此不能直接当基线用。落定判据修好后连跑两次，
含 `geometry` 在内**全部字段完全相同**，所以本轮入库的是落定后的数字。
构建产物里 `.guide-pill` 三条规则与条带那条联合几何规则都在位（`grep -o '\.guide-pill\[[^{]*{[^}]*}'`）。
