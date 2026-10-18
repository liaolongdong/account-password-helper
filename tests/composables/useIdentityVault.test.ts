import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useIdentityVault } from '@/composables/useIdentityVault';
import { currentLocale, registerMessages, type Messages } from '@/utils/i18n';
import { warmPinyinMatcher } from '@/utils/searchMatch/core';
import zhIdentity from '@/utils/i18n/locales/zh-CN/identity.json';
import enIdentity from '@/utils/i18n/locales/en/identity.json';
import {
  getAllIdentity,
  getIdentityManualOrder,
  getIdentitySortMode,
  saveIdentityManualOrder,
  saveIdentitySortMode,
} from '@/utils/storage/identityCrud';
import type { IdentityEntry, IdentityPayload, IdentitySortMode } from '@/utils/identity/types';

/**
 * useIdentityVault 视图态行为测试（node 环境，无需 DOM）
 *
 * 聚焦本批次有状态复杂度的几块——批量展开 / 收起、批量折叠与单卡折叠、排序档位与过滤清除、
 * `manual` 档的手排换位，锁定其作用范围口径：
 * - 展开 / 收起只作用「可见且含机密字段」的卡片，无机密卡永不进 revealedIds；
 * - 折叠 / 展开只作用「可见」的卡片（与机密无关），保留被过滤掉的既有折叠态；单卡 toggleCollapse 与批量共用 collapsedIds；
 * - 排序档位只改 filteredRows 的展示顺序，rows（导出真值）不动；换档写盘一次、等值不重写，读回受代际保护；
 * - manual 档的序位来自落盘数组（load 时与条目并行读回）；moveIdentity 换位先对齐条目集合
 *   （剪已删除、追加新出现），过滤态只动可见子集，无位移不写盘，落盘失败只告警；
 * - 序号与档位同属落盘偏好，teardown / resetViewState 都不清（否则重开弹窗会把用户排好的顺序读成中间态）；
 * - 切换过滤不整体清空，保留被过滤掉的既有展开 / 折叠项（对齐 selectAllVisible 语义）；
 * - clearFilters 仅清过滤，保留显隐 / 折叠 / 勾选；resetViewState 清空全部视图态（档位属落盘偏好，不在其内）；
 * - teardown 连解密明文（rows）一起释放，列表弹窗关闭后 PII 不再驻留内存。
 * copy 等涉及 clipboard 的路径不在此覆盖（另有纯函数单测）。
 */

/**
 * 注册身份库命名空间（中英文）
 *
 * 「按字段名检索」这一族的判据就是语言包里的那 11 个译名，而 `t()` 对未注册 key 直接返回
 * key 本身——不注册的话测的是 `identity.field.idNumber` 这串字符，不是屏上「证件号码」那三个字。
 * options 入口的 bundle 静态注册同一份包（`utils/i18n/bundles/options.ts`），这里对齐它。
 */
registerMessages('zh-CN', zhIdentity as Messages);
registerMessages('en', enIdentity as Messages);

/**
 * `ElMessage` 桩：WxtVitest 不套 Element Plus 的 AutoImport 解析器，运行时它是裸标识符
 * （同 `useSidepanelFill.totpClipboard.test.ts` 的打桩理由）。手动排序落盘失败那一例
 * 会真的走到 `ElMessage.warning`，不打桩就是 unhandled rejection 而不是断言失败。
 */
const elMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };
Object.assign(globalThis, { ElMessage: elMessage });

vi.mock('@/utils/storage/identityCrud', () => ({
  getAllIdentity: vi.fn(async () => ({ entries: [], skippedIds: [] })),
  deleteIdentities: vi.fn(),
  saveIdentity: vi.fn(),
  updateIdentity: vi.fn(),
  getIdentitySortMode: vi.fn(async () => 'updated' as const),
  // 必须返回 Promise：setSortMode 对返回值取 .catch，mock 成 undefined 会把测试炸成 TypeError
  saveIdentitySortMode: vi.fn(async () => undefined),
  getIdentityManualOrder: vi.fn(async () => [] as string[]),
  // 同 setSortMode：moveIdentity 走 fire-and-forget 的 .catch 链，非 Promise 桩会直接抛 TypeError
  saveIdentityManualOrder: vi.fn(async () => undefined),
}));

