# 个人信息字段提示的匹配逻辑

> 面向「身份信息库召唤提示」（形态一：识别 + 提示 + 深链，不自动填充）。本文写的是**当前代码里真实跑的判据**，
> 每条都能在 `entrypoints/content/piiClassifier.ts` 找到对应符号；改词典或改顺序时请同步本文与
> `tests/content/piiClassifier.coverage.test.ts` 的账本。
>
> 三个具体问题的答案分别在这些小节：
> **「机构证件号码为什么不提示」** → §5.1；**「社保那张表没有 placeholder 的框为什么不提示」** → §5.2；
> **「常见字段都覆盖了吗」** → §6 覆盖矩阵与 §7 刻意不覆盖清单。

## 1. 定位与边界

- 分类器是**纯函数**：单字段进、单字段出，不填充、不落盘、不发网络请求、不写日志。
- 它只读页面的**结构信号**（`name` / `id` / `label` / `placeholder` / `autocomplete` / DOM 邻居）与**这一框自己的值**。
  值只在最后一层用于形状收口，命中时 `evidence` 写的是形状码（`id-shape`）而不是原文。
- 唯一一条明文离开页面的通道是 `selfNameValueNear()`：用户已经手打好的**本人姓名**，在点击「从身份库选择」那一刻
  取一次、只进身份库搜索框。四条边界写在该函数 JSDoc 里（只认 `role === 'name'` 且 `ownership === 'self'`、
  只在点击时调用、作用域是所在 `<form>` 且封顶 80 枚控件、交给 `normalizeSearchKeyword` 收口）。
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

| 层                 | 判据                                                                                                                                                                                                                                                                                                           | 命中后的 `tier` / `suppress`                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1 结构性排除       | `type` ∈ `STRUCTURAL_EXCLUDE_TYPES`（hidden / password / submit / button / reset / image / checkbox / radio / range / color / file 共 11 枚）、`role="searchbox"`、祖先链 4 层内像搜索容器                                                                                                                     | `suppress='excluded'`                              |
| 2 autocomplete     | 站点自声明：`CARD_AUTOCOMPLETE`（`cc-number` / `cc-exp` / `cc-csc` / `cc-name`）先，`AUTOCOMPLETE_MAP`（18 枚：`name` `given-name` `additional-name` `family-name` `bday` `sex` `street-address` `address-line1..2` `address-level1..3` `postal-code` `tel` `tel-national` `mobile` `email` `organization`）后 | `tier='autocomplete'`；卡类口令 `suppress='card'`  |
| 3 负向短语         | `ZH_NEG`（带三条例外，见下）→ `EN_NEG`                                                                                                                                                                                                                                                                         | `suppress='negative'`                              |
| 3.5 机构证照号     | `orgCredentialHit()`：屏幕前这个人没有「统一社会信用代码」可填                                                                                                                                                                                                                                                 | `suppress='orgCredential'`                         |
| 4 `name`/`id` 词元 | `CARD_ATTR_DICT`（先，见 §4.1）→ `ACCOUNT_TOKENS` → `NEG_TOKENS` → `ATTR_DICT`（切词 + 逐来源整串粘连 + 修饰词剥离）                                                                                                                                                                                           | `tier='attr'` 或 `suppress='account'`/`'negative'` |
| 5 label 文本       | `dictRoleOf()`：逐字相等档 → `ZH_DICT` 子串 → `EN_DICT` 子串                                                                                                                                                                                                                                                   | `tier='label'`                                     |
| 6 同项兄弟标签     | `groupLabelOf()` 拿到的那段文字，再过三道闸（组织主体 / 负向自检 / 与 placeholder 矛盾）                                                                                                                                                                                                                       | `tier='group'` 或 `suppress='noRole'`              |
| 7 placeholder      | `dictRoleOf(s.placeholder)`，但「机构主体 + 非 org 角色」不许自证                                                                                                                                                                                                                                              | `tier='placeholder'`                               |
| 8 已输入值形状     | `^\d{17}[\dXx]$` → idNumber；`^1[3-9]\d{9}$` → phone；`email` 正则 → email                                                                                                                                                                                                                                     | `tier='value'`                                     |
| 收口               | 各层全空                                                                                                                                                                                                                                                                                                       | `suppress='noRole'`                                |

**顺序里三处「调换就回归」的地方**（源码注释各钉了一条用例）：

