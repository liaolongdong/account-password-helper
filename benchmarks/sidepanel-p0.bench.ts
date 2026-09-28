/**
 * 侧边栏 / 管理页的 JS 计算层基准（过滤、排序、行呈现，不含 DOM）
 *
 * 运行：`pnpm exec vitest bench benchmarks/sidepanel-p0.bench.ts --run`
 *
 * **本文件禁止触碰拼音匹配器的就绪位**（不调 `warmPinyinMatcher()`，也不引任何会引到它的模块）。
 * 一个 bench 文件在同一 worker 里跑，而 `warmPinyinMatcher()` 翻的是模块级标志、在收集阶段就完成——
 * 同文件内不存在「只影响后半段」的写法。一次预热会把 `all scope + keyword match` 从
 * 「纯子串」变成「每个字段都问一遍拼音」，而 `docs/PERF_LARGE_VAULT_EVALUATION.md` §3.1 / §9.10
 * 记录的基线是前者，前后数字就此不可比。拼音成本用例因此住在
 * `benchmarks/pinyin-keyword.bench.ts`（自带预热、独立 worker）。
 */
import { bench, describe } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { BENCHMARK_DOMAIN, createBenchmarkDataset } from '@/benchmarks/fixtures/vaultDataset';
import {
  comparePasswordEntries,
  DEFAULT_SIDEPANEL_SORT,
  filterAndSortEntriesForDomain,
  sortPasswordEntries,
} from '@/utils/passwordSort';
import {
  countSameMainDomainCandidates,
  isCrossSubdomainTier,
  isExactHostMatch,
  resolveMatchTier,
  type DomainMatchMode,
} from '@/utils/domain';
import { applyListFilters, filterEntriesByScope, matchesSiteScope, type ScopeContext } from '@/utils/passwordFilter';
import { getTagFullStyle, parseTags } from '@/utils/tagUtils';

const DATASET_SIZES = [100, 500, 2000] as const;
const SCOPE_CONTEXT: ScopeContext = { domain: BENCHMARK_DOMAIN, port: '' };
/** 与 `entrypoints/sidepanel/App.vue` 的 `NOT_ON_SITE_PRIORITY` 同值 */
const NOT_ON_SITE_PRIORITY = 5;

let _benchmarkSink = 0;

function getDomainPriority(entry: PasswordEntry): number {
  if (entry.url && entry.url.trim() !== '' && isExactHostMatch(BENCHMARK_DOMAIN, entry.url)) return 0;
  return 1;
}

/** 优化前实现的基准参照：在 O(N log N) 比较器内重复执行域名优先级计算。 */
function legacySortPasswordEntries(list: PasswordEntry[]): PasswordEntry[] {
  return list.sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SIDEPANEL_SORT, getDomainPriority));
}

for (const size of DATASET_SIZES) {
  const source = createBenchmarkDataset(size);

  describe(`sidepanel domain-priority sort (${size} entries)`, () => {
    bench(
      'legacy comparator recomputes priority',
      () => {
        const result = legacySortPasswordEntries([...source]);
        _benchmarkSink += result[0]?.id.length ?? 0;
      },
      { time: 1000, warmupTime: 200 },
    );

    bench(
      'production sortPasswordEntries',
      () => {
        const result = sortPasswordEntries([...source], DEFAULT_SIDEPANEL_SORT, getDomainPriority);
        _benchmarkSink += result[0]?.id.length ?? 0;
      },
      { time: 1000, warmupTime: 200 },
    );
  });
}

describe('sidepanel sort before current-domain discovery (2000 entries)', () => {
  const source = createBenchmarkDataset(2000);
  const neutralPriority = () => 0;

  bench(
    'legacy comparator calls neutral priority',
    () => {
      const result = [...source].sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SIDEPANEL_SORT, neutralPriority));
      _benchmarkSink += result[0]?.id.length ?? 0;
    },
    { time: 1000, warmupTime: 200 },
  );

  bench(
    'production sortPasswordEntries',
    () => {
      const result = sortPasswordEntries([...source], DEFAULT_SIDEPANEL_SORT, neutralPriority);
      _benchmarkSink += result[0]?.id.length ?? 0;
    },
    { time: 1000, warmupTime: 200 },
  );
});

describe('sidepanel row tag presentation (2000 entries)', () => {
  const source = createBenchmarkDataset(2000);
  const cachedRecords = source.map(entry => parseTags(entry.tag).map(name => ({ name, style: getTagFullStyle(name) })));

  bench(
    'legacy render recomputes parse and style records',
    () => {
      for (const entry of source) {
        for (const name of parseTags(entry.tag)) {
          _benchmarkSink += getTagFullStyle(name).color.length;
        }
      }
    },
    { time: 1000, warmupTime: 200 },
  );

  bench(
    'cached row records are reused',
    () => {
      for (const records of cachedRecords) {
        for (const record of records) _benchmarkSink += record.name.length + record.style.color.length;
      }
    },
    { time: 1000, warmupTime: 200 },
  );
});