beforeEach(() => {
  // currentLocale 是模块级单例 ref，「切语言」那一例会把它改成 en；每轮开头复位，
  // 否则那条用例一旦在中途断言失败，后面所有用例都在英文环境里跑（档位/文案读数都会带偏）。
  currentLocale.value = 'zh-CN';
  vi.mocked(getAllIdentity).mockReset();
  vi.mocked(getAllIdentity).mockResolvedValue({ entries: [], skippedIds: [] });
  vi.mocked(getIdentitySortMode).mockReset();
  vi.mocked(getIdentitySortMode).mockResolvedValue('updated');
  vi.mocked(saveIdentitySortMode).mockReset();
  vi.mocked(saveIdentitySortMode).mockResolvedValue(undefined);
  vi.mocked(getIdentityManualOrder).mockReset();
  vi.mocked(getIdentityManualOrder).mockResolvedValue([]);
  vi.mocked(saveIdentityManualOrder).mockReset();
  vi.mocked(saveIdentityManualOrder).mockResolvedValue(undefined);
  elMessage.warning.mockReset();
});

function entry(
  id: string,
  payload: Partial<IdentityPayload>,
  times: { createTime?: number; updateTime?: number } = {},
): IdentityEntry {
  return {
    id,
    encryptedPayload: 'c',
    createTime: times.createTime ?? 0,
    updateTime: times.updateTime ?? 0,
    payload: { pv: 1, category: 'person', ...payload },
  };
}

describe('toggleRevealAll / allVisibleRevealed', () => {
  it('只展开可见且含机密的卡，无机密卡不进 revealedIds', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { idNumber: '1' }), entry('b', { address: '某地' })];
    vault.toggleRevealAll();
    expect([...vault.revealedIds.value]).toEqual(['a']);
    expect(vault.allVisibleRevealed.value).toBe(true); // 可见含机密集合已全部展开（不受无机密 b 干扰）
  });

  it('展开后再点收起，仅清除展开态', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { cardNo: '1' })];
    vault.toggleRevealAll();
    expect(vault.allVisibleRevealed.value).toBe(true);
    vault.toggleRevealAll();
    expect(vault.revealedIds.value.size).toBe(0);
    expect(vault.allVisibleRevealed.value).toBe(false);
  });

  it('切换过滤只动可见项，保留被过滤掉的既有展开（不整体清空）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { idNumber: '1' }), entry('b', { category: 'bank_card', cardNo: '2' })];
    vault.toggleRevealAll();
    expect([...vault.revealedIds.value].sort()).toEqual(['a', 'b']);
    vault.categoryFilter.value = 'bank_card'; // 仅 b 可见
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b']);
    vault.toggleRevealAll(); // 收起：只清除可见的 b
    expect(vault.revealedIds.value.has('b')).toBe(false);
    expect(vault.revealedIds.value.has('a')).toBe(true); // a 的展开态保留
  });

  it('无可见含机密卡：allVisibleRevealed 为 false 且 toggleRevealAll 不改动集合', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { address: 'x' }), entry('b', { name: 'n' })];
    expect(vault.allVisibleRevealed.value).toBe(false);
    vault.toggleRevealAll();
    expect(vault.revealedIds.value.size).toBe(0);
  });
});

describe('toggleCollapseAll / allVisibleCollapsed', () => {
  it('折叠全部可见卡：写入 collapsedIds、isCollapsed 命中、allVisibleCollapsed 为 true', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];
    expect(vault.allVisibleCollapsed.value).toBe(false);
    vault.toggleCollapseAll();
    expect([...vault.collapsedIds.value].sort()).toEqual(['a', 'b']);
    expect(vault.isCollapsed('a')).toBe(true);
    expect(vault.allVisibleCollapsed.value).toBe(true);
  });

  it('折叠后再点展开全部，清空折叠态', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' })];
    vault.toggleCollapseAll();
    expect(vault.allVisibleCollapsed.value).toBe(true);
    vault.toggleCollapseAll();
    expect(vault.collapsedIds.value.size).toBe(0);
    expect(vault.isCollapsed('a')).toBe(false);
  });

  it('切换过滤只动可见项，保留被过滤掉的既有折叠态（不整体清空）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { category: 'bank_card', name: 'B' })];
    vault.toggleCollapseAll(); // a、b 全折叠
    expect([...vault.collapsedIds.value].sort()).toEqual(['a', 'b']);
    vault.categoryFilter.value = 'bank_card'; // 仅 b 可见
    vault.toggleCollapseAll(); // 展开：只展开可见的 b
    expect(vault.collapsedIds.value.has('b')).toBe(false);
    expect(vault.collapsedIds.value.has('a')).toBe(true); // a 折叠态保留
  });

  it('resetViewState 清空折叠态（重开弹窗回到全展开）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' })];
    vault.toggleCollapseAll();
    vault.resetViewState();
    expect(vault.collapsedIds.value.size).toBe(0);
  });
});

