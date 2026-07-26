import type { PasswordEntry } from '@/utils/types';
import { evaluatePasswordStrength } from '@/composables/usePasswordStrength';
import { filterCommonPasswords } from '@/utils/weakPasswordDict';

/**
 * 密码健康统计核心逻辑（纯函数，零副作用、零网络、零存储写入）
 *
 * 全部计算在调用方已解密的内存明文数组上完成，符合项目「零网络 / 结构性健康」定位：
 * - 不做在线泄露检测（HIBP 等需联网的能力被刻意排除）；
 * - 复用检测仅在内存分组比对，**不落盘、不返回任何明文密码**；
 * - 空密码条目不参与弱/复用/陈旧统计（无密码即无对应风险）。
 *
 * 与 `usePasswordManagement.removeDuplicates`（用户名+网址账号去重）是不同概念，互不影响。
 */

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 陈旧密码分级阈值（单位：天）
 *
 * - `warn`：≥90 天，提醒关注
 * - `high`：≥180 天
 * - `critical`：≥365 天，强烈建议更换
 */
export const STALE_THRESHOLDS = { warn: 90, high: 180, critical: 365 } as const;

/**
 * 安全评分各维度扣分权重（满分 100）
 *
 * 每个维度按「受影响占比」线性扣分，占比越高扣分越多。
 * reuse / weak / breached / stale 计入评分；未开启两步验证仅作信息展示，不扣分。
 */
export const HEALTH_WEIGHTS = { reuse: 35, weak: 25, breached: 20, stale: 20 } as const;

/** 健康等级 */
export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor';

/** 陈旧程度分级 */
export type StaleSeverity = 'warn' | 'high' | 'critical';

/**
 * 受影响条目的展示元数据（绝不含明文密码）
 */
export interface HealthEntryMeta {
  /** 条目 ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 网址 */
  url: string;
  /** 标签（逗号拼接） */
  tag: string;
}

/** 弱密码条目 */
export type WeakEntry = HealthEntryMeta;

/** 常见泄露密码条目（命中 top-1000 字典） */
export type BreachedEntry = HealthEntryMeta;

/** 长时间未更新条目 */
export interface StaleEntry extends HealthEntryMeta {
  /** 距最后更新的天数（向下取整） */
  ageDays: number;
  /** 陈旧程度分级 */
  severity: StaleSeverity;
}

/** 密码复用组（共用同一明文密码的多个条目） */
export interface ReuseGroup {
  /** 组内条目数量 */
  count: number;
  /** 组内条目元数据 */
  entries: HealthEntryMeta[];
}

/** 密码健康报告 */
export interface HealthReport {
  /** 参与统计的条目总数（含空密码条目） */
  total: number;
  /** 综合安全评分（0~100） */
  score: number;
  /** 健康等级 */
  grade: HealthGrade;
  /** 弱密码条目 */
  weak: WeakEntry[];
  /** 命中常见泄露密码字典的条目 */
  breached: BreachedEntry[];
  /** 密码复用组（按组内数量降序） */
  reuseGroups: ReuseGroup[];
  /** 受密码复用影响的条目总数（各组求和） */
  reuseAffectedCount: number;
  /** 长时间未更新条目（按天数降序） */
  stale: StaleEntry[];
  /** 未开启两步验证的条目数（仅信息展示，不计入评分） */
  noTotpCount: number;
}

/**
 * 判断条目是否含有效（非空）密码
 * @param entry 密码条目
 */
function hasPassword(entry: PasswordEntry): boolean {
  return !!entry.password && entry.password.length > 0;
}

/**
 * 提取条目的展示元数据（剔除明文密码与 UI 字段）
 * @param entry 密码条目
 */
function toMeta(entry: PasswordEntry): HealthEntryMeta {
  return { id: entry.id, username: entry.username, url: entry.url, tag: entry.tag };
}

/**
 * 统计弱密码条目
 *
 * 复用 {@link evaluatePasswordStrength} 的等级判定，仅收集 `level === 'weak'` 的条目；
 * 空密码条目被跳过。
 *
 * @param list 已解密的密码条目列表
 * @returns 弱密码条目元数据
 */
