# 个人信息字段提示的匹配逻辑

> 面向「身份信息库召唤提示」（形态一：识别 + 提示 + 深链，不自动填充）。本文写的是**当前代码里真实跑的判据**，
> 每条都能在 `entrypoints/content/piiClassifier.ts` 找到对应符号；改词典或改顺序时请同步本文与
> `tests/content/piiClassifier.coverage.test.ts` 的账本。
>
> 四个具体问题的答案分别在这些小节：
> **「机构证件号码那一族现在提示成什么、什么时候仍沉默」** → §5.1；**「社保那张表没有 placeholder 的框为什么不提示」** → §5.2；
> **「常见字段都覆盖了吗」** → §6 覆盖矩阵与 §7 刻意不覆盖清单；
> **「学历证书编号那一类为什么从沉默翻成提示」** → §5.6。

## 1. 定位与边界

- 分类器是**纯函数**：单字段进、单字段出，不填充、不落盘、不发网络请求、不写日志。
- 它只读页面的**结构信号**（`name` / `id` / `label` / `placeholder` / `autocomplete` / DOM 邻居）与**这一框自己的值**。
  值只在最后一层用于形状收口，命中时 `evidence` 写的是形状码（`id-shape`）而不是原文。
- 离开页面的明文只有**一条通道、两个来源**，都发生在点击「从身份库选择」那一刻、只进身份库的搜索框，
  并共用同一个 64 字收口（`utils/keywordMatch.ts` 的 `normalizeSearchKeyword`）：
  `selfNameValueNear()` 取用户已经手打好的**本人姓名**（四条边界写在该函数 JSDoc 里——只认
  `role === 'name'` 且 `ownership === 'self'`、只在点击时调用、作用域是所在 `<form>` 且封顶 80 枚控件、
  交给 `normalizeSearchKeyword` 收口）；`hintFieldKeyword()` 取**这一格叫什么**（标签文字，退到同项兄弟标签；
  只服务「库里没有那一格」的编号族，**永不读这一框里已经填的值**）。两条通道由 `pickSearchKeyword()`
  按角色互斥地选中，调用点只有一处（§5.6）。
- 角色**不跨入口**：深链载荷只有搜索词一个标签，角色不决定身份库的类别档位（一条条目同时带证件号、手机号等
  多个值，预选会把该命中的筛掉）。

## 2. 判定输入：一个框能被问到什么

`collectPiiSignals()` 收齐一框能自报的十项信号（属性合串 `attr` 与它的两个来源 `attrSources`、`label`、
`groupLabel`、`placeholder`、`value`、`type`、`autocomplete`、`roleAttr`、`inSearchBox`）。其中 `label`
的取值有一条严格优先级链，**先拿到先停**：

| 顺序 | 线索                         | 取自                                                                        | 为什么排在这                                                                                                                                                                 |
| ---- | ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `aria-label` + `title`       | 框自己                                                                      | 页面对「这框叫什么」的直接自述                                                                                                                                               |
| 2    | 包裹式 `<label>`             | `el.closest('label')`                                                       | 原生关联，无需推断                                                                                                                                                           |
| 3    | 显式关联                     | 原生 `labels`（`for` 与包裹关系浏览器已算好）→ `aria-labelledby` 指向的节点 | 组件库不发 `for` 时仍能命中；只读文本、不读值；走 `labels` 而非全文档扫 `<label>`，因为这条判据既在聚焦热路径上每框一次，也会被点击通道的 `selfNameValueNear` 最多连问 80 次 |
| 4    | 前兄弟文本                   | 最多 4 个前兄弟节点 / 1 个前元素兄弟                                        | `姓名：<input>` 这类裸文本（12306 形状）                                                                                                                                     |
| 5    | 同 `<tr>` 的 `<th>`          | `closest('tr').querySelector('th')`                                         | 表格里标签写在表头格                                                                                                                                                         |
| 6    | 同项兄弟标签（`groupLabel`） | `groupLabelOf()`                                                            | **仅在前五层全落空时才计算**，见 §4 第 6 层                                                                                                                                  |

三条贯穿所有文本线索的口径：

- **文字体系分档的长度预算**：`withinLabelBudget()` 中文 ≤ 20 字、英文 ≤ 60 字符。同一个阈值按字母算会把
  `National Insurance number`（25 字母）整条丢掉，按字数算会放过一句 22 字的中文宣传语。
- **匹配前的归一化**：中文侧 `squeeze()` 删掉所有空白（站点真实写成 `姓 名` / `身 份 证`），英文侧 `flatten()`
  把空白压成单个空格并小写。判定用的合串是 `hintText = label + placeholder + attr`，两个方向各算一份。
- **只接受「叶子状」节点**（`isLabelish`）：块内含 `input/textarea/select` 的文字不是标签，否则 `重量(kg)`
  会一路退到 `<fieldset>` 的聚合文本「收件人姓名电话地址」，把整个寄件区的空框读成姓名框。

## 3. 判定链：八层编号 + 一道全层闸门，顺序即优先级

弱信号永不覆盖强信号。`classifyPiiRaw()` 按下列顺序返回，**第一个命中的层就是结论**，后面的层不再看
（3.5 是本轮为机构证照号插入的一道闸门，源码里各处仍按 1…8 编号引用，所以它不占整数位）：

| 层                 | 判据                                                                                                                                                                                                                                                                                                           | 命中后的 `tier` / `suppress`                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1 结构性排除       | `type` ∈ `STRUCTURAL_EXCLUDE_TYPES`（hidden / password / submit / button / reset / image / checkbox / radio / range / color / file 共 11 枚）、`role="searchbox"`、祖先链 4 层内像搜索容器                                                                                                                     | `suppress='excluded'`                                                 |
| 2 autocomplete     | 站点自声明：`CARD_AUTOCOMPLETE`（`cc-number` / `cc-exp` / `cc-csc` / `cc-name`）先，`AUTOCOMPLETE_MAP`（18 枚：`name` `given-name` `additional-name` `family-name` `bday` `sex` `street-address` `address-line1..2` `address-level1..3` `postal-code` `tel` `tel-national` `mobile` `email` `organization`）后 | `tier='autocomplete'`；卡类口令 `suppress='card'`                     |
| 3 负向短语         | `ZH_NEG`（带三条例外，见下）→ `EN_NEG`                                                                                                                                                                                                                                                                         | `suppress='negative'`                                                 |
| 3.5 机构证照号     | `orgCredentialHit()`：这条文本永远不许被词典接进本人 `idNumber`；命中后按**证据来源**分派（§5.1）                                                                                                                                                                                                              | 标签/属性写明 → `serialNumber`；仅弱线索 → `suppress='orgCredential'` |
| 4 `name`/`id` 词元 | `CARD_ATTR_DICT`（先，见 §4.1）→ `ACCOUNT_TOKENS` → `NEG_TOKENS` → `ATTR_DICT`（切词 + 逐来源整串粘连 + 修饰词剥离）                                                                                                                                                                                           | `tier='attr'` 或 `suppress='account'`/`'negative'`                    |
| 5 label 文本       | `dictRoleOf()`：逐字相等档 → `ZH_DICT` 子串 → `EN_DICT` 子串                                                                                                                                                                                                                                                   | `tier='label'`                                                        |
| 6 同项兄弟标签     | `groupLabelOf()` 拿到的那段文字，再过三道闸（组织主体 / 负向自检 / 与 placeholder 矛盾）                                                                                                                                                                                                                       | `tier='group'` 或 `suppress='noRole'`                                 |
| 7 placeholder      | `dictRoleOf(s.placeholder)`，但「机构主体 + 非 org 角色」不许自证                                                                                                                                                                                                                                              | `tier='placeholder'`                                                  |
| 8 已输入值形状     | `^\d{17}[\dXx]$` → idNumber；`^1[3-9]\d{9}$` → phone；`email` 正则 → email                                                                                                                                                                                                                                     | `tier='value'`                                                        |
| 收口               | 各层全空                                                                                                                                                                                                                                                                                                       | `suppress='noRole'`                                                   |

