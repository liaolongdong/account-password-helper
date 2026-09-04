import type {
  AutoSaveConfig,
  AutoSavePasswordData,
  CheckCredentialStatusData,
  CredentialStatusResponse,
  PasswordEntry,
  SaveRiskHint,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { isWeakPassword } from '@/utils/passwordStrengthCore';
import { isSessionValid } from './facades';
import { getAllPasswords, updatePassword, savePassword } from './passwordCrud';
import { getFavoriteLimit } from './configManager';
import { tl } from '@/utils/i18n-lite';

// ==================== 自动保存配置 ====================

/**
 * 获取默认自动保存配置
 */
export function getDefaultAutoSaveConfig(): AutoSaveConfig {
  return {
    enabled: true,
    domainPatterns: [],
    excludedDomains: [],
  };
}

/**
 * 获取自动保存配置（带默认值）
 */
export async function getAutoSaveConfig(): Promise<AutoSaveConfig> {
  const defaultConfig = getDefaultAutoSaveConfig();
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_SAVE_CONFIG);
    const config = result[STORAGE_KEYS.AUTO_SAVE_CONFIG] as Partial<AutoSaveConfig> | undefined;
    if (!config) return defaultConfig;
    return {
      ...defaultConfig,
      ...config,
      domainPatterns: Array.isArray(config.domainPatterns) ? config.domainPatterns : defaultConfig.domainPatterns,
      excludedDomains: Array.isArray(config.excludedDomains) ? config.excludedDomains : defaultConfig.excludedDomains,
    };
  } catch (error) {
    logger.error('获取自动保存配置失败:', error);
    return defaultConfig;
  }
}

/**
 * 保存自动保存配置
 */
export async function saveAutoSaveConfig(config: Partial<AutoSaveConfig>): Promise<void> {
  try {
    const current = await getAutoSaveConfig();
    const updated: AutoSaveConfig = { ...current, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_SAVE_CONFIG]: updated,
    });
  } catch (error) {
    logger.error('保存自动保存配置失败:', error);
    throw error;
  }
}

/**
 * 解析 host:port 格式字符串，分离 hostname 和 port
 *
 * @param value - host 或 host:port 格式的字符串
 * @returns [hostname, port] 元组；无端口时 port 为空串
 */
function parseHostPort(value: string): [string, string] {
  const colonIdx = value.lastIndexOf(':');
  if (colonIdx > 0) {
    const port = value.substring(colonIdx + 1);
    if (/^\d+$/.test(port)) {
      return [value.substring(0, colonIdx), port];
    }
  }
  return [value, ''];
}

/**
 * 添加域名到自动保存黑名单（去重）
 *
 * 支持 `host:port` 格式（如 `localhost:3000`），存储原始值以便匹配时区分端口。
 * @param domain - 域名或 host:port 格式（如 `github.com`、`localhost:3000`）
 */
export async function addExcludedDomain(domain: string): Promise<void> {
  const config = await getAutoSaveConfig();
  const lowerDomain = domain.toLowerCase();
  if (config.excludedDomains.some(d => d.toLowerCase() === lowerDomain)) {
    return;
  }
  config.excludedDomains.push(lowerDomain);
  await saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
  logger.info(`[APH] 已将 ${lowerDomain} 加入自动保存屏蔽列表`);
}

/**
 * 从自动保存黑名单中移除域名
 */
export async function removeExcludedDomain(domain: string): Promise<void> {
  const config = await getAutoSaveConfig();
  const lowerDomain = domain.toLowerCase();
  config.excludedDomains = config.excludedDomains.filter(d => d.toLowerCase() !== lowerDomain);
  await saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
  logger.info(`[APH] 已将 ${lowerDomain} 从自动保存屏蔽列表移除`);
}

/**
 * 检测域名是否匹配自动保存规则（支持端口区分）
 *
 * 黑名单匹配规则：
 * - 屏蔽条目无端口（如 `example.com`）→ 匹配该 hostname 及子域名，不限端口
 * - 屏蔽条目有端口（如 `localhost:3000`）→ 仅精确匹配该 host + port 组合
 *
 * 域名规则匹配规则（domainPatterns）：
 * - 规则无端口（如 `github.com`）→ 匹配 hostname 及子域名
 * - 规则有端口（如 `localhost:3000`）→ 仅精确匹配 host + port
 * - 正则表达式 → 仅对 hostname（不含端口）做匹配
 *
 * @param host - 当前页面的 host（可含端口，如 `localhost:3000`、`github.com`）
 * @param config - 自动保存配置
 * @returns 是否匹配（且未被屏蔽）
 */
