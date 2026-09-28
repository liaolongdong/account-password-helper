/**
 * 分页纯计算件单测（utils/vaultPagination）
 *
 * 零 Vue、无状态，因此不需要 effect scope 也不需要 `nextTick`——这正是它从
 * `composables/useVaultListPagination.ts` 拆出来的收益：换档落点与页码折叠这两套
 * 最容易在"顺手改一下页码条"时破掉的规则，可以在这里逐条钉死而不必挂载响应式系统。
 * 响应式状态与两个 watcher 的断言在 `tests/composables/useVaultListPagination.test.ts`；
 * 档位白名单判据随常量拆到 `utils/vaultPageSize.ts`，其断言在
 * `tests/utils/vaultPageSize.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { buildPagerItems, pageForSizeChange } from '@/utils/vaultPagination';

describe('pageForSizeChange 换档位后的落点', () => {
  it('原首条仍落在眼前：250 条 / 每页 200 / 停在第 2 页改 50 → 第 5 页', () => {
    // 第 2 页首条是第 201 条（下标 200）；新档位下它在第 5 页。
    // 这里若用组件当时读到的 `pageCount` 钳位，得到的是**旧档位**的 2 → 用户被扔到 51～100 条。
    expect(pageForSizeChange(200, 50, 250)).toBe(5);
  });

  it('换大档位向回收页，同样以原首条为准', () => {
    // 每页 50 的第 5 页首条（下标 200）在每页 200 下落在第 2 页
    expect(pageForSizeChange(200, 200, 250)).toBe(2);
    // 每页 100 的第 3 页首条（下标 200）在每页 200 下是第 2 页（该页含 200～399 条）
    expect(pageForSizeChange(200, 200, 500)).toBe(2);
  });

  it('首页恒回首页，越界入参恒落在合法页码内', () => {
    expect(pageForSizeChange(0, 200, 250)).toBe(1);
    // 列表在同一次更新里被清空（下标已不存在）时不能算出第 0 页
    expect(pageForSizeChange(0, 50, 0)).toBe(1);
    expect(pageForSizeChange(999, 50, 250)).toBe(5);
  });
});

describe('buildPagerItems 页码条折叠', () => {
  it('页数不超过 7 时全展开', () => {
    expect(buildPagerItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('超过 7 页时只留首尾与当前页邻域，中间折叠为省略号', () => {
    expect(buildPagerItems(10, 20)).toEqual([1, 'prev-ellipsis', 9, 10, 11, 'prev-ellipsis', 20]);
  });

  it('贴着首尾时不产生多余省略号', () => {
    expect(buildPagerItems(1, 20)).toEqual([1, 2, 'prev-ellipsis', 20]);
    expect(buildPagerItems(20, 20)).toEqual([1, 'prev-ellipsis', 19, 20]);
  });

  it('当前页邻域越界时被裁掉，页码项恒在 [1, total] 内', () => {
    for (let total = 8; total <= 20; total++) {
      for (let current = 1; current <= total; current++) {
        const pages = buildPagerItems(current, total).filter((item): item is number => typeof item === 'number');
        expect(pages).toContain(current);
        expect(pages).toContain(1);
        expect(pages).toContain(total);
        expect(Math.max(...pages)).toBeLessThanOrEqual(total);
        expect(Math.min(...pages)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