**顺序里四处「调换就回归」的地方**（源码注释各钉了一条用例）：

1. 负向短语必须早于任何正向词元，否则 `用户名` / `Display name` 被 `name` 抢走。
2. `autocomplete` 必须早于负向短语，否则 `autocomplete="tel"` 的登录手机号先被账号守卫挡掉、又落进 `phone` 词典。
3. `ZH_DICT` 内部顺序：卡类三档在 `name` 之前（`持卡人姓名` 末尾正是 name 档短语）；证件号族里那条
   `社保卡号 / 社会保障卡 / 医保卡` 排在 `卡号` 之前（四个字里就含着 `卡号`，但它问的是社保个人编号，
   多数城市那一串就是身份证号；`社会保障卡号` 多一个「障」字，接不上「社保卡号」那串，所以整条词收在
   `社会保障卡` 上）；**`联系人 / 收件人 / 申请人` 这一段「人」词挪到整张词典末尾**（见 §5.3）。
4. `serialNumber` 档排在 `idNumber` **之前**，中文侧与 `EN_DICT`、`ATTR_DICT` 三处同形：`社保卡电脑号`
   含「社保卡」三字，反序会被证件号先接走，而深圳那一串 8 位电脑号根本不是身份证号（§5.6 末段）。

**负向短语的三条例外**（`isZhNegative()`，都是「同一个后缀既指向人也指向事物」的形状歧义）：

- `名称`：文本里另有组织名词（`ORG_NOUNS_ZH`：单位 / 公司 / 企业 / 组织 / 机构 / 团体 / 银行 / 雇主）或住址名词
  （`ADDRESS_NOUNS_ZH`：小区 / 花园 / 大厦 / 公寓 / 住宅 / 楼栋 / 单元 / 门牌 / 住址 / 地址 / 家乡 / 村）时放行，
  于是 `单位名称` / `开户银行名称` / `小区名称` 能提示，而 `物品名称` / `商品名称` 照旧沉默。
- `方式`：含「联系」时放行（`联系方式` 就是手机号框最常见的中文写法）。
- `账号` / `帐号`：含「银行」或「卡」时放行（`银行账号` 是卡号档最常见的中文写法），裸「账号」仍是登录名。

## 4. 属性词元这一层的两个特例

### 4.1 `CARD_ATTR_DICT` 抢在账号守卫之前

`ACCOUNT_TOKENS` 含 `account`，而中文站「户名」最常见的字段名正是 `accountName`（切词 = account + name），
按原顺序会被整段判成登录字段。所以卡类三档的词元表单独存在、且比账号守卫**早一步**：

- `cardNo`：`iban` `bankCard` `creditCard` `debitCard` `bankAccount` `bankAccountNo` `bankAccountNumber` `sortCode` `routingNumber`
- `cardHolder`：`cardHolder` `cardHolderName` `holderName` `accountName` `accountHolder`
- `cardBank`：`bankName` `bank` `issuingBank`

例外只开给这十七枚具体词元。比对的顺序是**先试整串粘连词元、再试单个词元**：`accountName` 切出来是
account + name，只有拼回 `accountname` 才对得上户名档；而 `bank` 走的是后一条——单个词元相等即算命中，
这正是 `name="bank_account_number"` 一度被读成开户行的原因（现在由 `bankaccountnumber` 排在它前面接住）。
裸 `account` / `user_account` / `login_id` 仍按原样判成登录字段，`piiClassifier.test.ts` 钉着这条。
这张表**刻意不收录裸 `accountnumber`**（2026-10-17 评审回灌把它摘了）：两步登录页的账号框用的正是这个名字，
而第二步才出现的密码框不在同一个字段组里，登录容器守卫拦不住它——写着 `bankaccountnumber` 才收下这一格，
标签写着「银行账号 / Bank Account Number」的页面各走自己的文本通道，不受这条影响。
与 `ATTR_DICT` 同一条**刻意的缺席**：不收录裸 `card` / `cardno`——中文站点同时用它指身份证号和银行卡号，
词元层面分不开，收录会把证件号框读成卡号。

### 4.2 同名不同档的先后

`ATTR_DICT` 里 givenName / familyName 必须早于裸 `name`（否则 `first_name` 的 `name` 词元先赢，
「名 / 姓」两档在最常见的属性写法上永远够不到）；`org` 排最后（`company_address` 这类带更具体角色的形状先被
address 接走，单位名只收「除了公司词元没说别的」的字段）。`name` / `company` 这类裸词还要过**同生词元核查**：
`goods_name` / `hotelName` 是事物名、`company_size` / `company_logo` 是元信息，都不算人名或单位名。

## 5. 六案归因（都是真实漏报 / 误报，不是审美选择）

### 5.1 「机构证件号码」——闸门拦的是什么，以及它的出口换过一次

`证件号` / `证件号码` 都在 `ZH_DICT` 的 idNumber 档里，所以这句话本身是**认得的**。问题在于它认的是「谁的」：

- **旧实现**：机构主体的判据（`ORG_SUBJECT_ZH`）只挂在第 6、7 两层弱线索上，因为那时它要兜的是
  「组件库形状下拿不到真标签，只能靠整项闭嘴」。而真机勘察里最常见的那枚 `机构证件号码`
  挂的是货真价实的 `<label for>`，走的是第 5 层 label 通道，**两道闸门一次都碰不到**，
  于是被词典接走、提示成**本人**的证件号——用错的身份填错框，是本功能唯一不可接受的误填形态。
- **现实现（2026-10-17）**：抬成第 3.5 层闸门（`orgCredentialHit()`），吃的是 `label + placeholder + attr` 的合串，
  所以机构字样出现在哪一格都拦得住。出口码 `orgCredential`，只进日志与单测，不进任何用户可见文案。
- **出口改判（2026-10-18）**：立闸那天 `serialNumber` 还不存在，「不声称它是本人证件号」的唯一出口就是
  整格沉默。编号族补上之后这一族有了落点——机构那串同样没有内置字段（库里只有 11 个内置格），
  而 `org` 档的「单位名称」早就在可提示词表里，所以「它是机构的、库里没有」这两条都不构成沉默的理由。
  于是命中之后判 `serialNumber`：气泡说「编号」＋「库里没有这一格，可在自定义字段里存下它」，
  深链带这一格自己的字段名。**闸门拦的方向一条没松：这条文本永远不许走到词典那一层被接进 `idNumber`**，
  仍是 3.5 层先决定，只是出口从 `null` 换成一个不声称证件号的角色。
- **界线画在证据来源上**：机构字样必须落在**这一格的名字载体**上才给提示——直连的 `<label>` 文本、
  `name`/`id` 属性，或**同项兄弟标签块**（组件库行栅格 `<div class="ant-form-item-label">`、
  老式 `<table>` 的 `<td>` 标签格）。把兄弟块算作名字不是放宽标准，是**对齐口径**：第 6 层为它立层
  的理由就是「这一格没有直连标签时，那块文字就是它的名字」，而深链取词的 `hintFieldKeyword`
  本来就读 `label || groupLabel`——两边此前不一致，同一句话在直连形状有提示、在行栅格没提示
  （用户真机那枚 `<input k="field1" placeholder="请输入机构证件号码" class="ant-input">` 就是这种）。
  三条都不命中、机构字样只剩 placeholder 时维持沉默（出口码 `orgCredential`）：占位符通常是
  「请输入…」那类示例文字，而那一格自己可能正写着「证件号码」——它问的是本人身份证号，
  把它说成「编号、去自定义字段找」是另一种错。演示台 ⑯ 区两行与 ⑫ 区 `#k-a4`
  （兄弟块那形，`tier="group"`）在提示侧，⑬ 区 `#k-p15` / `#k-p16` 两行在沉默侧。

