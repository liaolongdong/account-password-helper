/**
 * 站点规则的明文 JSON 导出 / 导入
 *
 * 站点规则是「可再生但没有重录价值」的配置：条目少，但每条的选择器都要去目标站点
 * 用 DevTools 现抄，换机或重装后重配的代价远高于配置本身。因此这里给一条与密码库
 * 加密备份（`.aph`）完全分离的明文通道。
 *
 * 明文是有意为之：规则里只有域名与 CSS 选择器，不含账号、密码或任何可推导凭据的
 * 字段，用户可以直接打开文件肉眼核对、手改后回导。域名清单会随文件离开扩展，这是
 * 该通道已知的取舍，不要把这里当成可以放敏感数据的地方。
 *
 * 导入侧的文件内容全部按不可信输入处理：结构、条数、体积、域名形态与选择器语法
 * 都要过一遍校验，不合法的条目逐条剔除而不是整份接受。
 */
import { formatTimestampCompact } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import {
  bulkSetSiteRules,
  getSiteRules,
  isValidCssSelector,
  normalizeSiteRuleDomain,
  type SiteRule,
} from '@/utils/storage/siteRules';

/** 导出文件类型标识，用于把站点规则文件与密码库 / 身份库的 JSON 区分开 */
export const SITE_RULES_EXPORT_KIND = 'aphsr';

/** 导出格式版本，字段增删时提升，并在导入侧作为兼容判据 */
export const SITE_RULES_EXPORT_VERSION = 1;

/** 单次导入的规则条数上限，防止异常文件把存储撑爆 */
export const SITE_RULES_IMPORT_MAX_RULES = 500;

/** 导入文件的大小上限（字符数近似），先于 JSON.parse 生效，避免解析超大文本 */
export const SITE_RULES_IMPORT_MAX_INPUT_BYTES = 2 * 1024 * 1024;

/** 导入失败的错误码，UI 侧据此映射可读文案，绝不把原始异常抛给用户 */
export type SiteRulesImportErrorCode =
  'FILE_TOO_LARGE' | 'INVALID_JSON' | 'UNSUPPORTED_FILE' | 'TOO_MANY_RULES' | 'NO_VALID_RULES';

/** 带错误码的导入异常（与身份库备份的 backupError 同构，便于 UI 分支处理） */
function importError(code: SiteRulesImportErrorCode, cause?: unknown): Error {
  const err = new Error(code) as Error & { code: SiteRulesImportErrorCode; cause?: unknown };
  err.code = code;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** 从任意错误里取出导入错误码（无则返回 undefined） */
export function getSiteRulesImportErrorCode(error: unknown): SiteRulesImportErrorCode | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code as SiteRulesImportErrorCode;
  }
  return undefined;
}

/** 导出文件结构 */
export interface SiteRulesExportPayload {
  /** 固定为 `aphsr`，用于拒绝拿错文件 */
  kind: string;
  /** 格式版本 */
  version: number;
  /** 导出时间（毫秒时间戳，与密码库 JSON 导出同一形态） */
  exportedAt: number;
  /** 规则条数，与 `rules` 长度交叉校验 */
  count: number;
  /** 规则列表，按域名升序，保证同一份数据导出结果可比对 */
  rules: SiteRule[];
}

/** 合并结果：`rules` 是写回存储的完整集合，另两数为可观测的变更规模 */
export interface SiteRulesMergeResult {
  added: number;
  updated: number;
  rules: SiteRule[];
}

/** 解析结果：`dropped` 是文件里被剔除的条目数（域名非法、选择器非法或规范化后重复） */
export interface SiteRulesParseResult {
  rules: SiteRule[];
  dropped: number;
}

/**
 * 把一条来源不可知的记录收敛成合法站点规则
 *
 * 域名走与写入端相同的规范化（小写、去空白、可含端口），否则规则会在内容脚本的
 * 精确匹配下静默失效。选择器两侧要么都合法要么整体丢弃：`CustomSelectors` 本来就
 * 要求成对，半条规则只会让消费端在两种来源之间摇摆。两侧都不成立时返回 null，
 * 避免往存储里塞一条什么都不做的记录。
 */
function toSiteRule(rawDomain: unknown, rawRule: unknown): SiteRule | null {
  const domain = normalizeSiteRuleDomain(rawDomain);
  if (!domain || typeof rawRule !== 'object' || rawRule === null) return null;

  const source = rawRule as Record<string, unknown>;
  const rule: SiteRule = { domain };

  const selectors = source.customSelectors;
  if (typeof selectors === 'object' && selectors !== null) {
    const username = (selectors as Record<string, unknown>).username;
    const password = (selectors as Record<string, unknown>).password;
    if (
      typeof username === 'string' &&
      typeof password === 'string' &&
      username.trim() &&
      password.trim() &&
      isValidCssSelector(username) &&
      isValidCssSelector(password)
    ) {
      rule.customSelectors = { username: username.trim(), password: password.trim() };
    }
  }

  // 默认即为 true，只保留显式关闭，避免把可推导的默认值固化进存储
  if (source.penetrateShadow === false) rule.penetrateShadow = false;

  return rule.customSelectors || rule.penetrateShadow === false ? rule : null;
}

/**
 * 构造导出载荷（纯函数，便于测试比对）
 */
export function buildSiteRulesExportPayload(rules: SiteRule[]): SiteRulesExportPayload {
  return {
    kind: SITE_RULES_EXPORT_KIND,
    version: SITE_RULES_EXPORT_VERSION,
    exportedAt: Date.now(),
    count: rules.length,
    rules: [...rules].sort((a, b) => a.domain.localeCompare(b.domain)),
  };
}

