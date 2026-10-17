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
  ['accountNumber', 'cardNo', '银行账号：卡类词元先于账号守卫比对，这里必须仍走得通'],
  ['houseNumber', 'address', '门牌字段名'],
  ['apartment', 'address', '单元号字段名'],
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
 * 必须保持沉默的写法：机构主体的证照号（不是屏幕前这个人的）与本库装不下的人口学字段。
 * `suppress` 为期望的出口码——它同时是「为什么这句没提示」的可归因答案。
 */
const ORG_CREDENTIAL_CASES: readonly (readonly [label: string, why: string])[] = [
  ['机构证件号码', '银行开户页的对公主体证照'],
  ['统一社会信用代码', '对公表单的第一行'],
  ['营业执照号码', '对公表单'],
  ['纳税人识别号', '发票开立'],
  ['组织机构代码', '老式对公表单'],
  ['金融许可证编号', '银行业监管信息'],
  ['Company Tax Number', '海外对公税号'],
  ['Employer Identification Number', '美国 W-9 的 EIN'],
  ['Business Registration Number', '港新对公注册号'],
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
  ['出生证编号', '问的是《出生医学证明》的编号，此前被裸「出生」读成生日，会把人往日期上引'],
  ['出生医学证明号', '同上'],
  ['身份证有效期止', '证件有效期是日期，库里没有那一格，此前被「身份证」三字接走'],
  ['IP地址', '机器的地址，不是住址——「地址」两字的子串判据需要这一条例外'],
  ['与申请人关系', '问的是关系称谓，不是姓名（此前的结论来自 name 档末尾那个「人」组）'],
  ['单位性质', '与「单位类型」同族元信息，此前只有「类型」进了负向档'],
  ['户籍性质', '同上，且此前被「户籍」抢成地区'],
  ['Ethnicity', '英文 region 档的裸 city 把它读成地区；民族库里没有，本就不该提示'],
  // —— 边界钉：这一族编号**不等于**本人证件号，补词典时不许顺手接进 idNumber ——
  ['驾照档案编号', '车管所档案号，与驾驶证号是两串不同的数'],
  ['学历证书编号', '资格证书编号，提示成「证件号」会把人往身份证号上引'],
  ['学位证书编号', '同上'],
  ['教师资格证编号', '同上'],
  ['医师资格证号', '同上'],
  ['保单号', '保单自己的编号，不是本人证件号'],
  ['社保电脑号', '深圳那一串 8 位电脑号不等于身份证号'],
  ['公积金个人编号', '同上，库里没有那一格'],
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
    expect(resolvePiiField(fieldWithName(name))).toMatchObject({ role, tier: 'attr' });
  });
});

describe('机构主体的证照号：全层压制', () => {
  it.each(ORG_CREDENTIAL_CASES)('「%s」不出提示（%s）', label => {
    const verdict = resolvePiiField(fieldWithLabel(label));
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('orgCredential');
  });

  it('压制发生在 label 层之前：同一条文本不会再被词典接走', () => {
    const verdict = resolvePiiField(fieldWithLabel('机构证件号码'));
    expect(verdict.tier).toBeNull();
  });

  it('占位符里写着机构证照号时同样压制（即便标签像是本人证件号）', () => {
    document.body.innerHTML = '<label>证件号码<input id="f" placeholder="机构证件号码"></label>';
    const verdict = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('orgCredential');
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

  it('「CVV」与卡有效期按卡类口令压制，不因卡类三档放开而漏口', () => {
    const cvv = fieldWithLabel('CVV');
    expect(cvv.name).toBe('');
    document.body.innerHTML = '<label>CVV<input id="f" name="cvv" autocomplete="cc-csc"></label>';
    const verdict = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('card');
  });
});
