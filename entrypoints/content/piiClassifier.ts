/**
 * 页面个人信息（PII）字段分类器
 *
 * 定位：为「身份库召唤提示」提供**单字段**语义判定。本模块只做识别，不填充、不落盘、
 * 不发起任何网络请求，也不写任何日志。判定链里的取值只发生在最后一层——形状回推要读一次
 * `input.value`，判的是「像不像证件号 / 手机号 / 邮箱」，命中时给出的 `evidence` 是形状码
 * 而不是原文；其余各层吃的都是属性、标签与 `autocomplete` 这些字段自报的元数据。
 * 调用方只取「语义角色 + 是否需复验」两个标签（见 `FormDetector.handleIdentityHintOnFocus`）。
 *
 * 唯一的例外是 {@link selfNameValueNear}：它不在判定链上，是「点了『从身份库选择』之后，
 * 顺手把用户已经打好的**本人姓名**当搜索词」这条已批准通道。边界由该函数的判据钉死
 * （只取 `role === 'name'` 且 `ownership === 'self'` 的框、点击时才读、只进搜索框、不落盘不写日志），
 * 除此之外密文与明文都不离开管理页（见 `docs/ARCHITECTURE.md`「27. 身份信息库」的「定位与独立性」）。
 *
 * 与既有登录桶的分工：`formSelectors.ts` 的 username/mobile/verifyCode 三桶按**子串**匹配
 * 认领登录字段，本模块刻意不复用那套判据——姓名/证件号词典若照抄子串会把 `username`
 * 判成姓名。两条链的让位规则收口在 {@link resolvePiiField} 的登录容器守卫里：
 * 字段组内出现凭据框即认定这一组是登录语义，身份提示完全不参与。
 *
 * 分层顺序即优先级（弱信号永不覆盖强信号）：
 * 结构性排除 → `autocomplete` 自声明 → 负向短语 → `name`/`id` 词元 → label 文本 → 同项兄弟标签 →
 * placeholder → 已输入值形状。
 * 顺序调换会引入真实回归：负向短语必须早于正向词元，否则「用户名 / Display name」会被
 * `name` 抢走；`autocomplete` 必须早于负向短语，否则 `autocomplete="tel"` 的登录手机号
 * 会被账号守卫挡掉后又落入 `phone` 词典。
 *
 * @module entrypoints/content/piiClassifier
 */

import type { IdentityHintRole } from '@/utils/identity/hintRoles';

/**
 * 语义角色（分类器词表，不等于身份库字段——库内没有的角色由调用方降级为「需自建」提示）。
 *
 * 可提示的 16 个角色取共享词表 {@link IdentityHintRole}（含卡号 / 户名 / 开户行三档）；
 * 卡类口令只在本模块内部出现，由 autocomplete 自声明识别出来后立即压制，
 * 类型上就进不了气泡与跨入口载荷。
 */
export type PiiRole = IdentityHintRole | 'cardExp' | 'cardCvv';

/** 卡类里可以提示的三档（决定 `needsVerify` 与压制口径，与共享词表同源） */
const CARD_HINT_ROLES: readonly PiiRole[] = ['cardNo', 'cardHolder', 'cardBank'];

/** 卡类口令：识别得到但永不提示 */
const CARD_SECRET_ROLES: readonly PiiRole[] = ['cardExp', 'cardCvv'];

/** 命中层级：越靠前越可信，`value` 只用于收口、不作为主动判据 */
export type PiiTier = 'autocomplete' | 'attr' | 'label' | 'group' | 'placeholder' | 'value';

/**
 * 归属档位（模拟跑批的主要教训）：
 * - `self`：无他人修饰，可直接当作本人信息使用；
 * - `confirm`：可能是本人也可能是家属/同行（收货人、乘车人、入住人），提示语必须要求核对；
 * - `other`：语义上一定是别人（紧急联系人、担保人），不给身份提示——用本人身份填别人
 *   的证件号是本功能唯一不可接受的错误。
 */
export type PiiOwnership = 'self' | 'confirm' | 'other';

/** 不出提示的原因码（仅供日志与单测定位，不进任何用户可见文案） */
export type PiiSuppressReason = 'excluded' | 'negative' | 'account' | 'card' | 'ownership' | 'loginGroup' | 'noRole';

/** 生产判定的唯一出口：要么给出角色，要么给出被压制的原因 */
export interface PiiVerdict {
  /** 可提示的角色；被压制时为 null */
  role: PiiRole | null;
  tier: PiiTier | null;
  ownership: PiiOwnership;
  /** 证件号类高敏角色或他人歧义：提示语必须额外要求「核对后再用」 */
  needsVerify: boolean;
  suppress: PiiSuppressReason | null;
  /** 命中的依据：label 层是页面文本、值层是形状码；只留在返回值里供判据自身定位，调用方不读、不上报、不写盘、不进日志 */
  evidence: string;
}

/** 卡类 autocomplete 取值（2026-10-17 拍板：卡号 / 户名 / 开户行三档可提示，有效期与 CVV 压制） */
const CARD_AUTOCOMPLETE: Record<string, PiiRole> = {
  'cc-number': 'cardNo',
  'cc-exp': 'cardExp',
  'cc-exp-month': 'cardExp',
  'cc-exp-year': 'cardExp',
  'cc-csc': 'cardCvv',
  'cc-name': 'name',
};

/** autocomplete 官方取值 → 角色（最强的自声明信号，站点自己写的就是答案） */
const AUTOCOMPLETE_MAP: Record<string, PiiRole> = {
  name: 'name',
  'given-name': 'givenName',
  'additional-name': 'givenName',
  'family-name': 'familyName',
  bday: 'birthday',
  sex: 'gender',
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'address',
  'address-level1': 'region',
  'address-level2': 'region',
  'address-level3': 'region',
  'postal-code': 'postal',
  tel: 'phone',
  'tel-national': 'phone',
  mobile: 'phone',
  email: 'email',
  organization: 'org',
};

/** 账号语义守卫：出现这些词元即认定是登录字段 */
const ACCOUNT_TOKENS = new Set(['user', 'username', 'account', 'login', 'signin', 'pwd', 'password', 'pass']);

/**
 * 负向词元：整词即非个人信息。
 * 教训是裸 `code` / `s` 不能进——`post_code`（邮编）与 `zip_code` 会被一起吃成漏报。
 * 末段是「元信息」词元（标签 / 类型 / 数量），它们描述「怎么填」而不是「填什么」。
 * 刻意不含裸 `no`，否则 `idCardNo`（证件号）会被误杀。
 *
 * `school` / `college` 留在表内、`company` 不在：表单里的「学校」按实测绝大多数是毕业院校
 * （属于经历，不是要填进对方系统的本人单位名），而「公司」在注册页与发票页要的正是单位名。
 * 单位名的正向判定见 `ATTR_DICT` 的 org 档。
 */
