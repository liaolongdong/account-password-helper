/** @vitest-environment jsdom */
/**
 * 页面个人信息（PII）字段分类器回归测试
 *
 * 每一条用例对应模拟跑批里真实付出过代价的一个形状（不是随手造的样例），
 * 因此这份测试同时是「词典为什么长成这样」的账本：
 * 去掉任一守卫，对应用例会从「不提示」变成「提示」或反向，
 * 命中的正是当初量化过的误报/漏报。
 *
 * 环境口径：`vitest.config.ts` 固定 `environment: 'node'`，本文件用
 * `@vitest-environment jsdom` 单独换环境——被测模块只读 DOM 结构，
 * 不碰布局/样式/事件，jsdom 的几何缺陷（见 `tests/helpers/domLayout.ts` 头注）不影响判定。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { classifyPiiRaw, collectPiiSignals, resolvePiiField, tokenize } from '@/entrypoints/content/piiClassifier';

/** 用一段真实形状的面板构造 DOM，取其中的第一个 input */
function inputOf(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  const el = document.body.querySelector('input');
  if (!el) throw new Error('夹具里没有 input');
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tokenize：词边界切词', () => {
  it('分隔符与 camelCase 双向拆分，且保留 CJK 连续段', () => {
    expect(tokenize('user_name')).toEqual(['user', 'name']);
    expect(tokenize('idCardNo')).toEqual(['id', 'card', 'no']);
    expect(tokenize('邮政编码')).toEqual(['邮政编码']);
  });

  it('切词是「按词元比对」的前提：子串匹配会把 username 读成姓名', () => {
    expect(tokenize('username')).toEqual(['username']);
    expect(tokenize('username')).not.toContain('name');
  });
});

describe('信号采集', () => {
  it('裸 input 向前退兄弟文本取标签（12306 那种 `姓名：<input>` 形状）', () => {
    const el = inputOf('<div>姓名：<input name="xm"></div>');
    expect(collectPiiSignals(el).label).toBe('姓名：');
  });

  it('兄弟节点必须「叶子状」：含 input 的块不参与 label 回退，否则整区空框都读成姓名', () => {
    document.body.innerHTML = '<div><div>姓名<input name="realname"></div><input name="weight"></div>';
    const el = document.body.querySelector('input[name="weight"]') as HTMLInputElement;
    const signals = collectPiiSignals(el);
    expect(signals.label).toBe('');
    expect(resolvePiiField(el).role).toBeNull();
  });

  it('表格形状退到 `<th>`', () => {
    const el = inputOf('<table><tr><th>姓名</th><td><input name="xm"></td></tr></table>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'name', tier: 'label' });
  });

  it('标签长度阈值按文字体系分档：英文 25 字母留得住，中文 22 字判为噪音', () => {
    const en = inputOf('<div>National Insurance number<input name="nino"></div>');
    expect(resolvePiiField(en)).toMatchObject({ role: 'idNumber', tier: 'label' });
    const zh = inputOf('<div>请填写您本人的居民身份证证件号码用于实名制认证核验<input name="x1"></div>');
    expect(resolvePiiField(zh).role).toBeNull();
  });

  it('中文短语匹配前压空白：站点会写成 `姓 名`', () => {
    const el = inputOf('<label>姓 名<input name="xingming"></label>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'name', tier: 'label' });
  });
});

describe('结构性排除', () => {
  it.each([
    ['隐藏域', '<input type="hidden" name="realname">'],
    ['勾选框', '<input type="checkbox" name="agree_name">'],
    ['搜索容器', '<div class="search-box"><input name="q_name"></div>'],
    ['role=searchbox', '<input role="searchbox" name="name">'],
  ])('%s 一律不出提示', (_label, html) => {
    expect(resolvePiiField(inputOf(html))).toMatchObject({ suppress: 'excluded' });
  });
});

describe('autocomplete 自声明优先', () => {
  it('站点的 `autocomplete="tel"` 直接给出角色，跳过账号守卫与词典', () => {
    const el = inputOf('<input name="loginMobile" autocomplete="tel">');
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', tier: 'autocomplete' });
  });

  it('卡类自声明按拍板不进路径', () => {
    const el = inputOf('<input name="cardNo" autocomplete="cc-number">');
    expect(classifyPiiRaw(el)).toMatchObject({ role: 'cardNo', card: true, suppress: 'card' });
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'card' });
  });
});

