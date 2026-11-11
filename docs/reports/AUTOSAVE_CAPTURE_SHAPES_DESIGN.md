# 自动保存捕获形态矩阵、可及名识别与影子树穿透（设计定稿）

> 状态：**可及名识别已落地并收窄到捕获链（形态 3）**；形态 8（邮箱 + 验证码）与形态 9（影子树）
> 仍是待拍板缺口，§5 那条存量兜底同样待拍板。
> 影子穿透撞在已钉住的设计基线上（§3.2），属于「改变隐私边界 / 交互承诺」的取舍，
> 按 `AGENTS.md`「必须暂停并询问确认」的口径停在设计层。本文给出矩阵、冲突点与剩余切口。
>
> 已落地部分的实现：`entrypoints/content/fieldLabels.ts`（可及名解析 + 桶内 aria 关键词推导）、
> `formSelectors.ts` 的 `declaredText()`（**填充链**尺子，只读四个属性）与 `captureText()`
> （**捕获链**尺子，四属性 + `aria-label` 缺席时的可及名）、`hasPhoneEvidence()` /
> `hasVerifyCodeEvidence()`（捕获门的正向证据，不改桶归属）、`looksLikePostalCode()` 走捕获尺子，
> `LoginAutoSave.findMobileCodeField` 改用 `hasPhoneEvidence`。判据在
> `tests/content/loginAutoSave.mobileCode.test.ts` 末尾那一组、
> `tests/content/formSelectors.labelScope.test.ts`（两把尺子的分界线，10 条）与
> `tests/content/formDetector.identityHint.test.ts`（label-only 联系电话框不让位，3 条）。
>
> **收窄记录（2026-11-11 用户拍板，`8de87c2`）**：`46bd26b` 曾把可及名并进共用尺子，
> 连带改掉了填充落点与身份提示让位，踩出演示台第 ⑯ 区两行回归。现已把可及名的作用域
> 限回捕获证据链，详见 §3.1。捕获能力 ⊇ `b0f66cd` 但 ⊂ `46bd26b`，是一次**有意收窄**。
>
> 相关评审：`docs/reports/` 下的自动保存链评审结论；行号以 `8de87c2` 为准。

## 1. 判据本体：捕获门只有一条

三个入口（表单提交 / 按钮点击 / Enter）都汇到 `entrypoints/content/LoginAutoSave.ts:1160` 的
`readCredentials(form)`，它只有两条出路：

```
scope = form ?? document                                                          // :1161
口令框 = scope.querySelector('input[type="password"], input[data-aph-password]')   // :62 + :1162
├─ 口令框有值  → 找账号（form 走 findUsernameInForm，无 form 走 findUsernameInPage）→ mobileLogin: false
└─ 口令框无值  → findMobileCodeField(scope)                                        → mobileLogin: true
```

`findMobileCodeField`（`:1125`）的成立条件是三件事同时为真：作用域内**已填写且可见**的 input 里
① 有一个构成验证码证据（`hasVerifyCodeEvidence`）且不是邮编框、且值形如 4~8 位字母数字（`:1129`），
② 有一个构成手机号证据（`hasPhoneEvidence`）且不是国家码/区号/分机子段、且不命中验证码选择器（`:1136`），
③ 二者都在同一个 scope 内（`:1126` 的一次 `querySelectorAll('input')`）。

两个「证据」谓词都是**窄谓词 ∪ 桶内 aria 关键词命中可及名**，只服务捕获门；
桶归属仍走 `matchesVerifyCodeSelectors`（理由见 §3.3），填充与让位仍走窄谓词（理由见 §3.1）。

账号那侧（`findUsernameInForm` `:1179`）是三段式：`autocomplete="username"`（`:1181`）→
逐个试 `USERNAME_SELECTORS`（约 80 条，**数组顺序即优先级**，`:1185`）→ 兜底扫 form 内可见的
`text/email/tel`（`:1194`）。`findUsernameInPage`（`:1243`）口径不同：兜底段要求 `isElementVisible`。

## 2. 形态矩阵（重推导）

原始那份「7 种形态」清单只留在会话里、没有入库。下表按判据重新推导，
「现状」一列全部由代码路径得出，不是推测：