/**
 * 搜索范围（本站 / 全站）过滤 + 排序成本
 *
 * 两条路径用同一份数据集与同一套「范围过滤 → 列表过滤 → 就地排序」取数方式，
 * 直接对比全站模式相对本站默认路径的额外开销；并单独度量全站模式下
 * `offSiteIds`（逐条 `matchesSiteScope` 扫描）的成本，确认默认路径短路后无回归。
 */
for (const size of DATASET_SIZES) {
  const source = createBenchmarkDataset(size);

  describe(`sidepanel search scope filter + sort (${size} entries)`, () => {
    bench(
      'site scope (default path)',
      () => {
        const scoped = filterEntriesByScope(source, 'site', SCOPE_CONTEXT);
        const result = applyListFilters(scoped, {});
        sortPasswordEntries(result, DEFAULT_SIDEPANEL_SORT, getDomainPriority);
        _benchmarkSink += result[0]?.id.length ?? 0;
      },
      { time: 1000, warmupTime: 200 },
    );

    bench(
      'all scope (full vault)',
      () => {
        const scoped = filterEntriesByScope(source, 'all', SCOPE_CONTEXT);
        const result = applyListFilters(scoped, {});
        sortPasswordEntries(result, DEFAULT_SIDEPANEL_SORT, getDomainPriority);
        _benchmarkSink += result[0]?.id.length ?? 0;
      },
      { time: 1000, warmupTime: 200 },
    );

    bench(
      'all scope + keyword match',
      () => {
        const scoped = filterEntriesByScope(source, 'all', SCOPE_CONTEXT);
        const result = applyListFilters(scoped, { keyword: 'user-0100' });
        sortPasswordEntries(result, DEFAULT_SIDEPANEL_SORT, getDomainPriority);
        _benchmarkSink += result.length;
      },
      { time: 1000, warmupTime: 200 },
    );

    bench(
      'offSiteIds scan over all-scope result',
      () => {
        const scoped = filterEntriesByScope(source, 'all', SCOPE_CONTEXT);
        const offSite = new Set<string>();
        for (const entry of scoped) {
          if (!matchesSiteScope(entry, SCOPE_CONTEXT)) offSite.add(entry.id);
        }
        _benchmarkSink += offSite.size;
      },
      { time: 1000, warmupTime: 200 },
    );
  });
}

/**
 * 跨子域放宽档的取数开销（`off` 基线 vs `wildcard` vs `sameMainDomain`）
 *
 * 关心两件事：
 * 1. 放宽后每条多付的判定成本（`getMainDomain` 已记忆化，增量应只是常数次 `new URL`）；
 * 2. 更关键的「可见集扩容」——通过过滤的条目变多，下游的列表拷贝、排序优先级预计算
 *    与徽章扫描都在更大数组上进行。
 *
 * 既有 `DATASET_SIZES` 夹具的条目分属 41 个 `service-*.example.net` 主机，与当前域名
 * 不同主域，放宽与否可见集几乎不变，量不出扩容代价。下面的夹具按「一个根域名 + 多套
 * 测试环境」这一放宽档的真实使用场景铺排。
 *
 * 秒开 SLA 的判定口径：本文件量的是 JS 侧取数（`filteredPasswords` 的同步计算部分），
 * 不含 DOM。侧边栏列表已由 `SidepanelAuthView` 分批放开渲染（首帧固定条数 + rAF 扩容），
 * 因此扩容只影响放开节奏、不抬高首帧节点数，这里给出的是 JS 侧上界。
 */
const CROSS_SUBDOMAIN_SIZES = [600, 2000] as const;
const CROSS_MODES: readonly DomainMatchMode[] = ['off', 'wildcard', 'sameMainDomain'];

/**
 * 同主域密集夹具：每 12 条中 4 条精确命中当前域名、1 条主域名 apex、4 条兄弟子域、
 * 1 条 `*.example.com` 通配、1 条空 URL 通用条目、1 条外域条目。
 *
 * 由此可见集为 `off` 5/12、`wildcard` 6/12、`sameMainDomain` 11/12（相对 off 约 2.2 倍）。
 */
function createCrossSubdomainDataset(size: number): PasswordEntry[] {
  return Array.from({ length: size }, (_, index) => {
    const slot = index % 12;
    const url =
      slot < 4
        ? `https://${BENCHMARK_DOMAIN}/login/${index}`
        : slot === 4
          ? `https://example.com/console/${index}`
          : slot < 9
            ? `https://uat-${index % 9}.example.com/login/${index}`
            : slot === 9
              ? `https://*.example.com/login/${index}`
              : slot === 10
                ? ''
                : `https://service-${index % 41}.example.net/login/${index}`;
    return {
      id: `cross-${index}`,
      username: `user-${String(size - index).padStart(4, '0')}`,
      password: `password-${index}`,
      url,
      tag: `group-${index % 8},team-${index % 5}`,
      remark: `cross subdomain entry ${index}`,
      favorite: index % 11 === 0,
      lastUsedAt: index % 13 === 0 ? undefined : size - index,
      createTime: index,
      updateTime: size - index,
      order: index,
    };
  });
}