三条出口按「先排除、再认串、最后共现」排：

1. **人主体豁免**（`PERSON_SUBJECT_OVERRIDE`）最先：`法定代表人` `法人代表` `法定代理人` `经办人` `办理人`
   `代理人` `负责人` `联系人` `申请人` `法人证件` `legal representative` `authorized representative`
   `contact person` `applicant` `signatory`。这些词出现时问的是那个**自然人**的证件，闸门不许连坐——
   对公表单里 `法定代表人证件号码`、柜面代办的 `经办人证件号码`、跨境清关的 `联系人证件号码`
   填的都是身份证号码，一起压掉等于把身份提示从最需要它的三张表上撤走。
   **兜住它们的是整词、不是词根**：`法人` 虽然在册，却不是 `法定代表人` 的子串（法**定**代表人），
   2026-10-18 把这一行注释掉做变异时，`经办人证件号码` 翻成编号族而 `法定代表人证件号码` 仍由词典判
   `idNumber`——真正拦住后者的是表里的 `法定代表人` 与 `法人证件` 两个整词，别把它们当成冗余摘掉。
2. **直接串**（`ORG_CREDENTIAL_ZH` / `ORG_CREDENTIAL_EN`）次之：`统一社会信用代码` `纳税人识别号` `营业执照`
   `组织机构代码` `金融许可证` `开户许可证` `登记证书` / `business registration` `company registration`
   `tax registration` `employer identification` `value added tax` `vat number` `vat id`。这些写法自己就足以判定是机构证照
   （`纳税人识别号` 里没有任何组织主体词，但中文表单上这一格问的从来不是个人税号）。
   **`EIN` 这个缩写不在任何一张表里，也不该加**：这里的判据是 `includes` 子串匹配，三字母的 `ein`
   会咬进 `meine` / `schein` / `Führerschein`（德语「我的 / 证 / 驾驶证」），把本人的证件框连坐压掉。
   所以 W-9 上裸写 `EIN` 的那一格确实不出提示，但出口码是 `noRole`（词典不收），不是 `orgCredential`；
   全称 `Employer Identification Number` 才由表里的 `employer identification` 压制。
3. **共现档**兜组合：组织主体词（`机构` `公司` `企业` `单位` `组织` `团体` `营业` `资质` `法人` `股东` `经办`
   `信用代码` `统一社会` / `company` `corporation` `organisation` `employer` `merchant` `business licen` `tax id`）
   **与** 证照词（`证件` `证照` `执照` `登记号` `注册号` `许可证` `批准号` `备案号` `信用代码` `代码` `编号` /
   `licence` `license` `registration` `permit` `certificate` `identification number` `tax number` `reg no`）
   同时出现才压。单靠组织词会连坐（`公司名称` / `单位地址` 都该提示），单靠证照词也不对（`证件号码` 问的就是本人）。
   英文那条组织词收到 `licen` 为止、不写全 `licens`：写全就漏掉英联邦拼法的 `Business Licence Number`，
   那一串会被词典的 `licence number` 接走、提示成本人证件号（2026-10-17 评审回灌）。

`org` 角色全程豁免：`公司名称` / `单位名称` / `雇主名称` 问的是组织叫什么，那是对的提示，不是误报。

**豁免开的那道口子上，词典不能再判一次**：闸门命中的人主体文本会继续往下走，最后由 label 词典决定角色，
所以机构证照那类写法**不许**同时出现在 `idNumber` 档里。`统一社会信用` 曾在，于是
`法定代表人统一社会信用代码` 走「豁免 → 词典接走」这条链，被提示成**本人**的证件号——正是 §5.1 开头
判定的唯一不可接受方向，而那一串 18 位码问的还是机构。现由第 3.5 层独占这一族写法，词典侧摘掉，
覆盖面账本用 `['法定代表人统一社会信用代码', …]` 钉住它不出提示。

### 5.2 社保参保登记表：没有 placeholder 的框为什么曾经不提示

那张表的形状是：整张表单是一张 `<table>`，标签写在 `<td class="tdBg">` 里，既不是 `<label>`、也不在任何关联属性上，
`<input>` 没有 `name`/`id`，**一格 placeholder 都没有**。于是 §2 的前五层线索同时落空，只能靠第 6 层
`groupLabelOf()`——而它头上压着四道预算（层数 ≤ 4、前兄弟 ≤ 3、块内载体 ≤ 2、**形状要像个标签**）。
最后那道「形状门」`isLabelBlock()` 原本只认 `label, th, legend, dt` 四种原生标签和类名里带 `label` 的块，
`<td class="tdBg">` 两个条件都不满足 → 标签回退拿到空串 → 第 6 层落空 → 第 7 层没有 placeholder →
第 8 层空框没有值 → `noRole`，整行静默。这正是用户实测「身份证号码 + 姓名那一行不出提示」的成因。

**修法**是在形状门里放行 `<td>`，理由不是「放宽一档」而是「这一形状本来就是标签」：

- 组件库的值显示块（EP 的 `.el-select__selected-item` 写着「手机号码」、AntD 的
  `.ant-select-selection-selected-value` 写着「中国居民身份证」）之所以要挡，是因为它们挂在代理 input 的
  前兄弟位置、是这一框的**当前值**而不是名字；而这些块没有一枚是 `<td>`。
- 「值格紧邻控件格」的形状在表格表单里不存在，且 `isLabelish`（格内不许有控件）与块内载体 ≤ 2 两道预算仍在。
- 同一 `<tr>` 里各格只认自己前面那一格，不许把上一行的名字读走。

配套还补了词典：`社会保障号码` / `社保号` / `社保卡号` / `居住证` 一类写法此前够不到。
两条通道的账本在第 6 层有专门计数守卫（演示台 `data-tier="group"` 至少 4 行、`data-tier="placeholder"` 至少 8 行），
删掉整段属性会让测试直接红，而不是静默少一类形状。

### 5.3 「申请人联系电话」曾被报成姓名

`联系人 / 收件人 / 寄件人 / 申请人 / 乘客 / 乘机人 / 入住人 / 就诊人 / 监护人 / 本人 / 户主 / 旅客 / 出行人 /
投保人 / 被保险人` 这一段是**人**的词，只有在这一格没写更具体的字段名时它才等于「姓名」。
它们原本排在 `name` 档（在 phone / idNumber 之前），于是公租房表的 `申请人联系电话` 被报成姓名、
同族还有 `联系人证件号码`、`收件人联系电话`。修法不是删词也不是给每个组合加短语，而是**把这一段搬到
`ZH_DICT` 末尾**：只写「联系人」的格子要的确实是姓名（词还在），写了「联系电话」的格子先被 phone 档接走。

### 5.4 「难记的号码」缺口勘察（2026-10-17）

前一案补的是形状，这一案补的是**词**。做法不是凭印象列字段，而是把一批候选逐条喂进真分类器看落点：标签与占位符共 184 条
（中文标签 118 / 英文标签 59 / 占位符 7，按证件编号、人口属性、联系方式、职业经济、地址细分、教育家庭、
车辆其他七组排）、属性写法 130 条（`name` 81 / `autocomplete` 48），误报收窄后再跑 91 条对照。
候选逐条按 `suppress` 出口码分桶、再逐条看命中侧有没有把别的字段吃掉。
勘察脚本跑完即删（不入库），**留在仓库里的只有两份账本**：覆盖面账本本轮新增 54 行（156 → 210）、
演示台新增 10 行（整页受检字段 126 → 136），两边同源于同一批词典改动。