| #   | 形态                                                             | 现状                                | 依据                                                                        |
| --- | ---------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| 1   | form + 密码框 + `name/id/placeholder` 命中的账号                 | ✅ 捕获                             | `:1165` + `:1185`                                                           |
| 2   | form + 密码框 + 只有 `aria-label` 命中的账号                     | ✅ 捕获                             | `USERNAME_SELECTORS:36-41,71-77`                                            |
| 3   | form + 密码框 + 账号只有 `<label for>` / `aria-labelledby` 标注  | ✅ 捕获（走兜底，不是走可及名）     | `:1194` 的「form 内可见 text/email/tel」兜底；可及名**不进**账号桶，见 §4.2 |
| 4   | 无 form 的 SPA + 密码框 + 页面兜底账号                           | ✅ 捕获                             | `:1166` → `findUsernameInPage`                                              |
| 5   | 手机号框 + 短信码框都有值                                        | ✅ 捕获（授权位为真、口令强制置空） | `:1125` + `:956`                                                            |
| 6   | 手机号框有值、验证码框还空（点「获取验证码」那一下）             | ⛔ 不捕获（设计如此，噪声大于价值） | `:1126` 的已填写过滤 + `:1129` 要求码框有值                                 |
| 7   | 收货地址页：手机号框 + 邮编框                                    | ⛔ 不捕获（邮编摘除生效）           | `looksLikePostalCode:301`，走 `captureText` 故 label 标注的邮编也摘得掉     |
| 8   | 邮箱 + 短信/邮件验证码登录（无手机号框）                         | ❌ **漏**                           | 账号侧只认 `hasPhoneEvidence`，邮箱语义进不来（`:1136`）                    |
| 9   | 登录表单在**开放影子树**里（Web Components / Lightning / Ionic） | ❌ **整条漏**                       | 所有取值都是 `form.querySelector` / `document.querySelector`，不跨影子边界  |

第 6、7 两行是**必须一直为负的负例**：任何放宽可及名或作用域的改动，只要让这两行变绿，
就是把搜索框、注册页、收货页读成登录页。第 3、8、9 行才是缺口。

## 3. 三处冲突

### 3.1 可及名曾并进「共用尺子」，现已收窄回捕获链（`8de87c2`）

`looksLikePhoneField` / `looksLikeCodeField` / `looksLikeEmailField` / `looksLikePostalCode`
被分类、侧边栏自动打开、填充落点（`FormDetector.ts:983,1000,1419,1865,2054`、
`selectorPicker.ts:337`）与自动保存共用，`formSelectors.ts` 原本写了理由：
**同一字段在不同判定点不许被读成两种意图**。`46bd26b` 据此把可及名并进四个谓词共用的
`declaredText()`——放宽一次、四处同权。

**这个判断错在把「一致」当成了无条件的好。** 两条链的误判代价并不对称：

- 捕获侧多认一个框，代价只是多问一句「要不要保存」，用户点取消即止；
- 让位侧多认一个框，代价是**静默拿掉一个已交付的功能**：`isInLoginFormOrPopup` 有整页级回退
  （`LoginFormAnalyzer.ts:121`），页面别处一个登录区就能把无关填报区一起判成「已认领」，
  于是个人信息填报页上只写 `<label>` 的联系电话框气泡消失，而钥匙又填不出身份库的值。

真机 e2e 在演示台第 ⑯ 区抓到两行（`docs/fixtures/identity-hint-demo.html` 的
`gz-lxdh` 申请人联系电话 / `kd-jjdhh` 寄件人联系电话，两者都在 form 之外）。
单测全绿也没拦住——那两行的成立依赖「整页别处有登录表单」这个跨区条件。

因此按用户拍板**收窄作用域而不是回滚**，落成两把尺子：

| 尺子             | 读什么                                                     | 谁在用                                                               |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `declaredText()` | 只读 `name` / `id` / `placeholder` / `aria-label` 四个属性 | 分类、侧边栏触发、填充落点、身份提示让位                             |
| `captureText()`  | 四属性 + `aria-label` 缺席时的可及名                       | `hasPhoneEvidence` / `hasVerifyCodeEvidence` / `looksLikePostalCode` |

`declaredText` 逐字恢复 `b0f66cd` 的口径，填充链回到改动前的行为边界。
`hasPhoneEvidence` = 窄谓词 **∪** 可及名命中桶内 aria 词，是窄谓词的**超集**；
但可及名分支只吃 `MOBILE_SELECTORS` 自己承认过的词（手机 / 电话 / mobile / phone，`:107-110`），
比 `MOBILE_KEYWORDS` 窄——「号码」不在其中。所以捕获能力 ⊇ `b0f66cd` 但 ⊂ `46bd26b`，
**不能**说成「相对 46bd26b 无捕获损失」：label 写「社保卡号码」不构成证据，
而 `placeholder` / `aria-label` 写同样的字仍被原谓词认下。
排除判据 `looksLikePostalCode` 一并走捕获尺子，放宽的正反两端同时生效，
label 标注的收货地址页不会重新变成登录页（矩阵第 7 行）。
桶归属判定（`matchesVerifyCodeSelectors`）刻意**没有**放宽，理由见 §3.3。

分界线两侧各配一把刀，均在 `tests/content/formSelectors.labelScope.test.ts`（10 条）：
把可及名塞回 `declaredText` → 填充链那组见红（实测 7 条，含 `aria-labelledby` 邮箱半条）；
把捕获门换回 `looksLikePhoneField` → `LABELLED_MOBILE_CODE_FORM` 那条见红（prompt 调用 0 次），
其余 16 条照旧绿。让位那侧另由 `formDetector.identityHint.test.ts` 的 3 条钉住。

