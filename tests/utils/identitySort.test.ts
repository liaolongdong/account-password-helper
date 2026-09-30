import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { sortIdentityEntries } from '@/utils/identity/sort';
import {
  CATEGORY_ORDER,
  DEFAULT_IDENTITY_SORT_MODE,
  IDENTITY_SORT_MODES,
  isIdentitySortMode,
} from '@/utils/identity/constants';
import type { IdentityCategory, IdentityEntry } from '@/utils/identity/types';

const ROOT = path.resolve(__dirname, '../..');

/**
 * 身份库列表排序纯函数测试（node 环境，无需 DOM）
 *
 * 锁定五件事，这些都是「顺手改比较器 / 顺手加档位」最容易悄悄破坏的：
 * 1. 默认档与改造前写死的 updateTime 倒序逐位一致（旧行为不漂移）；
 * 2. 永不原地重排——`rows` 是 shallowRef 里的同一份数组，就地 sort 会连带改掉导出次序；
 * 3. 结果与输入顺序无关（同档兜底必须走到 id），否则两次 load 之间顺序会漂；
 * 4. 类别档序取 CATEGORY_ORDER 而非界面译名，切语言不该把顺序换一遍；标题档则**必须**跟随 locale；
 * 5. 下拉靠动态键 `identity.sort.<mode>` 取词，静态扫描提不到它，只能在这里对语言包做双向校验
 *    （与 `onboardingTour.test.ts` 对剧本动态键的同一手法）。
 */

function entry(
  id: string,
  options: { category?: IdentityCategory; name?: string; createTime?: number; updateTime?: number } = {},
): IdentityEntry {
  return {
    id,
    encryptedPayload: 'c',
    createTime: options.createTime ?? 0,
    updateTime: options.updateTime ?? 0,
    payload: { pv: 1, category: options.category ?? 'person', name: options.name },
  };
}

/** 标题档的最简上下文：标题即 name，语言固定中文（比较器不该关心 i18n 取词） */
const ctx = { titleOf: (e: IdentityEntry) => e.payload.name ?? '', locale: 'zh-CN' };

const ids = (list: IdentityEntry[]) => list.map(e => e.id);

describe('档位口径', () => {
  it('默认档 = updated，且下拉顺序与档位集合以此处为单一事实来源', () => {
    expect(DEFAULT_IDENTITY_SORT_MODE).toBe('updated');
    expect(IDENTITY_SORT_MODES).toEqual(['updated', 'created', 'category', 'title']);
  });

  it('白名单判据只认四档，其它形状一律回落（供存储层读写两侧使用）', () => {
    for (const mode of IDENTITY_SORT_MODES) {
      expect(isIdentitySortMode(mode)).toBe(true);
    }
    for (const junk of ['updatedAt', '', 'TITLE', 1, null, undefined, {}, ['title']]) {
      expect(isIdentitySortMode(junk)).toBe(false);
    }
  });
});

