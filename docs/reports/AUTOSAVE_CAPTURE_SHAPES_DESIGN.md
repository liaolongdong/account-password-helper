# 自动保存捕获形态矩阵、可及名识别与影子树穿透（设计定稿）

> 状态：**形态 3（可及名）、形态 8（邮箱 + 验证码）已落地；形态 9（影子树）已拍板「暂不做，
> 维持主树基线」；§5 那条存量安全兜底已收口。** 本文的矩阵、冲突点与取舍记录保持原样，
> 只把结论按代码现状对齐。
>
> 已落地部分的实现：`entrypoints/content/fieldLabels.ts`（可及名解析 + 桶内 aria 关键词推导）、
> `formSelectors.ts` 的 `declaredText()`（**填充链**尺子，只读四个属性）与 `captureText()`
> （**捕获链**尺子，四属性 + `aria-label` 缺席时的可及名）、`hasPhoneEvidence()` /
> `hasVerifyCodeEvidence()`（捕获门的正向证据，不改桶归属）、`looksLikePostalCode()` 走捕获尺子，
> `LoginAutoSave.findMobileCodeField` 改用 `hasPhoneEvidence`。判据在
> `tests/content/loginAutoSave.mobileCode.test.ts` 末尾那一组、
> `tests/content/formSelectors.labelScope.test.ts`（两把尺子的分界线，12 条）与
> `tests/content/formDetector.identityHint.test.ts`（label-only 联系电话框不让位，3 条）。
>
> **收窄记录（2026-11-11 用户拍板，`8de87c2`）**：`46bd26b` 曾把可及名并进共用尺子，
> 连带改掉了填充落点与身份提示让位，踩出演示台第 ⑯ 区两行回归。现已把可及名的作用域
> 限回捕获证据链，详见 §3.1。捕获能力 ⊇ `b0f66cd` 但 ⊂ `46bd26b`，是一次**有意收窄**。
>
> **形态 8 落地记录（2026-11-11 用户拍板）**：账号候选从「只认手机号证据」扩到
> 「`hasPhoneEvidence` **或** `hasEmailEvidence`」，仍要求同 scope 内存在合格的一次性码框；
> 未放宽 `declaredText`，填充链一字未动。详见 §4.1。授权位 `mobileLogin` 的**名字**保留
> （它已进 sessionStorage 密文与跨入口消息契约），语义以 `utils/types.ts` 的 JSDoc 为准：
> 「本次登录没有口令」，手机号与邮箱共用。
>
> **形态 9 决策记录（2026-11-11 用户拍板）**：**暂不做，维持「自动识别只在文档主树」的基线**，
> 结论钉在 §3.2 与 §4.3，不再重开；`tests/content/formDetector.shadow.test.ts` 的五条基线事实
> 保持原样。
>
> 相关评审：`docs/reports/` 下的自动保存链评审结论；行号以 `8de87c2` 为准。

## 1. 判据本体：捕获门只有一条

三个入口（表单提交 / 按钮点击 / Enter）都汇到 `entrypoints/content/LoginAutoSave.ts:1171` 的
`readCredentials(form)`，它只有两条出路：

```
scope = form ?? document                                                          // :1172
口令框 = scope.querySelector('input[type="password"], input[data-aph-password]')   // :62 + :1173
├─ 口令框有值  → 找账号（form 走 findUsernameInForm，无 form 走 findUsernameInPage）→ mobileLogin: false
└─ 口令框无值  → findMobileCodeField(scope)                                        → mobileLogin: true
```

`findMobileCodeField`（`:1130`）的成立条件是三件事同时为真：作用域内**已填写且可见**的 input 里
① 有一个构成验证码证据（`hasVerifyCodeEvidence`）且不是邮编框、且值形如 4~8 位字母数字（`:1134`），
② 有一个构成账号证据——手机号（`hasPhoneEvidence`）**或邮箱（`hasEmailEvidence`，形态 8）**——
且不是国家码/区号/分机子段、且**自身不构成验证码证据**（`!hasVerifyCodeEvidence`，`:1142-1147`），
③ 二者都在同一个 scope 内（`:1131` 的一次 `querySelectorAll('input')`）。