判「该不该收进词典」用的是两条轴，而不是一条：

1. **那一串值难不难记**——性别、民族、婚姻状况一句话就能填，提示与否没有价值；
   证件号、卡号、税号是一串人记不住的数字，才是这一功能的收益区。
2. **库里有没有那一格**——`identity/fields.ts` 的内置字段只有 11 项，指不到格子的角色提示出来只是空跳转。

证件号族按一把更窄的尺子挑：**那一串数字本身就是这个人的证件号**。
`驾驶证号` `回乡证号` `社会保障卡号` `医保卡号` `个人税号` / `个税编号` 在中国都等于身份证号，
所以提示到库里的 `idNumber` 是对的落点；`SSN` `NINO` `Social Security Number` `Personal Tax Number`
`Driving licence number` `Medicare number` 同族。按这把尺子，`学历证书编号` `教师资格证编号`
`医师资格证号` `驾驶证档案编号` `社保电脑号` `保单号` 当时**一律不收**——它们各自成串、都不等于身份证号，
提示成「证件号」会把人往身份证号上引。2026-10-18 这一族由沉默翻成提示，但**翻的是落点、不是这把尺子**：
它们仍然不许挂 `idNumber`，改挂新角色 `serialNumber`，落点是身份库的自定义字段（§5.6）。
同一把尺子也决定了这一档的短语**必须带「号」收口**：裸「驾驶证」会吃进车管所那串 12 位档案编号，
裸「个税」会吃进薪酬表的「个税(元)」扣缴金额——两条都是 §5.5 评审回灌抓出来的误报。
`回乡证号` 是一条**已知分叉**：同一张证的全称 `港澳居民来往内地通行证号码` 由 passport 档接走（它写着「通行证」三字），
而省写「回乡证号」按本族尺子落在 `idNumber`。账本两条各钉一处，这个差异是拍板的结果，不是漏网。

银行账号侧补的是英文与属性两个通道：`Bank account number` `IBAN` `Sort code` `Routing number`
进 `EN_DICT` 的 `cardNo`，`bankAccountNumber` `sortCode` `routingNumber` 进 `CARD_ATTR_DICT`（必须进那张表而不是
`ATTR_DICT`，理由见 §4.1——裸 `account` 词元在账号守卫那一层就已经被判成登录字段了）。
地址细分补的是快递面单与公租房表拆出来的格子：`单元` `房间号` `房号` `楼层` `House number`
`Apartment number` → `address`，`乡镇` `村委会` 与属性侧的 `birthPlace` `placeOfBirth` `countryOfBirth` → `region`。

**这一轮抓出的四条误报全部是「子串判据吃进相邻语义」**，收口方式是收窄正向短语、而不是无休止地加负向词：

- `出生证编号` / `出生医学证明号` 被判成 `birthday`——根因是生日档收了裸「出生」。
  把它收窄成 `出生日 / 出生年月 / 出生时间 / 生日` 四条，`出生日期` 一类照常接住，`出生地` 仍由更早的
  region 档接走。**这一条曾在负向表里补过一枚 `'出生证'`，词典收窄后它就是死规则，已摘除**——
  同一句话只在最早生效的那一层拦一次，负向表不是词典宽窄的兜底。
- `身份证有效期止` 被判成 `idNumber`——那一格问的是日期，库里没有。负向表补 `'有效期'`，
  顺带把 `信用卡有效期` 的出口码从 `noRole` 变成 `negative`（气泡行为一字未变，
  但「这一格为什么没提示」从此有一个可对账的答案，演示台夹具跟着改了这一行）。
- `与申请人关系` 被判成 `name`（§5.3 那一段「人」词吃进来的）、`单位性质` 被判成 `org`、
  `户籍性质` 被判成 `region`、`IP地址` 被判成 `address`、`Ethnicity` 被判成 `region`
  ——分别补负向 `'关系' '性质' 'ip地址' 'ethnicity'`。
- 属性侧 `name="birth_place"` 曾被切出来的 `birth` 词元抢成生日。修法不是摘掉 birthday 档里那枚裸 `birth`
  （`name="birth"` 问的确实就是出生日期），而是让 region 只收**完整词元**
  （`birthplace` `placeofbirth` `countryofbirth` `birthcountry`）并排在 birthday 之前——`birth_place`
  整串粘回 `birthplace` 就被 region 接走，两条结论各归其位。

### 5.5 评审回灌：13 条先 RED 的误报，六处收口，两条主张被证伪（2026-10-17 同日第二轮）

收口后派出的评审把这张词典逐条按「新裸子串 / 负向吞角色 / 层序 / 属性表先后 / 够不到的词 / 文字比实现强」
六问扫了一遍，报回一批主张。处置方式跟 §5.4 一样：**先拿真分类器跑**（两轮临时探针，跑完即删、不入库），
主张逐条要么给出读数、要么作废；读数坐实的每一条先写进覆盖面账本看它红（13 条红），再动词典。
账本因此从 210 行走到 227 行，+17 例逐类闭合：8 条误报边界、3 条带 `no` 缩写的英文正向、
3 条社保卡金融账号侧的中文正向、1 条机构证照（英联邦拼法）、1 条属性词元、1 条合串负向形状。
那 13 条红不是回忆出来的——把新账本单文件拷进改动之前那棵树（`7197c2a`）的同构隔离树跑一次，
`assertionResults.length=227`、`numFailedTests=13`，剩下的 4 条（三条 `no` 正向与那条 `个人所得税`）
当时就是绿的，它们钉的是「收窄之后仍要判对」那一半。

六处收口，方向全是**把正向短语改窄**或**把闸门词元改宽**，没有新增一枚负向词：

| 误报（评审报回、探针复现）                                                   | 读数                                                              | 收口                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `驾驶证档案编号` / `驾驶证编号` → idNumber                                   | 车管所那串 12 位档案号被裸「驾驶证」接走                          | 短语带「号」收口：`驾驶证` → `驾驶证号`                                             |
| `个税(元)` / `代扣个税` → idNumber                                           | 薪酬表的扣缴金额被裸「个税」接走                                  | `个税` → `个税号` `个税编号`（`个人所得税` 不含相邻二字，天然沉默）                 |
| `医保卡金融账号` / `社会保障卡银行账号` → idNumber                           | 社保卡**另一面**那串银行账号被「医保卡 / 社会保障卡」六个字先接走 | 卡号档补一条 `金融账号 / 金融账户 / 银行账号 / 银行帐号 / 银行账户`，排在社保档之前 |
| `name="account_number"` 在两步登录页 → cardNo                                | 第二步才出现的密码框不在同一字段组，登录容器守卫拦不住            | `CARD_ATTR_DICT` 摘掉裸 `accountnumber`，只收 `bankaccountnumber`                   |
| `Social Security Tax` / `Medicare Levy` / `Health Insurance Plan` → idNumber | 薪酬与险种页问的是金额 / 险种                                     | 三条英文短语各拆 `number` / `no` 两种带号收口                                       |
| `Business Licence Number` → idNumber                                         | 机构闸门里那枚词元写的是 `business licens`，只认美式拼法          | 词元改到 `business licen`，`licence` 拼法一并进闸门                                 |

两条主张**探针没能坐实，作废**：

- 「`EN_DICT` 里的 `tax id` 是死规则」——不成立。`Applicant Tax ID`、`Legal Representative Tax ID` 实测由
  人主体豁免先放行、再由这条短语接住；不带人主体词的 `Tax ID` / `Personal Tax ID` 仍按机构证照压住，
  那是 §3.5 闸门既有的取舍（方向是安全侧），不是这条短语够不到。
