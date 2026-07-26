import { describe, expect, it, vi } from 'vitest';
import {
  buildHealthReport,
  buildHealthReportAsync,
  computeBreachedEntries,
  computeReuseGroups,
  computeSecurityScore,
  computeStaleEntries,
  computeWeakEntries,
  scoreToGrade,
} from '@/utils/passwordHealth';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/**
 * passwordHealth.ts 特征化测试
 *
 * 锁定四项健康统计与评分的当前契约：弱密码收集、复用分组（降序、仅 meta、
 * 不含明文）、陈旧分级（90/180/365 天、天数降序）、评分公式与等级映射，
 * 以及 buildHealthReport 的聚合口径（reuseAffectedCount、noTotpCount 等）。
 *
 * 弱密码依赖 evaluatePasswordStrength：此处将其 mock 为「password 以 weak 开头即为弱」，
 * 以便隔离强度算法、只验证 passwordHealth 自身逻辑。
 */
vi.mock('@/composables/usePasswordStrength', () => ({
  evaluatePasswordStrength: (pw: string) => ({ level: pw.startsWith('weak') ? 'weak' : 'strong' }),
}));

/**
 * 字典校验 mock：「password 以 breached 开头即命中字典」，
 * 隔离 top-1000 字典懒加载、只验证 passwordHealth 的索引映射与聚合逻辑。
 */
vi.mock('@/utils/weakPasswordDict', () => ({
  filterCommonPasswords: async (passwords: string[]) => {
    const hits = new Set<number>();
    passwords.forEach((pw, i) => {
      if (pw.startsWith('breached')) hits.add(i);
    });
    return hits;
  },
}));

const DAY = 24 * 60 * 60 * 1000;
/** 固定「当前时间」，使陈旧计算确定化 */
const NOW = 1_000_000_000_000;

describe('computeWeakEntries', () => {
  it('仅收集弱密码条目、跳过空密码，且只返回元数据（不含明文）', () => {
    const list = [
      makePasswordEntry({ id: 'w1', password: 'weak-a', username: 'u1', url: 'x', tag: 't' }),
      makePasswordEntry({ id: 's1', password: 'strong-a' }),
      makePasswordEntry({ id: 'empty', password: '' }),
    ];
    const weak = computeWeakEntries(list);
    expect(weak.map(w => w.id)).toEqual(['w1']);
    expect(weak[0]).toEqual({ id: 'w1', username: 'u1', url: 'x', tag: 't' });
    expect('password' in weak[0]).toBe(false);
  });
});

describe('computeReuseGroups', () => {
  it('按明文分组，仅保留 count>=2，按数量降序，且不泄露明文密码', () => {
    const list = [
      makePasswordEntry({ id: 'a', password: 'dup' }),
      makePasswordEntry({ id: 'b', password: 'dup' }),
      makePasswordEntry({ id: 'c', password: 'dup' }),
      makePasswordEntry({ id: 'd', password: 'pair' }),
      makePasswordEntry({ id: 'e', password: 'pair' }),
      makePasswordEntry({ id: 'f', password: 'unique' }),
      makePasswordEntry({ id: 'g', password: '' }),
    ];
    const groups = computeReuseGroups(list);
    expect(groups.map(g => g.count)).toEqual([3, 2]);
    expect(groups[0].entries.map(e => e.id).sort()).toEqual(['a', 'b', 'c']);
    for (const g of groups) {
      for (const e of g.entries) {
        expect('password' in e).toBe(false);
      }
    }
  });
});

