/** @vitest-environment jsdom */
/**
 * 「就近取本人姓名当搜索词」回归测试（A 方案的取值侧）
 *
 * 用户已批准把「同区块里那个已判定为『姓名』且属于本人的框」的当前值，作为搜索词带进
 * 身份库弹窗，让「填了姓名 → 下一框想取证件号」这一步少一次筛选。这是本功能**唯一**一条
 * 明文出页面的通道，因此这一层的判据必须是「谁能被读」而不是「读到了什么」：
 *
 * - 只有分类结论 `role === 'name'` 且 `ownership === 'self'` 的框才是候选；
 * - `confirm`（收货人可能是家属）与 `other`（紧急联系人一定是别人）不作为搜索词，
 *   前者是歧义、后者按既有拍板整条不出提示，都不该反过来决定库里该显示谁；
 * - 结构性排除的框（`type=password` / `type=hidden`）在 `role` 这一步就落空，
 *   所以遮蔽值与隐藏值物理上不会被读第二次；
 * - 扫描有界：控件数超过上限即停止，注册长表单不至于每次点击都全表扫一遍。
 *
 * 取值时机（点击那一刻才读，不在聚焦时缓存）由 `tests/architecture/identityHintWiring.test.ts`
 * 按源码兜网；这里只管「给不给取值」这一条边界。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NAME_KEYWORD_SCAN_LIMIT, resolvePiiField, selfNameValueNear } from '@/entrypoints/content/piiClassifier';

/** 取区块内某个 id 的控件作为「当前聚焦字段」 */
function fieldOf(html: string, id: string): HTMLElement {
  document.body.innerHTML = html;
  const el = document.getElementById(id);
  if (!el) throw new Error(`夹具里没有 #${id}`);
  return el as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('selfNameValueNear：谁能被当作搜索词', () => {
  it('同表单里已填写的姓名框，值就是搜索词', () => {
    const el = fieldOf(
      '<form><p><label>真实姓名<input id="n" name="realname" value="廖龙东"></label></p>' +
        '<p><label>证件号码<input id="i" name="idNumber"></label></p></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('廖龙东');
  });

  it('聚焦框自己就是姓名框时取自己的值（在姓名框上点「从身份库选择」）', () => {
    const el = fieldOf('<form><label>真实姓名<input id="n" name="realname" value="张三"></label></form>', 'n');
    expect(selfNameValueNear(el)).toBe('张三');
  });

  it('姓名框还空着就没有搜索词：不返回空串之外的任何东西', () => {
    const el = fieldOf(
      '<form><label>真实姓名<input id="n" name="realname" value=""></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('');
  });

  it('收货人档（待核对）不作为搜索词', () => {
    const el = fieldOf(
      '<form><h3>收货信息</h3><label>收货人<input id="n" name="receiver_name" value="李四"></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    // 前置自检：那一框确实是姓名角色，证明这条红来自「归属不为本人」，不是夹具没写成姓名框
    expect(resolvePiiField(document.getElementById('n') as Element).role).toBe('name');
    expect(selfNameValueNear(el)).toBe('');
  });

  it('紧急联系人档（一定是别人）整条已被压制，更不会被读成搜索词', () => {
    const el = fieldOf(
      '<form><label>紧急联系人姓名<input id="n" name="emergency_name" value="王五"></label>' +
        '<label>紧急联系人电话<input id="i" name="emergency_phone"></label></form>',
      'i',
    );
    // 这条红不靠取值规则：那一框在 `resolvePiiField` 就被归属压制（role 置空），
    // 断言压制原因，免得日后压制失效时它反而悄悄失去意义。
    expect(resolvePiiField(document.getElementById('n') as Element).suppress).toBe('ownership');
    expect(selfNameValueNear(el)).toBe('');
  });

  it('遮蔽值与隐藏值物理上取不到：结构性排除的框进不了候选集', () => {
    const masked = fieldOf(
      '<form><label>真实姓名<input id="n" name="realname" type="password" value="廖龙东"></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(masked)).toBe('');
    const hidden = fieldOf(
      '<form><input id="n" name="realname" type="hidden" value="廖龙东">' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(hidden)).toBe('');
  });

  it('多个姓名框按文档顺序取第一个非空：站点会摆「本人姓名 + 监护人姓名」两栏', () => {
    const el = fieldOf(
      '<form><label>姓名<input id="n1" name="realname" value="廖龙东"></label>' +
        '<label>姓名<input id="n2" name="realname2" value="监护人"></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('廖龙东');
  });

  it('textarea 形态的姓名框同样参与（详情页常用 textarea）', () => {
    const el = fieldOf(
      '<form><label>真实姓名<textarea id="n" name="realname">廖龙东</textarea></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('廖龙东');
  });

  it('作用域是所在表单：隔壁表单里的姓名不串过来', () => {
    const el = fieldOf(
      '<form><label>姓名<input id="n" name="realname" value="廖龙东"></label></form>' +
        '<form><label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('');
  });

  it('没有 form 时按整页扫（SPA 注册页常把字段拆成多个 div 而无 form）', () => {
    const el = fieldOf(
      '<div class="step1"><label>真实姓名<input id="n" name="realname" value="廖龙东"></label></div>' +
        '<div class="step2"><label>证件号码<input id="i" name="idNumber"></label></div>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('廖龙东');
  });

  it('扫描有界：超出上限的姓名框不参与（长表单点击不扫全表）', () => {
    const filler = Array.from(
      { length: NAME_KEYWORD_SCAN_LIMIT },
      (_, i) => `<input id="pad${i}" name="pad${i}">`,
    ).join('');
    const el = fieldOf(
      `<form><label>证件号码<input id="i" name="idNumber"></label>${filler}` +
        '<label>真实姓名<input id="n" name="realname" value="廖龙东"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('');
    // 正向对照：把同一个姓名框挪到上限之内，它就取到了——证明上一条红的是边界，不是夹具写坏
    const inside = fieldOf(
      '<form><label>证件号码<input id="i" name="idNumber"></label>' +
        '<label>真实姓名<input id="n" name="realname" value="廖龙东"></label></form>',
      'i',
    );
    expect(selfNameValueNear(inside)).toBe('廖龙东');
  });

  it('脱敏：值里的首尾空白被剪掉，返回值就是搜索框该显示的那串', () => {
    const el = fieldOf(
      '<form><label>真实姓名<input id="n" name="realname" value="  廖龙东  "></label>' +
        '<label>证件号码<input id="i" name="idNumber"></label></form>',
      'i',
    );
    expect(selfNameValueNear(el)).toBe('廖龙东');
  });
});
