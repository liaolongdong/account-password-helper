import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  MANUAL_ORDER_UNRANKED,
  applyManualMove,
  normalizeManualOrder,
  sortIdentityEntries,
} from '@/utils/identity/sort';
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
 * 锁定六件事，这些都是「顺手改比较器 / 顺手加档位」最容易悄悄破坏的：
 * 1. 默认档与改造前写死的 updateTime 倒序逐位一致（旧行为不漂移）；
 * 2. 永不原地重排——`rows` 是 shallowRef 里的同一份数组，就地 sort 会连带改掉导出次序；
 * 3. 结果与输入顺序无关（同档兜底必须走到 id），否则两次 load 之间顺序会漂；
 * 4. 类别档序取 CATEGORY_ORDER 而非界面译名，切语言不该把顺序换一遍；标题档则**必须**跟随 locale；
 * 5. 下拉靠动态键 `identity.sort.<mode>` 取词，静态扫描提不到它，只能在这里对语言包做双向校验
 *    （与 `onboardingTour.test.ts` 对剧本动态键的同一手法）；
 * 6. `manual` 档只认注入的序位：未登记的 id 落末尾而不是消失，过滤态的重排也只动可见子集。
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

/** 标题档的最简上下文：标题即 name，语言固定中文（比较器不该关心 i18n 取词）、手排序位恒缺省 */
const ctx = {
  titleOf: (e: IdentityEntry) => e.payload.name ?? '',
  locale: 'zh-CN',
  orderIndexOf: () => MANUAL_ORDER_UNRANKED,
};

const ids = (list: IdentityEntry[]) => list.map(e => e.id);