1. 负向短语必须早于任何正向词元，否则 `用户名` / `Display name` 被 `name` 抢走。
2. `autocomplete` 必须早于负向短语，否则 `autocomplete="tel"` 的登录手机号先被账号守卫挡掉、又落进 `phone` 词典。
3. `ZH_DICT` 内部顺序：卡类三档在 `name` 之前（`持卡人姓名` 末尾正是 name 档短语）；证件号族里那条
   `社保卡号 / 社会保障卡 / 医保卡` 排在 `卡号` 之前（四个字里就含着 `卡号`，但它问的是社保个人编号，
   多数城市那一串就是身份证号；`社会保障卡号` 多一个「障」字，接不上「社保卡号」那串，所以整条词收在
   `社会保障卡` 上）；**`联系人 / 收件人 / 申请人` 这一段「人」词挪到整张词典末尾**（见 §5.3）。

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

- `cardNo`：`iban` `bankCard` `creditCard` `debitCard` `bankAccount` `bankAccountNo` `accountNumber` `sortCode` `routingNumber`
- `cardHolder`：`cardHolder` `cardHolderName` `holderName` `accountName` `accountHolder`
- `cardBank`：`bankName` `bank` `issuingBank`

例外只开给这十七枚具体词元（比对时用「整串粘连词元」，`accountName` 只有拼回 `accountname` 才对得上）。
裸 `account` / `user_account` / `login_id` 仍按原样判成登录字段，`piiClassifier.test.ts` 钉着这条。
`accountNumber` 之所以敢进这张表，正是因为它排在账号守卫**之后**就已够不到——它必须在同一张早一步的表里，
而欧美转账表单上 `name="account_number"` 与 `name="bank_account"` 指的是同一串。
与 `ATTR_DICT` 同一条**刻意的缺席**：不收录裸 `card` / `cardno`——中文站点同时用它指身份证号和银行卡号，
词元层面分不开，收录会把证件号框读成卡号。

### 4.2 同名不同档的先后

`ATTR_DICT` 里 givenName / familyName 必须早于裸 `name`（否则 `first_name` 的 `name` 词元先赢，
「名 / 姓」两档在最常见的属性写法上永远够不到）；`org` 排最后（`company_address` 这类带更具体角色的形状先被
address 接走，单位名只收「除了公司词元没说别的」的字段）。`name` / `company` 这类裸词还要过**同生词元核查**：
`goods_name` / `hotelName` 是事物名、`company_size` / `company_logo` 是元信息，都不算人名或单位名。

## 5. 四案归因（都是真实漏报 / 误报，不是审美选择）

### 5.1 「机构证件号码」——为什么必须沉默，以及旧行为错在哪

`证件号` / `证件号码` 都在 `ZH_DICT` 的 idNumber 档里，所以这句话本身是**认得的**。问题在于它认的是「谁的」：

- **旧实现**：机构主体的判据（`ORG_SUBJECT_ZH`）只挂在第 6、7 两层弱线索上，因为那时它要兜的是
  「组件库形状下拿不到真标签，只能靠整项闭嘴」。而真机勘察里最常见的那枚 `机构证件号码`
  挂的是货真价实的 `<label for>`，走的是第 5 层 label 通道，**两道闸门一次都碰不到**，
  于是被词典接走、提示成**本人**的证件号——用错的身份填错框，是本功能唯一不可接受的误填形态。
- **现实现**：抬成第 3.5 层闸门（`orgCredentialHit()`），吃的是 `label + placeholder + attr` 的合串，
  所以机构字样出现在哪一格结论都一样。出口码 `orgCredential`，只进日志与单测，不进任何用户可见文案。

三条出口按「先排除、再认串、最后共现」排：

1. **人主体豁免**（`PERSON_SUBJECT_OVERRIDE`）最先：`法定代表人` `法人代表` `法定代理人` `经办人` `办理人`
   `代理人` `负责人` `联系人` `申请人` `法人证件` `legal representative` `authorized representative`
   `contact person` `applicant` `signatory`。这些词出现时问的是那个**自然人**的证件，闸门不许连坐——
   对公表单里 `法定代表人证件号码`、柜面代办的 `经办人证件号码`、跨境清关的 `联系人证件号码`
   填的都是身份证号码，一起压掉等于把身份提示从最需要它的三张表上撤走。
2. **直接串**（`ORG_CREDENTIAL_ZH` / `ORG_CREDENTIAL_EN`）次之：`统一社会信用代码` `纳税人识别号` `营业执照`
   `组织机构代码` `金融许可证` `开户许可证` `登记证书` / `business registration` `tax registration`
   `employer identification`(EIN) `value added tax` `vat number`。这些写法自己就足以判定是机构证照
   （`纳税人识别号` 里没有任何组织主体词，但中文表单上这一格问的从来不是个人税号）。