const NEG_TOKENS = new Set([
  'nickname',
  'nick',
  'displayname',
  'screenname',
  'author',
  'handle',
  'captcha',
  'vcode',
  'otp',
  'sms',
  'verif',
  'coupon',
  'promo',
  'discount',
  'search',
  'searchbox',
  'keyword',
  'keywords',
  'query',
  'q',
  'kw',
  'remark',
  'note',
  'notes',
  'comment',
  'message',
  'content',
  'resume',
  'attachment',
  'file',
  'salary',
  'expect',
  'expectation',
  'major',
  'school',
  'college',
  'occupation',
  'position',
  'year',
  'years',
  'tag',
  'label',
  'type',
  'kind',
  'mode',
  'index',
  'picker',
]);

/**
 * `name` 词元的上下文噪声：`goods_name` / `hotelName` / `file_name` 是事物名不是人名。
 * 缺这一层会把「物品名称」判成「姓名」。
 * `company` 也在表内，但它不是「到此为止」——`company_name` 剥掉裸 name 后要继续往下走，
 * 由 org 档接住（单位名），所以这里的语义是「这个 name 不是人名」，不是「这个字段无用」。
 */
const NAME_CONTEXT_NOISE = new Set([
  'goods',
  'product',
  'item',
  'company',
  'file',
  'project',
  'brand',
  'shop',
  'store',
  'hotel',
  'city',
  'country',
  'province',
  'region',
  'domain',
  'window',
  'button',
  'class',
  'column',
  'variable',
  'key',
  'tag',
  'label',
  'category',
  'song',
  'movie',
  'book',
  'app',
  'task',
]);

/**
 * 裸单位名词元的上下文噪声：`company_size` / `company_logo` 描述的是公司这件事，
 * 不是「公司叫什么」——org 档只在该词元承担「名称」职责时才提示。
 * 表内不放 `name` / `address`：`company_name` 要判单位名，`company_address` 由 address 档先接住。
 */
const ORG_CONTEXT_NOISE = new Set([
  'size',
  'scale',
  'logo',
  'icon',
  'img',
  'image',
  'url',
  'uri',
  'link',
  'website',
  'site',
  'web',
  'industry',
  'trade',
  'field',
  'desc',
  'description',
  'about',
  'intro',
  'contact',
  'num',
  'number',
  'count',
  'code',
  'level',
  'stage',
  'status',
  'tax',
  'taxid',
]);

/** 需要「同生词元核查」的单位名词元：这三个短词在公司名之外还大量用于描述公司这件事 */
const ORG_BARE_TOKENS = new Set(['company', 'corp', 'org']);

/**
 * `name`/`id` 属性词元 → 角色。
 *
 * 词典内容与模拟跑批的 tier H 配置逐字一致，唯一差异是**不收录裸 `cardno`**：
 * 中文站点同时用它指身份证号和银行卡号，词元层面无法区分，而卡类按既有拍板永不进
 * 提示路径，收录只会把支付页的卡号框读成证件号。真实身份证字段靠 `idCardNo` /
 * `cert_no` 这类带前缀的形状命中（拼接词元已覆盖）。
 *
 * 形态选 `[角色, 词元表]` 元组数组而不是 Record：`Object.entries` 会把键放宽成
 * `string`，遍历处只能靠 `as` 断言角色；写成元组后角色天然就是 `PiiRole`，
 * 且数组顺序即词典优先级（先到先得），与 Record 的键序语义相同但不依赖实现细节。
 *
 * 顺序上的两处真机教训（30 字段逐字段勘察）：
 * - givenName / familyName 必须早于裸 `name`，否则 `first_name` 的 `name` 词元先赢，
 *   「名 / 姓」两档在最常见的属性写法上永远够不到（label 档写对了也没用）；
 * - org 排最后：`company_address` 这类带更具体角色的形状先被 address 接走，
 *   单位名只收「除了公司词元没说别的」的字段。
 */
const ATTR_DICT: readonly (readonly [role: PiiRole, tokens: readonly string[]])[] = [
  ['givenName', ['givenname', 'firstname', 'forename', 'given']],
  ['familyName', ['familyname', 'lastname', 'surname']],
  ['name', ['name', 'realname', 'truename', 'fullname', 'personname']],
  ['phone', ['phone', 'phonenumber', 'mobile', 'mobileno', 'cellphone', 'tel', 'telephone', 'msisdn', 'contactno']],
  ['email', ['email', 'emailaddress', 'mail', 'myemail']],
  ['address', ['address', 'addr', 'detailaddress', 'street', 'streetaddress', 'addressline', 'doorno']],
  ['region', ['region', 'province', 'city', 'district', 'state', 'area', 'location']],
  ['postal', ['postalcode', 'zipcode', 'zip', 'postcode']],
  ['idNumber', ['idcard', 'idcardno', 'idno', 'idnumber', 'certno', 'certnum', 'identityno', 'idnum', 'ssn']],
  ['passport', ['passport', 'passportno', 'passno', 'travelcert', 'permitno']],
  ['birthday', ['birthday', 'birthdate', 'birth', 'bdate']],
  ['gender', ['gender', 'sex']],
  ['org', ['company', 'companyname', 'corp', 'corpname', 'org', 'orgname', 'organization', 'organisation', 'employer']],
];

/**
 * 修饰词白名单：`receiver_name` / `realName` 这类组合里，剥掉修饰后剩余词元仍按角色判。
 * 修饰词本身另用于归属判定（见 {@link OTHER_CONFIRM}）。
 */
const NAME_MODIFIERS = new Set([
  'real',
  'true',
  'full',
  'receiver',
  'consignee',
  'contact',
  'applicant',
  'passenger',
  'viewer',
  'guest',
  'booker',
  'shipping',
  'billing',
  'sender',
  'linkman',
  'person',
  'student',
  'patient',
  'driver',
  'main',
  'primary',
]);