export function computeWeakEntries(list: PasswordEntry[]): WeakEntry[] {
  return list.filter(e => hasPassword(e) && evaluatePasswordStrength(e.password).level === 'weak').map(toMeta);
}

/**
 * 检测密码复用组
 *
 * 以**非空**密码明文为 key 分组，仅保留成员数 ≥ 2 的组（即被多个账号共用的密码）。
 * 返回结果按组内数量降序，且**只包含条目元数据、绝不含任何明文密码**。
 *
 * @param list 已解密的密码条目列表
 * @returns 复用组列表（数量降序）
 */
export function computeReuseGroups(list: PasswordEntry[]): ReuseGroup[] {
  const groups = new Map<string, PasswordEntry[]>();
  for (const entry of list) {
    if (!hasPassword(entry)) continue;
    const group = groups.get(entry.password) ?? [];
    group.push(entry);
    groups.set(entry.password, group);
  }

  const result: ReuseGroup[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    result.push({ count: group.length, entries: group.map(toMeta) });
  }

  result.sort((a, b) => b.count - a.count);
  return result;
}

/**
 * 计算陈旧程度分级
 * @param ageDays 距最后更新的天数
 */
function toStaleSeverity(ageDays: number): StaleSeverity {
  if (ageDays >= STALE_THRESHOLDS.critical) return 'critical';
  if (ageDays >= STALE_THRESHOLDS.high) return 'high';
  return 'warn';
}

/**
 * 统计长时间未更新的条目
 *
 * 以 `updateTime` 为「最后更新」近似基准（注意：编辑网址/备注等也会刷新，
 * 因此语义为「长时间未更新」而非严格的密码年龄）。年龄 ≥ {@link STALE_THRESHOLDS.warn} 天计入，
 * 按 90/180/365 天分级；空密码条目被跳过。
 *
 * @param list 已解密的密码条目列表
 * @param now  当前时间戳（毫秒），默认 `Date.now()`
 * @returns 陈旧条目列表（天数降序）
 */
export function computeStaleEntries(list: PasswordEntry[], now: number = Date.now()): StaleEntry[] {
  const result: StaleEntry[] = [];
  for (const entry of list) {
    if (!hasPassword(entry) || !entry.updateTime) continue;
    const ageDays = Math.floor((now - entry.updateTime) / MS_PER_DAY);
    if (ageDays < STALE_THRESHOLDS.warn) continue;
    result.push({ ...toMeta(entry), ageDays, severity: toStaleSeverity(ageDays) });
  }

  result.sort((a, b) => b.ageDays - a.ageDays);
  return result;
}

/**
 * 统计命中常见泄露密码字典的条目
 *
 * 使用 {@link filterCommonPasswords} 批量检查 top-1000 离线字典（懒加载、零联网）。
 * 空密码条目被跳过。
 *
 * @param list 已解密的密码条目列表
 * @returns 命中字典的条目元数据
 */
export async function computeBreachedEntries(list: PasswordEntry[]): Promise<BreachedEntry[]> {
  const passwordsWithIndex = list.map((e, i) => ({ entry: e, index: i })).filter(({ entry }) => hasPassword(entry));

  if (passwordsWithIndex.length === 0) return [];

  const passwords = passwordsWithIndex.map(({ entry }) => entry.password);
  const hitIndices = await filterCommonPasswords(passwords);

  return passwordsWithIndex.filter((_, i) => hitIndices.has(i)).map(({ entry }) => toMeta(entry));
}

/**
 * 计算综合安全评分（0~100）
 *
 * 以受影响条目占总数的比例线性扣分：
 * `100 - 35*reuseRatio - 25*weakRatio - 20*breachedRatio - 20*staleRatio`，
 * 结果 clamp 到 0~100 并取整。总数为 0 时返回满分 100。
 *
 * @param input 各维度受影响计数与总数
 * @returns 0~100 的整数评分
 */