3. **共现档**兜组合：组织主体词（`机构` `公司` `企业` `单位` `组织` `团体` `营业` `资质` `法人` `股东` `经办`
   `信用代码` `统一社会` / `company` `corporation` `organisation` `employer` `merchant` `business licens` `tax id`）
   **与** 证照词（`证件` `证照` `执照` `登记号` `注册号` `许可证` `批准号` `备案号` `信用代码` `代码` `编号` /
   `licence` `license` `registration` `permit` `certificate` `identification number` `tax number` `reg no`）
   同时出现才压。单靠组织词会连坐（`公司名称` / `单位地址` 都该提示），单靠证照词也不对（`证件号码` 问的就是本人）。

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
`医师资格证号` `驾照档案编号` `社保电脑号` `保单号` **一律不收**——它们各自成串、都不等于身份证号，
提示成「证件号」会把人往身份证号上引。这一族每一条都在账本里钉着「不出提示」，
所以「收了证件号族」和「没顺手把编号族一起收进来」是两件能被测试分开的事。

银行账号侧补的是英文与属性两个通道：`Bank account number` `IBAN` `Sort code` `Routing number`
进 `EN_DICT` 的 `cardNo`，`accountNumber` `sortCode` `routingNumber` 进 `CARD_ATTR_DICT`（必须进那张表而不是
`ATTR_DICT`，理由见 §4.1——`account_number` 在账号守卫那一层就已经被判成登录字段了）。
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

## 6. 覆盖矩阵：16 个可提示角色

角色闭集定义在 `utils/identity/hintRoles.ts`；气泡文案是 `utils/i18n-lite.ts` 的 `cs.identity.role.*`（中英各一份，
由 `tests/utils/identityHintRoles.test.ts` 钉住词表与语言包同步）。下表三列都是**代表性写法**（词元列为节选，
完整集合以 `ZH_DICT` / `EN_DICT` / `ATTR_DICT` 为准），覆盖面账本里另有一批同族用例
（`tests/content/piiClassifier.coverage.test.ts` 的 `ZH_LABEL_CASES` / `EN_LABEL_CASES` / `ATTR_CASES` / `SCENE_CASES`
四张表，一行 = 一条用例）。