/** 中文短语词典（作用于 label / aria / title / 同项兄弟标签 / placeholder 文本，不作用于 name 属性——属性走切词） */
const ZH_DICT: { role: PiiRole; phrases: readonly string[] }[] = [
  // 卡类三档排在 name 之前：`持卡人姓名` 末尾两字正是 name 档的短语，按相反顺序会把「持卡人」
  // 报成又一张本人姓名，而身份库里这两条是不同字段。短语一律带「号」收口，
  // 这样 `信用卡有效期`、`银行卡类型` 不会被误收进卡号档（前者留给永不提示的口令类）。
  { role: 'cardHolder', phrases: ['持卡人', '开户人', '账户姓名', '开户姓名'] },
  { role: 'cardBank', phrases: ['开户行', '开户银行', '银行名称', '发卡行', '所属银行'] },
  {
    role: 'cardNo',
    phrases: ['卡号', '卡账号', '银行账号', '银行帐号', '信用卡号', '借记卡号', '储蓄卡号', '账户号'],
  },
  {
    role: 'name',
    phrases: [
      '姓名',
      '名字',
      '联系人',
      '收件人',
      '收货人',
      '寄件人',
      '申请人',
      '乘客',
      '乘机人',
      '入住人',
      '就诊人',
      '监护人',
      '本人',
    ],
  },
  { role: 'phone', phrases: ['手机', '电话', '联系方式', '联系电话'] },
  { role: 'email', phrases: ['邮箱', '邮件', '电子邮箱'] },
  { role: 'address', phrases: ['地址', '详细地址', '街道', '门牌', '小区'] },
  { role: 'region', phrases: ['所在地区', '所在区域', '省份', '城市', '区县', '地区', '户籍'] },
  { role: 'postal', phrases: ['邮编', '邮政编码'] },
  {
    role: 'idNumber',
    phrases: ['身份证', '身份号', '证件号', '证件号码', '军官证', '社保卡', '台胞证', '永久居留', '统一社会信用'],
  },
  { role: 'passport', phrases: ['护照', '通行证', '签证'] },
  { role: 'birthday', phrases: ['出生', '生日'] },
  { role: 'gender', phrases: ['性别'] },
  { role: 'org', phrases: ['公司', '单位', '院校', '学校'] },
];

/**
 * 中文负向短语：这些框无论如何不该出身份提示。
 * 末段是「元信息 / 事物名」后缀——`地址标签`、`证件类型`、`房间数量`、`物品名称`
 * 在模拟跑批里分别被读成 address / idNumber / — / name，是误报的主要来源。
 *
 * 唯一的例外写在 {@link ORG_NOUNS_ZH} 上：裸「名称」同时是「物品名称」（事物名，必须挡）
 * 和「单位名称」（本人供对方记录的组织名，应该提示）的后缀，按整串负向拦会把中文最常见
 * 的单位名字段一起清零——真机勘察里 `单位名称` / `公司名称` 就是这样静默掉的。
 */
const ZH_NEG = [
  '昵称',
  '用户名',
  '账号',
  '帐号',
  '密码',
  '搜索',
  '关键词',
  '验证码',
  '优惠券',
  '兑换码',
  '备注',
  '留言',
  '评论',
  '期望',
  '工作年限',
  '年收入',
  '职业',
  '专业',
  '毕业院校',
  '动态口令',
  '安全码',
  '标签',
  '类型',
  '方式',
  '数量',
  '名称',
];

/**
 * 「名称」负向例外的触发词：同一段文本里出现这些组织名词时，「名称」问的是组织叫什么。
 * 刻意不含 `学校` / `院校`——表单里的院校绝大多数是毕业院校（经历），不是本人供对方登记的单位。
 * `银行` 是 2026-10-17 随卡类三档放开补的：`开户银行名称` 中文表单里就是这么写的。
 */
const ORG_NOUNS_ZH = ['单位', '公司', '企业', '组织', '机构', '团体', '银行'];

/** 「名称」是带歧义的负向短语：只有整段文本没提组织时才按事物名拦掉 */
function isZhNegative(phrase: string, zhHint: string): boolean {
  if (!zhHint.includes(phrase)) return false;
  if (phrase === '名称') return !ORG_NOUNS_ZH.some(noun => zhHint.includes(noun));
  // 「方式」的同一条歧义：`支付方式` / `配送方式` 问的是怎么填，但「联系方式」就是手机号框
  // 最常见的中文写法——ZH_DICT 的 phone 档收了它，而负向短语排在正向词典之前，
  // 不放这个例外那条词典项在这套顺序下永远够不到（真机漏报的一条，见其 JSDoc）。
  if (phrase === '方式') return !zhHint.includes('联系');
  // 「账号」的同一条歧义（第三条）：裸「账号 / 帐号」是登录名，必须继续挡，
  // 但「银行账号」「银行卡账号」问的是卡号——放开卡号档后这是它最常见的中文写法。
  // 判据用「银行 / 卡」这两个字样，而不是给 `账户` 开例外：`账户名` 在支付页通常是登录账号。
  if (phrase === '账号' || phrase === '帐号') return !(zhHint.includes('银行') || zhHint.includes('卡'));
  return true;
}

/**
 * 英文短语词典。扩展本身中英双语，只写中文词典等于英文站点全漏——
 * 留出集的纯英文注册页实测整段漏报。
 */
const EN_DICT: { role: PiiRole; phrases: readonly string[] }[] = [
  { role: 'cardHolder', phrases: ['cardholder', 'card holder', 'account holder'] },
  { role: 'cardBank', phrases: ['bank name', 'issuing bank', 'beneficiary bank'] },
  { role: 'cardNo', phrases: ['card number', 'card no', 'credit card number'] },
  { role: 'givenName', phrases: ['first name', 'given name', 'forename'] },
  { role: 'familyName', phrases: ['last name', 'family name', 'surname'] },
  {
    role: 'name',
    phrases: ['full name', 'real name', 'true name', 'contact name', 'your name', 'passenger name'],
  },
  { role: 'phone', phrases: ['mobile', 'phone number', 'telephone', 'cell phone', 'msisdn'] },
  { role: 'email', phrases: ['email', 'e-mail'] },
  { role: 'address', phrases: ['address line', 'street address', 'delivery address', 'address'] },
  { role: 'region', phrases: ['state', 'province', 'city', 'region', 'county'] },
  { role: 'postal', phrases: ['postcode', 'postal code', 'zip code', 'zipcode'] },
  {
    role: 'idNumber',
    phrases: ['id number', 'identity number', 'national insurance', 'drivers license', 'identity card'],
  },
  { role: 'passport', phrases: ['passport'] },
  { role: 'birthday', phrases: ['date of birth', 'birth date', 'day of birth'] },
  { role: 'gender', phrases: ['gender', 'sex'] },
  { role: 'org', phrases: ['company', 'organisation', 'organization', 'employer', 'school'] },
];

/** 英文负向短语 */
const EN_NEG = [
  'nickname',
  'display name',
  'user name',
  'username',
  'password',
  'search',
  'keyword',
  'verification code',
  'captcha',
  'one time',
  'coupon',
  'promo',
  'comment',
  'message',
  'notes',
  'job title',
  'expected',
];