describe('toggleCollapse（单卡折叠）', () => {
  it('只影响被点的那张卡，不动其它卡的折叠态', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' }), entry('c', { name: 'C' })];
    vault.toggleCollapse('a');
    expect(vault.isCollapsed('a')).toBe(true);
    expect(vault.isCollapsed('b')).toBe(false);
    expect([...vault.collapsedIds.value]).toEqual(['a']);
    vault.toggleCollapse('c');
    expect([...vault.collapsedIds.value].sort()).toEqual(['a', 'c']);
    vault.toggleCollapse('a');
    expect([...vault.collapsedIds.value]).toEqual(['c']);
  });

  it('单卡折叠不会把 allVisibleCollapsed 误判成「全部已折叠」', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];
    vault.toggleCollapse('a');
    expect(vault.allVisibleCollapsed.value).toBe(false);
    vault.toggleCollapse('b');
    expect(vault.allVisibleCollapsed.value).toBe(true);
  });

  it('与批量折叠共用同一个集合：先折叠两张再「展开全部」，单卡折叠态一起清掉', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];
    vault.toggleCollapse('a');
    vault.toggleCollapse('b');
    vault.toggleCollapseAll(); // 已全部折叠 → 这一刀切回展开
    expect(vault.collapsedIds.value.size).toBe(0);
  });

  it('resetViewState 同时清掉单卡折叠态（重开弹窗不会停在上次收起的那张）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' })];
    vault.toggleCollapse('a');
    vault.resetViewState();
    expect(vault.isCollapsed('a')).toBe(false);
  });
});

describe('clearFilters', () => {
  it('清除搜索与类别过滤，但保留显隐、折叠与勾选态', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { idNumber: '1' })];
    vault.toggleReveal('a');
    vault.toggleCollapseAll(); // a 可见 → 折叠
    vault.toggleSelect('a');
    vault.keyword.value = 'zzz';
    vault.categoryFilter.value = 'bank_card';
    vault.clearFilters();
    expect(vault.keyword.value).toBe('');
    expect(vault.categoryFilter.value).toBe('all');
    expect(vault.revealedIds.value.has('a')).toBe(true);
    expect(vault.collapsedIds.value.has('a')).toBe(true);
    expect(vault.selectedIds.value.has('a')).toBe(true);
  });
});