| 角色                | 中文标签（代表写法）                                                                                                       | 英文标签                                                                                                       | `name`/`id` 词元                                                                                                           | 库里有这一格的值吗      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `name` 姓名         | 姓名 / 名字 / 真实姓名 / 户主姓名 / 参保人姓名 / 乘机人姓名 / 投保人姓名 / 联系人 / 收件人 / 申请人 / 本人                 | full name / real name / preferred name                                                                         | name, realname, fullname, personname                                                                                       | ✅ `name`               |
| `givenName` 名      | 名（逐字相等）                                                                                                             | given name / first name / forename                                                                             | givenname, firstname, forename, given, fname                                                                               | ➖ 由 `name` 承担       |
| `familyName` 姓     | 姓（逐字相等）/ 姓氏                                                                                                       | last name / family name / surname                                                                              | familyname, lastname, lname                                                                                                | ➖ 由 `name` 承担       |
| `phone` 手机号      | 手机 / 电话 / 联系电话 / 联系方式 / 联系号码 / 移动电话                                                                    | mobile / phone number / telephone / contact number / landline                                                  | phone, mobile, tel, telephone, msisdn, contactnumber, landline                                                             | ✅ `phone`              |
| `email` 邮箱        | 邮箱 / 邮件 / 电子信箱                                                                                                     | email / e-mail                                                                                                 | email, emailaddress, mail                                                                                                  | ✅ `email`              |
| `address` 详细地址  | 地址 / 详细地址 / 街道 / 门牌 / 小区 / 住址 / 居住地 / 楼栋 / 单元 / 房间号 / 楼层                                         | address / street address / delivery address / mailing address / home address / house number / apartment number | address, addr, street, addressline, doorno, housenumber, apartment, unitnumber, roomnumber                                 | ✅ `address`            |
| `region` 所在地区   | 所在地区 / 省份 / 城市 / 区县 / 户籍 / 籍贯 / 出生地 / 社区 / 参保地 / 缴存地 / 乡镇 / 村委会                              | state / province / city / region / country of birth                                                            | region, province, city, district, state, nativeplace, birthplace, placeofbirth, countryofbirth                             | ➖ 常在 `address` 里    |
| `postal` 邮编       | 邮编 / 邮政编码                                                                                                            | postcode / zip code / zipcode                                                                                  | postalcode, zipcode, zip, postcode                                                                                         | ➖ 常在 `address` 里    |
| `idNumber` 证件号   | 身份证 / 证件号 / 社保卡号 / 社会保障号 / 居住证 / 警官证 / 士兵证 / 台胞证 / 永久居留 / 驾驶证 / 回乡证 / 个人税号 / 个税 | id card / national id / driving licence number / tax number / national insurance / ssn / medicare number       | idcard, idcardno, certno, ssn, nino, nationalid, socialsecuritynumber, taxid, driverlicense, licensenumber                 | ✅ `idNumber`（secret） |
| `passport` 护照号   | 护照 / 通行证 / 签证                                                                                                       | passport                                                                                                       | passport, passno, travelcert                                                                                               | ➖ 走 `customFields`    |
| `birthday` 出生日期 | 出生日 / 生日 / 出生年月 / 出生时间（刻意**不收**裸「出生」，见 §5.4）                                                     | date of birth / birth date                                                                                     | birthday, birthdate, dob                                                                                                   | ➖ 走 `customFields`    |
| `gender` 性别       | 性别                                                                                                                       | gender / sex                                                                                                   | gender, sex                                                                                                                | ➖ 走 `customFields`    |
| `org` 单位名称      | 公司 / 单位 / 院校 / 学校 / 雇主                                                                                           | company / organisation / employer / school                                                                     | company, corp, org, organization, employer                                                                                 | ➖ 走 `customFields`    |
| `cardNo` 银行卡号   | 卡号 / 银行账号 / 信用卡号 / 借记卡号 / 储蓄卡号 / 账户号                                                                  | card number / credit card number / bank account number / iban / sort code / routing number                     | （走 `CARD_ATTR_DICT`，见 §4.1）iban, bankcard, creditcard, debitcard, bankaccount, accountnumber, sortcode, routingnumber | ✅ `cardNo`（secret）   |
| `cardHolder` 持卡人 | 持卡人 / 开户人 / 户名 / 开户名 / 账户姓名                                                                                 | cardholder / card holder / account holder                                                                      | cardholder, accountname                                                                                                    | ✅ `cardHolder`         |
| `cardBank` 开户银行 | 开户行 / 开户银行 / 银行名称 / 发卡行 / 所属银行                                                                           | bank name / issuing bank                                                                                       | bankname, bank                                                                                                             | ✅ `cardBank`           |

「库里有这一格的值吗」这一列决定的是提示的**实用性上限**：`identity/fields.ts` 的内置字段只有
`name / idNumber / phone / email / address / cardNo / cardBank / cardHolder / cardExpiry / cardCvv / remark`，
其余角色提示出来仍然有用（点「从身份库选择」带的是搜索词，用户能在自定义字段里找到值），
但它们不是库里的一条内置字段。

需要**二次核对**（`needsVerify`，提示语额外带「请核对后再取用」）的角色：`idNumber` + 可提示的卡类三档
（库里按高敏字段加密），以及任何归属判为 `confirm` 的框。

## 7. 刻意不覆盖：宁可不提示，也不给一句「库里没有的东西」

- **机构主体的证照号**：`机构证件号码` `统一社会信用代码` `营业执照号码` `纳税人识别号` `组织机构代码`
  `金融许可证编号` / `Company Tax Number` `EIN` `Business Registration Number` `VAT Number`（出口码 `orgCredential`）。
- **单据号与金额**：`运单号` `快递单号` `保单号` `保价金额` `建筑面积` `月平均缴费基数` `家庭月收入` `注册资本`。
- **各证自成一串的「编号」族**（判据见 §5.4 那把尺子）：`学历证书编号` `学位证书编号` `教师资格证编号`
  `医师资格证号` `驾照档案编号` `社保电脑号` `公积金个人编号` `出生证编号` `出生医学证明号`。
  库里那一格存的是身份证号，把这一族提示成「证件号」等于把人往一个填不进那串数字的落点引——
  沉默比错提示有用。
- **登录语义**：`用户名` `账号` `密码` `验证码` `安全码` `动态口令` / `username` `password` `one-time code`
  （出口码 `negative` / `account` / `card`）。
- **一定是别人的字段**：`紧急联系人姓名` `担保人身份证号` `受益人姓名` `配偶姓名` `代收人` `被访人` `父母` `子女`
  / `emergency contact` `guarantor`（命中 `OTHER_BLOCK`，归属 `other`，出口码 `ownership`）。
  **同族的「监护人」与 `Guardian` 不在这张表里**，那是已知缺口、不是覆盖项，见 §11 第二条。