/**
 * 归属词表：`OTHER_BLOCK` 一定是别人，`OTHER_CONFIRM` 可能是本人也可能是家属/同行。
 * 用词干而非整词：`收货` 要同时覆盖「收货人」「收货地址」「收货电话」。
 */
const OTHER_BLOCK = ['紧急联系人', '担保人', '被访人', '代收人', '配偶', '父母', '子女', 'emergency', 'guarantor'];
const OTHER_CONFIRM = [
  '收货',
  '收件',
  '寄件',
  '联系人',
  '乘客',
  '乘机人',
  '入住人',
  '就诊人',
  '申请人',
  '乘车人',
  'receiver',
  'consignee',
  'sender',
  'contact',
  'passenger',
  'viewer',
  'guest',
  'applicant',
  'patient',
];

/**
 * 组织主体词：一段标签文本里出现这些词，问的就是**某家机构**而不是屏幕前的那个人。
 *
 * 只作用于两条弱线索（同项兄弟标签 / placeholder），不动 label 与 attr 那两层——那两层的
 * 同一条误报是既有行为，收窄它会让一批现在能看到提示的框静默消失，属另一件事。
 * 而弱线索是这一轮新开的口子，必须自己带上闸门：勘察那页银行开户表单（88 枚控件）里
 * `机构证件号码`、`金融业务资质证件号码`、`统一社会信用代码` 成串出现，
 * 少了这道闸，这些框会被提示成**本人**的证件号——那是本功能唯一不可接受的误填形态。
 *
 * `org` 角色本身豁免：`公司名称` / `单位名称` 问的是组织叫什么，身份库里恰好有「单位名」这一档，
 * 那是对的提示，不是误报。
 */
const ORG_SUBJECT_ZH = [
  '机构',
  '公司',
  '企业',
  '单位',
  '组织',
  '团体',
  '营业',
  '资质',
  '法人',
  '股东',
  '经办',
  '信用代码',
  '统一社会',
];
const ORG_SUBJECT_EN = [
  'company',
  'corporation',
  'organisation',
  'organization',
  'employer',
  'merchant',
  'business licens',
  'tax id',
];

/**
 * 结构性排除的 input type：隐藏域、按钮、勾选框等都不是个人信息载体。
 *
 * `password` 也在表内，而且这道排除必须排在形状回推之前：最后一层会读一次 `input.value`，
 * 遮蔽框里那串数字最可能是手机号或验证码，但绝不会是等着被身份库召唤的个人信息字段。
 * 登录容器守卫挡不住这条——它在字段组超过 4 个输入框时主动退出（避免把大表单整页判成登录区），
 * 而提示挂在遮蔽框下面只会让用户取错值。
 */
const STRUCTURAL_EXCLUDE_TYPES = new Set([
  'hidden',
  'password',
  'submit',
  'button',
  'reset',
  'image',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
]);

/** 中文短语匹配前先去空白：真实站点大量写成 `姓 名` / `身 份 证` */
const squeeze = (t: string): string => t.replace(/[\s\u3000]+/g, '');

/** 英文短语匹配前把空白压成单个空格并小写 */
const flatten = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();

const toLower = (t: string): string => t.toLowerCase();

/** 把 name/id 切成小写词元：分隔符 + camelCase 双向拆分，保留 CJK */
export function tokenize(raw: string): string[] {
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
}

/** 单个字段采集到的信号（独立导出供单测直接喂形状） */
export interface PiiSignals {
  attr: string;
  /** name / id 单列，供「整串拼接词元」比对：`idCardNo` 切词后是 id/card/no，只有拼回来才是 idcardno */
  attrSources: string[];
  label: string;
  /**
   * 同项兄弟标签：四条常规线索（aria/title、包裹 label、显式关联、兄弟文本、表格 th）全落空时，
   * 向上有界地找「标签块与控件块互为兄弟」这一组件库形状。只在 label 为空时才计算，
   * 聚焦热路径上不白跑一次兄弟链遍历。
   */
  groupLabel: string;
  placeholder: string;
  value: string;
  type: string;
  autocomplete: string;
  roleAttr: string;
  inSearchBox: boolean;
}