describe('sortMode（排序档位）', () => {
  it('默认档 = 最近修改倒序，与改造前写死的顺序一致（旧行为不漂移）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('old', { name: 'O' }, { updateTime: 100 }),
      entry('new', { name: 'N' }, { updateTime: 300 }),
      entry('mid', { name: 'M' }, { updateTime: 200 }),
    ];
    expect(vault.sortMode.value).toBe('updated');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('创建时间档按 createTime 倒序，与 updateTime 解耦', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('a', { name: 'A' }, { createTime: 10, updateTime: 900 }),
      entry('b', { name: 'B' }, { createTime: 30, updateTime: 100 }),
      entry('c', { name: 'C' }, { createTime: 20, updateTime: 800 }),
    ];
    vault.setSortMode('created');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('类别档按固定档序（个人→证件→银行卡→地址），不跟随界面语言译名', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('addr', { category: 'address', name: '地址卡' }, { updateTime: 400 }),
      entry('bank', { category: 'bank_card', name: '卡' }, { updateTime: 300 }),
      entry('per', { category: 'person', name: '人' }, { updateTime: 100 }),
      entry('id', { category: 'id_card', name: '证件' }, { updateTime: 200 }),
    ];
    vault.setSortMode('category');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['per', 'id', 'bank', 'addr']);
  });

  it('标题档按界面语言的拼写序：中文走拼音而非码位序', () => {
    const vault = useIdentityVault();
    // 码位序：八 U+516B < 啊 U+554A；拼音序：啊(ā) < 八(bā) —— 两者相反，故这一例能区分「真的走了 Collator」
    vault.rows.value = [entry('ba', { name: '八' }), entry('a', { name: '啊' })];
    vault.setSortMode('title');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['a', 'ba']);
  });

  it('标题档跟随 currentLocale：切到 en 后同一份标题顺序反转', () => {
    // 纯函数侧已证明「ctx.locale 变了结果就变」，这一例钉的是接线：composable 传的是 currentLocale，
    // 而不是写死的 'zh-CN'——写死的话上一例照样绿，只有切语言才会暴露。
    const vault = useIdentityVault();
    vault.rows.value = [entry('ba', { name: '八' }), entry('a', { name: '啊' })];
    vault.setSortMode('title');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['a', 'ba']); // zh-CN：拼音序
    currentLocale.value = 'en';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['ba', 'a']); // en：ICU 根排序，CJK 按码位
  });

  it('档位只改列表展示顺序，rows（导出与勾选摘要的真值）不受影响', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }, { updateTime: 100 }), entry('b', { name: 'B' }, { updateTime: 200 })];
    const before = vault.rows.value.map(r => r.id);
    vault.setSortMode('title');
    vault.setSortMode('category');
    expect(vault.rows.value.map(r => r.id)).toEqual(before);
  });

  it('换档位即写盘一次；重复选同一档位不产生多余写入', () => {
    const vault = useIdentityVault();
    vault.setSortMode('title');
    expect(saveIdentitySortMode).toHaveBeenCalledTimes(1);
    expect(saveIdentitySortMode).toHaveBeenCalledWith('title');
    vault.setSortMode('title');
    expect(saveIdentitySortMode).toHaveBeenCalledTimes(1);
  });

  it('落盘失败只告警，档位在本会话内仍然生效（视图偏好不值得向用户报错）', async () => {
    vi.mocked(saveIdentitySortMode).mockRejectedValueOnce(new Error('quota'));
    const vault = useIdentityVault();
    vault.setSortMode('created');
    await Promise.resolve();
    expect(vault.sortMode.value).toBe('created');
  });

  it('restoreSortMode 用落盘值对齐视图', async () => {
    vi.mocked(getIdentitySortMode).mockResolvedValueOnce('category');
    const vault = useIdentityVault();
    await vault.restoreSortMode();
    expect(vault.sortMode.value).toBe('category');
  });

  it('读回期间用户已手动换档 → 过期读数作废（代际保护，慢读不能覆盖刚做的选择）', async () => {
    let release: (mode: IdentitySortMode) => void = () => {};
    vi.mocked(getIdentitySortMode).mockReturnValue(
      new Promise<IdentitySortMode>(resolve => {
        release = resolve;
      }),
    );
    const vault = useIdentityVault();
    const restoring = vault.restoreSortMode();

    vault.setSortMode('title'); // 用户在读回落地前换了档
    release('created'); // 过期值此刻才到达
    await restoring;

    expect(vault.sortMode.value).toBe('title');
  });

  it('过滤 + 排序叠加：先按类别过滤再按标题排序，两者互不吞掉', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('b2', { category: 'bank_card', name: 'B' }),
      entry('p1', { category: 'person', name: 'A' }),
      entry('b1', { category: 'bank_card', name: 'C' }),
    ];
    vault.categoryFilter.value = 'bank_card';
    vault.setSortMode('title');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b2', 'b1']);
  });

  it('teardown / resetViewState 不复位档位（它是落盘偏好，不是 PII 视图态）', async () => {
    vi.mocked(getIdentitySortMode).mockResolvedValueOnce('title');
    const vault = useIdentityVault();
    await vault.restoreSortMode();
    vault.rows.value = [entry('a', { name: 'A' })];
    vault.toggleCollapse('a');
    vault.keyword.value = 'A';
    // 两条复位路径各自走一遍：teardown 内部虽然调用了 resetViewState，但「弹窗 @closed 只复位视图态」
    // 走的是 resetViewState 本身，用例名并列声明了两者，断言就得各自覆盖（顺带确认真的清掉了视图态）。
    vault.resetViewState();
    expect(vault.sortMode.value).toBe('title');
    expect(vault.keyword.value).toBe('');
    expect([...vault.collapsedIds.value]).toEqual([]);
    vault.teardown();
    expect(vault.sortMode.value).toBe('title');
    expect(vault.rows.value).toEqual([]);
  });
});