- 「裸 `nino` 会把意大利人名 `Antonino` 读成证件号」——形状不成立。文本通道只读标签 / 占位符 / 属性，
  不读用户敲进去的值；要让 `Antonino` 进判据，得有一格**标签本身**写着人名。

三处**刻意接受的代价**，钉进账本而不修：`单元测试` / `部署单元` / `楼层数` 仍落 address（目标页面里
「单元 / 楼层」压倒性地指住址细分，为开发者页面的罕见写法堆负向词，与 §5.4 的原则相反）；
负向档吃的是 label + placeholder + 属性的**合串**，所以「身份证号码」配「18 位，有效期内」的占位符会整体沉默
（漏报方向是安全侧，账本钉住这条形状，免得日后被当成 bug 改回去）；`Nursing License Number` 一类职业执照的
省写仍落 idNumber（英文表单上裸 "licence number" 绝大多数指驾驶证，收窄它要再补两枚负向词，不划算）。

### 5.6 编号族翻案：沉默改成「提示 + 说出落点」（2026-10-18）

驱动这一轮的是一条用户评论：「现在身份信息库中的自定义字段不能搜索嘛？这些证件号和编号可以放到自定义字段里面呀」。
**先把这句话的前提跑了一遍**再动手：身份库的检索侧 `collectSearchableFields` 本来就把自定义字段的
**标签与值**都收进搜索面（那条特征测试现在钉在 `tests/composables/useIdentityVault.test.ts`），
所以用户问的「不能搜索嘛」答案是「能」——真正的缺口只有两处：

1. 分类器侧没有一档能**不声称证件号**地接住这一族（§5.4 的尺子只能让它们沉默）；
2. 气泡点「从身份库选择」时，深链带过去的搜索词**只有本人姓名**，那一族即便提示了也跳不到对的格子。

于是新增角色 `serialNumber`（第 17 档，中英 label 18 + 7 条短语、属性 9 个词元，全部带**证书 / 单据名 + 号 / 编号**
收口，不收录裸「编号」也不收录裸 `number`），并把它的落点显式写进气泡：`utils/identity/hintRoles.ts` 里新增
`CUSTOM_FIELD_LANDING_ROLES = ['serialNumber']` 那张表被 `buildBubble` 用来决定是否多附一句
「库里没有这一格，可在自定义字段里存下它」。之所以做成**一张表**而不是在气泡里判角色名：以后再有「库里没有那一格」
的角色，加进表里气泡文案与深链取值两条通道会一起跟上，`identityHintWiring.test.ts` 会要求分派器重新表态。

深链的取值口径按角色分派（`pickSearchKeyword()`，`entrypoints/content/IdentityHint.ts`）：
编号族带的是**这一格叫什么**（标签文字，退而取同项兄弟标签，两端装饰字符 `\*＊:：、。.，,;；·—_-` 剥掉），
其余角色维持原来的本人姓名。两条通道刻意不同源，因为落点不同——姓名那一族搜的是「这个人存过的值」，
编号族搜的是「用户自拟的那一格」。**它与姓名通道共用同一份 64 字上限**（`utils/keywordMatch.ts` 的
`normalizeSearchKeyword`），这是全仓检索词长度的单一真源，第三条通道将来也必须是它。
三条安全边界跟原口径一致：取值只在**点下按钮那一次**发生（聚焦期间不读，否则明文在闭包里活整段聚焦时间）、
**读的是标签文字，永不读这一框里已经填的值**、跨入口载荷仍然只有 `{ keyword }` 一个标签且后台不写日志。

词典排布上有一条**必须留名的先后关系**：`serialNumber` 档排在 `idNumber` 之前。反序的话
`社保卡电脑号` 会被「社保卡」三字先接走、报成证件号，而深圳那一串 8 位电脑号根本不是身份证号。
这一对（`社会保障卡号 → idNumber` / `社保卡电脑号 → serialNumber`）与「编号族三条边界仍沉默」
一起钉在 `piiClassifier.coverage.test.ts`，演示台 ⑯ 区也跟着改了那一行的 `data-expect`。

验证：覆盖面账本与演示台先红后绿（整页受检字段 137 → 148 行，新区 11 行 + 翻案 1 行改判）；
角色闭集从 16 抬到 17，`piiClassifier.demoPage.test.ts` 那句「十七个可提示角色在本页全部出现过」现在
除了硬编码清单还会拿 `IDENTITY_HINT_ROLES` 的真实词表来对账，**下次再加一档而没在演示台摆行，这里会红**。
七道变异逐个做过：把分派判据换成硬编码角色名、把 `CUSTOM_FIELD_LANDING_ROLES` 的引用摘掉、
把取值通道换成读 `input.value`、把装饰剥离正则摘宽、把 64 字上限就地写死、把调用点挪进展示路径、
把空白载荷写成空串键——每一处都只在预期的那一条用例上红。

**落点那一侧同轮补了一条出路**（2026-10-18 同日）：气泡说「可在自定义字段里存下它」，但用户从没
建过那一格时，点进身份库看到的是 `IdentityVaultDialog.vue` 的「没有匹配的身份信息」空态，原本
唯一的动作只有「清除筛选」——指路的话说了，路没铺完。现在空态多一行**把当前搜索词插进去**的
说明（`identity.noMatchHint`，中英各一条）与一枚复用工具栏同一条 `$emit('add')` 的添加按钮，
两者都只在**有搜索词**时出现（只按类别筛空的那些形里这句话会乱指路）。守卫在
`tests/architecture/identityLookupFromDetailWiring.test.ts`，按本仓惯例做源码扫描：三条判据
**各自切元素再断言**，因为 `v-if="keyword.trim()"` 在这一块里出现两次（说明行与按钮各一次），
整块匹配会被另一处救活——第一版就是这么写的，M6 变异摘掉说明行的 `v-if` 后守卫照样绿。

## 6. 覆盖矩阵：17 个可提示角色

角色闭集定义在 `utils/identity/hintRoles.ts`；气泡文案是 `utils/i18n-lite.ts` 的 `cs.identity.role.*`（中英各一份，
由 `tests/utils/identityHintRoles.test.ts` 钉住词表与语言包同步）。下表三列都是**代表性写法**（词元列为节选，
完整集合以 `ZH_DICT` / `EN_DICT` / `ATTR_DICT` 为准），覆盖面账本里另有一批同族用例
（`tests/content/piiClassifier.coverage.test.ts` 的 `ZH_LABEL_CASES` / `EN_LABEL_CASES` / `ATTR_CASES` / `SCENE_CASES`
四张表，一行 = 一条用例）。

