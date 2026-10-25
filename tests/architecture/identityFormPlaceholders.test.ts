/**
 * 个人信息表单字段的文案完整性守卫
 *
 * 表单里的内置字段是循环渲染的（`t(`identity.field.${key}`)` 与
 * `t(`identity.form.placeholder.${key}`)` 都是动态 key），i18n 的「中英文 key 集对齐」
 * 只能保证两侧一致，保证不了一致地**都缺**：新增一个 `IdentityFieldKey` 而忘了配文案，
 * 界面会直接把 key 本身印在输入框里，而全量测试仍然全绿。
 * 这里把组件里的字段清单当唯一事实来源，逐字段要求标签与占位符在两个语言里都在位。
 */
import { describe, expect, it } from 'vitest';
import zhIdentity from '@/utils/i18n/locales/zh-CN/identity.json';
import enIdentity from '@/utils/i18n/locales/en/identity.json';
import { readSource } from '../helpers/architectureScan';

const DIALOG = 'components/options/IdentityFormDialog.vue';

/** 从组件源码里取 ALL_FIELDS 的字段名，避免在测试里另抄一份清单（那会一起烂掉） */
function allFieldKeys(): string[] {
  const source = readSource(DIALOG);
  const block = source.match(/const ALL_FIELDS: IdentityFieldKey\[\] = \[([\s\S]*?)\];/);
  expect(block, 'ALL_FIELDS 被改名或换写法，守卫需要跟着调整').toBeTruthy();
  return [...block![1].matchAll(/'([a-zA-Z]+)'/g)].map(match => match[1]);
}

const KEYS = allFieldKeys();

describe('个人信息表单的字段文案', () => {
  it('抽取到全部内置字段，避免守卫空跑', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(10);
    expect(KEYS).toContain('cardCvv');
  });

  it('每个字段都有标签与占位符，中英文都不缺', () => {
    const messages: Record<string, Record<string, unknown>> = { zh: zhIdentity, en: enIdentity };
    for (const [locale, table] of Object.entries(messages)) {
      for (const key of [...KEYS, 'remark']) {
        expect(table[`identity.field.${key}`], `${locale} 缺字段标签：${key}`).toBeTruthy();
        expect(table[`identity.form.placeholder.${key}`], `${locale} 缺字段占位符：${key}`).toBeTruthy();
      }
    }
  });

  it('占位符不复述已在位的标签，且各字段之间不互相复制', () => {
    for (const key of [...KEYS, 'remark']) {
      const label = String((zhIdentity as Record<string, unknown>)[`identity.field.${key}`]);
      const placeholder = String((zhIdentity as Record<string, unknown>)[`identity.form.placeholder.${key}`]);
      expect(placeholder, `${key} 的占位符与标签同义反复`).not.toBe(label);
    }
    // 一键填好整表时最容易犯的就是把同一句粘到所有字段上
    const placeholders = [...KEYS, 'remark'].map(key =>
      String((zhIdentity as Record<string, unknown>)[`identity.form.placeholder.${key}`]),
    );
    expect(new Set(placeholders).size, '存在两个字段共用同一句占位符').toBe(placeholders.length);
  });
});