describe('updated / created', () => {
  it('updated 按 updateTime 倒序，与改造前 load() 里写死的比较器逐位一致', () => {
    const list = [
      entry('old', { updateTime: 100 }),
      entry('new', { updateTime: 300 }),
      entry('mid', { updateTime: 200 }),
    ];
    expect(ids(sortIdentityEntries(list, ctx, 'updated'))).toEqual(['new', 'mid', 'old']);
    // 缺省参数走同一档
    expect(ids(sortIdentityEntries(list, ctx))).toEqual(['new', 'mid', 'old']);
  });

  it('created 按 createTime 倒序，不受 updateTime 影响', () => {
    const list = [entry('a', { createTime: 10, updateTime: 900 }), entry('b', { createTime: 30, updateTime: 100 })];
    expect(ids(sortIdentityEntries(list, ctx, 'created'))).toEqual(['b', 'a']);
  });

  it('时间完全相同 → 兜底到 id 字典序，且与输入顺序无关', () => {
    const a = entry('a', { updateTime: 5 });
    const b = entry('b', { updateTime: 5 });
    const c = entry('c', { updateTime: 5 });
    expect(ids(sortIdentityEntries([c, a, b], ctx, 'updated'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortIdentityEntries([b, c, a], ctx, 'updated'))).toEqual(['a', 'b', 'c']);
  });
});

describe('category', () => {
  it('按 CATEGORY_ORDER 的固定档序分组，组内再按时间倒序', () => {
    const list = [
      entry('addr', { category: 'address' }),
      entry('bank', { category: 'bank_card' }),
      entry('per2', { category: 'person', updateTime: 100 }),
      entry('per1', { category: 'person', updateTime: 200 }),
      entry('id', { category: 'id_card' }),
    ];
    expect(ids(sortIdentityEntries(list, ctx, 'category'))).toEqual(['per1', 'per2', 'id', 'bank', 'addr']);
    // 档序真值：这一行让「改 CATEGORY_ORDER 会同时改按钮顺序和排序」变成显式契约
    expect([...CATEGORY_ORDER]).toEqual(['person', 'id_card', 'bank_card', 'address']);
  });

  it('未知类别排末档，而不是 indexOf 的 -1 抢在最前', () => {
    // 合法导入路径不会产生未知类别（validators + backup 双重把关），这里防的是「绕过校验的历史/手改数据」
    const list = [
      entry('weird', { category: 'passport' as IdentityCategory }),
      entry('addr', { category: 'address' }),
      entry('per', { category: 'person' }),
    ];
    expect(ids(sortIdentityEntries(list, ctx, 'category'))).toEqual(['per', 'addr', 'weird']);
  });
});

describe('title', () => {
  it('走 Intl 拼写序而非码位序：八(U+516B) 与 啊(U+554A) 两种排序结果相反', () => {
    const list = [entry('ba', { name: '八' }), entry('a', { name: '啊' })];
    // 前提用不依赖 ICU 的事实钉住：JS 默认 sort 按 UTF-16 码元序，八 在 啊 之前
    expect(['八', '啊'].sort()).toEqual(['八', '啊']);
    expect(ids(sortIdentityEntries(list, ctx, 'title'))).toEqual(['a', 'ba']); // 拼音序：啊(ā) 在 八(bā) 之前
  });

  it('标题档跟随 ctx.locale：同一份数据在 en 与 zh-CN 下顺序相反', () => {
    // 这是「按标题排序」的真实契约之一：composable 传的是 currentLocale，切语言即换排序规则。
    // 实测读数（Node 22 full-icu）：zh-CN 走拼音（啊→八），en 落 ICU 根排序（CJK 按码位，八→啊）。
    const list = [entry('ba', { name: '八' }), entry('a', { name: '啊' })];
    expect(ids(sortIdentityEntries(list, { ...ctx, locale: 'en' }, 'title'))).toEqual(['ba', 'a']);
    expect(ids(sortIdentityEntries(list, { ...ctx, locale: 'zh-CN' }, 'title'))).toEqual(['a', 'ba']);
  });

  it('数字感知：a2 排在 a10 之前（numeric 档）', () => {
    const list = [entry('x10', { name: 'a10' }), entry('x2', { name: 'a2' })];
    expect(ids(sortIdentityEntries(list, ctx, 'title'))).toEqual(['x2', 'x10']);
  });

  it('同名靠时间倒序兜底，空标题不参与比较也不抛错', () => {
    const list = [entry('a', { name: '', updateTime: 1 }), entry('b', { name: '', updateTime: 2 })];
    expect(ids(sortIdentityEntries(list, ctx, 'title'))).toEqual(['b', 'a']);
  });
});

describe('不改动入参', () => {
  it('返回新数组，原数组次序保持不变（导出次序的真值来源就是它）', () => {
    const list = [entry('a', { updateTime: 1 }), entry('b', { updateTime: 9 }), entry('c', { updateTime: 5 })];
    const snapshot = ids(list);
    const sorted = sortIdentityEntries(list, ctx, 'updated');
    expect(sorted).not.toBe(list);
    expect(ids(list)).toEqual(snapshot);
    expect(ids(sorted)).toEqual(['b', 'c', 'a']);
  });

  it('空数组与单条：直接返回，不构造 Collator 也不报错', () => {
    expect(sortIdentityEntries([], ctx, 'title')).toEqual([]);
    const one = [entry('a', { name: 'A' })];
    expect(ids(sortIdentityEntries(one, ctx, 'title'))).toEqual(['a']);
  });
});

describe('档位下拉的取词与档位集合对齐', () => {
  // `IdentityVaultDialog` 的下拉选项由 IDENTITY_SORT_MODES 拼动态键 identity.sort.<mode> 取词，
  // 静态扫描提取不到这种键，`i18nBundles.test.ts` 那条守卫对它无能为力。
  // 加一档却忘补文案不会报错，只会在下拉里渲染出裸 key —— 与 onboardingTour.test.ts 对剧本动态键同一手法。
  it('每一档与档位用途说明在中英文语言包里都有非空词条', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const file = path.join(ROOT, 'utils/i18n/locales', locale, 'identity.json');
      const messages: Record<string, string> = JSON.parse(readFileSync(file, 'utf-8'));
      for (const mode of IDENTITY_SORT_MODES) {
        expect(messages[`identity.sort.${mode}`], `${locale} 缺少 identity.sort.${mode}`).toBeTruthy();
      }
      expect(messages['identity.sortLabel'], `${locale} 缺少 identity.sortLabel`).toBeTruthy();
    }
  });
});
