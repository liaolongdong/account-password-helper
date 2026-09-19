/**
 * 站点级填充规则存储模块
 *
 * 存储格式：Record<domain, SiteRule>，以域名 key 便于 O(1) 查找/删除。
 * 与 PasswordEntry 解耦（不改动现有加密结构），旧版本升级无需迁移。
 */
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 自定义选择器配置
 */
export interface CustomSelectors {
  /** 用户名字段 CSS 选择器 */
  username: string;
  /** 密码字段 CSS 选择器 */
  password: string;
}

/**
 * 站点规则接口
 */
export interface SiteRule {
  /** 域名（精确匹配，如 example.com） */
  domain: string;
  /** 自定义选择器（可选） */
  customSelectors?: CustomSelectors;
  /** 是否启用影子 DOM 穿透（可选，默认 true） */
  penetrateShadow?: boolean;
}

/**
 * 站点规则存储类型
 */
type SiteRuleStore = Record<string, SiteRule>;

/**
 * 读取所有站点规则
 *
 * 读取失败返回空对象（安全降级：无规则时走默认检测逻辑）
 */
export async function getSiteRules(): Promise<SiteRuleStore> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_RULES);
    const rules = result[STORAGE_KEYS.SITE_RULES] as SiteRuleStore | undefined;
    return rules ?? {};
  } catch (error) {
    logger.error('获取站点规则失败:', error);
    return {};
  }
}

/**
 * 保存整个站点规则集
 */
async function setSiteRules(rules: SiteRuleStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SITE_RULES]: rules });
}

/**
 * 添加/更新单个站点规则
 */
export async function setSiteRule(domain: string, rule: Omit<SiteRule, 'domain'>): Promise<void> {
  const rules = await getSiteRules();
  rules[domain] = { domain, ...rule };
  await setSiteRules(rules);
  logger.info(`站点规则已保存：${domain}`);
}

/**
 * 删除单个站点规则
 */
export async function removeSiteRule(domain: string): Promise<void> {
  const rules = await getSiteRules();
  if (!(domain in rules)) {
    logger.debug(`站点规则不存在：${domain}`);
    return;
  }
  delete rules[domain];
  await setSiteRules(rules);
  logger.info(`站点规则已删除：${domain}`);
}

/**
 * 根据域名查找站点规则（精确匹配）
 */
export async function getSiteRule(domain: string): Promise<SiteRule | undefined> {
  const rules = await getSiteRules();
  return rules[domain];
}

/**
 * 站点规则域名最大长度（DNS 完整主机名上限），同时作为写入 storage 前的边界裁剪
 */
export const SITE_RULE_DOMAIN_MAX_LENGTH = 253;

/**
 * 单条 CSS 选择器最大长度，防止超长选择器在每次字段检测时拖慢页面主线程
 */
export const SITE_RULE_SELECTOR_MAX_LENGTH = 1024;

/**
 * 校验 CSS 选择器语法是否合法
 *
 * 借用浏览器自身的 CSS 解析器判定：`querySelector` 对非法选择器抛错，且不会执行任何
 * 匹配以外的副作用。写入端（Options 表单）与消费端（内容脚本检测）共用同一判定，
 * 避免表单里写得通、页面上却静默匹配不到字段。
 *
 * 依赖 DOM，仅可在有 DOM 的上下文（Options / 内容脚本）调用。
 *
 * @param selector 待校验的选择器（按不可信输入处理）
 * @returns 语法合法且长度在预算内时为 true
 */
export function isValidCssSelector(selector: unknown): boolean {
  if (typeof selector !== 'string') return false;
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > SITE_RULE_SELECTOR_MAX_LENGTH) return false;
  try {
    document.createDocumentFragment().querySelector(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 规范化并校验站点规则域名
 *
 * 域名是规则的匹配主键，且读取端用 `location.hostname`（天然小写、无尾点）做精确匹配，
 * 因此写入端必须归一化为同一形态，否则规则会静默失效。按 DNS 标签逐段校验，拒绝
 * 通配符、空标签与连续点。
 *
 * @param value 待规范化的域名（按不可信输入处理，可含 `host:port`）
 * @returns 规范化后的域名；非法或超长时返回 null
 */
export function normalizeSiteRuleDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase();
  if (!domain || domain.length > SITE_RULE_DOMAIN_MAX_LENGTH) return null;

  const withPort = /^(.*):(\d{1,5})$/.exec(domain);
  const host = withPort ? withPort[1] : domain;
  if (!host) return null;

  const labels = host.split('.');
  const isWellFormedHost = labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isWellFormedHost) return null;

  return domain;
}

/**
 * 批量设置站点规则（用于初始化或迁移）
 */
export async function bulkSetSiteRules(rules: SiteRule[]): Promise<void> {
  const store: SiteRuleStore = {};
  for (const rule of rules) {
    store[rule.domain] = rule;
  }
  await setSiteRules(store);
  logger.info(`已批量保存 ${rules.length} 条站点规则`);
}