②的排除项必须用 `hasVerifyCodeEvidence` 而不是 `matchesVerifyCodeSelectors`：账号证据与码证据
共用同一把尺子，若排除项只读四个属性，`<label>手机验证码</label><input value="246813">` 会既算
码证据又算账号证据，一次性验证码就以 `username` 落库（判据见 `tests/content/loginAutoSave.mobileCode.test.ts`
的「账号候选不得取到验证码框本身」2 条）。桶归属本身仍走 `matchesVerifyCodeSelectors`（§3.3）。

三处捕获谓词（手机号证据 / 邮箱证据 / 验证码证据）都是**窄谓词 ∪ 桶内 aria 关键词命中可及名**，只服务捕获门；
桶归属仍走 `matchesVerifyCodeSelectors`（理由见 §3.3），填充与让位仍走窄谓词（理由见 §3.1）。
邮箱证据的 aria 词从 `USERNAME_SELECTORS` 里**只筛邮箱那几条**再推导（`formSelectors.ts:494`），
不整桶端过来——整桶会把「账号 / 用户名 / 登录名」也算成账号证据。

账号那侧（`findUsernameInForm` `:1190`）是三段式：`autocomplete="username"`（`:1192`）→
逐个试 `USERNAME_SELECTORS`（约 80 条，**数组顺序即优先级**，`:1196`）→ 兜底扫 form 内可见的
`text/email/tel`（`:1205`）。`findUsernameInPage`（`:1254`）口径不同：兜底段要求 `isElementVisible`。

**已知边界（存量，不是本轮引入）**：站点把 OTP 做成 `input[type="password"]` 的掩码框时，
`readCredentials:1176` 会先命中口令分支，把验证码当口令读走（`mobileLogin` 为假，条目落库时
`password` 是那串一次性码）。产品文案里的「验证码不保存」只在**页面上没有可用密码框**的分支成立，
文档里的「验证码本身不进任何字段」也是指这条分支，不是全站承诺。要覆盖这一形态得给口令框加一次性码
语义判据、并决定此时授权位怎么取，属于会改变 `mobileLogin` 取值面的另一轮改动，本轮不动。

## 2. 形态矩阵（重推导）

原始那份「7 种形态」清单只留在会话里、没有入库。下表按判据重新推导，
「现状」一列全部由代码路径得出，不是推测：

| #   | 形态                                                             | 现状                                | 依据                                                                           |
| --- | ---------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| 1   | form + 密码框 + `name/id/placeholder` 命中的账号                 | ✅ 捕获                             | `:1176` + `:1196`                                                              |
| 2   | form + 密码框 + 只有 `aria-label` 命中的账号                     | ✅ 捕获                             | `USERNAME_SELECTORS:36-41,71-77`                                               |
| 3   | form + 密码框 + 账号只有 `<label for>` / `aria-labelledby` 标注  | ✅ 捕获（走兜底，不是走可及名）     | `:1205` 的「form 内可见 text/email/tel」兜底；可及名**不进**账号桶，见 §4.2    |
| 4   | 无 form 的 SPA + 密码框 + 页面兜底账号                           | ✅ 捕获                             | `:1177` → `findUsernameInPage`                                                 |
| 5   | 手机号框 + 验证码框都有值                                        | ✅ 捕获（授权位为真、口令强制置空） | `:1130` + `:958`                                                               |
| 6   | 手机号框有值、验证码框还空（点「获取验证码」那一下）             | ⛔ 不捕获（设计如此，噪声大于价值） | `:1131` 的已填写过滤 + `:1134` 要求码框有值                                    |
| 7   | 收货地址页：手机号框 + 邮编框                                    | ⛔ 不捕获（邮编摘除生效）           | `looksLikePostalCode:301`，走 `captureText` 故 label 标注的邮编也摘得掉        |
| 8   | 邮箱 + 邮件验证码登录（无手机号框）                              | ✅ 捕获（授权位为真、口令强制置空） | 账号候选 `hasPhoneEvidence` **或** `hasEmailEvidence`（`:1142`），码框同一道门 |
| 9   | 登录表单在**开放影子树**里（Web Components / Lightning / Ionic） | ⛔ **不做**（2026-11-11 拍板）      | 维持「自动识别只在主文档」的基线，结论与理由见 §3.2                            |