/**
 * 空态引导夹具：当前域名零精确命中，但同主域存在条目。
 *
 * `crossDomainHintCount` / `crossDomainCount` 只在「本站无结果、全站有命中」的空态分支
 * 才被读取，此时遍历的是**全库**而非过滤后的子集，是大库上最坏的一条路径。
 * 铺排为每 6 条：2 条兄弟子域、1 条通配、3 条外域，另每 12 条留 1 条空 URL。
 */
function createEmptyStateDataset(size: number): PasswordEntry[] {
  return Array.from({ length: size }, (_, index) => {
    const slot = index % 12;
    const url =
      slot === 0
        ? ''
        : slot < 4
          ? `https://uat-${index % 9}.example.com/login/${index}`
          : slot === 4
            ? `https://*.example.com/login/${index}`
            : `https://service-${index % 41}.example.net/login/${index}`;
    return {
      id: `empty-${index}`,
      username: `user-${index}`,
      password: `password-${index}`,
      url,
      tag: `group-${index % 8}`,
      remark: `empty state entry ${index}`,
      favorite: false,
      createTime: index,
      updateTime: size - index,
      order: index,
    };
  });
}

/**
 * 复刻 `App.vue` 的 `domainPriorityOf`：`off` 档走二值 `getDomainPriority`，放宽档返回 tier
 *
 * `off` 分支与既有基线用的是同一个 `getDomainPriority`，但**不是同一份数据**：基线夹具
 * `createBenchmarkDataset` 每 5 条才有 1 条精确命中当前域名，本夹具每 12 条有 5 条同主域命中，
 * 命中分布不同，跨夹具的绝对数值不可直接比，只能在同一夹具内比档位。
 */
function priorityOf(mode: DomainMatchMode) {
  if (mode === 'off') return getDomainPriority;
  return (entry: PasswordEntry): number => {
    const tier = resolveMatchTier(BENCHMARK_DOMAIN, entry.url, mode);
    return tier === -1 ? NOT_ON_SITE_PRIORITY : tier;
  };
}

for (const size of CROSS_SUBDOMAIN_SIZES) {
  const source = createCrossSubdomainDataset(size);

  describe(`sidepanel site-scope pipeline across domain-match tiers (${size} entries)`, () => {
    for (const mode of CROSS_MODES) {
      bench(
        `site scope pipeline @ ${mode}`,
        () => {
          const scoped = filterEntriesByScope(source, 'site', SCOPE_CONTEXT, mode);
          const result = applyListFilters(scoped, {});
          sortPasswordEntries(result, DEFAULT_SIDEPANEL_SORT, priorityOf(mode));
          _benchmarkSink += result.length;
        },
        { time: 1000, warmupTime: 200 },
      );
    }

    // `off` 档下徽章集直接返回共享空集（零遍历），故只量两档放宽后的扫描成本
    for (const mode of ['wildcard', 'sameMainDomain'] as const) {
      bench(
        `crossDomainIds badge scan @ ${mode}`,
        () => {
          const scoped = filterEntriesByScope(source, 'site', SCOPE_CONTEXT, mode);
          const ids = new Set<string>();
          for (const entry of scoped) {
            const tier = resolveMatchTier(BENCHMARK_DOMAIN, entry.url, mode);
            if (isCrossSubdomainTier(tier)) ids.add(entry.id);
          }
          _benchmarkSink += ids.size;
        },
        { time: 1000, warmupTime: 200 },
      );
    }

    bench(
      'inline dropdown path filterAndSortEntriesForDomain @ off',
      () => {
        const matched = filterAndSortEntriesForDomain(source, BENCHMARK_DOMAIN, DEFAULT_SIDEPANEL_SORT, '', 'off');
        _benchmarkSink += matched.length;
      },
      { time: 1000, warmupTime: 200 },
    );

    bench(
      'inline dropdown path filterAndSortEntriesForDomain @ sameMainDomain',
      () => {
        const matched = filterAndSortEntriesForDomain(
          source,
          BENCHMARK_DOMAIN,
          DEFAULT_SIDEPANEL_SORT,
          '',
          'sameMainDomain',
        );
        _benchmarkSink += matched.length;
      },
      { time: 1000, warmupTime: 200 },
    );
  });
}

describe('sidepanel empty-state widen counter (2000 entries, zero on-site match)', () => {
  const source = createEmptyStateDataset(2000);

  for (const mode of CROSS_MODES) {
    bench(
      `countSameMainDomainCandidates @ ${mode}`,
      () => {
        _benchmarkSink += countSameMainDomainCandidates(source, BENCHMARK_DOMAIN, mode);
      },
      { time: 1000, warmupTime: 200 },
    );
  }
});