describe('负向语义先于正向词典', () => {
  it.each([
    ['用户名', 'zh-neg:用户名', '<label>用户名<input name="uname"></label>'],
    ['地址标签', 'zh-neg:标签', '<label>地址标签<input name="addr_label"></label>'],
    ['证件类型', 'zh-neg:类型', '<label>证件类型<input name="cert_type"></label>'],
    ['房间数量', 'zh-neg:数量', '<label>房间数量<input name="room_num"></label>'],
    ['物品名称', 'zh-neg:名称', '<label>物品名称<input name="goods_name"></label>'],
  ])('%s 被元信息/事物名后缀挡掉（依据=%s）', (_label, evidence, html) => {
    const verdict = resolvePiiField(inputOf(html));
    expect(verdict).toMatchObject({ role: null, suppress: 'negative', evidence });
  });

  it('英文 `Display name` 不被 name 词元抢走', () => {
    const el = inputOf('<label>Display name<input name="displayname"></label>');
    expect(resolvePiiField(el)).toMatchObject({ suppress: 'negative' });
  });

  it('裸 `code` 不在负向词元里：`post_code` / `zip_code` 仍是邮编', () => {
    expect(resolvePiiField(inputOf('<input name="post_code">'))).toMatchObject({
      role: 'postal',
      tier: 'attr',
      evidence: 'postcode',
    });
    expect(resolvePiiField(inputOf('<input name="zip_code">')).role).toBe('postal');
  });
});

describe('账号语义守卫', () => {
  /**
   * 负向短语档早于账号守卫，所以 `username` 记为 `negative`（EN_NEG 里有该短语），
   * 只有短语表没覆盖、要靠词元判的形状才记 `account`。两条压制都不出提示，
   * 原因码分开是为了让「词典漏了哪个词」在日志里可定位。
   */
  it.each([
    ['username', 'negative'],
    ['user_name', 'account'],
    ['account', 'account'],
    ['login_id', 'account'],
    ['pwd', 'account'],
  ])('name=%s 让位给登录链（原因=%s）', (name, suppress) => {
    const verdict = resolvePiiField(inputOf(`<input name="${name}">`));
    expect(verdict).toMatchObject({ role: null, suppress });
  });

  it('label 写着「用户名」时，即便 name 属性是 realname 也不出提示', () => {
    const el = inputOf('<label>用户名<input name="realname"></label>');
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'negative' });
  });
});

describe('name/id 词元与组合词元', () => {
  it('拼接词元救回切词切碎的形状：`idCardNo` 切出来是 id/card/no', () => {
    expect(resolvePiiField(inputOf('<input name="idCardNo">'))).toMatchObject({
      role: 'idNumber',
      tier: 'attr',
      evidence: 'idcardno',
    });
  });

  it('camelCase 的 `realName` 直接被切成 real + name，按 name 词元判', () => {
    expect(resolvePiiField(inputOf('<input name="realName">'))).toMatchObject({
      role: 'name',
      tier: 'attr',
      evidence: 'name',
    });
  });

  it('全小写粘连的 `realname` 靠修饰词剥离判，剥掉的修饰词同时是归属线索', () => {
    expect(resolvePiiField(inputOf('<input name="realname">'))).toMatchObject({
      role: 'name',
      evidence: 'realname',
      ownership: 'self',
    });
    expect(resolvePiiField(inputOf('<label>收货人姓名<input name="receiver_name"></label>'))).toMatchObject({
      role: 'name',
      ownership: 'confirm',
      needsVerify: true,
    });
  });

  it('`contact_no` 同时证明词典（contactno）与归属（contact）两条路径', () => {
    expect(resolvePiiField(inputOf('<input name="contact_no">'))).toMatchObject({
      role: 'phone',
      ownership: 'confirm',
      needsVerify: true,
    });
  });

  it('事物名上下文噪声让 `goods_name` / `hotelName` 不判成姓名', () => {
    expect(resolvePiiField(inputOf('<input name="goods_name">')).role).toBeNull();
    expect(resolvePiiField(inputOf('<input name="hotelName">')).role).toBeNull();
  });

  it('裸 `cardno` 刻意不收录：中文站点同时用它表示证件号与银行卡号，无法按词元区分', () => {
    expect(resolvePiiField(inputOf('<input name="cardNo">')).role).toBeNull();
  });
});

