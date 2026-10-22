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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    /** `name` 刻意留空词元：`nino` 现在由属性档自己认得（tier 会变成 `attr`），这一行就测不到标签长度了 */
    const en = inputOf('<div>National Insurance number<input name="x0"></div>');
    expect(resolvePiiField(en)).toMatchObject({ role: 'idNumber', tier: 'label' });
    const zh = inputOf('<div>请填写您本人的居民身份证证件号码用于实名制认证核验<input name="x1"></div>');
    expect(resolvePiiField(zh).role).toBeNull();
  });

  it('中文短语匹配前压空白：站点会写成 `姓 名`', () => {
    const el = inputOf('<label>姓 名<input name="xingming"></label>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'name', tier: 'label' });
  });

  /**
   * Element Plus / Ant Design 那类「label 块与 content 块互为兄弟」的表单：input 不是 label 的
   * 后代，`closest('label')` 拿不到；它的 id 是 `el-id-1-2` 这种合成串，属性档也没信号；
   * 兄弟回退同样落空（input 是 `.el-input` 的独子）。三条路全断 = 证件号框**静默漏报**。
   * 唯一还挂在页面上的线索是 `label for`，所以必须做反查。
   */
  it('label[for] 反查救回组件库形状：label 不是 input 的祖先时也能拿到标签', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label class="el-form-item__label" for="el-id-1-2">证件号码</label>
        <div class="el-form-item__content">
          <div class="el-input"><input id="el-id-1-2" class="el-input__inner" type="text"></div>
        </div>
      </div>`;
    const el = document.getElementById('el-id-1-2') as HTMLInputElement;
    expect(collectPiiSignals(el).label).toBe('证件号码');
    expect(resolvePiiField(el)).toMatchObject({ role: 'idNumber', tier: 'label' });
    // 反查必须走原生关联（`el.labels`），不许退化成「扫全文档的 label 再比 for」：
    // 这条判据在聚焦热路径上每个框都要走一遍，点击通道的 `selfNameValueNear` 最多还会连问 80 次，
    // 扫全文档就是 80 × 页面 label 总数——agents.md 要求 content 侧 DOM 扫描有界。
    const spy = vi.spyOn(document, 'querySelectorAll');
    collectPiiSignals(el);
    const labelScans = spy.mock.calls.filter(([selector]) => String(selector).includes('label'));
    spy.mockRestore();
    expect(labelScans, `反查标签退化成全文档扫 label（${labelScans.length} 次）`).toHaveLength(0);

    // 等价性钉子：包裹式 label 文本为空时不判死这一档，继续看后面 `for` 指过来的那一枚。
    // 换掉取标签的写法（原生 `labels` 替掉逐枚比对）时，这一句保证旧行为里那半边语义没丢。
    document.body.innerHTML = '<label><input id="d"></label><label for="d">单位名称</label>';
    expect(resolvePiiField(document.getElementById('d') as HTMLInputElement)).toMatchObject({
      role: 'org',
      tier: 'label',
    });
  });

  it('aria-labelledby 反查 id 列表：显式关联赢过恰好挨着的兄弟节点', () => {
    document.body.innerHTML =
      '<span id="lb-a">详细</span><span id="lb-b">地址</span><input id="f" aria-labelledby="lb-a lb-b">';
    const el = document.getElementById('f') as HTMLInputElement;
    expect(collectPiiSignals(el).label).toBe('详细 地址');
    expect(resolvePiiField(el)).toMatchObject({ role: 'address', tier: 'label' });
  });

  it('显式关联排在兄弟文本回退之前：包着 input 的 label 赢过页面上另一枚 for 指向它的 label', () => {
    document.body.innerHTML = '<label>手机<input id="c"></label><label for="c">单位名称</label>';
    const el = document.getElementById('c') as HTMLInputElement;
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', tier: 'label' });
  });

  /**
   * 「联系方式」就是手机号框最常见的中文写法，ZH_DICT 的 phone 档里明确收了它——
   * 但 `方式` 作为「元信息」负向短语排在正向词典之前，整串里只要出现「方式」就先被判负向，
   * 于是 phone 档那条「联系方式」在这套顺序下**永远够不到**。
   * 例外只开「联系」这一个词：`支付方式` / `配送方式` / `缴费方式` 描述的仍是「怎么填」，必须照旧挡掉。
   */
  it('「联系方式」不再被裸「方式」负向短语吃掉', () => {
    const el = inputOf('<label>联系方式<input name="contact_way"></label>');
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', tier: 'label' });
  });

  it.each(['支付方式', '配送方式'])('%s 仍按元信息挡掉：放行的只有「联系方式」这一种写法', text => {
    const el = inputOf(`<label>${text}<input name="way"></label>`);
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'negative' });
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

  /**
   * 密码框必须在结构性排除里，而且要早于形状回推。
   *
   * 最后一层会读一次 `input.value` 做形状收口：`type="password"` 的框里恰好存着一串
   * 11 位数字时，那串数字最可能是手机号或短信验证码，但**绝不可能**是等着被身份库召唤的
   * 个人信息字段——提示会挂在遮蔽框下面，用户按「从身份库选择」只会填错东西。
   * 「密码框一定被登录容器守卫挡掉」挡不住这条：那道守卫在字段组超过 4 个输入框时主动退出
   * （避免把大表单整页判成登录区），而遮蔽框的值本来就不该参与语义判定。
   */
  it('密码框即使值像手机号也不出提示：遮蔽值不参与形状回推', () => {
    document.body.innerHTML = `
      <form>
        <input name="f1"><input name="f2"><input name="f3"><input name="f4">
        <input type="password" name="x">
      </form>`;
    const el = document.body.querySelector('input[type="password"]') as HTMLInputElement;
    el.value = '13800138000';
    expect(el.closest('form')!.querySelectorAll('input').length).toBe(5);
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'excluded', evidence: 'type=password' });
  });

  it('单个密码框也不出提示：结构性排除排在登录容器守卫之前', () => {
    const el = inputOf('<input type="password" name="x">');
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'excluded', evidence: 'type=password' });
  });
});

describe('autocomplete 自声明优先', () => {
  it('站点的 `autocomplete="tel"` 直接给出角色，跳过账号守卫与词典', () => {
    const el = inputOf('<input name="loginMobile" autocomplete="tel">');
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', tier: 'autocomplete' });
  });

  it('卡号自声明现在进提示路径（2026-10-17 改判：卡号 / 户名 / 开户行三档放开）', () => {
    const el = inputOf('<input name="cardNo" autocomplete="cc-number">');
    expect(classifyPiiRaw(el)).toMatchObject({ role: 'cardNo', card: true, suppress: null });
    expect(resolvePiiField(el)).toMatchObject({ role: 'cardNo', needsVerify: true });
  });

  it('卡类口令永不提示：有效期与 CVV 自声明仍按 `card` 压制', () => {
    for (const ac of ['cc-exp', 'cc-csc']) {
      const el = inputOf(`<input autocomplete="${ac}">`);
      expect(classifyPiiRaw(el)).toMatchObject({ card: true, suppress: 'card' });
      expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'card' });
    }
  });
});

/**
 * 卡类三档识别（2026-10-17 拍板放开：卡号 / 户名 / 开户行；有效期与 CVV 永不提示）。
 *
 * 三条形状各自的坑都在这儿钉住：`银行账号` 撞负向词 `账号`（与 `名称` / `方式` 同一类歧义，
 * 例外只给「这一串问的就是卡」的形状）；`持卡人姓名` 撞词典里排在最前的 `姓名`，
 * 所以卡档必须插在 name 之前；`开户银行名称` 同时撞 `名称` 负向与 org 词典，靠组织名词豁免放行。
 */
describe('卡类三档：卡号 / 户名 / 开户行', () => {
  it.each([
    ['银行卡号', 'cardNo'],
    ['卡号', 'cardNo'],
    ['银行账号', 'cardNo'],
    ['银行帐号', 'cardNo'],
    ['信用卡号', 'cardNo'],
    ['持卡人姓名', 'cardHolder'],
    ['持卡人', 'cardHolder'],
    ['开户银行名称', 'cardBank'],
    ['开户行', 'cardBank'],
  ])('中文「%s」判成 %s', (text, role) => {
    const verdict = resolvePiiField(inputOf(`<label>${text}<input name="f"></label>`));
    expect(verdict).toMatchObject({ role, tier: 'label', needsVerify: true });
  });

  it.each([
    ['card number', 'cardNo'],
    ['cardholder name', 'cardHolder'],
    ['bank name', 'cardBank'],
  ])('英文「%s」判成 %s', (text, role) => {
    expect(resolvePiiField(inputOf(`<label>${text}<input name="f"></label>`))).toMatchObject({ role });
  });

  it('卡档插在姓名之前，但只改角色不改归属：`持卡人姓名` 仍是本人', () => {
    expect(resolvePiiField(inputOf('<label>持卡人姓名<input name="hdr"></label>'))).toMatchObject({
      role: 'cardHolder',
      ownership: 'self',
    });
  });

  it('例外只给卡：裸「账号」与「银行卡类型 / 信用卡有效期」仍一律沉默', () => {
    expect(resolvePiiField(inputOf('<label>账号<input name="zh"></label>'))).toMatchObject({
      role: null,
      suppress: 'negative',
    });
    expect(resolvePiiField(inputOf('<label>银行卡类型<input name="lx"></label>')).role).toBeNull();
    expect(resolvePiiField(inputOf('<label>信用卡有效期<input name="yx"></label>')).role).toBeNull();
    expect(resolvePiiField(inputOf('<label>安全码<input name="cvv"></label>')).role).toBeNull();
  });

  it('别人的卡不给提示：卡档排在他人词表之后仍会被归属压制', () => {
    expect(resolvePiiField(inputOf('<label>配偶银行卡号<input name="other"></label>'))).toMatchObject({
      role: null,
      ownership: 'other',
      suppress: 'ownership',
    });
  });

  it('placeholder 自述「请输入银行卡号」同样出卡号档', () => {
    expect(resolvePiiField(inputOf('<input name="f" placeholder="请输入银行卡号">'))).toMatchObject({
      role: 'cardNo',
      tier: 'placeholder',
    });
  });

  it('卡号不参与「证件号形状回推」：一串 16 位数字不许被认成证件号', () => {
    const el = inputOf('<input name="f">');
    el.value = '6222021234567890';
    expect(resolvePiiField(el).role).toBeNull();
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

describe('placeholder 档：字段自述里最弱的一条线索', () => {
  /**
   * 这一档 2026-10-17 前刻意不吃正向词典（94 字段语料上有效命中为 0），改判的依据是
   * 组件库形状：AntD 行栅格与 EP「一项两控件不发 `for`」让四条常规线索同时落空，
   * 对一家银行开户页实测 88 枚控件 0 提示。这几条形状就是那次漏报的反面。
   */
  it('只有占位符写着角色词也出提示（用户点名的检测面）', () => {
    const shapes: [string, string][] = [
      ['请输入真实姓名', 'name'],
      ['请输入身份证号', 'idNumber'],
      ['请输入邮箱地址', 'email'],
      ['联系方式', 'phone'],
      ['请输入送货地址', 'address'],
      ['户籍所在地', 'region'],
    ];
    for (const [placeholder, role] of shapes) {
      const verdict = resolvePiiField(inputOf(`<input name="x" placeholder="${placeholder}">`));
      expect(verdict, placeholder).toMatchObject({ role, tier: 'placeholder' });
    }
  });

  it('占位符排在所有强线索之后：打架时以 label 为准，账号词与负向词仍然先把它挡下', () => {
    expect(
      resolvePiiField(inputOf('<label>联系电话<input name="x" placeholder="请输入邮箱地址"></label>')),
    ).toMatchObject({ role: 'phone', tier: 'label' });
    expect(resolvePiiField(inputOf('<input name="user_account" placeholder="请输入姓名">')).suppress).toBe('account');
    expect(resolvePiiField(inputOf('<input name="x" placeholder="请输入验证码">')).role).toBeNull();
    expect(resolvePiiField(inputOf('<input name="x" type="password" placeholder="请输入证件号码">')).suppress).toBe(
      'excluded',
    );
  });

  it('占位符自己写着机构主体不许开口：那问的是机构的证照号，不是屏幕前这个人的', () => {
    expect(resolvePiiField(inputOf('<input name="x" placeholder="请输入机构证件号码">')).role).toBeNull();
    expect(resolvePiiField(inputOf('<input name="x" placeholder="统一社会信用代码">')).role).toBeNull();
  });
});

describe('同项兄弟标签档：标签块与控件块互为兄弟的组件库形状', () => {
  /** 造一枚「兄弟标签 + 控件块」的表单项，取其中第 index 枚控件（0 起） */
  function controlOf(html: string, index = 0): HTMLElement {
    document.body.innerHTML = html;
    const el = document.body.querySelectorAll('input, textarea, select')[index];
    if (!el) throw new Error('夹具里没有控件');
    return el as HTMLElement;
  }

  it('EP 一项两控件不发 `for`：兄弟标签块就是这一框的名字（tier=group）', () => {
    const el = controlOf(
      '<div class="el-form-item"><div class="el-form-item__label">证件号码</div>' +
        '<div class="el-form-item__content"><span><input name="a" placeholder="请选择"></span>' +
        '<input class="el-input__inner" placeholder="请输入证件号码"></div></div>',
      1,
    );
    expect(resolvePiiField(el)).toMatchObject({ role: 'idNumber', tier: 'group', evidence: '证件号码' });
  });

  it('一项里出现第三枚控件，那段文字就是区标题而不是这一框的名字', () => {
    const el = controlOf(
      '<div class="row"><div class="field-label">收货地址</div><div class="ctl">' +
        '<input placeholder="请选择省"><input placeholder="请选择市"><input placeholder="请选择区">' +
        '</div></div>',
      0,
    );
    expect(resolvePiiField(el).tier).not.toBe('group');
    expect(resolvePiiField(el).role).toBeNull();
  });

  it('兄弟标签与占位符互相打脸时整项沉默：两条弱线索没有一条能压过另一条', () => {
    const el = controlOf(
      '<div class="row"><div class="field-label">证件号码</div><div class="ctl">' +
        '<input name="x" placeholder="请输入邮箱地址"></div></div>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'noRole' });
  });

  it('兄弟标签既是角色来源也是归属来源，且只许单向收紧', () => {
    const selfNamed = controlOf(
      '<div class="row"><div class="field-label">本人姓名</div><div class="ctl"><input name="x" placeholder="请输入姓名"></div></div>',
    );
    expect(resolvePiiField(selfNamed)).toMatchObject({ role: 'name', tier: 'group', ownership: 'self' });
    /** 占位符写着「配偶」即已判明是别人：兄弟标签写着「本人姓名」也不许把它放松回 self */
    const otherNamed = controlOf(
      '<div class="row"><div class="field-label">本人姓名</div><div class="ctl"><input name="x" placeholder="配偶姓名"></div></div>',
    );
    expect(resolvePiiField(otherNamed)).toMatchObject({ ownership: 'other', suppress: 'ownership' });
  });

  it('组织主体的兄弟标签写明证照号时改判编号族，不再整项沉默', () => {
    const el = controlOf(
      '<div class="row"><div class="field-label">金融业务资质证件号码</div><div class="ctl">' +
        '<input name="x" placeholder="请输入证件号码"></div></div>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: 'serialNumber', tier: 'group', suppress: null });
  });

  it('兄弟标签落空仍不影响 placeholder 自证：两条弱线索各自成立', () => {
    const el = controlOf(
      '<div class="row"><div class="field-label">支付方式</div><div class="ctl">' +
        '<input name="x" placeholder="请输入邮箱地址"></div></div>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: 'email', tier: 'placeholder' });
  });

  /**
   * 下拉的**当前选中值**显示块不是标签。
   *
   * Element Plus 2.14.4 的 `.el-select__selection` 里，「当前选中了什么」那一块就挂在代理 input
   * 的前兄弟位置，文字正是「手机号码」。它长得像标签、是叶子、块内只有一枚载体——三道预算全过，
   * 只有「这块文字在给这一框命名、还是在报这一框的值」能把它挡下：把类型选择器报成 phone，
   * 提示就是在往「选证件类型」的那格里塞证件号。
   */
  it('下拉的「当前选中值」显示块不许当标签：那写着「手机号码」也不是这一框的名字', () => {
    const el = controlOf(
      '<div class="el-select"><div class="el-select__wrapper"><div class="el-select__selection">' +
        '<div class="el-select__selected-item">手机号码</div>' +
        '<div class="el-select__selected-item el-select__input-wrapper">' +
        '<input class="el-select__input" type="text" readonly></div></div></div></div>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'noRole' });
  });

  /**
   * Ant Design 3 的同一种形状，挡下它的却是另一道门。
   *
   * 那套组件把代理 input 写成 `class="ant-select-search__field"`，容器叫 `ant-select-search`，
   * 于是结构性排除里的「搜索容器」先命中，兄弟标签那条通道根本走不到。
   * 这一行钉的是 2026-10-17 那次真实勘察读数：银行开户页 8 枚这种 input 全部沉默，
   * 归因到 `inSearchBox`（气泡侧的 0×0 视口守卫是同一条结论的第二重保险，不是它的原因）。
   * 记下它，是为了让「给兄弟标签加形状门」这次收窄能被看见——它不该让这一行改判。
   */
  it('AntD 的搜索代理 input 由搜索容器排除挡下，与形状门无关', () => {
    const el = controlOf(
      '<span class="ant-select"><span class="ant-select-selection__rendered">' +
        '<div class="ant-select-selection-selected-value">中国居民身份证</div>' +
        '<div class="ant-select-search"><input class="ant-select-search__field" type="text" readonly></div>' +
        '</span></span>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: null, suppress: 'excluded' });
  });

  /**
   * 政务 / 社保页的主流形状：整张表单是一张 `<table>`，标签格与控件格互为兄弟。
   *
   * 结构和 EP 的 `el-form-item__label` 完全同构，差别只在标签块用的是 `<td>`、
   * 类名里也没有 `label`。原生标签集合收了 `th`，`td` 不在里面，于是形状门把这一整类
   * 连同它给的名字一起清零——2026-10-17 用户实测的一张社保参保登记表就是这个读数
   * （「身份证号码」+「姓名」那一行不出提示）。
   *
   * 两格分开取：同一 `<tr>` 里前一格的文字不能被后一格读走，回兄弟必须停在自己那格之前。
   */
  it('表格表单的 `<td>` 标签格是这一框的名字，且各格只认自己前面那格', () => {
    const row =
      '<table><tbody><tr><td class="tdBg">身份证号码</td><td><input id="sfzh" maxlength="18"></td>' +
      '<td class="tdBg">姓名</td><td><input id="xm"></td></tr></tbody></table>';
    expect(resolvePiiField(controlOf(row))).toMatchObject({
      role: 'idNumber',
      tier: 'group',
      evidence: '身份证号码',
    });
    expect(resolvePiiField(controlOf(row, 1))).toMatchObject({ role: 'name', tier: 'group', evidence: '姓名' });
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

  it('组件库卡片头也能继承归属：ant-card-head-title 不会被当成独立卡片跳过', () => {
    const el = inputOf(
      '<div class="ant-card"><div class="ant-card-head"><div class="ant-card-head-title">收货地址</div></div>' +
        '<div class="ant-card-body"><label>手机号<input name="mobile"></label></div></div>',
    );
    expect(resolvePiiField(el)).toMatchObject({ role: 'phone', ownership: 'confirm', needsVerify: true });
  });

  it('页面级无关标题不再污染整张表单：body 顶部的「紧急联系人」不改变表单内字段归属', () => {
    document.body.innerHTML = '<h1>紧急联系人</h1><form><label>手机号<input id="f" name="mobile"></label></form>';
    const verdict = resolvePiiField(document.getElementById('f') as HTMLInputElement);
    expect(verdict).toMatchObject({ role: 'phone', ownership: 'self', suppress: null });
  });

  it('「被保险人」归属不是本人：名称词典仍认得出，但整条提示被压制', () => {
    const verdict = resolvePiiField(inputOf('<label>被保险人<input name="insured_name"></label>'));
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('ownership');
  });

  it.each([
    ['身份证后6位', 'idNumber'],
    ['手机号后四位', 'phone'],
    ['银行卡 last 4', 'cardNo'],
  ])('部分值字段「%s」不再提示取完整高敏值', (label, role) => {
    const verdict = resolvePiiField(inputOf(`<label>${label}<input name="${role}"></label>`));
    expect(verdict.role).toBeNull();
    expect(verdict.suppress).toBe('negative');
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

describe('证件号的中文别名不能只认「身份证」这三个字', () => {
  /**
   * 「公民身份号码」是公安系统的正式叫法，社保 / 政务 / 银行页面普遍这么写，
   * 而它不含「身份证」（是「身份」+「号码」），按旧词典整条落空。「身份号」是空间不够时的缩写。
   */
  it.each(['公民身份号码', '身份号码', '居民身份证号码', '证件号码'])('%s 判成 idNumber', text => {
    expect(resolvePiiField(inputOf(`<label>${text}<input name="zjhm"></label>`))).toMatchObject({
      role: 'idNumber',
      tier: 'label',
    });
  });

  it('加宽证件号档不踩「身份」开头的元信息后缀', () => {
    expect(resolvePiiField(inputOf('<label>身份验证方式<input name="fs"></label>')).role).toBeNull();
    expect(resolvePiiField(inputOf('<label>身份照片<input name="zp"></label>')).role).toBeNull();
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