/** 祖先链上是否为搜索容器（最多 4 层，够用且不陪跑整棵 DOM） */
function isInSearchContainer(el: Element): boolean {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 4; depth += 1) {
    const hay = `${cur.className ?? ''} ${cur.getAttribute('role') ?? ''}`.toLowerCase();
    if (/search|keyword|query/.test(hay)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * 只接受「叶子状」的标签节点。
 * 不限定的话，`重量(kg)` 会一路退到 `<fieldset>` 的聚合文本「收件人姓名电话地址」，
 * 于是整个寄件区里每个空框都被读成姓名框。
 */
const isLabelish = (n: Node): boolean =>
  n.nodeType === Node.TEXT_NODE || !(n as Element).querySelector('input, textarea, select');

/**
 * 文本长度阈值按文字体系分档：中文 20 字已是很宽的一条 label，
 * 而 `National Insurance number` 25 个字母是常态——同一个阈值会把英文站 label 全丢。
 */
const withinLabelBudget = (text: string): boolean => text.length <= (/[\u4e00-\u9fa5]/.test(text) ? 20 : 60);

/** 同项兄弟标签回退的预算：向上 4 层、每层前 3 个兄弟、命中块内至多 2 枚载体控件 */
const GROUP_LABEL_LEVELS = 4;
const GROUP_LABEL_BACK = 3;
const GROUP_LABEL_CARRIERS = 2;

/** HTML 里天生就是「名字」的四种节点 */
const LABEL_TAGS = 'label, th, legend, dt';

/**
 * 这段兄弟文字是不是在给这一框**命名**。
 *
 * 原生标签（{@link LABEL_TAGS}）之外，只认类名里带 `label` 的块——这条不是凭空设的：
 * Element Plus 写 `el-form-item__label`、Ant Design 3 写 `ant-form-item-label`、
 * Bootstrap 写 `control-label`，三家把「标签块」这个词直接写进了类名，
 * 手写的管理页也普遍是 `field-label` / `form-label`。
 *
 * 它挡掉的是**值显示块**：EP 的 `.el-select__selected-item` 写着「手机号码」、
 * AntD 的 `.ant-select-selection-selected-value` 写着「中国居民身份证」，都挂在代理 input 的
 * 前兄弟位置，叶子、有文本、块内载体数也过——前三道预算全放行。它们是这一框的**当前值**，
 * 不是这一框的名字；当成名字就会把类型选择器报成本人证件号，把身份填进「选证件类型」那格。
 *
 * 例外放行 `<td>`：社保 / 政务 / 银行的老式表单整张是 `<table>`，标签格与控件格互为兄弟，
 * 结构和上面三家一模一样，只是类名里既没有 `label`、也不是 `th`（2026-10-17 实测：
 * 「身份证号码 + 姓名」那一行因此静默）。组件库的值显示块没有一枚是 `<td>`，而这一通道
 * 头上还压着 {@link isLabelish}（格内不许有控件）和块内载体数 ≤ 2 两道预算，
 * 「值格紧邻控件格」的形状在表格表单里并不存在。
 */
const isLabelBlock = (n: Element): boolean =>
  n.matches(LABEL_TAGS) || n.matches('td') || `${n.className}`.toLowerCase().includes('label');

/**
 * 「标签块与控件块互为兄弟」这一形状下的标签回退。
 *
 * Element Plus 2.14.4 的 `labelFor` 是 `props.for ?? (inputIds.length === 1 ? inputIds[0] : undefined)`：
 * 一个表单项里只要有第二枚控件（类型选择器 + 号码框、起始日期 + 截止日期），`for` 就不发，
 * 标签从 `<label>` 退化成 `<div class="el-form-item__label">`。Ant Design 3 更彻底——行栅格里
 * 标签块与控件块本就是兄弟，`<label>` 不写 `for`、input 不写 `name`/`id`。两种形状下
 * 四条常规线索同时落空，字段静默无提示（2026-10-17 对一家银行开户页的实测：88 枚控件、0 枚提示）。
 *
 * 四个预算各自挡掉一种真实的越界，缺一个就会把邻项或整张卡片的标题当成这一框的名字：
 * - **层数**：够到标签要穿过控件自己的包装层（日期选择器比输入框多两层），但不许穿过表单项；
 * - **前兄弟数**：行栅格一排六格，第三格往后已经是上一项的标签；
 * - **块内载体数 ≤ 2**：一个表单项里出现第三枚控件，那段文字就是「区标题」而不是「这一框的名字」，
 *   「收货地址」这种区块头正是靠这一条挡住整卡清零——它是 {@link isLabelish} 那条教训的另一半；
 * - **形状**：那块文字本身得像个标签（{@link isLabelBlock}），否则它是下拉的当前选中值；表格标签格按该条放行。
 *
 * 只读文本，且必须是叶子状节点（同 {@link isLabelish} 的理由）。
 */
function groupLabelOf(el: Element): string {
  let cur: Element | null = el.parentElement;
  for (let level = 0; cur && level < GROUP_LABEL_LEVELS; level += 1) {
    /** 到 body 就停：这一层往上没有「这一框的名字」，只有整页的控件总数——那次子树查询最贵且必空手 */
    if (cur === document.body || cur === document.documentElement) break;
    if (cur.querySelectorAll('input, textarea, select').length <= GROUP_LABEL_CARRIERS) {
      let sib = cur.previousElementSibling;
      for (let back = 0; sib && back < GROUP_LABEL_BACK; back += 1) {
        const text = (sib.textContent ?? '').trim();
        if (text && withinLabelBudget(text) && isLabelish(sib) && isLabelBlock(sib)) return text;
        sib = sib.previousElementSibling;
      }
    }
    cur = cur.parentElement;
  }
  return '';
}

/** 一段文本自身是否触负向语义（弱线索通道的自检：兄弟标签写着「支付方式」就不能当它是手机号框） */
function isNegativeText(text: string): boolean {
  const zh = squeeze(toLower(text));
  const en = flatten(toLower(text));
  return ZH_NEG.some(phrase => isZhNegative(phrase, zh)) || EN_NEG.some(phrase => en.includes(phrase));
}

/** 一段文本是否在问「某家机构」（`org` 角色自己不算误报，见 {@link ORG_SUBJECT_ZH}） */
function isOrgSubject(text: string): boolean {
  const zh = squeeze(toLower(text));
  const en = flatten(toLower(text));
  return ORG_SUBJECT_ZH.some(w => zh.includes(w)) || ORG_SUBJECT_EN.some(w => en.includes(w));
}

/**
 * 一段文本按中英词典落到哪个角色（`ZH_DICT` 数组顺序即优先级）。
 *
 * label / 同项兄弟标签 / placeholder 三条通道吃同一张词典，所以匹配必须收在这一个函数里，
 * 否则「加了新通道」和「词典改了」两件事会在三个地方各改一遍。
 */
function dictRoleOf(text: string): PiiRole | null {
  if (!text) return null;
  const zh = squeeze(toLower(text));
  const en = flatten(toLower(text));
  const zhHit = ZH_DICT.find(entry => entry.phrases.some(p => zh.includes(p)));
  if (zhHit) return zhHit.role;
  return EN_DICT.find(entry => entry.phrases.some(p => en.includes(p)))?.role ?? null;
}

/**
 * 「可能有原生关联标签」这一形状。
 *
 * `labels` 只声明在 labelable 那几枚元素上，而 TS 的 DOM 类型里没有规范给的
 * `HTMLLabelableElement` 这个名字（直接写它 `tsc` 会报 TS2552）；本函数的入参在调用链上
 * 恒是 `input` / `textarea` / `select` 之一，所以用交叉类型表达「读得到就读、读不到就算了」。
 */
type LabelAwareElement = Element & { labels?: NodeListOf<HTMLLabelElement> | null };

/**
 * 显式关联反查：`label for` 与 `aria-labelledby`。
 *
 * 这两条是页面上「哪个标签属于这个框」唯一被写死的答案，优先级必须排在兄弟文本回退之前：
 * 回退靠的是 DOM 邻居这种弱线索，而组件库（Element Plus / Ant Design 那类把 label 与
 * content 渲染成兄弟块的结构）会让所有弱线索同时落空——input 不是 label 的后代、
 * 没有前兄弟、id 是 `el-id-1-2` 这种合成串，于是字段静默漏报，用户在表单里看不到提示。
 *
 * 只读文本、不读值。`label for` 走原生关联的 `labels`：浏览器已按 `for` 与包裹关系算好集合，
 * 不必扫全文档的 `<label>`——这条判据既在聚焦热路径上每个框走一次，
 * 也会被点击通道的 `selfNameValueNear` 最多连问 80 次，全文档扫描在那两处都不可接受（有界性
 * 要求见 `agents.md`「Content Script」）。同时也省掉 id 的选择器转义问题。
 * 取文档顺序里第一枚**有文本**的关联标签：包裹式 label 文本为空时（`collectPiiSignals` 正是因此
 * 才走到这里）跳过它，继续看后面那枚 `for` 指过来的——比「只认第一枚 `for`、空壳也算命中」更宽一档。
 */
function labelFromAssociation(el: Element): string {
  for (const label of (el as LabelAwareElement).labels ?? []) {
    const text = (label.textContent ?? '').trim();
    if (text) return text;
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const texts = labelledBy
      .split(/\s+/)
      .map(refId => document.getElementById(refId)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 3);
    if (texts.length) return texts.join(' ');
  }

  return '';
}

/** 逐字段采集信号，含裸 input 的兄弟文本回退（12306 那种 `姓名：<input>` 形状）与表格 `th` */
export function collectPiiSignals(el: Element): PiiSignals {
  const input = el as HTMLInputElement;
  const nameAttr = input.getAttribute('name') ?? '';
  const idAttr = input.id ?? '';
  const placeholder = input.getAttribute('placeholder') ?? '';
  const aria = input.getAttribute('aria-label') ?? '';
  const title = input.getAttribute('title') ?? '';

  let label = `${aria} ${title}`.trim();
  const node = el as HTMLElement;
  if (!label) {
    const nearestLabel = node.closest('label');
    if (nearestLabel) label = (nearestLabel.textContent ?? '').trim();
  }
  if (!label) label = labelFromAssociation(el);
  if (!label) {
    let sib: ChildNode | null = el.previousSibling;
    let hops = 0;
    while (sib && hops < 4) {
      const text = (sib.textContent ?? '').trim();
      if (text && withinLabelBudget(text) && isLabelish(sib)) {
        label = text;
        break;
      }
      sib = sib.previousSibling;
      hops += 1;
    }
    if (!label) {
      const prevEl = el.previousElementSibling as HTMLElement | null;
      const prevText = prevEl?.textContent?.trim() ?? '';
      if (prevText && withinLabelBudget(prevText) && prevEl && isLabelish(prevEl)) label = prevText;
    }
    if (!label) {
      const th = node.closest('tr')?.querySelector('th');
      if (th) label = (th.textContent ?? '').trim();
    }
  }

  return {
    attr: `${nameAttr} ${idAttr}`.trim(),
    attrSources: [nameAttr, idAttr].filter(Boolean),
    label,
    groupLabel: label ? '' : groupLabelOf(el),
    placeholder,
    value: input.value ?? '',
    type: (input.type ?? input.getAttribute('type') ?? 'text').toLowerCase(),
    autocomplete: (input.getAttribute('autocomplete') ?? '').toLowerCase(),
    roleAttr: (input.getAttribute('role') ?? '').toLowerCase(),
    inSearchBox: isInSearchContainer(el),
  };
}

/** 区块标题：向上找最近的标题类节点，用于「收货地址」这类整卡归属继承 */
function sectionTitle(el: Element): string {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 6; depth += 1) {
    const head = cur.matches('h1,h2,h3,h4,legend,.hd,.title,.card-hd')
      ? cur
      : cur.querySelector?.('h1,h2,h3,h4,legend,.hd,.title,.card-hd');
    if (head) {
      const text = (head.textContent ?? '').trim();
      if (text && text.length <= 30) return text;
    }
    cur = cur.parentElement;
  }
  return '';
}

/** 在一段文本里查归属词（CJK 短语先压空白再子串匹配，拉丁短语按小写子串） */
function ownershipOf(text: string): PiiOwnership {
  const zh = squeeze(toLower(text));
  const en = flatten(toLower(text));
  const hit = (phrases: string[]): boolean =>
    phrases.some(p => (p.charCodeAt(0) > 127 ? zh.includes(p) : en.includes(p)));
  if (hit(OTHER_BLOCK)) return 'other';
  if (hit(OTHER_CONFIRM)) return 'confirm';
  return 'self';
}

/** 归属档位从松到紧的序：`self` 能填、`confirm` 提示但要核对、`other` 不提示 */
const OWNERSHIP_RANK: Record<PiiOwnership, number> = { self: 0, confirm: 1, other: 2 };

/**
 * 取两个读数里更保守的那个。
 *
 * 弱线索通道（同项兄弟标签）既是角色来源也是归属来源，直接用它覆盖 `ownershipOf(hintText)`
 * 会把「框上写着本人、区块头写着收货人」这种已经收紧的判定放松回去。单向收紧和
 * {@link classifyPiiRaw} 里区块归属继承用的是同一条纪律：只许 `self → confirm → other`。
 */
const tighten = (a: PiiOwnership, b: PiiOwnership): PiiOwnership => (OWNERSHIP_RANK[a] >= OWNERSHIP_RANK[b] ? a : b);

/** 卡类 autocomplete（`cc-number section` 这类组合只看第一段） */
function cardRole(autocomplete: string): PiiRole | null {
  return CARD_AUTOCOMPLETE[autocomplete.split(/\s+/)[0]] ?? null;
}

/** 分类器内核返回值（不含生产侧的让位与压制决策） */
export interface PiiRawClassification {
  role: PiiRole | null;
  tier: PiiTier | null;
  ownership: PiiOwnership;
  /** 卡类语义：按既有拍板永不提示 */
  card: boolean;
  /** 结构性排除 / 负向语义 / 账号守卫 */
  suppress: PiiSuppressReason | null;
  evidence: string;
}

/**
 * 分层判定内核：返回角色与命中层级，以及三类守卫标记。
 *
 * 归属档位在这一步就算好并随结果返回，因为「收货人」这类修饰既影响是否提示，
 * 也影响提示语怎么说，两条信息必须来自同一次文本扫描。
 */
export function classifyPiiRaw(el: Element): PiiRawClassification {
  const s = collectPiiSignals(el);
  const hintText = `${s.label} ${s.placeholder} ${s.attr}`;
  const zhHint = squeeze(toLower(hintText));
  const enHint = flatten(toLower(hintText));

  let ownership = ownershipOf(hintText);
  if (ownership === 'self') {
    /**
     * 区块归属继承：框上只写「手机号码」时，归属信息在卡头（「收货地址」），不在框上。
     * 只在自身文本判为 self 时才读卡头，因此继承是**单向变保守**的：它能把 self 升到
     * confirm / other（提示加「请核对」或直接不给），绝不会把已写明他人的框降回 self。
     */
    const title = sectionTitle(el);
    if (title) ownership = ownershipOf(title);
  }

  const base = { ownership, card: false, evidence: '' };

  // 1) 结构性排除
  if (STRUCTURAL_EXCLUDE_TYPES.has(s.type) || s.roleAttr === 'searchbox' || s.inSearchBox) {
    return { ...base, role: null, tier: null, suppress: 'excluded', evidence: `type=${s.type}` };
  }

  // 2) autocomplete 自声明（最强，且必须早于负向短语：`autocomplete="tel"` 的登录框另有让位规则）
  if (s.autocomplete && s.autocomplete !== 'off') {
    const card = cardRole(s.autocomplete);
    if (card) {
      // 卡号是「可提示的卡类」三档之一，照常给角色；有效期与 CVV 是卡类口令，识别得到也压制。
      return {
        ...base,
        role: card,
        tier: 'autocomplete',
        card: true,
        suppress: CARD_SECRET_ROLES.includes(card) ? 'card' : null,
        evidence: s.autocomplete,
      };
    }
    const mapped = AUTOCOMPLETE_MAP[s.autocomplete.split(/\s+/)[0]];
    if (mapped) return { ...base, role: mapped, tier: 'autocomplete', suppress: null, evidence: s.autocomplete };
  }

  // 3) 负向短语（早于任何正向判定，否则「用户名 / Display name」会被 name 抢走）
  const zhNegHit = ZH_NEG.find(phrase => isZhNegative(phrase, zhHint));
  if (zhNegHit) return { ...base, role: null, tier: null, suppress: 'negative', evidence: `zh-neg:${zhNegHit}` };
  const enNegHit = EN_NEG.find(phrase => enHint.includes(phrase));
  if (enNegHit) return { ...base, role: null, tier: null, suppress: 'negative', evidence: `en-neg:${enNegHit}` };

  // 4) name/id 词元
  const tokens = tokenize(s.attr);
  /** 逐来源整体拼接：`idCardNo` 切词后是 id/card/no，只有拼回 idcardno 才对得上词典 */
  const joinedList = s.attrSources.map(src => tokenize(src).join('')).filter(Boolean);
  if (tokens.some(t => ACCOUNT_TOKENS.has(t))) {
    return { ...base, role: null, tier: null, suppress: 'account', evidence: `account:${tokens.join(',')}` };
  }
  const negToken = tokens.find(t => NEG_TOKENS.has(t));
  if (negToken) return { ...base, role: null, tier: null, suppress: 'negative', evidence: `neg-token:${negToken}` };

  for (const [role, words] of ATTR_DICT) {
    const isBareName = role === 'name';
    const isBareOrg = role === 'org';
    for (const token of tokens) {
      if (words.includes(token)) {
        // 「name」词元必须先看同生词元：goods_name / hotelName 是事物名不是人名
        if (isBareName && token === 'name' && tokens.some(t => t !== 'name' && NAME_CONTEXT_NOISE.has(t))) continue;
        // 「company」这类裸单位词同理要看同生词元：company_size / company_logo 是元信息不是单位名
        if (isBareOrg && ORG_BARE_TOKENS.has(token) && tokens.some(t => t !== token && ORG_CONTEXT_NOISE.has(t))) {
          continue;
        }
        return { ...base, role, tier: 'attr', suppress: null, evidence: token };
      }
      // 组合词元：realname / receivername —— 剥掉已知修饰再比
      if (token.endsWith('name') && token.length > 4) {
        const modifier = token.slice(0, -4);
        if (NAME_MODIFIERS.has(modifier) && !ACCOUNT_TOKENS.has(modifier) && !NAME_CONTEXT_NOISE.has(modifier)) {
          return { ...base, role: 'name', tier: 'attr', suppress: null, evidence: token };
        }
      }
      if (token.length > 5 && words.some(w => token.endsWith(w) && NAME_MODIFIERS.has(token.slice(0, -w.length)))) {
        return { ...base, role, tier: 'attr', suppress: null, evidence: token };
      }
    }
    // 跨分隔符粘连：zip_code → zipcode（只在前几种比对都没命中时才试，避免抢语义）
    const joinedHit = joinedList.find(j => words.includes(j));
    if (joinedHit) return { ...base, role, tier: 'attr', suppress: null, evidence: joinedHit };
  }

  // 5) label 文本（中文短语主战场，英文词典兜双语站点）
  const labelRole = dictRoleOf(s.label);
  if (labelRole) return { ...base, role: labelRole, tier: 'label', suppress: null, evidence: s.label };

  /**
   * 6) 同项兄弟标签：组件库形状（EP 一项两控件不发 `for`、AntD 行栅格且 input 无 `name`/`id`）下
   * 唯一还能用的「这一框叫什么」线索。它比 label 弱，所以三道闸都在这一段：
   * 组织主体（整项作废，含 placeholder——否则机构的证照号框会被提示成本人证件号）、
   * 负向词（「支付方式」这类兄弟文字不配当名字，但只关掉本条线索，占位符仍可自证）、
   * 与占位符矛盾（两条弱线索互相打脸时说不准，整项沉默）。
   */
  if (s.groupLabel) {
    const groupRole = dictRoleOf(s.groupLabel);
    if (isOrgSubject(s.groupLabel)) {
      if (groupRole === 'org') return { ...base, role: 'org', tier: 'group', suppress: null, evidence: s.groupLabel };
      return { ...base, role: null, tier: null, suppress: 'noRole', evidence: `org-subject:${s.groupLabel}` };
    }
    if (groupRole && !isNegativeText(s.groupLabel)) {
      const roleFromPlaceholder = dictRoleOf(s.placeholder);
      if (roleFromPlaceholder && roleFromPlaceholder !== groupRole) {
        return {
          ...base,
          role: null,
          tier: null,
          suppress: 'noRole',
          evidence: `weak-conflict:${s.groupLabel}/${s.placeholder}`,
        };
      }
      /** 兄弟标签既是角色来源，它的归属词也必须一起算进来；且只允许单向收紧（见 {@link tighten}） */
      return {
        ...base,
        ownership: tighten(ownership, ownershipOf(s.groupLabel)),
        role: groupRole,
        tier: 'group',
        suppress: null,
        evidence: s.groupLabel,
      };
    }
  }

  // 7) placeholder：用户点名的判据（「检测当前填写的 input 字段或者 placeholder」）。
  // 它排在所有强线索与兄弟标签之后，因此永不覆盖它们——`联系电话` 的 label 配 `请输入邮箱`
  // 的占位符，报出来的仍是 phone。组织主体词同样适用：占位符自己写着「机构证件号码」时不许提示。
  const phRole = dictRoleOf(s.placeholder);
  if (phRole && !(phRole !== 'org' && isOrgSubject(s.placeholder))) {
    return { ...base, role: phRole, tier: 'placeholder', suppress: null, evidence: s.placeholder };
  }

  // 8) 已输入值的形状回推（只用于收口：用户已经手打过一次，形状是最强的自证）
  const value = s.value.trim();
  if (value) {
    if (/^\d{17}[\dXx]$/.test(value)) {
      return { ...base, role: 'idNumber', tier: 'value', suppress: null, evidence: 'id-shape' };
    }
    if (/^1[3-9]\d{9}$/.test(value)) {
      return { ...base, role: 'phone', tier: 'value', suppress: null, evidence: 'phone-shape' };
    }
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return { ...base, role: 'email', tier: 'value', suppress: null, evidence: 'email-shape' };
    }
  }

  return { ...base, role: null, tier: null, suppress: 'noRole', evidence: '' };
}