describe('placeholder 档不采集', () => {
  it('只有 placeholder 写着「真实姓名」时不出提示（模拟跑批里该档有效命中为 0）', () => {
    const el = inputOf('<input name="x" placeholder="请输入真实姓名">');
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'noRole' });
  });
});

describe('已输入值形状收口', () => {
  it.each([
    ['18 位证件号', '11010119900307001X', 'idNumber'],
    ['11 位手机号', '13800138000', 'phone'],
    ['邮箱', 'someone@example.com', 'email'],
  ])('%s 无标签也能收口（tier=value）', (_label, value, role) => {
    const el = inputOf('<input name="x">');
    el.value = value;
    expect(resolvePiiField(el)).toMatchObject({ role, tier: 'value' });
  });

  it('证件号形状必须额外核对', () => {
    const el = inputOf('<input name="x">');
    el.value = '110101199003070015';
    expect(resolvePiiField(el).needsVerify).toBe(true);
  });
});

describe('归属三档', () => {
  it('一定是别人的字段（紧急联系人）一律不给提示', () => {
    const el = inputOf('<label>紧急联系人姓名<input name="emergencyName"></label>');
    expect(classifyPiiRaw(el).role).toBe('name');
    expect(resolvePiiField(el)).toMatchObject({ role: null, ownership: 'other', suppress: 'ownership' });
  });

  it('无他人修饰的「姓名 / 手机号」是 self，且不需要二次核对', () => {
    expect(resolvePiiField(inputOf('<label>姓名<input name="realname"></label>'))).toMatchObject({
      ownership: 'self',
      needsVerify: false,
    });
  });

  it('卡头写着「收货地址」时，只标了「手机号码」的框继承 confirm', () => {
    const el = inputOf('<div class="card"><h3 class="card-hd">收货地址</h3><input name="mobile"></div>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', ownership: 'confirm', needsVerify: true });
  });

  it('继承是单向的：卡头只能把提示变保守，不能把已写明他人的框降回 self', () => {
    const el = inputOf('<div><h3 class="card-hd">个人资料</h3><label>收货人姓名<input name="realname"></label></div>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'name', ownership: 'confirm', needsVerify: true });
  });

  it('框上写着「本人」也会被卡头升到 confirm——方向是加一道核对，不是取消提示', () => {
    const el = inputOf('<div><h3 class="card-hd">收货地址</h3><label>本人手机号<input name="mobile"></label></div>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', ownership: 'confirm', suppress: null });
  });
});

describe('登录容器守卫按最小字段组', () => {
  it('同组出现口令框即让位', () => {
    const el = inputOf('<div><input name="realname"><input type="password" name="pwd"></div>');
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'loginGroup' });
  });

  it('同一个 form 里的注册页不整块拦掉：身份框各自成组仍出提示', () => {
    const html = `
      <form>
        <label>用户名<input name="username"></label>
        <label>密码<input type="password" name="password"></label>
        <label>真实姓名<input name="realname"></label>
      </form>`;
    document.body.innerHTML = html;
    const identity = document.body.querySelector('input[name="realname"]') as HTMLInputElement;
    expect(resolvePiiField(identity)).toMatchObject({ role: 'name', suppress: null });
  });

  it('卡类口令框（CVV 写成 password）豁免，否则支付页整页判成登录容器', () => {
    const el = inputOf(
      '<label>账单邮箱<input type="email" name="bill_email"><input type="password" name="cvv"></label>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: 'email', suppress: null });
  });
});