export function isDomainMatchForAutoSave(host: string, config: AutoSaveConfig): boolean {
  if (!host) return false;

  // 解析当前页面的 hostname 和端口
  const [currentHostname, currentPort] = parseHostPort(host);
  if (!currentHostname) return false;

  // ── 黑名单检查 ──
  if (config.excludedDomains && config.excludedDomains.length > 0) {
    const lowerHostname = currentHostname.toLowerCase();
    const isExcluded = config.excludedDomains.some(excluded => {
      const [excludedHost, excludedPort] = parseHostPort(excluded.toLowerCase());
      if (excludedPort) {
        // 屏蔽条目含端口：精确匹配 hostname + port
        return lowerHostname === excludedHost && currentPort === excludedPort;
      }
      // 屏蔽条目无端口：匹配 hostname 及子域名（不限端口）
      return lowerHostname === excludedHost || lowerHostname.endsWith('.' + excludedHost);
    });
    if (isExcluded) return false;
  }

  if (config.domainPatterns.length === 0) return true;

  // ── 域名规则匹配 ──
  const lowerHostname = currentHostname.toLowerCase();
  return config.domainPatterns.some(rule => {
    if (!rule.pattern) return false;
    if (rule.isRegex) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        return regex.test(lowerHostname);
      } catch {
        logger.warn('自动保存域名正则表达式无效:', rule.pattern);
        return false;
      }
    }
    const [patternHost, patternPort] = parseHostPort(rule.pattern.toLowerCase());
    if (patternPort) {
      // 规则含端口：精确匹配 hostname + port
      return lowerHostname === patternHost && currentPort === patternPort;
    }
    // 规则无端口：匹配 hostname 及子域名
    return lowerHostname === patternHost || lowerHostname.endsWith('.' + patternHost);
  });
}

/**
 * 在密码库中查找与给定账号+域名匹配的已存条目
 *
 * 匹配条件：用户名完全一致，且域名双向包含（entryHost === dataHost，
 * 或任一方为另一方的子域名）。供自动保存与保存前预检查复用，确保两者判定一致。
 *
 * @param passwords 已解密的密码条目列表
 * @param data 待匹配的账号与域名
 * @returns 匹配到的条目，未找到返回 undefined
 */
export function findMatchingEntry(
  passwords: PasswordEntry[],
  data: { username: string; url: string },
): PasswordEntry | undefined {
  // 统一通过 URL 解析提取 hostname（剥离端口号），确保 host:port 与纯 hostname 双向匹配
  let dataHost: string;
  try {
    dataHost = new URL(data.url.startsWith('http') ? data.url : `https://${data.url}`).hostname.toLowerCase();
  } catch {
    dataHost = data.url.toLowerCase().split(':')[0];
  }
  return passwords.find(entry => {
    if (!entry.url || entry.username !== data.username) return false;
    const entryHost = (() => {
      try {
        return new URL(entry.url.startsWith('http') ? entry.url : `https://${entry.url}`).hostname;
      } catch {
        return entry.url;
      }
    })().toLowerCase();
    return entryHost === dataHost || entryHost.endsWith('.' + dataHost) || dataHost.endsWith('.' + entryHost);
  });
}

/**
 * 自动保存密码
 */
export async function autoSavePassword(data: AutoSavePasswordData): Promise<{ success: boolean; message: string }> {
  try {
    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      return { success: false, message: tl('bg.autoSave.sessionExpired') };
    }

    const config = await getAutoSaveConfig();
    if (!config.enabled) {
      return { success: false, message: tl('bg.autoSave.disabled') };
    }
    if (!isDomainMatchForAutoSave(data.url, config)) {
      return { success: false, message: tl('bg.autoSave.domainMismatch') };
    }

    if (!data.username || !data.password) {
      return { success: false, message: tl('bg.autoSave.emptyFields') };
    }

    // 匹配需基于明文 username/url，而 storage.local 中为密文（at-rest 不变量），
    // 故这里用 getAllPasswords()（会话期用缓存数据密钥解密，无 PBKDF2）而非原始密文。
    const passwords = await getAllPasswords();

    const existingEntry = findMatchingEntry(passwords, data);

    if (existingEntry) {
      const newTag = data.tagEdited ? data.tag : existingEntry.tag || data.tag || '';
      const newRemark = data.remarkEdited
        ? data.remark || tl('cs.save.autoSaveRemark')
        : existingEntry.remark || data.remark || tl('cs.save.autoSaveRemark');

      await updatePassword(existingEntry.id, {
        password: data.password,
        tag: newTag,
        remark: newRemark,
        updateTime: Date.now(),
      });
      return { success: true, message: tl('bg.autoSave.updated') };
    } else {
      await savePassword({
        username: data.username,
        password: data.password,
        url: data.url,
        tag: data.tag || '',
        remark: data.remark || tl('cs.save.autoSaveRemark'),
        createTime: Date.now(),
        updateTime: Date.now(),
      });
      return { success: true, message: tl('bg.autoSave.savedNew') };
    }
  } catch (error) {
    logger.error('自动保存密码失败:', error);
    return {
      success: false,
      message: tl('bg.autoSave.failed', {
        message: error instanceof Error ? error.message : tl('bg.common.unknownError'),
      }),
    };
  }
}

