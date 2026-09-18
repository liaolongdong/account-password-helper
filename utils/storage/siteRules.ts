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
 * 验证选择器字符串（基础校验）
 *
 * - 非空字符串
 * - 不包含危险字符（防御性检查）
 */
export function isValidSelector(selector: unknown): boolean {
  if (typeof selector !== 'string' || selector.trim().length === 0) return false;
  // 简单防御：不允许包含 eval、javascript:、表达式等
  const dangerousPatterns = [/eval\s*\(/, /javascript:/, /\{.*\}/, /`.*/];
  return !dangerousPatterns.some(pattern => pattern.test(selector));
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
