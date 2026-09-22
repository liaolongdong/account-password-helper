import type {
  AutoSaveConfig,
  AutoSavePasswordData,
  CheckCredentialStatusData,
  CredentialStatusResponse,
  PasswordEntry,
  SaveRiskHint,
  SaveTargetNote,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { normalizeToHostname, resolveMatchTier } from '@/utils/domain';
import { isWeakPassword } from '@/utils/passwordStrengthCore';
import { isSessionValid } from './facades';
import { getAllPasswords, updatePassword, savePassword } from './passwordCrud';
import { getDomainMatchConfig, getFavoriteLimit } from './configManager';
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
 * 把条目存储的 URL 或页面 host 规范化为小写 hostname（剥离协议、端口与路径）
 *
 * @param raw 原始 URL 或 host，如 `https://a.com/login`、`a.com`、`localhost:3000`
 * @returns 可比较的 hostname；无法解析时回退为剥离端口的小写字符串
 */
function toMatchableHost(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return value.toLowerCase().split(':')[0];
  }
}

/**
 * 域名匹配精度评分，供多条命中时择优
 *
 * @param dataHost 规范化后的页面 host
 * @param entryHost 规范化后的条目 host
 * @returns 2 = 同一 hostname；1 = 存在父子域包含关系；0 = 不匹配
 */
function hostMatchScore(dataHost: string, entryHost: string): number {
  if (!dataHost || !entryHost) return 0;
  if (entryHost === dataHost) return 2;
  if (entryHost.endsWith(`.${dataHost}`) || dataHost.endsWith(`.${entryHost}`)) return 1;
  return 0;
}

/**
 * 在密码库中查找与给定账号+域名匹配的已存条目
 *
 * 匹配条件：用户名完全一致，且域名双向包含（entryHost === dataHost，
 * 或任一方为另一方的子域名）。供自动保存与保存前预检查复用，确保两者判定一致。
 *
 * 多条命中时取**最精确**的一条（同一 hostname 优先于父子域），而非数组顺序首条 ——
 * 避免在 `example.com` 与 `uat.example.com` 并存时改写错条目。精度并列时保留原顺序。
 *
 * @param passwords 已解密的密码条目列表
 * @param data 待匹配的账号与域名
 * @returns 匹配到的条目，未找到返回 undefined
 */
export function findMatchingEntry(
  passwords: PasswordEntry[],
  data: { username: string; url: string },
): PasswordEntry | undefined {
  const dataHost = toMatchableHost(data.url);
  let best: PasswordEntry | undefined;
  let bestScore = 0;

  for (const entry of passwords) {
    if (!entry.url || entry.username !== data.username) continue;
    const score = hostMatchScore(dataHost, toMatchableHost(entry.url));
    // 严格大于：并列时先到者胜，保持与迁移前相同的条目选择
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
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
    // 载荷容量边界由调用方（background/autoSaveHandler）在本函数之前收口。
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
 * 查找「同名但判重未命中」的跨子域候选条目
 *
 * 档位固定按最宽的 `sameMainDomain` 求解，调用方只在 `off` 档丢弃提示，不再按实际档位二次筛：
 * 这条文案陈述的是「库里有没有同名账号」这一客观事实，与当前档位能否看见它无关——
 * 通配档下看不见 `music.qq.com`，但它确实是一条同名近重复，判重不认正是需要提醒的时刻。
 * tier 取 1~3：
 * - 1（通配条目）与 3（兄弟子域）都是跨子域档位才在填充路径露出的条目；
 * - 2（同主域 apex）按 `hostMatchScore` 的父子域规则本应已被 `findMatchingEntry` 命中、
 *   走不到这一步，保留在区间内是为了不把结论押在那条规则上；
 * - 4（无网址条目）不限站点、无处可指，文案会指向空串，故排除。
 *
 * @param passwords 已解密的全量条目
 * @param data 待保存的账号与网址
 * @returns 首个同名跨子域候选；无候选返回 undefined
 */
function findCrossSubdomainTwin(
  passwords: PasswordEntry[],
  data: CheckCredentialStatusData,
): PasswordEntry | undefined {
  const host = normalizeToHostname(data.url);
  if (!host) return undefined;

  for (const entry of passwords) {
    if (entry.username !== data.username) continue;
    const tier = resolveMatchTier(host, entry.url, 'sameMainDomain');
    if (tier >= 1 && tier <= 3) return entry;
  }
  return undefined;
}

/**
 * 生成「本次将新增一条」提示
 *
 * 只在确实存在同名跨子域候选时才读档位配置：普通新账号保存因此不产生额外存储读取。
 * `off` 档下这些条目既不出现在填充列表，也与本次保存无关，提示反而误导，故按档位丢弃。
 *
 * @param passwords 已解密的全量条目
 * @param data 待保存的账号与网址
 * @returns 去向提示；不适用时返回 undefined
 */
async function buildWillCreateNote(
  passwords: PasswordEntry[],
  data: CheckCredentialStatusData,
): Promise<SaveTargetNote | undefined> {
  const twin = findCrossSubdomainTwin(passwords, data);
  if (!twin?.url) return undefined;

  const { mode } = await getDomainMatchConfig();
  return mode === 'off' ? undefined : { kind: 'willCreate', url: twin.url };
}

/**
 * 生成「将更新另一站的同名账号」提示
 *
 * 父子域判重（`hostMatchScore` 的 1 分）在 `off` 档同样成立，静默改写另一站条目是既有行为，
 * 本提示只是把它说出来，因此无档位门禁。两侧 host 经 `normalizeToHostname` 归一后比较：
 * 条目常存成完整 URL，而内容脚本上报的是 `location.hostname`，直接比字符串会误报。
 *
 * @param currentUrl 当前页网址（内容脚本上报值）
 * @param matched 判重命中的已存条目
 * @returns 去向提示；同 host 命中（去向不言自明）时返回 undefined
 */
function buildUpdateOtherHostNote(currentUrl: string, matched: PasswordEntry): SaveTargetNote | undefined {
  const currentHost = normalizeToHostname(currentUrl);
  const matchedHost = normalizeToHostname(matched.url);
  return matchedHost && matchedHost !== currentHost ? { kind: 'updateOtherHost', url: matched.url } : undefined;
}

/**
 * 保存前预检查：查询当前域名+账号在密码库中的凭证状态
 *
 * 会话无效返回 `locked`；否则用 findMatchingEntry 定位条目：无 → `new`，
 * 有且密码相同 → `identical`，密码不同 → `password_changed`（附标签/备注）。
 * `new` 与 `password_changed` 额外附带风险提示（弱密码/复用计数），供弹窗内联警示。
 * 两个弹窗分支再各带一条去向提示（`targetNote`），说明本次保存落在哪一条上。
 * 仅返回状态枚举与非密码元数据，绝不回传已存明文密码。
 *
 * @param data 待检查的账号、密码与域名
 * @returns 凭证状态、（password_changed 时）已存条目的标签/备注、（需弹窗时）风险提示与去向提示
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
      return {
        status: 'new',
        risk: buildSaveRiskHint(data.password, passwords),
        targetNote: await buildWillCreateNote(passwords, data),
      };
    }

    if (existingEntry.password === data.password) {
      return { status: 'identical' };
    }

    return {
      status: 'password_changed',
      existing: { tag: existingEntry.tag || '', remark: existingEntry.remark || '' },
      risk: buildSaveRiskHint(data.password, passwords),
      targetNote: buildUpdateOtherHostNote(data.url, existingEntry),
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