- **库里装不下的人口学字段**：`国籍` `民族` `婚姻状况` `最高学历` `区号` / `Ethnicity`。
- **元信息与事物名**：`证件类型` `证件有效期` `地址标签` `银行卡类型` `物品名称` `商品名称` `职业` `毕业院校`
  `单位性质` `户籍性质` `与申请人关系` `IP地址`（`名称` / `方式` / `账号` 三条例外之外仍按负向处理；
  后四条是 2026-10-17 补的负向短语，理由逐条写在 §5.4）。
- **卡类口令**：`有效期` `CVV`——识别得到也永不提示，类型层面 `cardExp` / `cardCvv` 就不进可提示词表。

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

| `suppress`      | 谁给的                                              | 典型写法                                                 |
| --------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `excluded`      | 第 1 层结构性排除                                   | `type="password"` / `hidden` / `checkbox` / 搜索框       |
| `negative`      | 第 3 层负向短语、第 4 层负向词元                    | `用户名` / `验证码` / `物品名称` / `name="occupation"`   |
| `orgCredential` | 第 3.5 层机构证照闸门                               | `机构证件号码` / `统一社会信用代码` / `VAT Number`       |
| `account`       | 第 4 层账号词元守卫                                 | `name="user_account"` / `login_id`                       |
| `card`          | 第 2 层卡类 autocomplete                            | `autocomplete="cc-csc"` / `cc-exp`                       |
| `ownership`     | `resolvePiiField` 收口                              | 紧急联系人 / 担保人 / 受益人 / 配偶                      |
| `loginGroup`    | `looksLikeLoginGroup`（最小字段组内有非卡类口令框） | 登录框与身份框同在一个 `<label>` 里                      |
| `noRole`        | 各层全空，或弱线索闸门挡下                          | 空框 + 无标签；`机构主体` 的兄弟标签；两条弱线索互相矛盾 |

## 10. 加一档要改哪些落点

1. `utils/identity/hintRoles.ts`：`IDENTITY_HINT_ROLES` 加角色（闭集，不在表内的角色串一律当「无身份语义」）。
2. `utils/i18n-lite.ts`：`cs.identity.role.<key>` 中英文各一条（漏一边就是语言不一致）。
3. 词典：`ZH_DICT` / `EN_DICT` / `ATTR_DICT`（或卡类专用的 `CARD_ATTR_DICT`）/ `AUTOCOMPLETE_MAP`，
   并注意 §3 末尾那三处先后关系。
4. 压制与核对口径：`CARD_HINT_ROLES` / `CARD_SECRET_ROLES` / `VERIFY_ROLES` / `OTHER_BLOCK` / `OTHER_CONFIRM`。
5. 测试：`piiClassifier.coverage.test.ts` 加表行（一行 = 一条用例）；`piiClassifier.test.ts` 钉形状与守卫；
   `piiClassifier.demoPage.test.ts` 的十六角色集合要同步；演示台 `docs/fixtures/identity-hint-demo.html` 加
   `data-expect` 行（真机 e2e 从页面 DOM 读账本，不需要改测试）。
6. 库侧：该角色在 `utils/identity/fields.ts` 有没有内置字段；没有就要在文档里写明它靠 `customFields` 承载。
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

## 12. 这份逻辑由哪些账本守着

| 账本                                              | 吃什么                                                                                                                                      | 数量           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `tests/content/piiClassifier.test.ts`             | 每条钉一个「形状 / 守卫为什么存在」                                                                                                         | 形状与回归用例 |
| `tests/content/piiClassifier.coverage.test.ts`    | 每张表一行一条用例：中英标签 / 属性词元 / 五类国内场景 / 机构证照 / 人主体豁免 / 库里没有的概念                                             | 覆盖矩阵       |
| `tests/content/piiClassifier.demoPage.test.ts`    | 把演示台整页读进 jsdom，逐行对 `data-expect` / `data-suppress` / `data-tier`，并守「16 角色全出现过」「group ≥ 4 行」「placeholder ≥ 8 行」 | 命中率         |
| `tests/content/formDetector.identityHint.test.ts` | 页面侧五道门与让位                                                                                                                          | 门             |
| `e2e/identity-hint-demo-page.spec.ts`             | 真 Chrome 里逐框聚焦，量「到底有没有气泡、报的是不是账本那个角色」，`owns=fill` 的行还要量到钥匙正钉在这一框上                              | 装完之后的行为 |

jsdom 全绿而真机红，漏的是 §8 那五道门里的某一道，不是词典；真机绿而覆盖面表红，是词典改了顺序。