第 6、7 两行是**必须一直为负的负例**：任何放宽可及名或作用域的改动，只要让这两行变绿，
就是把搜索框、注册页、收货页读成登录页。第 3 行由兜底覆盖（见 §4.2），第 8 行已落地（§4.1），第 9 行按 §3.2 的决定不做。

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

分界线两侧各配一把刀，均在 `tests/content/formSelectors.labelScope.test.ts`（现 12 条）：
把可及名塞回 `declaredText` → 填充链那组见红（实测 7 条，含 `aria-labelledby` 邮箱半条）；
把捕获门换回 `looksLikePhoneField` → `LABELLED_MOBILE_CODE_FORM` 那条见红（prompt 调用 0 次），
其余用例照旧绿（那之后该文件又加了邮箱形态的 6 条，条数不再写死）。让位那侧另由 `formDetector.identityHint.test.ts` 的 3 条钉住。

成本口径：可及名解析只在字段自己声明的四个属性读完之后才发生，且 `<label>` 关系走原生
`input.labels`（浏览器已维护 for / 包裹两种关联），不留每字段一次的文档级
`label[for=...]` 扫描。收窄之后这笔成本**只由捕获门承担**——`detectForms` 每轮扫描里的
四个谓词不再解析可及名，热路径比 `46bd26b` 更便宜。
`aria-labelledby` 需要按 id 查引用元素，只对声明了该属性的字段发生。

### 3.2 影子穿透已被钉成「只走站点规则显式选择器」——并已拍板不做

`tests/content/formDetector.shadow.test.ts` 开头钉了五条事实，其中第 1 条：
**自动识别的范围只有文档主树**，跨边界的唯一通道是站点规则自定义选择器，且受
`penetrateShadowEnabled` 总闸约束（`FormDetector.ts:842-873`，全局配置或站点规则任一关闭就把
查询根收回主树）。让 `readCredentials` 无条件下钻影子树会同时推翻这条基线与「别替我伸进
Shadow DOM」的开关承诺。正确形态是复用 `collectShadowQueryRoots` 的 BFS + 尊重总闸，
而不是再造一个无闸的遍历（本轮曾起草过一版独立 BFS，因与既有实现重复且绕过总闸已废弃）。

**2026-11-11 用户拍板：形态 9 暂不做，维持主树基线。** 这条不做的是「自动识别的产品承诺」
而不是一个缺失的启发式：影子树里的登录表单仍可由站点规则显式钉住（这才是受总闸管理的通道），
而把无条件的影子下钻塞进捕获链，会让「关掉穿透」这个开关对自动保存失效。**结论不再重开**；
`formDetector.shadow.test.ts` 的五条基线事实保持原样，改动它们需要与本节一起重新授权。

### 3.3 「两头落空」不变量限制验证码桶

`matchesVerifyCodeSelectors:245` 的注释写明：它必须与 `detectForms` 验证码桶用同一份选择器，
否则被排除的字段会在两个桶之间落空。因此**不能**给它直接加可及名分支；
可及名只能作为「本次提交是否算验证码登录」的正向证据参与，桶归属判定维持选择器口径。

## 4. 切口与落地状态

1. **形态 8（邮箱 + 验证码登录）**：✅ **已落地（2026-11-11 用户拍板）**。
   `findMobileCodeField` 的账号候选从「只认手机号证据」扩到「`hasPhoneEvidence` **或**
   `hasEmailEvidence`」，仍要求同 scope 内存在合格的一次性码框（`:1142`）。
   邮箱证据照 §3.1 的两把尺子口径新增：`hasEmailEvidence` = 窄谓词 `looksLikeEmailField`
   **∪** 可及名命中邮箱桶的 aria 词；**没有**回头去放宽 `declaredText`，填充与让位一字未动。
   邮箱没有独立的选择器数组，aria 词从 `USERNAME_SELECTORS` 里只筛含邮箱关键词的那几条推导
   （`formSelectors.ts:494`）——整桶端过来会把「账号 / 用户名 / 登录名」一并算成账号证据，
   于是任何「用户名 + 验证码」的注册页都会被判成登录页。
   文案随之统一到「账号 + 验证码」：`cs.save.mobileLoginNote` 从「短信验证码不保存」改成
   「验证码不保存」/「One-time code not saved」（英文选等长串，避免撑破弹窗值列的单行省略），
   授权位 `mobileLogin` 的**名字**保留、语义在 `utils/types.ts` 的 JSDoc 里写明是「本次登录没有口令」。
   判据：`tests/content/loginAutoSave.mobileCode.test.ts` 的「邮箱 + 验证码登录」6 条
   （2 正 + 4 负：码框空 / 邮编框 / 订阅页 / 邮箱 + 真密码框）与
   `tests/content/formSelectors.labelScope.test.ts` 的 2 条（等效标注成立；账号桶里的非邮箱词不成立）。
