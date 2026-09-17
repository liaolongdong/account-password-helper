import { describe, expect, it } from 'vitest';
import {
  IDENTITY_FIELD_DEFS,
  buildIdentityFieldRows,
  formatIdentityCardText,
  hasSecretFields,
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

describe('IDENTITY_FIELD_DEFS', () => {
  it('机密字段恰为证件号 / 卡号 / CVV', () => {
    const secretKeys = IDENTITY_FIELD_DEFS.filter(def => def.secret).map(def => def.key);
    expect(secretKeys).toEqual(['idNumber', 'cardNo', 'cardCvv']);
  });
});
