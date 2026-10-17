/**
 * 身份提示角色词表的回归测试
 *
 * 这份词表是页面侧「这一段字段语义」的闭合字母表，它同时承担着「白名单」和
 * 「文案目录」两个职责，所以本文件钉两条：
 *
 * 1. **闭集收窄**。网页 DOM 是自报环境，只有词表内的值才允许驱动气泡；卡类里只放
 *    「卡号 / 户名 / 开户行」三档（2026-10-17 拍板），有效期与 CVV 属卡类口令，
 *    按既有边界排除在词表外——排除写在类型层面，而不是「运行时记得别发」。
 * 2. **词表与文案目录同步**。少一条语种词条，气泡会直接把 key 画给用户看
 *    （`i18nLiteParity` 只保证中英对齐，管不到「角色新增了但文案没加」）。
 *
 * 曾经的第三条「角色 → 身份库类别映射完备」随 2026-10-17 的改判一并删除：深链不再按
 * 角色预选类别档位（一条条目同时携带证件号、手机号等多个值，预选会把该命中的筛掉），
 * 映射函数因此失去唯一消费者。角色现在只服务页面侧的气泡文案。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_HINT_ROLES, normalizeIdentityHintRole } from '@/utils/identity/hintRoles';
import { LITE_MESSAGES } from '@/utils/i18n-lite';

describe('normalizeIdentityHintRole：闭集收窄', () => {
  it('词表内的角色原样通过', () => {
    for (const role of IDENTITY_HINT_ROLES) {
      expect(normalizeIdentityHintRole(role)).toBe(role);
    }
  });

  it('卡号 / 户名 / 开户行现在在词表内，卡类口令（有效期 / CVV）永不进', () => {
    for (const role of ['cardNo', 'cardHolder', 'cardBank']) {
      expect(normalizeIdentityHintRole(role)).toBe(role);
    }
    for (const secret of ['cardExp', 'cardCvv']) {
      expect(normalizeIdentityHintRole(secret)).toBeNull();
    }
  });

  it.each([
    ['大小写不符', 'Name'],
    ['带空白', ' name'],
    ['非字符串·数字', 12345],
    ['非字符串·对象', { role: 'name' }],
    ['非字符串·null', null],
    ['非字符串·undefined', undefined],
    ['空串', ''],
    ['超长串', 'x'.repeat(300)],
  ])('%s 被拒', (_label, value) => {
    expect(normalizeIdentityHintRole(value)).toBeNull();
  });
});

describe('词表与轻量文案目录同步', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    it(`${locale}：每个角色都有对应词条，标题模板都带 {role} 占位`, () => {
      const table = LITE_MESSAGES[locale];
      const missing = IDENTITY_HINT_ROLES.filter(role => !table[`cs.identity.role.${role}`]?.trim());
      expect(missing).toEqual([]);
      // 占位符丢了，标题就只剩半句话，角色词无处可插
      expect(table['cs.identity.hintTitle']).toContain('{role}');
    });
  }
});