describe('manual 档与 moveIdentity（手排换位）', () => {
  it('load 与条目并行读回序位，列表按落盘顺序展示', async () => {
    vi.mocked(getAllIdentity).mockResolvedValue({
      entries: [
        entry('a', { name: 'A' }, { updateTime: 100 }),
        entry('b', { name: 'B' }, { updateTime: 300 }),
        entry('c', { name: 'C' }, { updateTime: 200 }),
      ],
      skippedIds: [],
    });
    vi.mocked(getIdentityManualOrder).mockResolvedValue(['c', 'a', 'b']);
    const vault = useIdentityVault();
    vault.setSortMode('manual');
    await vault.load();
    // 与 updated 档（时间倒序 b/c/a）明显不同，证明序位真的来自落盘数组
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('换位即写盘一次，rows（导出真值）不被就地重排', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' }), entry('c', { name: 'C' })];
    vault.manualOrder.value = ['a', 'b', 'c'];
    vault.setSortMode('manual');
    const before = vault.rows.value.map(r => r.id);

    expect(vault.moveIdentity('c', 'a', 'before')).toBe(1);
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(saveIdentityManualOrder).toHaveBeenCalledTimes(1);
    expect(saveIdentityManualOrder).toHaveBeenCalledWith(['c', 'a', 'b']);
    expect(vault.rows.value.map(r => r.id)).toEqual(before);
  });

  it('落盘前先对齐条目集合：已删除的 id 剪掉、新出现的 id 追加尾部（导入回导路径）', () => {
    const vault = useIdentityVault();
    // 'gone' 已被删除、'fresh' 是这次 load 才出现的（.aphid / 明文导入或新建）
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' }), entry('fresh', { name: 'F' })];
    vault.manualOrder.value = ['b', 'gone', 'a'];
    vault.setSortMode('manual');

    vault.moveIdentity('a', 'b', 'before');
    expect(saveIdentityManualOrder).toHaveBeenCalledWith(['a', 'b', 'fresh']);
    expect(vault.manualOrder.value).toEqual(['a', 'b', 'fresh']);
  });

  it('过滤态只在可见子集内重排，隐藏项占据的全局槽位一动不动', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('p1', { category: 'person', name: 'P1' }),
      entry('b1', { category: 'bank_card', name: 'B1' }),
      entry('p2', { category: 'person', name: 'P2' }),
      entry('b2', { category: 'bank_card', name: 'B2' }),
    ];
    vault.manualOrder.value = ['p1', 'b1', 'p2', 'b2'];
    vault.setSortMode('manual');
    vault.categoryFilter.value = 'person';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['p1', 'p2']);

    vault.moveIdentity('p2', 'p1', 'before');
    expect(saveIdentityManualOrder).toHaveBeenCalledWith(['p2', 'b1', 'p1', 'b2']);
    // 取消过滤后两张银行卡仍在第 2、第 4 位：没有被静默挤到末尾
    vault.categoryFilter.value = 'all';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['p2', 'b1', 'p1', 'b2']);
  });

  it('原地落回 / id 不在可见列表：返回 null 且不写盘', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];
    vault.manualOrder.value = ['a', 'b'];
    vault.setSortMode('manual');

    expect(vault.moveIdentity('a', 'a', 'before')).toBeNull();
    expect(vault.moveIdentity('ghost', 'a', 'after')).toBeNull();
    expect(saveIdentityManualOrder).not.toHaveBeenCalled();
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('未登记的新条目排在末尾且不消失（不在数组里 ≠ 看不见）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('fresh', { name: 'F' })];
    vault.manualOrder.value = ['a'];
    vault.setSortMode('manual');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['a', 'fresh']);
  });

  it('落盘失败只告警，新顺序在本次会话内仍然生效（视图偏好不值得向用户报错）', async () => {
    vi.mocked(saveIdentityManualOrder).mockRejectedValueOnce(new Error('quota'));
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' }), entry('c', { name: 'C' })];
    vault.manualOrder.value = ['a', 'b', 'c'];
    vault.setSortMode('manual');

    vault.moveIdentity('c', 'a', 'before');
    await Promise.resolve();
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['c', 'a', 'b']);
    // 静默失败是这一例原本的形状：卡片已跟着手势落位，落盘却没成功，用户下次打开弹窗
    // 会看到顺序"复活"。不回滚内存顺序（弹回去比留一条提示更糟），但必须留下提示。
    // 断的是渲染后的文案：本文件顶部注册了身份库语言包（与 options 入口一致），生产里
    // `ElMessage.warning` 拿到的就是这句中文，而不是 `identity.sort.saveFailed` 这个 key。
    expect(elMessage.warning).toHaveBeenCalledTimes(1);
    // 取语言包真值，不取 `t(key)`：未注册时 `t()` 原样回吐 key，自指断言会恒成立——
    // 直接读那份包既证「warning 收到的是渲染后的中文」，也证这棵树真的注册上了。
    expect(elMessage.warning).toHaveBeenCalledWith((zhIdentity as Messages)['identity.sort.saveFailed']);
  });

  it('切走档位再切回、以及 teardown 之后，序位数组都保留', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];
    vault.setSortMode('manual');
    vault.moveIdentity('b', 'a', 'before');
    expect(vault.manualOrder.value).toEqual(['b', 'a']);

    vault.setSortMode('updated');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['a', 'b']);
    vault.teardown();
    expect(vault.manualOrder.value).toEqual(['b', 'a']);
    vault.rows.value = [entry('a', { name: 'A' }), entry('b', { name: 'B' })];

    vault.setSortMode('manual');
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b', 'a']);
  });
});

