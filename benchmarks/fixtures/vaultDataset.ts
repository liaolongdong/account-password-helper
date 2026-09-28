import type { PasswordEntry } from '@/utils/types';

/**
 * 基准夹具的共用部分（`*.bench.ts` 之间）
 *
 * 抽出来的理由不是「少 20 行」，而是**可比性**：渲染/过滤层基准与拼音成本基准必须跑在
 * 逐字段一致的库上。两边各留一份「看起来一样」的合成数据，迟早出现读不出差别的数字——
 * 而基准数字一旦进了文档，事后没人会怀疑夹具悄悄漂了。
 *
 * 域形状（每 5 条 1 条精确命中当前域、约 1/7 无 URL、其余外域）与 ASCII 字段内容都是
 * 刻意选的：大 Vault 的真实用户名/标签/URL 基本都是可见 ASCII，拼音分支因此走到
 * 「扫完全部切分才判定不命中」的最坏情况，两侧条件一致才有对照意义。
 *
 * 纯合成数据，不含任何真实凭据。
 */

/** 夹具里「当前页面」的域名（渲染层与拼音成本两条基准共用） */
export const BENCHMARK_DOMAIN = 'accounts.example.com';

/**
 * 合成 ASCII 库
 *
 * @param size 条目数
 * @returns 字段形状稳定的条目数组（每次调用都是新数组，可安全原地排序）
 */
export function createBenchmarkDataset(size: number): PasswordEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `entry-${index}`,
    username: `user-${String(size - index).padStart(4, '0')}`,
    password: `password-${index}`,
    url:
      index % 5 === 0
        ? `https://${BENCHMARK_DOMAIN}/login/${index}`
        : index % 7 === 0
          ? ''
          : `https://service-${index % 41}.example.net/login`,
    tag: `group-${index % 8},team-${index % 5},region-${index % 3}`,
    remark: `benchmark entry ${index}`,
    favorite: index % 11 === 0,
    lastUsedAt: index % 13 === 0 ? undefined : size - index,
    createTime: index,
    updateTime: size - index,
    order: index,
  }));
}
