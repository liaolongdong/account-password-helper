import { describe, expect, it } from 'vitest';
import { useIdentityVault } from '@/composables/useIdentityVault';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';

/**
 * useIdentityVault 视图态行为测试（node 环境，无需 DOM）
 *
 * 聚焦本批次唯一有状态复杂度的两块——批量展开 / 收起与过滤清除，锁定其作用范围口径：
 * - 展开 / 收起只作用「可见且含机密字段」的卡片，无机密卡永不进 revealedIds；
 * - 切换过滤不整体清空，保留被过滤掉的既有展开项（对齐 selectAllVisible 语义）；
 * - clearFilters 仅清过滤，保留显隐与勾选。
 * load / copy 等涉及 storage / clipboard / ElMessage 的路径不在此覆盖（另有纯函数单测）。
 */

function entry(id: string, payload: Partial<IdentityPayload>): IdentityEntry {
  return {
    id,
    encryptedPayload: 'c',
    createTime: 0,
    updateTime: 0,
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

describe('clearFilters', () => {
  it('清除搜索与类别过滤，但保留显隐与勾选态', () => {
    const vault = useIdentityVault();
    vault.rows.value = [entry('a', { idNumber: '1' })];
    vault.keyword.value = 'zzz';
    vault.categoryFilter.value = 'bank_card';
    vault.toggleReveal('a');
    vault.toggleSelect('a');
    vault.clearFilters();
    expect(vault.keyword.value).toBe('');
    expect(vault.categoryFilter.value).toBe('all');
    expect(vault.revealedIds.value.has('a')).toBe(true);
    expect(vault.selectedIds.value.has('a')).toBe(true);
  });
});