| 角色                | 中文标签（代表写法）                                                                                                           | 英文标签                                                                                                       | `name`/`id` 词元                                                                                                               | 库里有这一格的值吗      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `name` 姓名         | 姓名 / 名字 / 真实姓名 / 户主姓名 / 参保人姓名 / 乘机人姓名 / 投保人姓名 / 联系人 / 收件人 / 申请人 / 本人                     | full name / real name / preferred name                                                                         | name, realname, fullname, personname                                                                                           | ✅ `name`               |
| `givenName` 名      | 名（逐字相等）                                                                                                                 | given name / first name / forename                                                                             | givenname, firstname, forename, given, fname                                                                                   | ➖ 由 `name` 承担       |
| `familyName` 姓     | 姓（逐字相等）/ 姓氏                                                                                                           | last name / family name / surname                                                                              | familyname, lastname, lname                                                                                                    | ➖ 由 `name` 承担       |
| `phone` 手机号      | 手机 / 电话 / 联系电话 / 联系方式 / 联系号码 / 移动电话                                                                        | mobile / phone number / telephone / contact number / landline                                                  | phone, mobile, tel, telephone, msisdn, contactnumber, landline                                                                 | ✅ `phone`              |
| `email` 邮箱        | 邮箱 / 邮件 / 电子信箱                                                                                                         | email / e-mail                                                                                                 | email, emailaddress, mail                                                                                                      | ✅ `email`              |
| `address` 详细地址  | 地址 / 详细地址 / 街道 / 门牌 / 小区 / 住址 / 居住地 / 楼栋 / 单元 / 房间号 / 楼层                                             | address / street address / delivery address / mailing address / home address / house number / apartment number | address, addr, street, addressline, doorno, housenumber, apartment, unitnumber, roomnumber                                     | ✅ `address`            |
| `region` 所在地区   | 所在地区 / 省份 / 城市 / 区县 / 户籍 / 籍贯 / 出生地 / 社区 / 参保地 / 缴存地 / 乡镇 / 村委会                                  | state / province / city / region / country of birth                                                            | region, province, city, district, state, nativeplace, birthplace, placeofbirth, countryofbirth                                 | ➖ 常在 `address` 里    |
| `postal` 邮编       | 邮编 / 邮政编码                                                                                                                | postcode / zip code / zipcode                                                                                  | postalcode, zipcode, zip, postcode                                                                                             | ➖ 常在 `address` 里    |
| `idNumber` 证件号   | 身份证 / 证件号 / 社保卡号 / 社会保障号 / 居住证 / 警官证 / 士兵证 / 台胞证 / 永久居留 / 驾驶证号 / 回乡证 / 个人税号 / 个税号 | id card / national id / driving licence number / tax number / national insurance / ssn / medicare number       | idcard, idcardno, certno, ssn, nino, nationalid, socialsecuritynumber, taxid, driverlicense, licensenumber                     | ✅ `idNumber`（secret） |
| `serialNumber` 编号 | 学历证书编号 / 毕业证号 / 学位证书编号 / 教师资格证编号 / 档案编号 / 驾驶证编号 / 电脑号 / 保单号 / 个人编号                   | serial number / certificate number / diploma number / policy number                                            | serialnumber, certificateno, certificatenumber, diplomanumber, policyno, policenumber, qualificationno                         | ➖ 走 `customFields`    |
| `passport` 护照号   | 护照 / 通行证 / 签证                                                                                                           | passport                                                                                                       | passport, passno, travelcert                                                                                                   | ➖ 走 `customFields`    |
| `birthday` 出生日期 | 出生日 / 生日 / 出生年月 / 出生时间（刻意**不收**裸「出生」，见 §5.4）                                                         | date of birth / birth date                                                                                     | birthday, birthdate, dob                                                                                                       | ➖ 走 `customFields`    |
| `gender` 性别       | 性别                                                                                                                           | gender / sex                                                                                                   | gender, sex                                                                                                                    | ➖ 走 `customFields`    |
| `org` 单位名称      | 公司 / 单位 / 院校 / 学校 / 雇主                                                                                               | company / organisation / employer / school                                                                     | company, corp, org, organization, employer                                                                                     | ➖ 走 `customFields`    |
| `cardNo` 银行卡号   | 卡号 / 银行账号 / 银行账户 / 金融账号 / 信用卡号 / 借记卡号 / 储蓄卡号 / 账户号                                                | card number / credit card number / bank account number / iban / sort code / routing number                     | （走 `CARD_ATTR_DICT`，见 §4.1）iban, bankcard, creditcard, debitcard, bankaccount, bankaccountnumber, sortcode, routingnumber | ✅ `cardNo`（secret）   |
| `cardHolder` 持卡人 | 持卡人 / 开户人 / 户名 / 开户名 / 账户姓名                                                                                     | cardholder / card holder / account holder                                                                      | cardholder, accountname                                                                                                        | ✅ `cardHolder`         |
| `cardBank` 开户银行 | 开户行 / 开户银行 / 银行名称 / 发卡行 / 所属银行                                                                               | bank name / issuing bank                                                                                       | bankname, bank                                                                                                                 | ✅ `cardBank`           |

「库里有这一格的值吗」这一列决定的是提示的**实用性上限**：`identity/fields.ts` 的内置字段只有
`name / idNumber / phone / email / address / cardNo / cardBank / cardHolder / cardExpiry / cardCvv / remark`，
其余角色提示出来仍然有用（点「从身份库选择」带的是搜索词，用户能在自定义字段里找到值），
但它们不是库里的一条内置字段。这一列写 `➖` 的角色里，只有 `serialNumber` 那一档的**落点本身也不在库里**，
所以它由 `CUSTOM_FIELD_LANDING_ROLES` 单独列出：气泡因此多附一句「存成自定义字段」，
而深链带过去的搜索词换成**这一格叫什么**（标签文字），不再带本人姓名——姓名在那一格是搜不出来的（§5.6）。
**这一档今天接两族写法**：上表这三列里的编号族，加上由第 3.5 层闸门改判进来的机构证照号（§5.1）。
后者**刻意不在这三列里**——它不从词典进来，三张表里也没有任何机构词；把机构词补进词典就等于
把「先拦再判」那条通道架空，「被词典接进本人证件号」那个错会重新漏回来。

需要**二次核对**（`needsVerify`，提示语额外带「请核对后再取用」）的角色：`idNumber` `serialNumber` + 可提示的卡类三档
（库里按高敏字段加密），以及任何归属判为 `confirm` 的框。编号族归入这一档的理由与证件号相同：
那一串是证书 / 保单上的编号，取错一位就是另一本证。

## 7. 刻意不覆盖：宁可不提示，也不给一句「库里没有的东西」

本节按写法逐条列「这一格为什么沉默」。**第一条与第三条要分开读**：编号族（第三条）已于
2026-10-18 从沉默翻成会提示的 `serialNumber`，机构主体的证照号（第一条）同日把出口也换掉了——
两条留在本节，是因为它们翻的都是**落点**，没翻各自那把尺子（前者不许挂 `idNumber`，
后者永远不许被词典接进本人证件号）。

- **机构主体的证照号：只有弱线索那一侧仍沉默**。`机构证件号码` `统一社会信用代码` `营业执照号码`
  `纳税人识别号` `组织机构代码` `金融许可证编号` `金融业务资质证件号码` / `Company Tax Number`
  `Employer Identification Number` `Business Registration Number` `Business Licence Number` `VAT Number`
  这些写法**落在这一格的名字载体上时判 `serialNumber`**——直连 `<label>`、`name`/`id` 属性，
  或同项兄弟标签块（组件库行栅格 / `<td>` 标签格，`tier="group"`）；同一句只剩 placeholder 时
  才仍走 `orgCredential` 沉默（见 §5.1）。`Business Licence Number` 那条是 2026-10-17 评审回灌
  补上的英联邦拼法（§5.5 第 3 条）。**裸缩写 `EIN` 两种形状都不出提示，但出口码是 `noRole` 不是
  `orgCredential`**——它压根不在闸门词表里，为什么不收见 §5.5 第 2 条。
- **单据号与金额**：`运单号` `快递单号` `保价金额` `建筑面积` `月平均缴费基数` `家庭月收入` `注册资本`
  / `Social Security Tax` `Medicare Levy` `Health Insurance Plan`（薪酬与险种页的金额 / 险种，英文侧同族误报，见 §5.5）。