2. **形态 3（可及名）**：✅ 已落地并收窄，口径见 §3.1——`declaredText()` 只读四属性（填充链），
   `captureText()` 才加可及名（捕获链），`hasPhoneEvidence` / `hasVerifyCodeEvidence` /
   `looksLikePostalCode` 走后者。排除与正向证据读同一份文本，所以收货地址页不会因放宽变登录页
   （矩阵第 7 行，由 `tests/content/loginAutoSave.mobileCode.test.ts` 钉住）。
   尚未做的是**账号桶**（`USERNAME_SELECTORS` 那 ~80 条选择器逐个 `querySelector` 的优先级语义）
   里的可及名补位：目前它由「form 内可见 text/email/tel」兜底覆盖（矩阵第 3 行），
   等效结果已由负例与正例共同验证，真要补的是一条优先级判据，需与 §2 第 1/2 行一起重测取值次序。
   这条补位属于**账号取值**而非让位判据，但动手前仍须确认它不会把 `declaredText` 重新拖宽。
3. **形态 9（影子树）**：⛔ **不做（2026-11-11 用户拍板）**。原方案是把
   `collectShadowQueryRoots` 提到可复用位置，让 `readCredentials` 在 `penetrateShadowEnabled`
   为真时用它查询；放弃的理由与边界见 §3.2。这条不留在待办里，也不再评估。
4. **配套判据**：形态矩阵应落成一张表驱动的测试（每行一条夹具，正例断言捕获结果与授权位，
   负例断言不弹窗），否则下一次放宽仍会靠人脑记忆判断有没有踩到 6/7 两行。

## 5. 存量兜底已收口：引用失效时存弹窗展示值（2026-11-11 用户拍板）

`captureCurrentCredentials`（`:797`）在存储引用失效时曾回退到**全文档**查询
`input[type="password"], input[data-aph-password]`，并把读到的值当口令返回。弹窗期间页面移除
原密码框、再自设一个带值的 `data-aph-password` 框，页面可控的非空口令就会走 `mobileLogin`
为假的那条正常路径覆写库中已存真口令——两道以 `!password` 为键的闸门天然拦不住非空值。
授权位为真的那一支早在 `f20e709` 就已钉成空串（`:958`），这次收口的是为假的那一支。

两个候选里用户选了**「改存弹窗展示值」**（另一个是把兜底作用域收窄回 `lastCapturedForm`）：
它更贴近「用户点保存时看到的是什么就存什么」，代价是放弃 SPA 重渲染后取到新口令的鲜度。
落地形态是把返回类型放宽成 `{ username: string; password: string | null } | null`，
兜底那一支返回 `password: null`，由 `handleSave:958` 既有的 `?? pending.password` 接住，
**出口那行一字未改**。那次全文档查询保留，但取到的口令值一律丢弃，只用来定位账号所在的 form：
找到带值的框时账号照旧实时重读（用户可能在弹窗期间改过账号）；一个带值的框都找不到时整支返回
null，账号与口令一起退回 pending——这是改动前就有的形状，本次一字未动。另一条候选（把兜底
作用域收窄回 `lastCapturedForm`）会连带改掉账号的取值口径——无 form 的 SPA 形态下它为 null，
兜底无从定位 form，账号只能退回 pending 值。

判据：`tests/content/loginAutoSave.mobileCode.test.ts` 的「口令形态的保存兜底：引用失效时存
弹窗展示值」3 条（两种选择器各一条 + 账号仍重读一条）；真机一条在
`e2e/mobile-code-autosave.spec.ts`（换掉 `#p` 再插 `data-aph-password` 框，点保存后到管理页
列表点开显隐比对明文）。两把刀都验过：`password: null` 改回 `passwordField.value` → 前两条
见红（实测收到 `PAGE-CONTROLLED-VALUE`）；兜底改成整支 `return null` → 账号那条见红。