/**
 * 解析导入文本为可导入的规则，并统计被剔除的条目数
 *
 * 接受两种形态：本扩展导出的信封，以及裸的 `Record<domain, SiteRule>`（即
 * `chrome.storage.local` 里 `site_rules` 的原样形态，便于手工编辑）。带 `kind` /
 * `version` 的文件一律严格校验，避免把密码库或身份库的 JSON 当规则导入。
 *
 * @param text 文件文本内容（不可信输入）
 * @returns 规范化后的规则列表与被剔除的条目数
 * @throws FILE_TOO_LARGE / INVALID_JSON / UNSUPPORTED_FILE / TOO_MANY_RULES / NO_VALID_RULES
 */
export function parseSiteRulesImportText(text: string): SiteRulesParseResult {
  if (typeof text !== 'string' || !text.trim()) throw importError('INVALID_JSON');
  if (text.length > SITE_RULES_IMPORT_MAX_INPUT_BYTES) throw importError('FILE_TOO_LARGE');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw importError('INVALID_JSON', error);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw importError('UNSUPPORTED_FILE');

  const record = json as Record<string, unknown>;
  const isEnvelope = record.kind !== undefined || record.version !== undefined;
  const pairs: [unknown, unknown][] = [];

  if (isEnvelope) {
    if (record.kind !== SITE_RULES_EXPORT_KIND || record.version !== SITE_RULES_EXPORT_VERSION) {
      throw importError('UNSUPPORTED_FILE');
    }
    if (!Array.isArray(record.rules)) throw importError('UNSUPPORTED_FILE');
    // count 与 rules 长度交叉校验：不一致说明文件被截断或手工改坏，不能按半份导入
    if (record.count !== undefined && record.count !== record.rules.length) throw importError('UNSUPPORTED_FILE');
    if (record.rules.length > SITE_RULES_IMPORT_MAX_RULES) throw importError('TOO_MANY_RULES');
    for (const item of record.rules) {
      pairs.push([(item as { domain?: unknown } | null)?.domain, item]);
    }
  } else {
    const entries = Object.entries(record);
    if (entries.length > SITE_RULES_IMPORT_MAX_RULES) throw importError('TOO_MANY_RULES');
    pairs.push(...entries);
  }

  const rules: SiteRule[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const [rawDomain, rawRule] of pairs) {
    const rule = toSiteRule(rawDomain, rawRule);
    if (!rule || seen.has(rule.domain)) {
      dropped++;
      continue;
    }
    seen.add(rule.domain);
    rules.push(rule);
  }
  if (!rules.length) throw importError('NO_VALID_RULES');

  return { rules, dropped };
}

/**
 * 按域名把导入规则合并到现有规则（纯函数）
 *
 * 同域名以导入内容为准（计为 `updated`），其余保留；导入里新出现的域名计为 `added`。
 * 匹配键用规范化后的域名，因此历史遗留的大小写不一致 key 会收敛成一条。
 *
 * @param current 现有规则（存储原样）
 * @param incoming 导入并校验后的规则
 */
export function mergeSiteRules(current: SiteRule[], incoming: SiteRule[]): SiteRulesMergeResult {
  const byDomain = new Map<string, SiteRule>();
  for (const rule of current) {
    const key = normalizeSiteRuleDomain(rule.domain) ?? rule.domain;
    const held = byDomain.get(key);
    // 本机若已同时存着同一站点的大小写变体，只留内容脚本命得到的那条（domain 已等于规范化 key）。
    // 落盘是整份覆盖，随存储返回顺序任选一条会把可用规则换成永远匹配不到的死规则；而两条都非
    // 规范化形态时无从判定优劣，保留先出现的以免每次导入结果不稳定。
    if (held && (held.domain === key || rule.domain !== key)) continue;
    byDomain.set(key, rule);
  }

  let added = 0;
  let updated = 0;
  for (const rule of incoming) {
    const key = normalizeSiteRuleDomain(rule.domain) ?? rule.domain;
    if (byDomain.has(key)) updated++;
    else added++;
    byDomain.set(key, rule);
  }

  return { added, updated, rules: [...byDomain.values()] };
}

/**
 * 触发一次浏览器下载
 *
 * @param parts Blob 内容分片
 * @param type MIME 类型
 * @param filename 下载文件名
 */
function downloadBlob(parts: BlobPart[], type: string, filename: string): void {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出当前全部站点规则为明文 JSON 文件
 *
 * @returns 实际导出的规则条数，供 UI 反馈
 */
export async function exportSiteRulesToFile(): Promise<number> {
  const rules = Object.values(await getSiteRules());
  const payload = buildSiteRulesExportPayload(rules);
  try {
    downloadBlob(
      [JSON.stringify(payload, null, 2)],
      'application/json;charset=utf-8',
      `site_rules_${formatTimestampCompact()}.json`,
    );
  } catch (error) {
    logger.error('导出站点规则失败:', error);
    const err = new Error('站点规则导出失败');
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
  return payload.count;
}

/**
 * 从文件文本导入站点规则并按域名合并落盘
 *
 * 落盘走整份写入：合并结果已包含未命中的既有规则，因此不会丢掉本机规则。
 *
 * @param text 文件文本内容
 * @returns 新增、更新与被剔除的条数，调用方必须显式报告，不得静默合并或静默丢数据
 */
export async function importSiteRulesFromText(
  text: string,
): Promise<{ added: number; updated: number; dropped: number }> {
  const { rules: incoming, dropped } = parseSiteRulesImportText(text);
  const current = Object.values(await getSiteRules());
  const { added, updated, rules } = mergeSiteRules(current, incoming);
  await bulkSetSiteRules(rules);
  logger.info(`导入站点规则完成：新增 ${added} 条，更新 ${updated} 条，忽略 ${dropped} 条`);
  return { added, updated, dropped };
}
