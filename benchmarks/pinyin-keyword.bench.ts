/**
 * 拼音检索的成本基准：命中高亮的 DP 记忆化前后、全未命中关键词过滤（不含 DOM）
 *
 * 运行：`pnpm exec vitest bench benchmarks/pinyin-keyword.bench.ts --run`
 *
 * **为什么单独一个文件**：`warmPinyinMatcher()` 翻的是 `utils/searchMatch/core` 的模块级就绪标志，
 * 而顶层 `await` 在**收集阶段**就完成——同一个 bench 文件跑在同一个 worker 里，因此文件内不存在
 * 「只影响后半段」的预热写法。放在 `sidepanel-p0.bench.ts` 里会把那边的
 * `all scope + keyword match` 从「纯子串」变成「每个字段都问一遍拼音」，而
 * `docs/PERF_LARGE_VAULT_EVALUATION.md` §3.1 记录的基线是前者。隔离之后本文件测「拼音已就绪」，
 * 那边测「拼音未就绪」，两组数字各自可长期对比。
 *
 * 夹具与 `sidepanel-p0.bench.ts` 共用 `benchmarks/fixtures/vaultDataset.ts`，
 * 保证两个文件里的「2000 条」是字节级同一份数据。
 */
import { bench, describe } from 'vitest';
import PinyinMatch from 'pinyin-match';
import { highlightSegments } from '@/utils/searchMatch';
import { warmPinyinMatcher } from '@/utils/searchMatch/core';
import { applyListFilters } from '@/utils/passwordFilter';
import { createBenchmarkDataset } from '@/benchmarks/fixtures/vaultDataset';

let _benchmarkSink = 0;

/**
 * 管理页命中高亮的拼音 DP 成本（`(text, keyword)` 记忆化前后）
 *
 * 复刻真实调用形状：一次交互里同一关键词会被「过滤」和「每个文本单元格的高亮」各问一遍，
 * 连续多次交互（悬浮、切筛选、翻页式重排）关键词与行内容都不变——正是记忆化的命中场景。
 * `legacy` 分支直调 `pinyin-match`（缺陷 3 修复前的等价实现），`production` 分支走
 * `highlightSegments`（内含按关键词代际的记忆缓存）。
 *
 * 夹具用中文用户名 + 不命中的拼音关键词：子串分支先短路返回，落到拼音分支时是 DP 的最坏情况
 * （扫完全部切分可能才判定不命中），两侧同一条件才有可比性。**中文文本刻意保留**——
 * 纯 ASCII 无空格的文本已被 `pinyinCannotWidenMatch` 等价短路，那样两组测的是同一件事。
 */
await warmPinyinMatcher();

describe('options highlight pinyin DP (600 rows × 3 passes)', () => {
  const texts = Array.from({ length: 600 }, (_, index) => `测试用户${index}账号`);
  const KEYWORD = 'zhangsan';

  bench(
    'legacy matcher invoked per cell',
    () => {
      for (let pass = 0; pass < 3; pass += 1) {
        for (const text of texts) {
          const hit = PinyinMatch.match(text, KEYWORD);
          _benchmarkSink += hit === false ? 0 : hit[0];
        }
      }
    },
    { time: 1000, warmupTime: 200 },
  );

  bench(
    'production highlightSegments (memoized)',
    () => {
      for (let pass = 0; pass < 3; pass += 1) {
        for (const text of texts) {
          _benchmarkSink += highlightSegments(text, KEYWORD).length;
        }
      }
    },
    { time: 1000, warmupTime: 200 },
  );
});

/**
 * 关键词过滤在「一条都不命中」的 ASCII 库上的代价（2000 条 × 4 字段）
 *
 * 这是大 Vault 最常见也最难受的一档：用户输了一段没有子串命中的拼音，过滤要为每条目的
 * 每个字段各问一次。`legacy per-field DP` 复刻短路判据之前必然走到 DP 的形状，
 * 用于对照 ASCII 等价短路的收益；`applyListFilters` 是生产路径。
 */
describe('ALL-MISS ASCII keyword filter (2000 entries)', () => {
  const source = createBenchmarkDataset(2000);
  const KEYWORD = 'zzqx';

  bench(
    'legacy per-field pinyin DP over username/tag/url',
    () => {
      let hits = 0;
      for (const entry of source) {
        for (const field of [entry.username, entry.tag, entry.remark, entry.url]) {
          if (!field) continue;
          if (field.toLowerCase().includes(KEYWORD)) continue;
          const hit = PinyinMatch.match(field, KEYWORD);
          if (hit !== false) hits += 1;
        }
      }
      _benchmarkSink += hits;
    },
    { time: 1000, warmupTime: 200 },
  );

  bench(
    'production applyListFilters',
    () => {
      _benchmarkSink += applyListFilters(source, { keyword: KEYWORD }).length;
    },
    { time: 1000, warmupTime: 200 },
  );
});