describe('档位口径', () => {
  it('默认档 = updated，且下拉顺序与档位集合以此处为单一事实来源', () => {
    expect(DEFAULT_IDENTITY_SORT_MODE).toBe('updated');
    // 这条 toEqual 是「档位集合单一真源」的守卫本体：加一档必须同时改这里，
    // 目的是让「顺手加档」在评审里显形，而不是能悄悄飘过去。
    expect(IDENTITY_SORT_MODES).toEqual(['updated', 'created', 'category', 'title', 'manual']);
  });

  it('白名单判据只认五档，其它形状一律回落（供存储层读写两侧使用）', () => {
    for (const mode of IDENTITY_SORT_MODES) {
      expect(isIdentitySortMode(mode)).toBe(true);
    }
    for (const junk of ['updatedAt', '', 'TITLE', 'manual_order', 1, null, undefined, {}, ['title']]) {
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

describe('manual（手排档）', () => {
  /** 序位上下文：数组下标即序位，不在数组里的一律取哨兵值（与 composable 的注入同一形状） */
  const rankCtx = (order: readonly string[]) => {
    const map = new Map(order.map((id, index) => [id, index]));
    return { ...ctx, orderIndexOf: (id: string) => map.get(id) ?? MANUAL_ORDER_UNRANKED };
  };

  it('只认注入的序位，时间与标题一律不参与', () => {
    const list = [
      entry('a', { name: 'A', updateTime: 300 }),
      entry('b', { name: 'B', updateTime: 100 }),
      entry('c', { name: 'C', updateTime: 200 }),
    ];
    expect(ids(sortIdentityEntries(list, rankCtx(['c', 'a', 'b']), 'manual'))).toEqual(['c', 'a', 'b']);
    // 反过来给序位 → 结果整体反转：证明这一档真的在读 ctx，而不是落到别的档的兜底分支
    expect(ids(sortIdentityEntries(list, rankCtx(['b', 'a', 'c']), 'manual'))).toEqual(['b', 'a', 'c']);
  });

  it('未登记的 id（新建 / 导入）落到末尾且不消失，尾部按时间倒序安定排列', () => {
    const list = [
      entry('pinned', { name: 'P', updateTime: 1 }),
      entry('fresh1', { name: 'F1', updateTime: 100 }),
      entry('fresh2', { name: 'F2', updateTime: 300 }),
    ];
    expect(ids(sortIdentityEntries(list, rankCtx(['pinned']), 'manual'))).toEqual(['pinned', 'fresh2', 'fresh1']);
    // 完全没排过序（存储回落空数组）：整表退化为 tieBreak 的更新时间倒序，一条都不该少
    expect(ids(sortIdentityEntries(list, ctx, 'manual'))).toEqual(['fresh2', 'fresh1', 'pinned']);
  });

  it('结果与输入顺序无关（同一份序位两次 load 给出同一序列）', () => {
    const order = ['x', 'y'];
    const a = entry('x', { name: 'X', updateTime: 5 });
    const b = entry('y', { name: 'Y', updateTime: 5 });
    expect(ids(sortIdentityEntries([a, b], rankCtx(order), 'manual'))).toEqual(['x', 'y']);
    expect(ids(sortIdentityEntries([b, a], rankCtx(order), 'manual'))).toEqual(['x', 'y']);
  });
});

describe('normalizeManualOrder（落盘顺序与现存条目对齐）', () => {
  it('剪掉已删除的 id，保持其余相对次序', () => {
    expect(normalizeManualOrder(['a', 'gone', 'b', 'alsoGone'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('新出现的 id（新建 / 导入）按传入顺序追加尾部', () => {
    expect(normalizeManualOrder([], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(normalizeManualOrder(['a'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('stored 里的重复 id 去重（写入侧第二道闸门）', () => {
    expect(normalizeManualOrder(['a', 'a', 'b', 'a'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('两侧都空返回空数组，不改动入参', () => {
    const stored = ['a', 'b'];
    expect(normalizeManualOrder(stored, [])).toEqual([]);
    expect(stored).toEqual(['a', 'b']);
  });
});

describe('applyManualMove（过滤态只在可见子集内换位）', () => {
  it('无过滤：插到目标卡之前 / 之后都按预期给出新序与落点下标', () => {
    const ids1 = ['a', 'b', 'c'];
    const before = applyManualMove({
      globalIds: ids1,
      visibleIds: ids1,
      draggedId: 'c',
      targetId: 'a',
      side: 'before',
    });
    expect(before).toEqual({ ids: ['c', 'a', 'b'], index: 0 });
    const after = applyManualMove({ globalIds: ids1, visibleIds: ids1, draggedId: 'a', targetId: 'c', side: 'after' });
    expect(after).toEqual({ ids: ['b', 'c', 'a'], index: 2 });
  });

  it('键盘 Alt+↑ / Alt+↓：与相邻可见卡交换一位', () => {
    const ids = ['a', 'b', 'c'];
    expect(
      applyManualMove({ globalIds: ids, visibleIds: ids, draggedId: 'c', targetId: 'b', side: 'before' })?.ids,
    ).toEqual(['a', 'c', 'b']);
    expect(
      applyManualMove({ globalIds: ids, visibleIds: ids, draggedId: 'a', targetId: 'b', side: 'after' })?.ids,
    ).toEqual(['b', 'a', 'c']);
  });

  it('过滤态：隐藏项占据的全局槽位一动不动', () => {
    // 全局 a, hidden1, b, hidden2, c；只见 a / b / c —— 把 c 提到最前应落在 a 的槽位上，
    // 两个隐藏项仍在原位（否则取消过滤后它们的顺序会被静默挤到末尾）
    const globalIds = ['a', 'hidden1', 'b', 'hidden2', 'c'];
    const moved = applyManualMove({
      globalIds,
      visibleIds: ['a', 'b', 'c'],
      draggedId: 'c',
      targetId: 'a',
      side: 'before',
    });
    expect(moved).toEqual({ ids: ['c', 'hidden1', 'a', 'hidden2', 'b'], index: 0 });
  });

  it('原地落回 / id 不在可见列表：返回 null，调用方据此不写盘', () => {
    const ids = ['a', 'b'];
    const base = { globalIds: ids, visibleIds: ids };
    expect(applyManualMove({ ...base, draggedId: 'a', targetId: 'a', side: 'before' })).toBeNull();
    expect(applyManualMove({ ...base, draggedId: 'ghost', targetId: 'a', side: 'before' })).toBeNull();
    expect(applyManualMove({ ...base, draggedId: 'a', targetId: 'ghost', side: 'after' })).toBeNull();
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
