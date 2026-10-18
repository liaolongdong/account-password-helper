import { describe, expect, it } from 'vitest';
import {
  IDENTITY_FIELD_DEFS,
  IDENTITY_FIELD_NAME_STEMS,
  buildIdentityFieldRows,
  formatIdentityCardText,
  hasSecretFields,
  identityFieldNameSet,
  requestedFieldName,
} from '@/utils/identity/fields';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';

/**
 * 身份信息字段展示模型单元测试（纯函数，t 以形参注入）
 *
 * 钉死弹窗与 composable 共享的三条口径：
 * - `hasSecretFields` 与 `buildIdentityFieldRows` 对「是否含机密字段」判定严格一致
 *   （批量展开/收起据此过滤，二者若分叉会让按钮态与实际可展开卡不一致）；
 * - 字段行的顺序、空值跳过、自定义字段附加与掩码标签来源；
 * - 整卡剪贴板文本的「标签: 值」拼接。
 */

/** 恒等翻译：断言标签来自 `identity.field.<key>`，与语言无关 */
const idt = (key: string): string => key;

function entry(payload: Partial<IdentityPayload>): IdentityEntry {
  return {
    id: 'x',
    encryptedPayload: 'c',
    createTime: 0,
    updateTime: 0,
    payload: { pv: 1, category: 'person', ...payload },
  };
}

describe('hasSecretFields', () => {
  it('内置机密字段非空 → true', () => {
    expect(hasSecretFields(entry({ idNumber: '123' }).payload)).toBe(true);
    expect(hasSecretFields(entry({ cardCvv: '123' }).payload)).toBe(true);
  });

  it('仅非机密字段 → false', () => {
    expect(hasSecretFields(entry({ name: '张三', phone: '138', address: '某地' }).payload)).toBe(false);
  });

  it('机密字段为空 / 未定义 → false', () => {
    expect(hasSecretFields(entry({ idNumber: '', cardNo: undefined }).payload)).toBe(false);
  });

  it('机密字段为纯空白仍视为存在（与 buildIdentityFieldRows 真值口径一致）', () => {
    // buildFieldRows 以「非空字符串」纳入字段，'   ' 为真值；hasSecretFields 必须同判，否则眼睛出现却无法展开
    const rows = buildIdentityFieldRows(entry({ idNumber: '   ' }), idt);
    expect(rows.some(r => r.secret)).toBe(true);
    expect(hasSecretFields(entry({ idNumber: '   ' }).payload)).toBe(true);
  });

  it('含非空 secret 自定义字段 → true；secret 但值为空 → false', () => {
    expect(
      hasSecretFields(entry({ customFields: [{ id: 'c1', label: '密', value: 'v', secret: true }] }).payload),
    ).toBe(true);
    expect(hasSecretFields(entry({ customFields: [{ id: 'c1', label: '密', value: '', secret: true }] }).payload)).toBe(
      false,
    );
    expect(
      hasSecretFields(entry({ customFields: [{ id: 'c1', label: '普', value: 'v', secret: false }] }).payload),
    ).toBe(false);
  });

  it('与 buildIdentityFieldRows.some(secret) 对同一批负载恒等', () => {
    const samples: Partial<IdentityPayload>[] = [
      { name: 'n' },
      { idNumber: '1' },
      { cardNo: '2' },
      { cardCvv: '3' },
      { address: 'a', cardBank: 'b' },
      { customFields: [{ id: 'c', label: 'L', value: 'V', secret: true }] },
      { customFields: [{ id: 'c', label: 'L', value: 'V', secret: false }] },
    ];
    for (const payload of samples) {
      const e = entry(payload);
      expect(hasSecretFields(e.payload)).toBe(buildIdentityFieldRows(e, idt).some(r => r.secret));
    }
  });
});