/**
 * 真机勘察（30 字段逐字段读 verdict）暴露的三处分档缺口。
 * 每一节都同时钉住「当初为什么不敢改」的对照组，收紧词典最容易把已有形状踩没。
 */
describe('姓名拆分：given / family 不能被裸 name 抢走', () => {
  it.each(['first_name', 'firstName', 'given_name', 'givenName'])('%s 判成「名」（attr）', attr => {
    expect(resolvePiiField(inputOf(`<input name="${attr}">`))).toMatchObject({ role: 'givenName', tier: 'attr' });
  });

  it.each(['last_name', 'lastName', 'family_name', 'surname'])('%s 判成「姓」（attr）', attr => {
    expect(resolvePiiField(inputOf(`<input name="${attr}">`))).toMatchObject({ role: 'familyName', tier: 'attr' });
  });

  it('拆分只改角色，不动归属：`realname` 仍是完整姓名档', () => {
    expect(resolvePiiField(inputOf('<input name="realname">'))).toMatchObject({ role: 'name', evidence: 'realname' });
    expect(resolvePiiField(inputOf('<input name="full_name">')).role).toBe('name');
  });
});

describe('单位名：属性档此前被 `company` 负向词元整条吃掉', () => {
  it.each(['company', 'company_name', 'companyName', 'employer'])('%s 判成 org', attr => {
    expect(resolvePiiField(inputOf(`<input name="${attr}">`))).toMatchObject({ role: 'org', suppress: null });
  });

  it('`company_name` 不再被裸 name 词元读成人名', () => {
    expect(resolvePiiField(inputOf('<input name="company_name">')).evidence).not.toBe('name');
  });

  it('公司 + 描述性后缀仍是元信息，豁免只给「单位叫什么」', () => {
    for (const attr of ['company_size', 'company_logo', 'company_url', 'company_industry']) {
      expect(resolvePiiField(inputOf(`<input name="${attr}">`)).role).toBeNull();
    }
  });

  it('公司地址仍归 address：org 档排在词典末尾，不抢既有角色', () => {
    expect(resolvePiiField(inputOf('<input name="company_address">')).role).toBe('address');
  });

  it('毕业院校仍是负向：`school` 在表单里通常指院校而不是雇主，不进单位名豁免', () => {
    expect(resolvePiiField(inputOf('<input name="school">')).suppress).toBe('negative');
    expect(resolvePiiField(inputOf('<input name="school_name">')).role).toBeNull();
  });
});

describe('中文单位名不再被裸「名称」负向词吃掉', () => {
  it('「单位名称 / 公司名称」给 org 提示', () => {
    expect(resolvePiiField(inputOf('<label>单位名称<input name="dwmc"></label>'))).toMatchObject({
      role: 'org',
      tier: 'label',
    });
    expect(resolvePiiField(inputOf('<label>公司名称<input name="gsmc"></label>')).role).toBe('org');
    expect(resolvePiiField(inputOf('<label>发票抬头单位名称<input name="title"></label>')).role).toBe('org');
  });

  it('豁免只认组织名词：「物品名称 / 商品名称」仍是事物名', () => {
    expect(resolvePiiField(inputOf('<label>物品名称<input name="wpmc"></label>')).role).toBeNull();
    expect(resolvePiiField(inputOf('<label>商品名称<input name="spm"></label>')).role).toBeNull();
  });
});

describe('输出边界', () => {
  it('判定的可见产物只有角色/层级/归属/核对标志/原因/依据，不含字段值', () => {
    const el = inputOf('<input name="idCardNo">');
    el.value = '110101199003070015';
    expect(Object.keys(resolvePiiField(el)).sort()).toEqual([
      'evidence',
      'needsVerify',
      'ownership',
      'role',
      'suppress',
      'tier',
    ]);
  });
});
