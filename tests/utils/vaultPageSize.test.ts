/**
 * 档位常量与白名单判据单测（utils/vaultPageSize）
 *
 * 这里测的是「哪些值有资格作为每页条数落盘」，与页码算法（`tests/utils/vaultPagination.test.ts`）
 * 分开：判据被存储层和 Options UI 同时消费，常量一旦漂移，两侧都要按同一份判据收敛。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isVaultPageSize } from '@/utils/vaultPageSize';

describe('PAGE_SIZE_OPTIONS 档位集合', () => {
  it('档位恒为 50 / 100 / 200，且默认档位在其中', () => {
    // 默认档位不在集合内会让「未落盘」与「落盘了一个非法值」两条路径给出不同行数。
    expect([...PAGE_SIZE_OPTIONS]).toEqual([50, 100, 200]);
    expect(isVaultPageSize(DEFAULT_PAGE_SIZE)).toBe(true);
  });
});

describe('isVaultPageSize 档位白名单', () => {
  it('只认 `PAGE_SIZE_OPTIONS` 里的三个值', () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(isVaultPageSize(size)).toBe(true);
    }
  });

  it('拒绝会击穿分页的值：0、负数、非档位数字、字符串与各种非数字', () => {
    // 0 与负数会让 `slice(start, start + size)` 恒空，表现为「列表被清空」；
    // 250/1000 这类"看着是数字"的值会绕过 200 这条渲染成本上限。
    for (const bad of [0, -100, 25, 51, 150, 250, 1000, Number.NaN, Infinity, '100', '50', null, undefined, {}, []]) {
      expect(isVaultPageSize(bad), `非法档位 ${String(bad)} 必须被拒`).toBe(false);
    }
  });
});