/**
 * 自定义字段是检索命中面
 *
 * 页面侧气泡「编号族」那一档的深链把**这一格叫什么**当搜索词发过来（用例见
 * `tests/content/identityHint.test.ts`），而库里根本没有「学历证书编号」「社保电脑号」
 * 那一格——用户唯一能存下它的地方就是自定义字段。这一组钉住「字段名本身就能搜到」这条
 * 落点承诺，是对既有实现的特征刻画（本轮改动前就该通过），不是新行为。
 */
describe('自定义字段按字段名可检索（气泡深链的落点）', () => {
  /** 一张只有自定义字段、内置字段全空的条目——深链过来时库里能命中它的只有这一格 */
  const customOnly = (id: string, label: string, value: string, secret = false): IdentityEntry =>
    entry(id, { customFields: [{ id: 'c1', label, value, secret }] });

  it('按字段名检索命中只写了自定义字段的条目，内置字段全空不影响命中', () => {
    const vault = useIdentityVault();
    vault.rows.value = [customOnly('serial', '学历证书编号', 'JX-2019-0001'), entry('other', { name: '张三' })];
    vault.keyword.value = '学历证书编号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['serial']);
  });

  it('字段值同样是命中面：同一条目，深链的字段名和用户手输的值前缀都能到', () => {
    const vault = useIdentityVault();
    vault.rows.value = [customOnly('serial', '学历证书编号', 'JX-2019-0001')];
    vault.keyword.value = 'JX-2019';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['serial']);
  });

  it('勾了「机密」的自定义字段照样参与检索（只是渲染时默认打码）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [customOnly('serial', '社保电脑号', 'SB-2019-0001', true)];
    vault.keyword.value = '社保电脑号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['serial']);
  });
});

/**
 * 内置字段名进检索面
 *
 * 自定义字段的「名称」早在检索面里，内置字段却只有「值」——同一片列表两套规则，
 * 于是「搜银行卡号」这种最自然的用法在内置格子上是零命中，而零命中那一屏会建议用户
 * 「建一条同名自定义字段」（见 `identity.noMatchHint`），把一个本来就有的格子指成了没有。
 * 这一组把口径拉平成一句话：**列表上看得见的字，就是搜得到的字**。
 * 名字只在对应字段有值时进集合，语义是「哪些条目有这一格」，空格子的名字不拉宽结果。
 */