describe('buildIdentityFieldRows', () => {
  it('按声明顺序输出内置字段，跳过空值', () => {
    const rows = buildIdentityFieldRows(entry({ phone: '138', name: '张三', email: '' }), idt);
    expect(rows.map(r => r.key)).toEqual(['name', 'phone']); // 顺序恒为声明序（name 先于 phone）
    expect(rows.map(r => r.label)).toEqual(['identity.field.name', 'identity.field.phone']);
  });

  it('自定义字段附在内置字段之后，空值跳过，空标签回退为破折号', () => {
    const rows = buildIdentityFieldRows(
      entry({ name: '张三', customFields: [{ id: 'c1', label: '会员号', value: '888', secret: false }] }),
      idt,
    );
    expect(rows.map(r => r.key)).toEqual(['name', 'custom:c1']);
    const withBlank = buildIdentityFieldRows(
      entry({ customFields: [{ id: 'c2', label: '', value: 'v', secret: false }] }),
      idt,
    );
    expect(withBlank[0].label).toBe('—');
  });

  it('secret 标记随内置定义与自定义字段各自透传', () => {
    const rows = buildIdentityFieldRows(
      entry({ idNumber: '1', customFields: [{ id: 'c', label: 'L', value: 'V', secret: true }] }),
      idt,
    );
    expect(rows.find(r => r.key === 'idNumber')?.secret).toBe(true);
    expect(rows.find(r => r.key === 'custom:c')?.secret).toBe(true);
  });
});

describe('formatIdentityCardText', () => {
  it('拼成「标签: 值」多行文本', () => {
    const rows = buildIdentityFieldRows(entry({ name: '张三', idNumber: '123' }), idt);
    expect(formatIdentityCardText(rows)).toBe('identity.field.name: 张三\nidentity.field.idNumber: 123');
  });

  it('空字段行返回空串', () => {
    expect(formatIdentityCardText([])).toBe('');
  });
});

describe('按名字认格子（零命中时的放宽通道）', () => {
  it('中文常见写法认得出那一格，即使我们的译名不在整串里', () => {
    expect(requestedFieldName('联系电话号码', identityFieldNameSet('phone', '手机号'))).toBe(true);
    expect(requestedFieldName('社会保障号码', identityFieldNameSet('idNumber', '证件号码'))).toBe(true);
    expect(requestedFieldName('开户行', identityFieldNameSet('cardBank', '发卡行'))).toBe(true);
  });

  it('英文写法走同一套判据', () => {
    expect(requestedFieldName('Contact Number', identityFieldNameSet('phone', 'Phone'))).toBe(true);
    expect(requestedFieldName('IBAN', identityFieldNameSet('cardNo', 'Card number'))).toBe(true);
  });

  it('屏上那串译名自己也是名字（用户打的是「手机号号码」这种半截话）', () => {
    expect(requestedFieldName('手机号号码', identityFieldNameSet('phone', '手机号'))).toBe(true);
  });

  it('认不出来就不认：宁可不放宽，也不把一句话安到某一格上', () => {
    for (const def of IDENTITY_FIELD_DEFS) {
      expect(requestedFieldName('e2e-no-such-field', identityFieldNameSet(def.key, def.key))).toBe(false);
    }
    expect(requestedFieldName('会员卡', identityFieldNameSet('address', '住址'))).toBe(false);
  });

  it('单字与空白不成名字（否则一个「号」就把整库放宽）', () => {
    expect(requestedFieldName('号码', ['号'])).toBe(false);
    expect(requestedFieldName('', identityFieldNameSet('phone', '手机号'))).toBe(false);
    expect(requestedFieldName('   ', identityFieldNameSet('phone', '手机号'))).toBe(false);
  });

  it('词表自证：每条 ≥2 字符、大小写去重、中英两侧都有写法', () => {
    for (const [key, stems] of Object.entries(IDENTITY_FIELD_NAME_STEMS)) {
      expect(stems.length, `${key} 的词表不能为空`).toBeGreaterThan(0);
      expect(
        stems.every(stem => stem.trim().length >= 2),
        `${key} 有短于 2 字符的词干`,
      ).toBe(true);
      expect(new Set(stems.map(stem => stem.toLowerCase())).size, `${key} 词表有重复`).toBe(stems.length);
      expect(
        stems.some(stem => /[\u4e00-\u9fff]/.test(stem)),
        `${key} 缺中文写法`,
      ).toBe(true);
      expect(
        stems.some(stem => /[a-z]/.test(stem)),
        `${key} 缺英文写法`,
      ).toBe(true);
    }
  });

  it('名字表把屏上那串译名放在第一位，且不掺空串', () => {
    const names = identityFieldNameSet('idNumber', '证件号码');
    expect(names[0]).toBe('证件号码');
    expect(names.includes('')).toBe(false);
  });
});

describe('IDENTITY_FIELD_DEFS', () => {
  it('机密字段恰为证件号 / 卡号 / CVV', () => {
    const secretKeys = IDENTITY_FIELD_DEFS.filter(def => def.secret).map(def => def.key);
    expect(secretKeys).toEqual(['idNumber', 'cardNo', 'cardCvv']);
  });
});
