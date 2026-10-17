// @vitest-environment jsdom
/**
 * 个人信息字段提示的**覆盖面**账本（中英常见写法 × 国内外站点习惯）
 *
 * 与 `piiClassifier.test.ts` 的分工：那份文件每条用例钉一个「形状 / 守卫为什么存在」，
 * 本文件钉的是「这一类字段写法认不认得」——它是用户问「常见字段都覆盖了吗」时唯一能回答的表。
 * 每张表的行都用 `it.each` 展开，所以本文件的用例数 = 表行数 + 下面的单点用例数，
 * 增减一行就是增减一条用例（不是「一个测试」）。
 *
 * 夹具统一构造成 `<label>文本<input></label>` 的包裹形状：走的是**文本通道**（label 层），
 * 因此本文件只考词典，不考形状。属性通道另用 `name="..."` 直接构形。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePiiField } from '@/entrypoints/content/piiClassifier';

/** 构造一个带标签的 input 并返回元素本身 */
function fieldWithLabel(label: string): HTMLInputElement {
  document.body.innerHTML = `<label>${label}<input id="f" type="text"></label>`;
  return document.getElementById('f') as HTMLInputElement;
}

/** 构造一个只有 `name` 属性的裸 input（无标签、无占位符） */
function fieldWithName(name: string): HTMLInputElement {
  document.body.innerHTML = `<input id="f" name="${name}" type="text">`;
  return document.getElementById('f') as HTMLInputElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * 中文标签 → 角色。逐条来自真实站点写法（社保 / 医保 / 银行开户 / 12306 / 航旅 / 电商 / 就医 / 求职）。
 * 括号里是这份表存在的理由——一句话记不住的场景，用例替他记。
 */
const ZH_LABEL_CASES: readonly (readonly [label: string, role: string, why: string])[] = [
  ['户主姓名', 'name', '户籍表的第一行'],
  ['参保人姓名', 'name', '社保参保登记表'],
  ['投保人姓名', 'name', '保险投保页'],
  ['被保险人', 'name', '保险投保页（人是别人时由归属档挡，不由词典挡）'],
  ['乘机人姓名', 'name', '航旅值机'],
  ['出行人姓名', 'name', '旅行社报名'],
  ['旅客姓名', 'name', '客运购票'],
  ['姓名拼音', 'name', '跨境票务与签证表'],
  ['中文姓名', 'name', '双语表单的中文那一栏'],
  ['英文姓名', 'name', '双语表单的英文那一栏'],
  ['姓氏', 'familyName', '拆开的姓 / 名两栏'],
  ['姓', 'familyName', '只写一个「姓」字的表格栏（逐字相等档）'],
  ['名', 'givenName', '只写一个「名」字的表格栏（逐字相等档）'],
  ['社会保障号码', 'idNumber', '社保登记表的正式写法'],
  ['社保号', 'idNumber', '口语写法'],
  ['社会保障卡号', 'idNumber', '与「社保卡号」同义，此前被「卡号」两字抢进卡档'],
  ['医保卡号', 'idNumber', '医保个人编号多数城市就是身份证号，不是银行卡'],
  ['医保卡金融账号', 'cardNo', '社保卡另一面那串银行账号，不是证件号（评审回灌：社保档排在卡档之前会连坐）'],
  ['社会保障卡银行账号', 'cardNo', '同上，全称写法'],
  ['个人银行账户', 'cardNo', '银行开户表只写「银行账户」时问的就是卡号'],
  ['警官证号', 'idNumber', '特殊职业证件'],
  ['士兵证号', 'idNumber', '特殊职业证件'],
  ['驾驶证号', 'idNumber', '中国驾驶证的证号即身份证号'],
  ['机动车驾驶证号', 'idNumber', '交管表单的全称写法'],
  ['回乡证号', 'idNumber', '港澳居民来往内地通行证，证号即身份证号'],
  ['个人税号', 'idNumber', '个税的纳税人识别号在中国就是身份证号'],
  ['个税编号', 'idNumber', '同上口语写法'],
  ['港澳台居民居住证', 'idNumber', '居住证类别'],
  ['居住证号码', 'idNumber', '居住地登记'],
  ['往来港澳台通行证号', 'passport', '出入境'],
  ['移动电话', 'phone', '通信类表单'],
  ['联系电话号码', 'phone', '常见冗长写法'],
  ['联系号码', 'phone', '没有「电话」二字的写法'],
  ['电子信箱', 'email', '老式政务站点写法'],
  ['家庭住址', 'address', '「住址」不含「地址」二字'],
  ['暂住地址', 'address', '居住类地址'],
  ['户籍地址', 'address', '政务表单'],
  ['居住地', 'address', '只写居住地的表'],
  ['籍贯', 'region', '求职与入学表'],
  ['出生地', 'region', '入境与入学表'],
  ['邮政编码', 'postal', '已有档，钉住不被新负向词吃掉'],
  ['单元号', 'address', '快递与公租房把住址拆到单元这一格'],
  ['房间号', 'address', '合租 / 酒店式公寓表单'],
  ['楼层', 'address', '同上，送货上门要的那一层'],
  ['乡镇', 'region', '农村地址的行政区划一级'],
  ['村委会', 'region', '同上更低一级'],
  ['户名', 'cardHolder', '银行开户与对公表单'],
  ['银行户名', 'cardHolder', '汇款页'],
  ['开户名', 'cardHolder', '证券开户'],
  ['雇主名称', 'org', '求职表'],
  ['现用人单位', 'org', '求职表'],
  ['出生年月', 'birthday', '不写「日期」的写法'],
];

/** 英文标签 → 角色（海外注册 / 税务 / 航旅 / 电商结账的常见写法） */
const EN_LABEL_CASES: readonly (readonly [label: string, role: string, why: string])[] = [
  ['National ID', 'idNumber', '多国通用写法'],
  ['ID Card Number', 'idNumber', '「身份证号码」的直译，此前整串够不到'],
  ['Driving Licence Number', 'idNumber', '英联邦拼写（licence 而非 license）'],
  ['Driver License Number', 'idNumber', '美式拼写'],
  ['Tax Number', 'idNumber', '个人税号（带公司词时由机构证照闸门挡）'],
  ['Personal Tax Number', 'idNumber', '写着 personal 时问的是自然人，闸门不连坐'],
  ['SSN', 'idNumber', '美国社会安全号的缩写，此前只有 name 属性通道认得'],
  ['Social Security Number', 'idNumber', '同上全称'],
  ['NINO', 'idNumber', '英国国民保险号的短写（属性通道早已认得）'],
  ['License Number', 'idNumber', '驾驶证号的美式省写，不带 driver 前缀'],
  ['Licence Number', 'idNumber', '英联邦拼写'],
  ['Medicare Number', 'idNumber', '澳洲 / 加拿大的医保编号'],
  ['Health Insurance Number', 'idNumber', '加省医保号'],
  ['Social Security No', 'idNumber', '带点的缩写写法：收窄到带号收口之后，这条仍要走得通'],
  ['Medicare No', 'idNumber', '同上'],
  ['Health Insurance No', 'idNumber', '同上'],
  ['Bank Account Number', 'cardNo', '英文站点写标签不写 name，此前只有属性通道够得到'],
  ['IBAN', 'cardNo', '欧洲账号的标签写法'],
  ['Sort Code', 'cardNo', '英国转账'],
  ['Routing Number', 'cardNo', '美国转账'],
  ['House Number', 'address', '欧美表单单独成格的门牌'],
  ['Apartment Number', 'address', '单元号'],
  ['Home Address', 'address', '电商结账'],
  ['Mailing Address', 'address', '政务信函地址'],
  ['Billing Address', 'address', '支付表单'],
  ['Shipping Address', 'address', '物流表单'],
  ['Residential Address', 'address', '开户表单'],
  ['Contact Number', 'phone', '服务类表单'],
  ['Landline', 'phone', '海外表的固话栏'],
  ['Mobile Number', 'phone', '已有档，钉住'],
  ['Email Address', 'email', '已有档，钉住'],
  ['E-mail', 'email', '连字符写法'],
  ['Given Name', 'givenName', '机票姓名拆分'],
  ['Surname', 'familyName', '机票姓名拆分'],
  ['Preferred Name', 'name', '双语习惯用语'],
  ['Date of Birth', 'birthday', '已有档，钉住'],
  ['Country of Birth', 'region', '签证表'],
  ['Postcode', 'postal', '英联邦'],
  ['Cardholder Name', 'cardHolder', '支付表单'],
  ['Bank Name', 'cardBank', '转账表单'],
  ['Company Name', 'org', '已有档，钉住不被机构闸门吃掉'],
];

/** `name` 属性词元 → 角色（开发者写下的英文词元，走切词与整串粘连两条比对） */
const ATTR_CASES: readonly (readonly [name: string, role: string, why: string])[] = [
  ['dob', 'birthday', '出生日期最短的字段名'],
  ['birthDate', 'birthday', '已有档，钉住'],
  ['iban', 'cardNo', '欧洲账号'],
  ['bankCard', 'cardNo', '银行卡（整串粘连写法）'],
  ['creditCard', 'cardNo', '信用卡'],
  ['bankName', 'cardBank', '开户行'],
  ['cardHolder', 'cardHolder', '持卡人'],
  ['accountName', 'cardHolder', '银行户名的字段名写法'],
  ['nino', 'idNumber', '英国国民保险号'],
  ['nationalId', 'idNumber', '多国证件号'],
  ['contactNumber', 'phone', '联系电话'],
  ['fname', 'givenName', '拆名的短字段名'],
  ['lname', 'familyName', '拆姓的短字段名'],
  ['nativePlace', 'region', '籍贯的常见字段名'],
  ['birthPlace', 'region', '出生地：此前属性通道的裸 birth 把它抢成生日'],
  ['placeOfBirth', 'region', '同一格的另一串写法'],
  ['countryOfBirth', 'region', '签证表最常见的字段名'],
  ['socialSecurityNumber', 'idNumber', '长形字段名：label 收了 ssn，属性通道此前够不到'],
  ['taxId', 'idNumber', '个人税号字段名'],
  ['driverLicense', 'idNumber', '驾驶证号字段名'],
  ['licenseNumber', 'idNumber', '不带 driver 前缀的省写'],
  ['sortCode', 'cardNo', '英国转账'],
  ['routingNumber', 'cardNo', '美国转账'],
  ['accountNumber', '-', '裸 account 词元是登录名：两步登录页没有标签文字，卡类词元不许在这一格把它读成银行账号'],
  ['bankAccountNumber', 'cardNo', '全称字段名：写着 bank 就不再有歧义，裸 bank 词元原本把它读成开户行'],
  ['houseNumber', 'address', '门牌字段名'],
  ['apartment', 'address', '单元号字段名'],
  ['certificateNo', 'serialNumber', '编号族的属性写法：切词是 certificate + no，只有拼回 certificateno 才对得上'],
  ['serialNumber', 'serialNumber', '同上，通用写法'],
  ['policyNo', 'serialNumber', '保单号的字段名'],
  ['diplomaNumber', 'serialNumber', '学历编号的字段名'],
];

/**
 * 国内五类高频填报场景的逐字段账本：社保参保 / 公租房申请 / 公积金 / 快递 / 住址。
 *
 * 与上面两张全表的区别是这一张**按场景**排，用户问「社保那页能不能提示」时能整段读出；
 * 每行括号记的是这一格在真实表单里的名字。库里装不下的概念一律进
 * {@link NOT_COVERED_CASES}，宁可不提示也不给一句「点库里没有的东西」的气泡。
 */
const SCENE_CASES: readonly (readonly [label: string, role: string, why: string])[] = [
  // 社保参保登记 / 缴费
  ['参保人姓名', 'name', '参保登记表第一列'],
  ['个人社保编号', 'idNumber', '各地社保局的个人编号写法'],
  ['社保卡号', 'idNumber', '社保卡一面印的那串'],
  ['参保地', 'region', '统筹地区选择'],
  ['社保缴费单位', 'org', '代缴单位名'],
  // 公租房申请
  ['申请人证件号码', 'idNumber', '公租房资格核验'],
  ['共同申请人姓名', 'name', '家庭申租名单'],
  ['申请人联系电话', 'phone', '资格复核联系方式'],
  ['现居住地址', 'address', '申租表居住情况一栏'],
  ['社区', 'region', '街道 / 社区两级里的社区格'],
  ['住房保障管理部门联系电话', 'phone', '政务表单的冗长前缀里问的仍是电话'],
  // 公积金
  ['公积金联名卡卡号', 'cardNo', '联名卡那一面'],
  ['工作单位名称', 'org', '缴存单位'],
  ['缴存地', 'region', '公积金中心统筹城市'],
  ['本人姓名', 'name', '公积金提取申请'],
  // 快递
  ['收件人姓名', 'name', '快递下单'],
  ['寄件人姓名', 'name', '快递下单'],
  ['收件人联系电话', 'phone', '快递下单'],
  ['所在地区', 'region', '省 / 市 / 区三级'],
  ['详细地址', 'address', '快递下单的最后一行'],
  ['门牌号', 'address', '地址细分格'],
  ['邮政编码', 'postal', '老式面单'],
  ['运单号', '-', '快递单自己的编号，不是个人信息'],
  ['保价金额', '-', '金额，库里没有也不该提示'],
  // 住址
  ['现住址', 'address', '住址信息第一栏'],
  ['通信地址', 'address', '信函地址'],
  ['邮寄地址', 'address', '电商 / 政务通用'],
  ['家庭住址', 'address', '求职与入学表'],
  ['住址门牌号', 'address', '住址细分'],
  ['小区名称', 'address', '「名称」负向的住址侧例外'],
  ['楼栋', 'address', '小区里的楼栋格'],
  ['籍贯', 'region', '户籍侧的地区'],
  ['户籍所在地', 'region', '政务表单'],
  ['户口所在地', 'region', '同上另一种写法'],
  ['出生地', 'region', '不能被「出生」抢成生日'],
];

/**
 * 机构主体的证照号：2026-10-18 起**从沉默翻成编号族**——闸门还在，挡的方向换了。
 *
 * 立闸那天 `serialNumber` 还不存在，「不声称它是本人证件号」的唯一出口就是干脆不出提示；
 * 编号族补上之后，这一族有了「库里没有那一格，可在自定义字段里存下它」的落点（机构那一串
 * 同样没有内置字段，而 `org` 档的「单位名称」早就在可提示词表里），所以命中之后判
 * `serialNumber` 而不是 `NULL`。**闸门的本意一条没丢：这一族永远不许被词典接进 `idNumber`。**
 *
 * 拍板划的那条界线是**证据来自哪一层**：只有「这一格自己的标签文字或 name/id 属性」写明
 * 机构证照时才给提示；机构字样只出现在 placeholder 或相邻块里时继续沉默——那两层的文本
 * 未必是这一格在问什么（下面 `压制只吃弱线索时仍沉默` 那条用例钉住它）。
 */
const ORG_CREDENTIAL_CASES: readonly (readonly [label: string, why: string])[] = [
  ['机构证件号码', '银行开户页的对公主体证照'],
  ['统一社会信用代码', '对公表单的第一行'],
  ['营业执照号码', '对公表单'],
  ['纳税人识别号', '发票开立'],
  ['组织机构代码', '老式对公表单'],
  ['金融许可证编号', '银行业监管信息'],
  ['Company Tax Number', '海外对公税号'],
  ['Employer Identification Number', '美国 W-9 的 EIN 全称（裸缩写 `EIN` 另说，见 §5.5）'],
  ['Business Registration Number', '港新对公注册号'],
  [
    'Business Licence Number',
    '英联邦拼写的营业执照号：闸门词元原本写全 `business licens`，只认美式拼法，那一串于是被词典的 licence number 接走、提示成本人证件号；收到 `business licen` 之后由这道闸门接住、判成编号族（2026-10-17 评审回灌）',
  ],
  ['VAT Number', '欧盟增值税号'],
];

/** 机构词旁边写着「人」时，问的是那个自然人，闸门不许连坐 */
const PERSON_OVERRIDE_CASES: readonly (readonly [label: string, role: string, why: string])[] = [
  ['法定代表人姓名', 'name', '法人是自然人'],
  ['法定代表人证件号码', 'idNumber', '对公表单里唯一那个人的证件号'],
  ['经办人证件号码', 'idNumber', '柜面代办'],
  ['联系人证件号码', 'idNumber', '跨境物流清关'],
  ['Legal Representative ID Number', 'idNumber', '英文对公表单'],
];

/**
 * 编号族：各自成串、都不等于身份证号，所以**不许**挂到 `idNumber`；
 * 但它们在身份库里有一个真实落点——**自定义字段**，所以从 2026-10-18 起单独成一档。
 *
 * 这一张表存在的前因：2026-10-17 那把尺子（「那一串数字本身就是这个人的证件号」才收）
 * 判的是「不许提示成证件号」，用户据此回的那一句是「这些编号可以放到自定义字段里面」，
 * 于是补一档**不声称证件号**的角色，同一批写法从「不出提示」翻成这一档。
 * 判据仍是那两条轴的交集：难记（不是性别民族那种一句话答案）+ 库里落得下（自定义字段）。
 * `运单号` `快递单号` 不进来——它们是这一单的编号，不是这个人的编号。
 */
const SERIAL_CASES: readonly (readonly [label: string, why: string])[] = [
  ['学历证书编号', '学信网与入职表的那一串'],
  ['学位证书编号', '同上，学位那一本'],
  ['教师资格证编号', '教师资格定期注册表'],
  ['医师资格证号', '医师执业注册'],
  ['护士执业证书编号', '同族执业证'],
  ['驾照档案编号', '车管所档案号，与驾驶证号是两串不同的数'],
  ['驾驶证档案编号', '交管页面上的官方全称写法，此前被裸「驾驶证」接走'],
  ['驾驶证编号', '带「编」字就是档案号，不带才是证号'],
  ['社保电脑号', '深圳那一串 8 位电脑号不等于身份证号'],
  ['公积金个人编号', '公积金大厅的个人账号，与登录用的裸「账号」是两回事'],
  ['保单号', '保单自己的编号，人记不住的那一串'],
  ['出生证编号', '《出生医学证明》的编号，此前被裸「出生」读成生日'],
  ['出生医学证明号', '同上全称写法'],
  ['Certificate Number', '英文站点的双语写法'],
  ['Diploma Number', '学历编号的直译'],
  ['Policy Number', '保单号'],
  ['Serial Number', '设备与证书通用那一串'],
  ['Birth Certificate Number', '出生医学证明号的英文写法'],
];

/** 身份库装不下的概念：宁可不提示，也不给一句「点库里没有的东西」的气泡 */
const NOT_COVERED_CASES: readonly (readonly [label: string, why: string])[] = [
  ['国籍', '库内无国籍字段，提示了也没有值可选'],
  ['民族', '同上'],
  ['婚姻状况', '同上'],
  ['最高学历', '同上，且属经历类信息'],
  ['区号', '号码的一段，不是可独立填写的联系电话'],
  ['紧急联系人姓名', '一定是别人（归属 other 档）'],
  ['担保人身份证号', '一定是别人'],
  ['受益人姓名', '一定是别人'],
  ['Guardian Name', '沉默来自英文 name 档不收裸 name 这一词典形状，不是归属判定（见报告 §11）'],
  ['住房公积金账号', '裸「账号」是公积金大厅的登录名，按既有负向档继续挡'],
  ['月平均缴费基数', '社保 / 公积金的金额档，不是身份字段'],
  ['家庭月收入', '同上，且属收入类信息'],
  ['配偶姓名', '一定是别人'],
  ['建筑面积', '公租房表里的房屋参数'],
  ['承租起始日期', '公租房合同的日期，不是本人出生日期'],
  ['快递单号', '单据编号，不是个人信息'],
  ['收件地址标签', '「地址」撞上「标签」元信息负向档'],
  ['法定代表人统一社会信用代码', '人主体豁免只豁免「人」的证件；那一串 18 位码问的还是机构，库里没有'],
  // —— 以下 2026-10-17 由「常用字段缺口」勘察抓出的误报族，方向全是收窄 ——
  ['身份证有效期止', '证件有效期是日期，库里没有那一格，此前被「身份证」三字接走'],
  ['IP地址', '机器的地址，不是住址——「地址」两字的子串判据需要这一条例外'],
  ['与申请人关系', '问的是关系称谓，不是姓名（此前的结论来自 name 档末尾那个「人」组）'],
  ['单位性质', '与「单位类型」同族元信息，此前只有「类型」进了负向档'],
  ['户籍性质', '同上，且此前被「户籍」抢成地区'],
  ['Ethnicity', '英文 region 档的裸 city 把它读成地区；民族库里没有，本就不该提示'],
  // —— 2026-10-18：曾经钉在这里的编号族（学历证书编号 / 资格证号 / 档案编号 / 保单号 …）
  // 全部搬到 {@link SERIAL_CASES}——「不等于本人证件号」这条判据没变，变的是它现在
  // 有一档不声称证件号的角色，落点是身份库的自定义字段。仍留在这一张表里的是**这一单的编号**
  // （`运单号` 已在 {@link SCENE_CASES} 钉过，这里不重复占一格）：
  ['订单号', '电商那一单的编号，不是这个人的编号'],
  ['发票号码', '一单一张，填进身份库下次就用不上了'],
  // —— 2026-10-17 评审回灌：子串吃进相邻语义的第二批，方向同样是收窄正向短语 ——
  ['个税(元)', '薪酬表里的扣缴金额，裸「个税」两字吃进了相邻语义'],
  ['代扣个税', '同上，那一栏问的是税额'],
  ['个人所得税', '同上——它不含相邻的「个税」二字，靠带「号」收口就够，不需要额外负向词'],
  ['Social Security Tax', '美国薪酬页的社保税项，问的是金额不是 SSN'],
  ['Medicare Levy', '澳洲的医保税项，不是 Medicare 号码'],
  ['Health Insurance Plan', '商业医保的计划选择，不是编号'],
];

describe('覆盖面：中文标签', () => {
  it.each(ZH_LABEL_CASES)('「%s」判为 %s（%s）', (label, role) => {
    expect(resolvePiiField(fieldWithLabel(label))).toMatchObject({ role, tier: 'label' });
  });
});

/**
 * 按场景排的账本
 *
 * `'-'` 行写的是「这一格在这张表单里确实存在，但它不该提示」——五类场景里混着大量
 * 单据号、金额、合同日期，把它们钉在同一张表里，读者一眼能看出边界在哪，
 * 不必再翻 {@link NOT_COVERED_CASES}。
 */
describe('覆盖面：国内五类高频填报场景', () => {
  it.each(SCENE_CASES)('「%s」判为 %s（%s）', (label, role) => {
    const verdict = resolvePiiField(fieldWithLabel(label));
    if (role === '-') {
      expect(verdict.role, '这一格不该提示').toBeNull();
      return;
    }
    expect(verdict).toMatchObject({ role, tier: 'label' });
  });
});

describe('覆盖面：英文标签', () => {
  it.each(EN_LABEL_CASES)('「%s」判为 %s', (label, role) => {
    expect(resolvePiiField(fieldWithLabel(label))).toMatchObject({ role, tier: 'label' });
  });
});

describe('覆盖面：name 属性词元', () => {
  it.each(ATTR_CASES)('name="%s" 判为 %s', (name, role) => {
    const verdict = resolvePiiField(fieldWithName(name));
    if (role === '-') {
      expect(verdict.role, '这一格不该提示').toBeNull();
      expect(verdict.suppress).toBe('account');
      return;
    }
    expect(verdict).toMatchObject({ role, tier: 'attr' });
  });
});

describe('机构主体的证照号：改判编号族，但永不判成证件号', () => {
  it.each(ORG_CREDENTIAL_CASES)('「%s」判成编号族（%s）', label => {
    const verdict = resolvePiiField(fieldWithLabel(label));
    expect(verdict.role, '这一格该有提示').toBe('serialNumber');
    expect(verdict.role, '不许把人往本人身份证号上引').not.toBe('idNumber');
    expect(verdict.tier).toBe('label');
    expect(verdict.suppress).toBeNull();
    expect(verdict.needsVerify).toBe(true);
  });

  it('改判发生在 label 词典之前：同一条文本不会再被 idNumber 那一档接走', () => {
    const verdict = resolvePiiField(fieldWithLabel('机构证件号码'));
    expect(verdict.role).toBe('serialNumber');
    expect(verdict.evidence, '归因码仍要指向这道闸门，不能变成词典命中').toContain('org-cert');
  });

  it('证据界线两侧对照：同一句话只写在占位符里时仍沉默，写进标签才给提示', () => {
    document.body.innerHTML = '<label>证件号码<input id="f" placeholder="机构证件号码"></label>';
    const phOnly = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(phOnly.role, '占位符不是这一格在问什么，不许把它说成编号').toBeNull();
    expect(phOnly.suppress).toBe('orgCredential');

    document.body.innerHTML = '<label>机构证件号码<input id="f"></label>';
    const labelHit = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(labelHit.role).toBe('serialNumber');
  });
});

describe('机构词旁边写着人：闸门不连坐', () => {
  it.each(PERSON_OVERRIDE_CASES)('「%s」仍判为 %s（%s）', (label, role) => {
    expect(resolvePiiField(fieldWithLabel(label))).toMatchObject({ role, tier: 'label' });
  });
});

describe('库里没有的概念：保持沉默', () => {
  it.each(NOT_COVERED_CASES)('「%s」不出提示（%s）', label => {
    expect(resolvePiiField(fieldWithLabel(label)).role).toBeNull();
  });
});

/**
 * 编号族：给得出角色，但那个角色**不是**证件号
 *
 * 每一条同时钉两件事——`role === 'serialNumber'`（有提示）与「不是 idNumber」（没被引到身份证号上），
 * 后者是这一档存在的唯一理由；只断言前者的话，把整族并进 idNumber 也能全绿。
 * `needsVerify` 恒为真：这些编号既可能是家属的证（出生证、学位证），也不是每周都填的东西。
 */
describe('覆盖面：编号族落在自己的那一档', () => {
  it.each(SERIAL_CASES)('「%s」判为编号族（%s）', label => {
    const verdict = resolvePiiField(fieldWithLabel(label));
    expect(verdict.role, '这一格该有提示').toBe('serialNumber');
    expect(verdict.role, '不许把人往身份证号上引').not.toBe('idNumber');
    expect(verdict.tier).toBe('label');
    expect(verdict.needsVerify).toBe(true);
  });

  it('词典次序有牙：「社保卡电脑号」是编号族，而「社保卡号」仍判证件号', () => {
    // 两条只差「电脑」二字，走的是同一档子串判据。编号档必须排在社保那条 idNumber 短语之前，
    // 否则深圳那一串 8 位电脑号会被「社保卡」三个字先接走、提示成本人身份证号。
    expect(resolvePiiField(fieldWithLabel('社保卡电脑号')).role).toBe('serialNumber');
    expect(resolvePiiField(fieldWithLabel('社保卡号')).role).toBe('idNumber');
  });
});

describe('扩充不得放宽既有负向档', () => {
  /** 新增的证件 / 地址短语都带「号 / 码 / 地址」收口，因此这些元信息写法仍应沉默 */
  it.each([
    ['证件类型'],
    ['证件有效期'],
    ['地址标签'],
    ['银行卡类型'],
    ['信用卡有效期'],
    ['安全码'],
    ['验证码'],
    ['用户名'],
    ['昵称'],
    ['物品名称'],
  ])('「%s」仍然不出提示', label => {
    expect(resolvePiiField(fieldWithLabel(label)).role).toBeNull();
  });

  it('负向档吃的是合串文本：标签写着身份证号码、占位符写着有效期内时整体沉默', () => {
    document.body.innerHTML = '<label>身份证号码<input id="f" type="text" placeholder="18 位，有效期内"></label>';
    const verdict = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('negative');
  });

  it('「CVV」与卡有效期按卡类口令压制，不因卡类三档放开而漏口', () => {
    const cvv = fieldWithLabel('CVV');
    expect(cvv.name).toBe('');
    document.body.innerHTML = '<label>CVV<input id="f" name="cvv" autocomplete="cc-csc"></label>';
    const verdict = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('card');
  });
});