describe('computeStaleEntries', () => {
  it('按 90/180/365 天分级，跳过空密码与无 updateTime，结果按天数降序', () => {
    const list = [
      makePasswordEntry({ id: 'fresh', password: 'p', updateTime: NOW - 10 * DAY }),
      makePasswordEntry({ id: 'warn', password: 'p', updateTime: NOW - 100 * DAY }),
      makePasswordEntry({ id: 'high', password: 'p', updateTime: NOW - 200 * DAY }),
      makePasswordEntry({ id: 'crit', password: 'p', updateTime: NOW - 400 * DAY }),
      makePasswordEntry({ id: 'noupd', password: 'p', updateTime: 0 }),
      makePasswordEntry({ id: 'nopwd', password: '', updateTime: NOW - 400 * DAY }),
    ];
    const stale = computeStaleEntries(list, NOW);
    expect(stale.map(s => s.id)).toEqual(['crit', 'high', 'warn']);
    expect(stale.map(s => s.severity)).toEqual(['critical', 'high', 'warn']);
    expect(stale.find(s => s.id === 'crit')?.ageDays).toBe(400);
  });

  it('分级边界：>=90 warn、>=180 high、>=365 critical', () => {
    const at = (days: number) => makePasswordEntry({ id: `d${days}`, password: 'p', updateTime: NOW - days * DAY });
    expect(computeStaleEntries([at(89)], NOW)).toEqual([]);
    expect(computeStaleEntries([at(90)], NOW)[0].severity).toBe('warn');
    expect(computeStaleEntries([at(180)], NOW)[0].severity).toBe('high');
    expect(computeStaleEntries([at(365)], NOW)[0].severity).toBe('critical');
  });
});

describe('computeSecurityScore', () => {
  it('总数为 0 返回满分 100', () => {
    expect(
      computeSecurityScore({ total: 0, weakCount: 0, breachedCount: 0, reuseAffectedCount: 0, staleCount: 0 }),
    ).toBe(100);
  });

  it('无风险返回 100', () => {
    expect(
      computeSecurityScore({ total: 10, weakCount: 0, breachedCount: 0, reuseAffectedCount: 0, staleCount: 0 }),
    ).toBe(100);
  });

  it('按占比线性扣分并四舍五入', () => {
    // 100 - 25*(1/3) = 91.67 → 92
    expect(
      computeSecurityScore({ total: 3, weakCount: 1, breachedCount: 0, reuseAffectedCount: 0, staleCount: 0 }),
    ).toBe(92);
  });

  it('全维度受影响时扣至下限 0', () => {
    expect(
      computeSecurityScore({ total: 5, weakCount: 5, breachedCount: 5, reuseAffectedCount: 5, staleCount: 5 }),
    ).toBe(0);
  });
});

describe('scoreToGrade', () => {
  it('按 90/70/40 阈值映射等级', () => {
    expect(scoreToGrade(100)).toBe('excellent');
    expect(scoreToGrade(90)).toBe('excellent');
    expect(scoreToGrade(89)).toBe('good');
    expect(scoreToGrade(70)).toBe('good');
    expect(scoreToGrade(69)).toBe('fair');
    expect(scoreToGrade(40)).toBe('fair');
    expect(scoreToGrade(39)).toBe('poor');
    expect(scoreToGrade(0)).toBe('poor');
  });
});

describe('buildHealthReport', () => {
  it('空库返回满分、各项为空', () => {
    expect(buildHealthReport([], NOW)).toEqual({
      total: 0,
      score: 100,
      grade: 'excellent',
      weak: [],
      breached: [],
      reuseGroups: [],
      reuseAffectedCount: 0,
      stale: [],
      noTotpCount: 0,
    });
  });

  it('聚合口径正确：total / 弱 / 复用 / 陈旧 / noTotp / 评分 / 等级', () => {
    const list = [
      makePasswordEntry({ id: '1', password: 'dup', totp: 'JBSW', updateTime: NOW }),
      makePasswordEntry({ id: '2', password: 'dup', updateTime: NOW }),
      makePasswordEntry({ id: '3', password: 'weak-x', updateTime: NOW - 400 * DAY }),
      makePasswordEntry({ id: '4', password: 'unique', totp: '   ', updateTime: NOW }),
    ];
    const report = buildHealthReport(list, NOW);

    expect(report.total).toBe(4);
    expect(report.weak.map(w => w.id)).toEqual(['3']);
    expect(report.reuseGroups.map(g => g.count)).toEqual([2]);
    expect(report.reuseAffectedCount).toBe(2);
    expect(report.stale.map(s => s.id)).toEqual(['3']);
    expect(report.stale[0].severity).toBe('critical');
    // 无 totp：'2' 无、'3' 无、'4' 为空白 → 3；'1' 有 JBSW
    expect(report.noTotpCount).toBe(3);
    // 新权重：100 - 35*(2/4) - 25*(1/4) - 20*(0/4) - 20*(1/4) = 100 - 17.5 - 6.25 - 0 - 5 = 71
    expect(report.score).toBe(71);
    expect(report.grade).toBe('good');
  });
});

