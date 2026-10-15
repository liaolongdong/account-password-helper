/**
 * 身份提示角色词表的回归测试
 *
 * 这份词表是页面侧与 Options 侧之间唯一的通信字母表，它同时承担着「白名单」和
 * 「文案目录」两个职责，所以本文件钉三条：
 *
 * 1. **闭集收窄**。网页 DOM 是自报环境，角色串只有在词表内才允许跨入口；卡类角色
 *    （`cardNo` / `cardExp` / `cardCvv`）刻意不在表内——按既有拍板，银行卡信息不走
 *    身份提示路径，把它们排除在类型层面而不是「运行时记得别发」。
 * 2. **角色 → 类别映射完备**。Options 侧靠它决定弹窗预选的筛选档位，缺一个角色就会
 *    把 `undefined` 写进筛选状态；同时反向钉住「银行类别永不由提示路径产生」。
 * 3. **词表与文案目录同步**。少一条语种词条，气泡会直接把 key 画给用户看
 *    （`i18nLiteParity` 只保证中英对齐，管不到「角色新增了但文案没加」）。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_HINT_ROLES, identityCategoryForRole, normalizeIdentityHintRole } from '@/utils/identity/hintRoles';
import { LITE_MESSAGES } from '@/utils/i18n-lite';

describe('normalizeIdentityHintRole：闭集收窄', () => {
  it('词表内的角色原样通过', () => {
    for (const role of IDENTITY_HINT_ROLES) {
      expect(normalizeIdentityHintRole(role)).toBe(role);
    }
  });

  it('卡类角色不在词表内，一律按「无角色」处理', () => {
    for (const card of ['cardNo', 'cardExp', 'cardCvv']) {
      expect(normalizeIdentityHintRole(card)).toBeNull();
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

describe('identityCategoryForRole：映射完备', () => {
  it('每个角色都能映射到类别，且只会落在 person / id_card / address 三档', () => {
    const produced = IDENTITY_HINT_ROLES.map(role => identityCategoryForRole(role));
    expect(produced.every(Boolean)).toBe(true);
    expect(new Set(produced)).toEqual(new Set(['person', 'id_card', 'address']));
  });

  it('证件类与地址类各自归位，其余按 person 取', () => {
    const byRole = Object.fromEntries(IDENTITY_HINT_ROLES.map(role => [role, identityCategoryForRole(role)]));
    expect(byRole).toEqual({
      name: 'person',
      givenName: 'person',
      familyName: 'person',
      phone: 'person',
      email: 'person',
      birthday: 'person',
      gender: 'person',
      org: 'person',
      idNumber: 'id_card',
      passport: 'id_card',
      address: 'address',
      region: 'address',
      postal: 'address',
    });
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