/**
 * 字段组：`label` 包裹优先，否则取直接父节点。
 *
 * 登录容器守卫必须按「最小字段组」判定，不能按 `<form>`——注册页常把 1 个密码框和
 * 9 个身份框放进同一个 form，整块拦掉等于功能为零（对照组实测命中 47 → 27）。
 */
function fieldGroupOf(el: Element): Element {
  return el.closest('label') ?? el.parentElement ?? el;
}

/**
 * 所在字段组是否是登录语义（组内有口令框）。
 *
 * 卡类密码框（CVV 写成 `type="password"`）必须豁免，否则支付页会被整页判成登录容器，
 * 连带挡掉账单地址与邮箱——这条豁免在模拟跑批里值 5 个字段。
 */
function looksLikeLoginGroup(el: Element): boolean {
  const group = fieldGroupOf(el);
  const fields = Array.from(group.querySelectorAll('input, textarea'));
  if (fields.length > 4) return false;
  return fields.some(f => {
    const type = (f as HTMLInputElement).type;
    if (type !== 'password') return false;
    const name = `${f.getAttribute('name') ?? ''} ${f.getAttribute('autocomplete') ?? ''}`.toLowerCase();
    return !/cvv|csc|cc-/.test(name);
  });
}

/**
 * 生产判定：给出「是否提示、提示什么角色、要不要核对」。
 *
 * 三条压制规则都来自实测，不是审美选择：
 * - 归属 `other` 一律不提示——用本人证件号填「紧急联系人」是唯一不可接受的误填；
 * - 卡类里只有「卡号 / 户名 / 开户行」进提示路径（2026-10-17 拍板），有效期与 CVV 属卡类口令，
 *   识别得到也压制；三档全部按高敏处理，走身份库复验；
 * - 弱线索（同项兄弟标签 / placeholder）自己带闸：组织主体词与两条弱线索互相矛盾时整项沉默，
 *   因为这两档吃的就是「没人给这框命名」的形状，误报的代价是用户按错身份填错框。
 *
 * placeholder 曾是「正向词典不吃它」——94 字段语料上该档有效命中为 0。2026-10-17 改判：
 * 组件库形状（AntD 行栅格、EP 一项两控件不发 `for`）下它是唯一剩下的线索，
 * 对一家银行开户页 88 枚控件实测「0 提示」就是这条漏报的现场。
 */