- **各证自成一串的「编号」族**：这一条**已于 2026-10-18 从「不覆盖」翻成 `serialNumber`**，
  翻的是落点而不是 §5.4 那把尺子——`学历证书编号` `学位证书编号` `教师资格证编号` `医师资格证号`
  `驾驶证档案编号` `驾驶证编号` `社保电脑号` `公积金个人编号` `出生证编号` `出生医学证明号` `保单号`
  仍然一律**不许挂 `idNumber`**，改成提示成「编号」并明说存成自定义字段（§5.6）。
  这一族留下的沉默边界是**「这一单」而不是「这个人」的编号**：`编号`（裸词）`订单号` `发票号码`
  `运单号` `快递单号` 继续 `noRole`，账本按这两侧各钉一处。
- **登录语义**：`用户名` `账号` `密码` `验证码` `安全码` `动态口令` / `username` `password` `one-time code`，
  以及只有属性没有标签文字的 `name="account_number"`（两步登录页的账号框，出口码 `account`，见 §4.1）
  （出口码 `negative` / `account` / `card`）。
- **一定是别人的字段**：`紧急联系人姓名` `担保人身份证号` `受益人姓名` `配偶姓名` `代收人` `被访人` `父母` `子女`
  / `emergency contact` `guarantor`（命中 `OTHER_BLOCK`，归属 `other`，出口码 `ownership`）。
  **同族的「监护人」与 `Guardian` 不在这张表里**，那是已知缺口、不是覆盖项，见 §11 第二条。
- **库里装不下的人口学字段**：`国籍` `民族` `婚姻状况` `最高学历` `区号` / `Ethnicity`。
- **元信息与事物名**：`证件类型` `证件有效期` `地址标签` `银行卡类型` `物品名称` `商品名称` `职业` `毕业院校`
  `单位性质` `户籍性质` `与申请人关系` `IP地址`（`名称` / `方式` / `账号` 三条例外之外仍按负向处理；
  后四条是 2026-10-17 补的负向短语，理由逐条写在 §5.4）。
- **卡类口令**：`CVV` `有效期` 走 `autocomplete` 那条（`cc-csc` / `cc-exp`）——识别得到也永不提示，
  类型层面 `cardExp` / `cardCvv` 就不进可提示词表，出口码 `card`。
  而**纯文字**写法的「信用卡有效期」「身份证有效期止」现在更早就被负向档 `'有效期'` 拦下，出口码 `negative`：
  负向档吃的是 label + placeholder + 属性的合串，所以这一族有两条可对账的出口，别把它们当成同一条（§5.4 补的）。

## 8. 从分类器到「画出一枚气泡」：页面侧五道门

分类器判出角色之后还要过五道守卫，才轮到 `showIdentityHint()`（`entrypoints/content/FormDetector.ts` 的
`handleIdentityHintOnFocus`）：

| 门         | 判据                                                                                                 | 为什么存在                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 总闸       | `!this.identityHintEnabled` 直接返回（getter 内部就是 `!== false`，与设置面板的显示态同一个口径）    | 关闭即完全不出现，页面不注入任何扩展 UI                                                                                                                                                             |
| 顶层 frame | `window !== window.top`                                                                              | `allFrames` 注入让脚本在每个 iframe 各跑一份；广告 / 统计 iframe 里的气泡既不在注视点上，又给页面脚本多一个可反复触发的扩展 UI                                                                      |
| 控件三类   | `target.matches('input, textarea, select')`                                                          | 详细地址常用 textarea、地区与性别常用 select；包裹元素上挂气泡没有意义                                                                                                                              |
| 只读不参与 | `'readOnly' in target && target.readOnly`                                                            | 气泡唯一的动作是「把这格填上」，而组件库的日期 / 下拉代理框、页面回写的灰底框焦点进得去、键盘打不进。不看 `disabled`——它压根拿不到焦点                                                              |
| 登录让位   | 角色 ∈ `SIDE_PANEL_FILLABLE_ROLES`（只有 `phone` / `email`）**且** `shouldShowSidePanel(input)` 为真 | 快速填充真正认领的字段由钥匙图标负责。判据取 `shouldShowSidePanel` 而非桶归属：用桶归属会把注册页手机号框一起挡掉。钥匙挂得上但**填不出值**的那一档（证件号被旧分桶读成手机号框）不让位、由提示顶上 |

还有一条整页条件要知道：`shouldShowSidePanel` 末尾的兜底是「**同一份文档里只要存在账号 + 密码对或登录按钮**，
落进 username / mobile 桶的框一律算在登录表单里」。所以「这框没有气泡」在真实页面上还可能是这条判据在起作用，
演示台的页头逐行列出了被它收进的框。

### 8.1 总开关：已存在，不需要新加（2026-10-17 评估）

`identityHintEnabled` 就是这枚功能的全局总闸，四条口径要一次说清：

- **入口两处，共用同一份面板**。悬浮按钮设置面板第 5 项「个人信息字段提示」，以及管理页与侧边栏的
  「偏好设置」弹窗——三处都走 `getSettingsPanelHTML()` / `bindSettingsPanelView()` 这一个真源，
  所以**把悬浮按钮隐藏掉也不会失去开关**（写配置的那条 `onConfigChange` 只发被改动的那一个键）。
- **默认开，且「未写即开」**。存量用户的配置对象里根本没有这个键，判据是 `!== false`；面板的显示态
  （`isSwitchOn`）与页面侧的门（`identityHintEnabled` getter）读同一个口径，两处各写一份时
  老配置就会出现「面板显示关、实际还开着」。
- **关掉之后成本归零、并当场收掉在屏的那枚**。门排在最前，词典与 DOM 一律不扫；从别的上下文拨到关时，
  存储监听会调 `hideIdentityHint()` 把已经可见的那枚收起，不需要用户先点别处或刷新页面（口径同
  `penetrateShadow` 翻转后重检测）。开回去不需要动 UI——下一条该出的气泡自然会出现。
- **它是体验门，不是隐私门**。这一档从头到尾不填值、不落盘、不发网络请求，跨入口载荷恒为 `{ role }`，
  库内明文始终不出管理页。真正的隐私边界在存储与加密层，所以「关掉它」的收益是安静，不是安全。
  反过来说：因为最坏后果只是「多一枚气泡」，默认开是站得住的取舍。

因此本轮只补上面那条「关闸即收起」的一致性，不动默认值、不加档位、不加第二枚开关。

## 9. 出口码表（只进日志与单测，不进用户可见文案）

| `suppress`      | 谁给的                                              | 典型写法                                                                     |
| --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `excluded`      | 第 1 层结构性排除                                   | `type="password"` / `hidden` / `checkbox` / 搜索框                           |
| `negative`      | 第 3 层负向短语、第 4 层负向词元                    | `用户名` / `验证码` / `物品名称` / `name="occupation"`                       |
| `orgCredential` | 第 3.5 层机构证照闸门的**只剩占位符那一侧**         | `<label>证件号码` + `placeholder="机构证件号码"` / 只有 placeholder 的那两形 |
| `account`       | 第 4 层账号词元守卫                                 | `name="user_account"` / `login_id`                                           |
| `card`          | 第 2 层卡类 autocomplete                            | `autocomplete="cc-csc"` / `cc-exp`                                           |
| `ownership`     | `resolvePiiField` 收口                              | 紧急联系人 / 担保人 / 受益人 / 配偶                                          |
| `loginGroup`    | `looksLikeLoginGroup`（最小字段组内有非卡类口令框） | 登录框与身份框同在一个 `<label>` 里                                          |
| `noRole`        | 各层全空，或弱线索闸门挡下                          | 空框 + 无标签；`机构主体` 的兄弟标签；两条弱线索互相矛盾                     |

## 10. 加一档要改哪些落点

1. `utils/identity/hintRoles.ts`：`IDENTITY_HINT_ROLES` 加角色（闭集，不在表内的角色串一律当「无身份语义」）。
2. `utils/i18n-lite.ts`：`cs.identity.role.<key>` 中英文各一条（漏一边就是语言不一致）。
3. 词典：`ZH_DICT` / `EN_DICT` / `ATTR_DICT`（或卡类专用的 `CARD_ATTR_DICT`）/ `AUTOCOMPLETE_MAP`，
   并注意 §3 末尾那四处先后关系。
