import { bench, describe } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { comparePasswordEntries, DEFAULT_SIDEPANEL_SORT, sortPasswordEntries } from '@/utils/passwordSort';
import { isExactHostMatch } from '@/utils/domain';
import { getTagFullStyle, parseTags } from '@/utils/tagUtils';

/** 运行：pnpm exec vitest bench benchmarks/sidepanel-p0.bench.ts --run */
const CURRENT_DOMAIN = 'accounts.example.com';
const DATASET_SIZES = [100, 500, 2000] as const;

let _benchmarkSink = 0;

function createDataset(size: number): PasswordEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `entry-${index}`,
    username: `user-${String(size - index).padStart(4, '0')}`,
    password: `password-${index}`,
    url:
      index % 5 === 0
        ? `https://${CURRENT_DOMAIN}/login/${index}`
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

function getDomainPriority(entry: PasswordEntry): number {
  if (entry.url && entry.url.trim() !== '' && isExactHostMatch(CURRENT_DOMAIN, entry.url)) return 0;
  return 1;
}

/** 优化前实现的基准参照：在 O(N log N) 比较器内重复执行域名优先级计算。 */
function legacySortPasswordEntries(list: PasswordEntry[]): PasswordEntry[] {
  return list.sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SIDEPANEL_SORT, getDomainPriority));
}

for (const size of DATASET_SIZES) {
  const source = createDataset(size);

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
  const source = createDataset(2000);
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
  const source = createDataset(2000);
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
