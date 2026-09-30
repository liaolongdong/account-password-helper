import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useIdentityVault } from '@/composables/useIdentityVault';
import { currentLocale } from '@/utils/i18n';
import { getAllIdentity, getIdentitySortMode, saveIdentitySortMode } from '@/utils/storage/identityCrud';
import type { IdentityEntry, IdentityPayload, IdentitySortMode } from '@/utils/identity/types';

/**
 * useIdentityVault 视图态行为测试（node 环境，无需 DOM）
 *
 * 聚焦本批次有状态复杂度的几块——批量展开 / 收起、批量折叠与单卡折叠、排序档位与过滤清除，锁定其作用范围口径：
 * - 展开 / 收起只作用「可见且含机密字段」的卡片，无机密卡永不进 revealedIds；
 * - 折叠 / 展开只作用「可见」的卡片（与机密无关），保留被过滤掉的既有折叠态；单卡 toggleCollapse 与批量共用 collapsedIds；
 * - 排序档位只改 filteredRows 的展示顺序，rows（导出真值）不动；换档写盘一次、等值不重写，读回受代际保护；
 * - 切换过滤不整体清空，保留被过滤掉的既有展开 / 折叠项（对齐 selectAllVisible 语义）；
 * - clearFilters 仅清过滤，保留显隐 / 折叠 / 勾选；resetViewState 清空全部视图态（档位属落盘偏好，不在其内）；
 * - teardown 连解密明文（rows）一起释放，列表弹窗关闭后 PII 不再驻留内存。
 * copy 等涉及 clipboard / ElMessage 的路径不在此覆盖（另有纯函数单测）。
 */

vi.mock('@/utils/storage/identityCrud', () => ({
  getAllIdentity: vi.fn(async () => ({ entries: [], skippedIds: [] })),
  deleteIdentities: vi.fn(),
  saveIdentity: vi.fn(),
  updateIdentity: vi.fn(),
  getIdentitySortMode: vi.fn(async () => 'updated' as const),
  // 必须返回 Promise：setSortMode 对返回值取 .catch，mock 成 undefined 会把测试炸成 TypeError
  saveIdentitySortMode: vi.fn(async () => undefined),
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