/**
 * 构造保存前风险提示（background 侧，无 Vue i18n 依赖）
 *
 * 弱密码判定复用 `utils/passwordStrengthCore.ts`，与表单实时校验、设置页安全体检
 * 完全同口径，避免各处自写阈值导致提示不一致。
 *
 * 调用方在弹窗前已经 `getAllPasswords()` 完成全量解密，因此本函数不产生额外的
 * 存储读取或解密开销，属于零成本扩展点。
 *
 * 复用计数无需减去条目自身：`password_changed` 分支已排除密码相同的条目（那种情况
 * 走 `identical`），`new` 分支则不存在匹配条目，所以命中数天然就是「其它账号」数量。
 *
 * 有意不做常见泄露密码字典校验：字典需异步懒加载，会给保存热路径引入延迟，
 * 且该维度已由设置页安全体检覆盖。
 *
 * @param password 待保存的密码明文（仅在内存中参与比对，绝不写入日志）
 * @param entries 已解密的全量密码条目
 * @returns 风险提示；两个维度均未命中时返回 undefined，避免弹窗渲染空警示条
 */
function buildSaveRiskHint(password: string, entries: PasswordEntry[]): SaveRiskHint | undefined {
  const hint: SaveRiskHint = {};

  if (isWeakPassword(password)) {
    hint.weak = true;
  }

  const reusedCount = entries.filter(entry => entry.password === password).length;
  if (reusedCount > 0) {
    hint.reusedCount = reusedCount;
  }

  return hint.weak || hint.reusedCount ? hint : undefined;
}

/**
 * 保存前预检查：查询当前域名+账号在密码库中的凭证状态
 *
 * 会话无效返回 `locked`；否则用 findMatchingEntry 定位条目：无 → `new`，
 * 有且密码相同 → `identical`，密码不同 → `password_changed`（附标签/备注）。
 * `new` 与 `password_changed` 额外附带风险提示（弱密码/复用计数），供弹窗内联警示。
 * 仅返回状态枚举与非密码元数据，绝不回传已存明文密码。
 *
 * @param data 待检查的账号、密码与域名
 * @returns 凭证状态、（password_changed 时）已存条目的标签/备注、（需弹窗时）风险提示
 */
export async function checkCredentialStatus(data: CheckCredentialStatusData): Promise<CredentialStatusResponse> {
  try {
    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      return { status: 'locked' };
    }

    // 无有效凭证可比对时按新账号处理，交由后续弹窗流程判定
    if (!data.username || !data.password) {
      return { status: 'new' };
    }

    const passwords = await getAllPasswords();
    const existingEntry = findMatchingEntry(passwords, data);

    if (!existingEntry) {
      return { status: 'new', risk: buildSaveRiskHint(data.password, passwords) };
    }

    if (existingEntry.password === data.password) {
      return { status: 'identical' };
    }

    return {
      status: 'password_changed',
      existing: { tag: existingEntry.tag || '', remark: existingEntry.remark || '' },
      risk: buildSaveRiskHint(data.password, passwords),
    };
  } catch (error) {
    logger.error('自动保存预检查失败:', error);
    // 检查失败时按新账号处理，保底弹「保存」弹窗，不阻断用户保存
    return { status: 'new' };
  }
}

// ==================== LRU 收藏淘汰 ====================

/**
 * LRU 淘汰：当收藏数已达上限时，取消最近最少使用的收藏条目
 */
export async function evictLRUFavoriteIfNeeded(passwords: PasswordEntry[]): Promise<PasswordEntry | null> {
  try {
    const limit = await getFavoriteLimit();
    const favorites = passwords.filter(p => p.favorite);
    if (favorites.length < limit) return null;

    const lruEntry = favorites.reduce((oldest, cur) => {
      const oldestTs = oldest.favoriteUsedAt ?? 0;
      const curTs = cur.favoriteUsedAt ?? 0;
      return curTs < oldestTs ? cur : oldest;
    });

    lruEntry.favorite = false;
    lruEntry.favoriteUsedAt = undefined;
    await updatePassword(lruEntry.id, {
      favorite: false,
      favoriteUsedAt: undefined,
      updateTime: lruEntry.updateTime,
    });
    return lruEntry;
  } catch (error) {
    logger.error('LRU 收藏淘汰失败:', error);
    return null;
  }
}
