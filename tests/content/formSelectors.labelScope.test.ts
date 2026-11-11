// @vitest-environment jsdom
/**
 * 可及名的作用域边界：哪把尺子读 `<label>`，哪把不读
 *
 * 2026-11-11 的用户拍板把 46bd26b 的收益限定在**捕获证据链**：自动保存要认得规范标注的
 * 登录页，但填充落点、侧边栏触发与身份提示让位必须回到改动前的四属性尺子。理由是两条链
 * 的误判代价不对称——捕获多认一个框只是多问一句「要不要保存」，而让位判据多认一个框会让
 * 个人信息填报页上的气泡消失、钥匙又填不出身份库的值（真机 e2e 在演示台第 ⑯ 区抓到两行）。
 *
 * 这份文件钉的就是那条分界线，两侧都有刀：
 * - 把可及名重新塞回 `declaredText`，「填充链」那组立刻红；
 * - 把 `hasPhoneEvidence` / `hasVerifyCodeEvidence` 改回窄谓词，或把 `looksLikePostalCode`
 *   一并收窄，「捕获链」那组立刻红（后者会让 label 标注的收货地址页重新变成登录页）。
 *
 * 关键词一个都不新增：`hasPhoneEvidence` 的可及名分支只吃 `MOBILE_SELECTORS` 自己承认过的
 * `input[aria-label*="X"]` 词，所以它是窄谓词的**超集**，不会让任何原本认得的框变得不认得。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasEmailEvidence,
  hasPhoneEvidence,
  hasVerifyCodeEvidence,
  looksLikeCodeField,
  looksLikeEmailField,
  looksLikePhoneField,
  looksLikePostalCode,
} from '@/entrypoints/content/formSelectors';

/** 布一个框并返回它；标注写法由调用方给全，判据只该读这里写下的东西 */
const mount = (html: string): HTMLInputElement => {
  document.body.innerHTML = html;
  const input = document.querySelector('input');
  if (!input) throw new Error('夹具里没有 input');
  return input;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('填充链：只读字段自己声明的四个属性', () => {
  it('label[for] 标注的联系电话不被读成手机号框', () => {
    const input = mount('<label for="a">申请人联系电话</label><input id="a">');
    expect(looksLikePhoneField(input)).toBe(false);
  });

  it('包裹式 label 标注的联系电话不被读成手机号框', () => {
    const input = mount('<label>寄件人联系电话<input id="b"></label>');
    expect(looksLikePhoneField(input)).toBe(false);
  });

  it('aria-labelledby 引用的邮箱 / 验证码文本同样不进填充链', () => {
    // 两次 mount 之间必须先断言：后一次会重写 body，前一个元素随即脱离文档，
    // 可及名解析不到标注，回归下也照样返回 false——那样这条判据就没有牙齿了
    const email = mount('<span id="l">电子邮箱</span><input aria-labelledby="l">');
    expect(looksLikeEmailField(email)).toBe(false);
    const code = mount('<span id="l2">验证码</span><input aria-labelledby="l2">');
    expect(looksLikeCodeField(code)).toBe(false);
  });

  it('四个属性各自都照常认得：收窄没有动既有通道', () => {
    expect(looksLikePhoneField(mount('<input type="tel">'))).toBe(true);
    expect(looksLikePhoneField(mount('<input name="mobile">'))).toBe(true);
    expect(looksLikePhoneField(mount('<input placeholder="请输入手机号">'))).toBe(true);
    expect(looksLikePhoneField(mount('<input aria-label="联系电话">'))).toBe(true);
    expect(looksLikeEmailField(mount('<label for="e">电子邮箱</label><input id="e" type="email">'))).toBe(true);
    expect(looksLikeCodeField(mount('<input autocomplete="one-time-code">'))).toBe(true);
  });
});

describe('捕获链：等效标注与 aria-label 同权', () => {
  it('label 标注的手机号构成捕获证据，且是窄谓词的超集', () => {
    const input = mount('<label for="m">手机号</label><input id="m">');
    expect(looksLikePhoneField(input)).toBe(false);
    expect(hasPhoneEvidence(input)).toBe(true);
  });

  it('aria-labelledby 与包裹式 label 一样构成证据', () => {
    expect(hasPhoneEvidence(mount('<span id="l">联系电话</span><input aria-labelledby="l">'))).toBe(true);
    expect(hasPhoneEvidence(mount('<label>手机号码<input></label>'))).toBe(true);
  });

  it('已写 aria-label 的框交回原谓词，不被两套尺子各判一次', () => {
    const input = mount('<label for="m">收货地址</label><input id="m" aria-label="联系电话">');
    expect(hasPhoneEvidence(input)).toBe(true);
  });

  it('没有手机号语义的标注不构成证据：关键词只从桶里推导，一个词都没多', () => {
    expect(hasPhoneEvidence(mount('<label for="a">收货地址</label><input id="a">'))).toBe(false);
    // 「号码」在 MOBILE_KEYWORDS 里，但 MOBILE_SELECTORS 没收过它——可及名分支不该顺手扩词
    expect(hasPhoneEvidence(mount('<label for="s">社保卡号码</label><input id="s">'))).toBe(false);
    expect(looksLikePhoneField(mount('<input placeholder="社保卡号码">'))).toBe(true);
  });

  it('label 标注的验证码仍构成捕获证据', () => {
    const input = mount('<label for="c">验证码</label><input id="c">');
    expect(hasVerifyCodeEvidence(input)).toBe(true);
  });

  it('label 标注的邮政编码仍被排除：放宽的两端同时生效', () => {
    expect(looksLikePostalCode(mount('<label for="z">邮政编码</label><input id="z">'))).toBe(true);
    expect(looksLikePostalCode(mount('<label>邮编<input></label>'))).toBe(true);
    expect(looksLikePostalCode(mount('<label for="c">验证码</label><input id="c">'))).toBe(false);
  });

  it('label 标注的邮箱构成捕获证据，填充链那侧仍旧判假', () => {
    const input = mount('<label for="e">电子邮箱</label><input id="e">');
    expect(looksLikeEmailField(input)).toBe(false);
    expect(hasEmailEvidence(input)).toBe(true);
    expect(hasEmailEvidence(mount('<span id="l">邮箱地址</span><input aria-labelledby="l">'))).toBe(true);
    expect(hasEmailEvidence(mount('<input aria-label="电子邮箱">'))).toBe(true);
  });

  it('账号桶里的非邮箱词不构成邮箱证据：只取邮箱那几条，不整桶端过来', () => {
    // 「账号」「用户名」都在 USERNAME_SELECTORS 的 aria 条目里，整桶推导会让任何
    // 「用户名 + 验证码」的注册页都变成登录页；邮箱证据只该认邮箱语义
    expect(hasEmailEvidence(mount('<label for="a">账号</label><input id="a">'))).toBe(false);
    expect(hasEmailEvidence(mount('<label for="u">用户名</label><input id="u">'))).toBe(false);
    expect(hasEmailEvidence(mount('<label for="s">搜索</label><input id="s">'))).toBe(false);
  });
});