describe('computeBreachedEntries', () => {
  it('空密码被跳过且命中索引正确映射回原条目，只返回元数据', async () => {
    const list = [
      makePasswordEntry({ id: 'empty', password: '' }),
      makePasswordEntry({ id: 'b1', password: 'breached-a', username: 'u1', url: 'x', tag: 't' }),
      makePasswordEntry({ id: 'safe', password: 'strong-a' }),
      makePasswordEntry({ id: 'b2', password: 'breached-b' }),
    ];
    const breached = await computeBreachedEntries(list);
    // 空密码条目 'empty' 被过滤后，命中索引 0/2 应映射回 'b1' / 'b2'
    expect(breached.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(breached[0]).toEqual({ id: 'b1', username: 'u1', url: 'x', tag: 't' });
    expect('password' in breached[0]).toBe(false);
  });

  it('全部为空密码时返回空数组（不触发字典查询）', async () => {
    const list = [makePasswordEntry({ id: 'e1', password: '' }), makePasswordEntry({ id: 'e2', password: '' })];
    expect(await computeBreachedEntries(list)).toEqual([]);
  });
});

describe('buildHealthReportAsync', () => {
  it('空库返回满分、各项为空', async () => {
    expect(await buildHealthReportAsync([], NOW)).toEqual({
      total: 0,
      score: 100,
      grade: 'excellent',
      weak: [],
      breached: [],
      reuseGroups: [],
      reuseAffectedCount: 0,
      stale: [],
      noTotpCount: 0,
    });
  });

  it('填充 breached 字段并将其纳入评分计算', async () => {
    const list = [
      makePasswordEntry({ id: '1', password: 'dup', totp: 'JBSW', updateTime: NOW }),
      makePasswordEntry({ id: '2', password: 'dup', updateTime: NOW }),
      makePasswordEntry({ id: '3', password: 'weak-x', updateTime: NOW - 400 * DAY }),
      makePasswordEntry({ id: '4', password: 'breached-y', totp: '   ', updateTime: NOW }),
    ];
    const report = await buildHealthReportAsync(list, NOW);

    expect(report.total).toBe(4);
    expect(report.weak.map(w => w.id)).toEqual(['3']);
    expect(report.breached.map(b => b.id)).toEqual(['4']);
    expect(report.reuseAffectedCount).toBe(2);
    expect(report.stale.map(s => s.id)).toEqual(['3']);
    // 与同步版唯一差异：breached 维度扣分。
    // 100 - 35*(2/4) - 25*(1/4) - 20*(1/4) - 20*(1/4) = 100 - 17.5 - 6.25 - 5 - 5 = 66.25 → 66
    expect(report.score).toBe(66);
    expect(report.grade).toBe('fair');
  });

  it('无字典命中时与同步版 buildHealthReport 结果一致', async () => {
    const list = [
      makePasswordEntry({ id: '1', password: 'dup', totp: 'JBSW', updateTime: NOW }),
      makePasswordEntry({ id: '2', password: 'dup', updateTime: NOW }),
      makePasswordEntry({ id: '3', password: 'weak-x', updateTime: NOW - 400 * DAY }),
      makePasswordEntry({ id: '4', password: 'unique', totp: '   ', updateTime: NOW }),
    ];
    const asyncReport = await buildHealthReportAsync(list, NOW);
    expect(asyncReport).toEqual(buildHealthReport(list, NOW));
  });
});