成本口径：可及名解析只在字段自己声明的四个属性读完之后才发生，且 `<label>` 关系走原生
`input.labels`（浏览器已维护 for / 包裹两种关联），不留每字段一次的文档级
`label[for=...]` 扫描。收窄之后这笔成本**只由捕获门承担**——`detectForms` 每轮扫描里的
四个谓词不再解析可及名，热路径比 `46bd26b` 更便宜。
`aria-labelledby` 需要按 id 查引用元素，只对声明了该属性的字段发生。

### 3.2 影子穿透已被钉成「只走站点规则显式选择器」

`tests/content/formDetector.shadow.test.ts` 开头钉了五条事实，其中第 1 条：
**自动识别的范围只有文档主树**，跨边界的唯一通道是站点规则自定义选择器，且受
`penetrateShadowEnabled` 总闸约束（`FormDetector.ts:842-873`，全局配置或站点规则任一关闭就把
查询根收回主树）。让 `readCredentials` 无条件下钻影子树会同时推翻这条基线与「别替我伸进
Shadow DOM」的开关承诺。正确形态是复用 `collectShadowQueryRoots` 的 BFS + 尊重总闸，
而不是再造一个无闸的遍历（本轮曾起草过一版独立 BFS，因与既有实现重复且绕过总闸已废弃）。

### 3.3 「两头落空」不变量限制验证码桶

`matchesVerifyCodeSelectors:245` 的注释写明：它必须与 `detectForms` 验证码桶用同一份选择器，
否则被排除的字段会在两个桶之间落空。因此**不能**给它直接加可及名分支；
可及名只能作为「本次提交是否算验证码登录」的正向证据参与，桶归属判定维持选择器口径。

## 4. 建议切口（按性价比排序）

1. **形态 8（邮箱 + 验证码登录）**：把 `findMobileCodeField` 的账号候选从「只认手机号证据」
   扩到「`hasPhoneEvidence` **或** 邮箱证据」，仍要求同 scope 内存在合格的一次性码框。
   邮箱侧须照 §3.1 的两把尺子口径新增 `hasEmailEvidence`（窄谓词 `looksLikeEmailField` ∪
   邮箱桶内 aria 词命中可及名），**不要**回头去放宽 `declaredText`——那会重演让位回归。
   改动面最小（一个候选谓词 + 一个桶），负例 6/7 不受影响，但中英文案与
   `cs.save.mobileLoginNote` 的措辞需同步（现在说的是「短信验证码」，邮箱收码不是短信）；
   授权位 `mobileLogin` 的命名与语义也要一并交代（它实际含义已是「本次登录没有口令」）。
2. **形态 3（可及名）**：✅ 已落地并收窄，口径见 §3.1——`declaredText()` 只读四属性（填充链），
   `captureText()` 才加可及名（捕获链），`hasPhoneEvidence` / `hasVerifyCodeEvidence` /
   `looksLikePostalCode` 走后者。排除与正向证据读同一份文本，所以收货地址页不会因放宽变登录页
   （矩阵第 7 行，由 `tests/content/loginAutoSave.mobileCode.test.ts` 钉住）。
   尚未做的是**账号桶**（`USERNAME_SELECTORS` 那 ~80 条选择器逐个 `querySelector` 的优先级语义）
   里的可及名补位：目前它由「form 内可见 text/email/tel」兜底覆盖（矩阵第 3 行），
   等效结果已由负例与正例共同验证，真要补的是一条优先级判据，需与 §2 第 1/2 行一起重测取值次序。
   这条补位属于**账号取值**而非让位判据，但动手前仍须确认它不会把 `declaredText` 重新拖宽。
3. **形态 9（影子树）**：把 `collectShadowQueryRoots` 提到可复用位置，
   让 `readCredentials` 在 `penetrateShadowEnabled` 为真时用它查询，为假时维持现状。
   这条改的是「自动识别范围」的产品承诺，需要同时更新 `formDetector.shadow.test.ts` 的基线
   事实、选项页文案与 `docs/ARCHITECTURE.md` 的边界描述——**必须先拿到明确授权**。
4. **配套判据**：形态矩阵应落成一张表驱动的测试（每行一条夹具，正例断言捕获结果与授权位，
   负例断言不弹窗），否则下一次放宽仍会靠人脑记忆判断有没有踩到 6/7 两行。

## 5. 另一条待处置的存量收口

`captureCurrentCredentials:810-812`：存储引用失效时按 `mobileLogin` 为**假**的路径仍回退到
**全文档**查询 `input[type="password"], input[data-aph-password]`。弹窗期间页面若移除原密码框并
自设一个带值的 `data-aph-password` 框，页面可控的非空口令会走正常路径覆写库中已存真口令
——两道以 `!password` 为键的闸门天然拦不住非空值。
本轮已收口的是授权位为真的那一支（`:956`）。建议后续二选一：把兜底作用域收窄回
`lastCapturedForm`，或引用失效时直接采用弹窗展示值 `pending.password`（后者更贴近「用户点保存时
看到的是什么就存什么」）。取舍点是「SPA 重渲染后取到新值的鲜度」与「页面可控面」，需产品拍板。