export function computeSecurityScore(input: {
  total: number;
  weakCount: number;
  breachedCount: number;
  reuseAffectedCount: number;
  staleCount: number;
}): number {
  const { total, weakCount, breachedCount, reuseAffectedCount, staleCount } = input;
  if (total <= 0) return 100;

  const reuseRatio = reuseAffectedCount / total;
  const weakRatio = weakCount / total;
  const breachedRatio = breachedCount / total;
  const staleRatio = staleCount / total;

  const raw =
    100 -
    HEALTH_WEIGHTS.reuse * reuseRatio -
    HEALTH_WEIGHTS.weak * weakRatio -
    HEALTH_WEIGHTS.breached * breachedRatio -
    HEALTH_WEIGHTS.stale * staleRatio;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * 将评分映射为健康等级
 *
 * ≥90 优秀 / 70–89 良好 / 40–69 一般 / <40 较差。
 *
 * @param score 0~100 的评分
 */
export function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/**
 * 构建完整的密码健康报告（同步版本，不含字典校验）
 *
 * 聚合弱密码、密码复用、长时间未更新、未开启两步验证四项统计并给出综合评分与等级。
 * breached 字段为空数组（需异步版本 {@link buildHealthReportAsync} 才能填充）。
 * 空库（`total === 0`）直接返回满分、各项为空的报告。
 *
 * @param list 已解密的密码条目列表
 * @param now  当前时间戳（毫秒），默认 `Date.now()`
 * @returns 密码健康报告（breached 为空）
 */
export function buildHealthReport(list: PasswordEntry[], now: number = Date.now()): HealthReport {
  const total = list.length;
  if (total === 0) {
    return {
      total: 0,
      score: 100,
      grade: 'excellent',
      weak: [],
      breached: [],
      reuseGroups: [],
      reuseAffectedCount: 0,
      stale: [],
      noTotpCount: 0,
    };
  }

  const weak = computeWeakEntries(list);
  const reuseGroups = computeReuseGroups(list);
  const reuseAffectedCount = reuseGroups.reduce((sum, g) => sum + g.count, 0);
  const stale = computeStaleEntries(list, now);
  const noTotpCount = list.filter(e => !e.totp || !e.totp.trim()).length;

  const score = computeSecurityScore({
    total,
    weakCount: weak.length,
    breachedCount: 0,
    reuseAffectedCount,
    staleCount: stale.length,
  });

  return {
    total,
    score,
    grade: scoreToGrade(score),
    weak,
    breached: [],
    reuseGroups,
    reuseAffectedCount,
    stale,
    noTotpCount,
  };
}

/**
 * 构建完整的密码健康报告（异步版本，含字典校验）
 *
 * 在同步版本基础上追加 top-1000 常见泄露密码字典离线校验，
 * 填充 breached 字段并将其纳入评分计算。
 *
 * @param list 已解密的密码条目列表
 * @param now  当前时间戳（毫秒），默认 `Date.now()`
 * @returns 含字典校验的完整健康报告
 */
export async function buildHealthReportAsync(list: PasswordEntry[], now: number = Date.now()): Promise<HealthReport> {
  const total = list.length;
  if (total === 0) {
    return {
      total: 0,
      score: 100,
      grade: 'excellent',
      weak: [],
      breached: [],
      reuseGroups: [],
      reuseAffectedCount: 0,
      stale: [],
      noTotpCount: 0,
    };
  }

  const weak = computeWeakEntries(list);
  const breached = await computeBreachedEntries(list);
  const reuseGroups = computeReuseGroups(list);
  const reuseAffectedCount = reuseGroups.reduce((sum, g) => sum + g.count, 0);
  const stale = computeStaleEntries(list, now);
  const noTotpCount = list.filter(e => !e.totp || !e.totp.trim()).length;

  const score = computeSecurityScore({
    total,
    weakCount: weak.length,
    breachedCount: breached.length,
    reuseAffectedCount,
    staleCount: stale.length,
  });

  return {
    total,
    score,
    grade: scoreToGrade(score),
    weak,
    breached,
    reuseGroups,
    reuseAffectedCount,
    stale,
    noTotpCount,
  };
}