describe('内置字段名可检索（屏上看得见的字都搜得到）', () => {
  it('按内置字段名检索命中只填了那一格的条目', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('id', { idNumber: '440300' }), entry('other', { name: '张三' })];
    vault.keyword.value = '证件号码';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['id']);
  });

  it('有值才进检索面：缺字段与空串两种形状都不因「银行卡号」这个名字被搜出来', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('name', { name: '张三' }), // 整格缺席（undefined）
      entry('blank', { name: '李四', cardNo: '' }), // 空串——只有导入路径造得出来（utils/identity/backup.ts 收 '')
      entry('addr', { address: '深圳市' }),
    ];
    vault.keyword.value = '银行卡号';
    expect(vault.filteredRows.value).toEqual([]);
  });

  it('名字与值同一条目内各自都是命中面（搜名字和搜值前缀拿到同一张卡）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('card', { cardNo: '622202' })];
    vault.keyword.value = '发卡行';
    expect(vault.filteredRows.value).toEqual([]);
    vault.keyword.value = '银行卡号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['card']);
    vault.keyword.value = '6222';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['card']);
  });

  it('严格检索的名字面跟屏走，中文写法在英文界面经放宽命中（两条通道各自可辨）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('card', { cardNo: '622202' })];

    // 英文界面上打屏上那串译名：严格通道就够，放宽不参与
    currentLocale.value = 'en';
    vault.keyword.value = 'Card number';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['card']);
    expect(vault.searchRelaxed.value).toBe(false);

    // 打中文写法：严格通道搜不到（那一列显示的是英文），由放宽通道接住
    vault.keyword.value = '银行卡号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['card']);
    expect(vault.searchRelaxed.value).toBe(true);
    expect([...vault.relaxedNameKeys.value]).toEqual(['cardNo']);

    // 而「谁的名字都不像」的一句话，在两种语言下都该是空态
    vault.keyword.value = 'e2e-no-such-field';
    expect(vault.filteredRows.value).toEqual([]);
    currentLocale.value = 'zh-CN';
    expect(vault.filteredRows.value).toEqual([]);
  });

  it('字段名的首字母缩写也能命中（拼音预热后与值同一套匹配口径）', async () => {
    await warmPinyinMatcher();
    const vault = useIdentityVault();
    vault.rows.value = [entry('card', { cardNo: '622202' }), entry('other', { name: '张三' })];
    vault.keyword.value = 'kh';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['card']);
  });
});

/**
 * 零命中时按字段名放宽
 *
 * 上一组把「屏上那串名字」放进了检索面，但口径是「关键词 ⊆ 名字」——真实表单写的是
 * `联系电话号码` / `社会保障号码` / `Contact Number`，那一路在 102 行写法语料上命中 0 行。
 * 这一组钉的是补上的另一半：**只在严格检索为空时**，把这句话认成「我要某一格」。
 * 放在最后才放宽，是为了让 `备注` / `姓名` 这类两三个字的短名字撞不进用户粘贴的长句——
 * 严格检索有结果时这条通道根本不打开。
 */