/** 一律要求二次核对的角色：证件号 + 可提示的卡类三档（库内按高敏字段加密） */
const VERIFY_ROLES: readonly PiiRole[] = ['idNumber', ...CARD_HINT_ROLES];

export function resolvePiiField(el: Element): PiiVerdict {
  const raw = classifyPiiRaw(el);
  const needsVerify = (raw.role !== null && VERIFY_ROLES.includes(raw.role)) || raw.ownership === 'confirm';

  /** 压制出口：角色置空、原因如实记录，其余信号（层级/归属/依据）原样带回便于定位 */
  const veto = (reason: PiiSuppressReason): PiiVerdict => ({
    role: null,
    tier: raw.tier,
    ownership: raw.ownership,
    needsVerify: false,
    suppress: reason,
    evidence: raw.evidence,
  });

  if (raw.suppress) return veto(raw.suppress);
  if (raw.ownership === 'other') return veto('ownership');
  if (raw.role && looksLikeLoginGroup(el)) return veto('loginGroup');

  return {
    role: raw.role,
    tier: raw.tier,
    ownership: raw.ownership,
    needsVerify,
    suppress: null,
    evidence: raw.evidence,
  };
}

/** {@link selfNameValueNear} 一次扫描的控件上限：长注册表单里点一次不该退化成全表扫描 */
export const NAME_KEYWORD_SCAN_LIMIT = 80;