4. 压制与核对口径：`CARD_HINT_ROLES` / `CARD_SECRET_ROLES` / `VERIFY_ROLES` / `OTHER_BLOCK` / `OTHER_CONFIRM`；
   库里没有那一格、落点要靠自定义字段的角色还要进 `CUSTOM_FIELD_LANDING_ROLES`（进了就自动带那句落点说明，
   并且 `pickSearchKeyword()` 会把它切成按字段名检索——`identityHintWiring.test.ts` 要求分派器引用这张表）。
5. 测试：`piiClassifier.coverage.test.ts` 加表行（一行 = 一条用例）；`piiClassifier.test.ts` 钉形状与守卫；
   `piiClassifier.demoPage.test.ts` 的十七角色清单要同步（那份清单现在会跟 `IDENTITY_HINT_ROLES` 的真实词表
   对账，只加角色不加用例是过不了的）；演示台 `docs/fixtures/identity-hint-demo.html` 加
   `data-expect` 行（真机 e2e 从页面 DOM 读账本，不需要改测试）。
6. 库侧：该角色在 `utils/identity/fields.ts` 有没有内置字段；没有就要在文档里写明它靠 `customFields` 承载，
   并回答「深链带过去的搜索词是什么」——只有那一族是**字段名**，其余都是本人姓名（§5.6）。
7. 文档：`docs/ARCHITECTURE.md`（及 `.en.md`）「功能实现详解」的身份库一节、侧边栏 `help.json` 词条、
   对外四处（README / index.html / HelpDialog / CWS）里涉及该功能的描述。

## 11. 已知缺口与待拍板

- **旧分桶会把带「号码」的框读成手机号框**：`formSelectors.ts` 的 `MOBILE_KEYWORDS` 含 `号码`，
  于是「请输入证件号码」这类 placeholder 的框会挂上快速填充钥匙。分类器侧已按「钥匙填不出值就不让位」处理
  （提示照常出），但**桶本身的宽判据没收窄**——它同时服务于账号候选排序，收窄会影响登录检测，属待拍板项。
- **「监护人」既不在 `OTHER_BLOCK` 也不在 `OTHER_CONFIRM`**：实测 `监护人姓名` 判的是 `role='name'`、
  `ownership='self'`、`needsVerify=false`——同族的 `配偶姓名` / `紧急联系人姓名` 会被 `other` 整条压制，
  而「给未成年人或老人代办」那一格会以「本人姓名」的口吻提示。英文同族更分裂：`Guardian ID Number` 同样判
  `idNumber` + `self`（带「请核对」），而 `Guardian Name` 判 `noRole`——它沉默是因为 `EN_DICT` 的 name 档
  不收裸 `name` 这个词，**是巧合不是设计**，别把它当成已覆盖。要不要把这一族抬到 `other`（不提示）或
  `confirm`（提示但要求核对）是产品口径，需拍板；抬之前这条差异要如实记在这里。
- **公司地址 / 公司电话是否也按机构主体压制**：现在 `公司电话` 判的是 `phone`（本人填表时经常写自己单位号码）。
  闸门只压「机构 + 证照号」，没压「机构 + 联系方式」，这条口径要不要改属待拍板。
- **提示范围要不要收到「可输入的 input / textarea」**：用户在本轮口径里说的是「只考虑 input 输入框或者 textarea
  文本框且可以输入的场景」，而 §8 的控件门现在是 `input, textarea, select` 三类——`性别` `省份` `所在地区`
  这类 `<select>` 焦点进得去、照样出气泡（演示台 ① 区性别框与 ⑯ 区下拉就是这一读数）。
  把 select 摘掉是**删功能**而不是补漏报：那一档一旦不提示，用户就得自己去身份库里翻，
  而政务表里「所在地区 / 参保地」的下拉恰恰是最常被问到的格子。因此本轮**不动这一判据**，
  只把差异如实记在这里；要收口需用户拍板（拍板后改动点就在 §8 那一行，页面侧一道门，词典与账本不受影响）。
- **`<select>` 与 `<textarea>` 不参与登录让位**：让位判据只看 `HTMLInputElement`，
  所以地址 textarea 永远出提示。这是既有行为，不是缺陷。
- **同一框第一次被问的时机会影响读数**：`LoginFormAnalyzer` 把整页兜底的答案按元素缓存在 `WeakMap` 里，
  只在重新检测时清。真机用例因此在扫描前加了「检测落定门」（登录区用户名框上出现钥匙才算落定）。
- **升级后要不要给一次「这枚气泡是什么、在哪关」的引导**：默认开意味着存量用户升级后页面会多出一枚
  过去没有的气泡，而唯一的解释性文案在设置面板那条 tip 里，用户未必会去点开。做成一次性通知要新增
  存储键 + 中英文案 + 一条生命周期，属交互变化，**留给用户拍板**（§8.1 已论证默认开本身站得住）。
- **要不要支持逐站点关掉提示**：`penetrateShadow` 有「全局总闸 + 站点规则再关一次」的先例，
  身份提示没有。加它要动站点规则 JSON schema（该结构的导出版本按拍板保持 1）、导入导出与 UI 四列宽度，
  代价远大于「全局关一次」的收益，**同样留给用户拍板**，本轮不做。
- **裸缩写 `EIN` 的沉默没有用例钉住**：2026-10-18 改判之后这一族的十一行都归到 `serialNumber`，
  而 `EIN` 仍靠「词典不收 + 注释与本文记着」沉默（出口码 `noRole`，见 §5.5 第 2 条）。
  往 `NOT_COVERED_CASES` 加一行就能钉住，代价是例数 +1 ⇒ 对外 35 处用例数位重刷 ＋ 一整轮门禁，
  所以本轮只把差异记在这里，**加不加由用户拍板**。

## 12. 这份逻辑由哪些账本守着

| 账本                                              | 吃什么                                                                                                                                      | 数量           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `tests/content/piiClassifier.test.ts`             | 每条钉一个「形状 / 守卫为什么存在」                                                                                                         | 形状与回归用例 |
| `tests/content/piiClassifier.coverage.test.ts`    | 每张表一行一条用例：中英标签 / 属性词元 / 五类国内场景 / 机构证照 / 人主体豁免 / 库里没有的概念                                             | 覆盖矩阵       |
| `tests/content/piiClassifier.demoPage.test.ts`    | 把演示台整页读进 jsdom，逐行对 `data-expect` / `data-suppress` / `data-tier`，并守「17 角色全出现过」「group ≥ 4 行」「placeholder ≥ 8 行」 | 命中率         |
| `tests/content/formDetector.identityHint.test.ts` | 页面侧五道门与让位                                                                                                                          | 门             |
| `tests/architecture/identityHintWiring.test.ts`   | 跨入口契约：角色不过界、深链载荷只有一个标签、取值分派器只有一份定义且必须引用落点表                                                        | 接线           |
| `tests/composables/useIdentityVault.test.ts`      | 库侧检索面：自定义字段的标签与值都参与匹配——§5.6 那次翻案的前提就是这一条                                                                   | 前提           |
| `e2e/identity-hint-demo-page.spec.ts`             | 真 Chrome 里逐框聚焦，量「到底有没有气泡、报的是不是账本那个角色」，`owns=fill` 的行还要量到钥匙正钉在这一框上                              | 装完之后的行为 |

jsdom 全绿而真机红，漏的是 §8 那五道门里的某一道，不是词典；真机绿而覆盖面表红，是词典改了顺序。