describe('零命中时按字段名放宽（把页面那行字认成某一格）', () => {
  /** 值都是数字串：任何页面写法都搜不到值，放宽与否只看这句话是不是在要某一格 */
  const phoneEntry = entry('p', { name: '张三', phone: '13800001234' });
  const idEntry = entry('i', { name: '李四', idNumber: '440300' });

  it('严格检索有结果时绝不放宽', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry, idEntry];
    vault.keyword.value = '1380000';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['p']);
    expect(vault.searchRelaxed.value).toBe(false);
    expect([...vault.relaxedNameKeys.value]).toEqual([]);
  });

  it('零命中且这句话是在要某一格时，放宽到「填过那一格的条目」', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry, idEntry];
    vault.keyword.value = '联系电话号码';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['p']);
    expect(vault.searchRelaxed.value).toBe(true);
    expect([...vault.relaxedNameKeys.value]).toEqual(['phone']);
  });

  it('零命中且这句话不是任何一格的名字时仍走空态，放宽标记不起', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry, idEntry];
    vault.keyword.value = 'e2e-no-such-field';
    expect(vault.filteredRows.value).toEqual([]);
    expect(vault.searchRelaxed.value).toBe(false);
  });

  it('放宽只列出真填过那一格的条目：一个手机号都没有时仍然是空，标记也不会亮着', () => {
    const vault = useIdentityVault();
    vault.rows.value = [idEntry];
    vault.keyword.value = '手机号';
    expect(vault.filteredRows.value).toEqual([]);
    expect(vault.searchRelaxed.value).toBe(false);
  });

  it('自定义字段的名字也能反向认出来（用户存的短，打的是页面上那行长字）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('c', {
        customFields: [
          { id: 'c1', label: '学历证书编号', value: 'JX-2019-0001', secret: false },
          // 起了名字但没填值：这一格既不该被搜出来，也不该被高亮成「你要的就是它」
          { id: 'c2', label: '学位证书编号', value: '', secret: false },
        ],
      }),
    ];
    vault.keyword.value = '学位证书编号';
    expect(vault.filteredRows.value).toEqual([]);
    expect(vault.searchRelaxed.value).toBe(false);

    vault.keyword.value = '学历证书编号（复印件）';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['c']);
    expect([...vault.relaxedNameKeys.value]).toEqual(['custom:c1']);
  });

  it('一句话既是值又是格子名时，严格那一半优先（放宽不许盖掉真实命中）', () => {
    const vault = useIdentityVault();
    // A 填了手机号但备注里没有「电话」二字；B 没填手机号，备注里写着「电话」
    const a = entry('a', { phone: '13800001234', remark: '办公室' });
    const b = entry('b', { name: '李四', remark: '前台电话' });
    vault.rows.value = [a, b];
    vault.keyword.value = '电话';
    // 严格检索里「电话」是 B 的备注值的子串；若把放宽排在前面，这一屏会变成「有手机号的那几条」＝A
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b']);
    expect(vault.searchRelaxed.value).toBe(false);
  });

  it('自定义字段的名字与值同一条条目内各自都是命中面（搜名字和搜值前缀拿到同一条）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [
      entry('c', {
        customFields: [
          { id: 'c1', label: '学历证书编号', value: 'JX-2019-0001', secret: false },
          { id: 'c2', label: '学位证书编号', value: '', secret: false },
        ],
      }),
    ];
    // 一句话同时含两格的名字：空着的那一格不进认中集合
    vault.keyword.value = '学历证书编号与学位证书编号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['c']);
    expect([...vault.relaxedNameKeys.value]).toEqual(['custom:c1']);
  });

  it('类别筛选照旧生效：放宽只动文本这一半', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry, entry('b', { category: 'bank_card', phone: '13900005678' })];
    vault.categoryFilter.value = 'bank_card';
    vault.keyword.value = '联系电话号码';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['b']);
  });

  it('换关键词与复位时，放宽标记和认中的格子一起收掉', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry, idEntry];
    vault.keyword.value = '联系电话号码';
    expect(vault.searchRelaxed.value).toBe(true);
    vault.keyword.value = '';
    expect(vault.searchRelaxed.value).toBe(false);
    vault.keyword.value = '社会保障号码';
    expect([...vault.relaxedNameKeys.value]).toEqual(['idNumber']);
    vault.resetViewState();
    expect(vault.relaxedNameKeys.value.size).toBe(0);
  });

  it('英文界面同一套：词表不分语言，认中的是屏上那一串译名所属的格子', () => {
    currentLocale.value = 'en';
    const vault = useIdentityVault();
    vault.rows.value = [entry('bank', { cardBank: '招商银行' })];
    vault.keyword.value = '开户银行';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['bank']);
    expect([...vault.relaxedNameKeys.value]).toEqual(['cardBank']);
  });

  it('名字通道不认拼音缩写：放宽回答的是「这行字是不是某一格的名字」', () => {
    const vault = useIdentityVault();
    vault.rows.value = [phoneEntry];
    vault.keyword.value = 'lxdh';
    expect(vault.filteredRows.value).toEqual([]);
    expect(vault.searchRelaxed.value).toBe(false);
  });

  it('放宽不替机密字段显形：认中证件号那一格时，参与匹配的仍是名字而非值', () => {
    const vault = useIdentityVault();
    vault.rows.value = [idEntry];
    vault.keyword.value = '军官证号';
    expect(vault.filteredRows.value.map(r => r.id)).toEqual(['i']);
    expect([...vault.relaxedNameKeys.value]).toEqual(['idNumber']);
  });
});

describe('teardown', () => {
  it('连同解密明文一起释放（resetViewState 只清视图态，保留 rows）', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { idNumber: '1' }), entry('b', { cardNo: '2' })];
    vault.toggleRevealAll();
    vault.toggleSelect('a');
    vault.keyword.value = '身份证';

    vault.teardown();

    // 明文条目本身：关闭列表弹窗 / 会话失效后不该继续在内存里可寻址
    expect(vault.rows.value).toEqual([]);
    expect(vault.filteredRows.value).toEqual([]);
    // 视图态一并复位，重开弹窗回到干净首屏
    expect(vault.revealedIds.value.size).toBe(0);
    expect(vault.selectedIds.value.size).toBe(0);
    expect(vault.keyword.value).toBe('');
    expect(vault.categoryFilter.value).toBe('all');
  });

  it('释放后按存储真值重载可恢复（列表弹窗关闭再打开的路径）', async () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { name: 'A' })];
    vault.teardown();
    expect(vault.rows.value.length).toBe(0);

    vi.mocked(getAllIdentity).mockResolvedValue({ entries: [entry('a', { name: 'A' })], skippedIds: [] });
    await vault.load();

    expect(vault.rows.value.map(r => r.id)).toEqual(['a']);
  });
});