/**
 * 就近取一个「本人姓名」框的当前值，供身份库弹窗做搜索词
 *
 * 用户在表单里先打好的姓名是「这一份身份是谁」最强的现场证据，把它带进身份库当筛选词，
 * 点「从身份库选择」时看到的就是那一个人的条目，少一次手工检索。这是本功能**唯一**一条
 * 明文离开页面的通道，四条边界把它压在「只是搜索词」这个量级上：
 *
 * 1. 候选只认 `role === 'name'` 且 `ownership === 'self'`——`confirm`（收货人可能是家属）是歧义、
 *    `other`（紧急联系人一定是别人）在 {@link resolvePiiField} 里已被整条压制，两者都不许反过来
 *    决定库里该显示谁；`password` / `hidden` 这类结构性排除的框拿不到角色，遮蔽值物理上读不到。
 * 2. 只在用户点击那一刻调用（见 `IdentityHint`），聚焦时不缓存取值，明文不额外延长存活时间。
 * 3. 作用域是所在 `<form>`，无 form 时退到整页；控件数封顶 {@link NAME_KEYWORD_SCAN_LIMIT}。
 *    不做可见性判断：那要给每个候选框读一次布局（点击路径上的强制回流），而一个 CSS 隐藏的
 *    姓名框最坏也只是让搜索框多一个看得懂、一键可清的条件词——它不参与填充、不参与解密。
 * 4. 取值后交给 `normalizeSearchKeyword`（trim + 64 字上限）在后台与选项页各收口一次，
 *    与既有「到全库找」那条关键词通道同一口径，不另立长度真源。
 *
 * 命中即返回：同一区块里若摆着「本人姓名 + 监护人姓名」，按文档顺序取第一个非空，
 * 与用户的注视点一致（本人信息栏在前的表单是绝大多数）。
 *
 * @param el 用户当前聚焦的那个字段（气泡绑定的那一枚）
 * @returns 姓名框的当前值（已 trim），没有合格候选时为空串
 */
export function selfNameValueNear(el: Element): string {
  if (!el.isConnected) return '';
  const scope = el.closest('form') ?? el.ownerDocument.body;
  if (!scope) return '';
  const controls = Array.from(scope.querySelectorAll('input, textarea, select')).slice(0, NAME_KEYWORD_SCAN_LIMIT);
  for (const control of controls) {
    const verdict = resolvePiiField(control);
    if (verdict.role !== 'name' || verdict.ownership !== 'self') continue;
    const value = (control as HTMLInputElement).value?.trim() ?? '';
    if (value) return value;
  }
  return '';
}
