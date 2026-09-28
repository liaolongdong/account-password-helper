/**
 * 检索链路两处记忆缓存的容量推导守卫
 *
 * 两把缓存都取「整库一轮检索的最坏键域」为上界，而不是「当前可见的那几十行」：
 *
 * - 拼音区间缓存（`utils/searchMatch/core.ts` 的 `PINYIN_RANGE_CACHE_MAX`）的键是
 *   **条目字段明文**，一轮检索最多写入「条目上限 × 检索字段数」个不同文本。
 *   旧值直接写 2000，看似等于条目上限就够用；实际本站范围常把候选集裁到几百条，
 *   于是这条线在多数场景下够不着，只有整库形状（新标签页 / `chrome://` 的空域名、
 *   侧边栏全站范围、管理页）会一次问满 2000 × 4 的键域——正好越过 2000，
 *   触发 FIFO 逐键淘汰，同代际第 2 遍**每个键都未命中**，整轮 DP 白跑第二遍。
 * - 主域名缓存（`utils/domain.ts` 的 `MAIN_DOMAIN_CACHE_MAX`）的键是 hostname，
 *   整库最多 2000 个不同 stored hostname，通配条目另需其 base 一条；旧值 2000
 *   与整库形状卡在临界点，一轮放宽档遍历会在中途整体清空一次。
 *
 * 两处都不静态引用 `vaultCapacity`：`core.ts` 与 `domain.ts` 位于侧边栏首屏依赖闭包内，
 * 为该常量新增一条模块边不划算（口径见 `docs/ARCHITECTURE.md` 的侧边栏秒开一节）。
 * 因此字面量留在原地，由本守卫把「上限 = 条目容量 × 系数」这个推导钉住：
 * 日后调高 `MAX_PASSWORD_ENTRIES` 或增删检索字段，这里会红，而不是让缓存静默退化成抖动源。
 */
import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_ENTRIES } from '@/utils/storage/vaultCapacity';
import { PINYIN_RANGE_CACHE_MAX } from '@/utils/searchMatch/core';
import { MAIN_DOMAIN_CACHE_MAX } from '@/utils/domain';
import { keywordFieldsOf } from '@/utils/keywordMatch';

/** 一条四字段全填的条目，用来量出「一轮检索最多写入几个不同键」的真实字段数 */
const FULL_ENTRY = { username: 'u', tag: 't', remark: 'r', url: 'https://example.com' };

describe('检索链路记忆缓存的容量推导', () => {
  it('字段数取自 keywordFieldsOf 本身，而不是测试里另写一个 4', () => {
    const fields = keywordFieldsOf(FULL_ENTRY);
    // 抽取非空守卫：四个字段都被读出来才算数，漏字段会让下面的乘积假绿
    expect(fields.filter(Boolean)).toHaveLength(4);
    expect(fields).toEqual(['u', 't', 'r', 'https://example.com']);
  });

  it('拼音区间缓存 = 条目上限 × 检索字段数（整库一轮的去重文本数上界）', () => {
    expect(PINYIN_RANGE_CACHE_MAX).toBe(MAX_PASSWORD_ENTRIES * keywordFieldsOf(FULL_ENTRY).length);
  });

  it('主域名缓存 = 条目上限 × 2（整库 hostname + 通配条目的 base）', () => {
    expect(MAIN_DOMAIN_CACHE_MAX).toBe(MAX_PASSWORD_ENTRIES * 2);
  });

  it('两把缓存都严格按比例随条目容量放大，不留在旧字面量上', () => {
    // 单独钉一条「系数 ≥ 1 且为整倍数」：把 MAX_PASSWORD_ENTRIES 调到 5000 时，
    // 若有人只改其中一处，这条与上面两条会一起变红，而不是只有乘积那条红
    expect(PINYIN_RANGE_CACHE_MAX % MAX_PASSWORD_ENTRIES).toBe(0);
    expect(MAIN_DOMAIN_CACHE_MAX % MAX_PASSWORD_ENTRIES).toBe(0);
    expect(PINYIN_RANGE_CACHE_MAX).toBeGreaterThan(MAIN_DOMAIN_CACHE_MAX);
  });
});
