import type { PasswordEntry, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { generateId } from '@/utils/generateId';
import { lazyImport } from '@/utils/lazyImport';
import { getSessionDataKey } from './facades';
import { isExactHostMatch } from '@/utils/domain';
import { applySavedSortConfig } from './configManager';
import { snapshotPasswordHistory } from './passwordHistory';
import { moveToTrash } from './trashManager';

/**
 * 延迟加载加密模块（deriveEncryptionKey / encryptPasswordEntry / decryptPasswordEntry）
 *
 * 仅在 savePassword / batchSavePasswords / updatePassword / getAllPasswords 中按需使用。
 * 页面上下文（sidepanel/options）中该拆分真实生效：PBKDF2/AES-GCM 不进入
 * 首屏 chunk；SW 产物被 WXT 内联为单文件，懒加载在 SW 中仅延迟模块
 * 初始化执行，不减少冷启动解析/编译量。
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/** 敏感字段集合：仅这些字段以密文形式存储，其余为明文元数据 */
const SENSITIVE_FIELDS = ['username', 'password', 'url', 'remark', 'totp'] as const;

/** 判断 updates 是否触及任一敏感字段（触及则需解密-合并-重新加密） */
function updatesTouchSensitiveFields(updates: Partial<PasswordEntry>): boolean {
  return SENSITIVE_FIELDS.some(f => f in updates);
}

/**
 * 解析用于加解密的数据密钥
 *
 * - 传入 masterPassword（锁定态显式操作）：PBKDF2 派生。
 * - 否则使用会话期缓存的数据密钥（storage.session / SW 内存，无 PBKDF2）。
 *
 * @returns 数据密钥 hex；无有效会话且未提供主密码时返回 null
 */
async function resolveDataKey(masterPassword?: string): Promise<string | null> {
  if (masterPassword) {
    const enc = await _getEncryption();
    return enc.deriveEncryptionKey(masterPassword);
  }
  return getSessionDataKey();
}

/**
 * 获取所有密码条目（原始数据，不进行解密）
 */
export async function getAllPasswordsRaw(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    return (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
  } catch (error) {
    logger.error('获取原始密码列表失败:', error);
    return [];
  }
}

/**
 * 保存密码条目（始终以密文落盘）
 */
export async function savePassword(
  entry: Omit<PasswordEntry, 'id' | 'order'>,
  masterPassword?: string,
  copyItemId?: string,
): Promise<PasswordEntry> {
  try {
    const passwords = await getAllPasswordsRaw();

    const now = Date.now();
    const createTime = entry.createTime ?? now;
    const updateTime = entry.updateTime ?? createTime;
    const newEntry: PasswordEntry = {
      ...entry,
      id: generateId(),
      createTime,
      updateTime,
      order: passwords.length,
    };

    // at-rest 不变量：新条目含敏感字段，必须加密后写入
    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();
    const encryptedEntry = await enc.encryptPasswordEntry(newEntry, masterPassword ?? '', key);

    const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
    if (copyItemId) {
      const copyIndex = entriesToSave.findIndex(p => p.id === copyItemId);
      if (copyIndex !== -1) {
        entriesToSave.splice(copyIndex + 1, 0, encryptedEntry);
      } else {
        entriesToSave.push(encryptedEntry);
      }
    } else {
      entriesToSave.push(encryptedEntry);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: entriesToSave,
    });

    // 返回明文条目供 UI 就地展示
    return newEntry;
  } catch (error) {
    logger.error('保存密码失败:', error);
    throw error;
  }
}

/**
 * 批量保存密码条目（性能优化：单次读写替代 N 次循环调用 savePassword）
 */
export async function batchSavePasswords(
  entries: Omit<PasswordEntry, 'id' | 'order'>[],
  masterPassword?: string,
): Promise<PasswordEntry[]> {
  try {
    if (!entries || entries.length === 0) return [];

    const existingPasswords = await getAllPasswordsRaw();

    const now = Date.now();
    const newEntries: PasswordEntry[] = entries.map((entry, i) => ({
      ...entry,
      id: generateId(),
      createTime: entry.createTime ?? now,
      updateTime: entry.updateTime ?? now,
      order: existingPasswords.length + i,
    }));

    // at-rest 不变量：批量新条目必须加密后写入（派生一次密钥复用）
    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();
    const encryptedNewEntries: EncryptedPasswordEntry[] = [];
    for (const entry of newEntries) {
      encryptedNewEntries.push(await enc.encryptPasswordEntry(entry, masterPassword ?? '', key));
    }
    const combinedEntries: (PasswordEntry | EncryptedPasswordEntry)[] = [...existingPasswords, ...encryptedNewEntries];

    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: combinedEntries,
    });

    return newEntries;
  } catch (error) {
    logger.error('批量保存密码失败:', error);
    throw error;
  }
}

/**
 * 更新密码条目
 */
export async function updatePassword(
  id: string,
  updates: Partial<PasswordEntry>,
  masterPassword?: string,
): Promise<void> {
  try {
    const passwords = await getAllPasswordsRaw();
    const index = passwords.findIndex(p => p.id === id);
    if (index === -1) return;

    const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
    const current = passwords[index];

    // 仅更新非敏感元数据（favorite/favoriteUsedAt/lastUsedAt/tag/order 等）：
    // 直接在（密文）条目上就地更新，无需加解密也无需会话密钥，
    // 保留 sidepanel 收藏/填充热路径的轻量特性。
    if (!updatesTouchSensitiveFields(updates)) {
      // updateTime 优先尊重调用方显式传入：收藏/取消收藏传入原值即保持不变
      // （只改收藏时间 favoriteUsedAt，不推高 updateTime），未传时默认 Date.now()
      entriesToSave[index] = { ...current, ...updates, updateTime: updates.updateTime ?? Date.now() } as
        | PasswordEntry
        | EncryptedPasswordEntry;
      await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: entriesToSave });
      return;
    }

    // 敏感字段变更：解密现有条目 → 合并 updates → 重新加密写回（at-rest 始终密文）
    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();
    const currentPlain = await enc.decryptPasswordEntry(current as EncryptedPasswordEntry, masterPassword ?? '', key);

    // 密码字段变更时快照旧密文（fire-and-forget，不阻塞主流程）
    if ('password' in updates && updates.password !== currentPlain.password) {
      snapshotPasswordHistory(id, current.password).catch(() => {});
    }

    // 同上：显式传入的 updateTime 优先生效（编辑场景均传 Date.now() 或依赖默认值，行为不变）
    const updatedPlain: PasswordEntry = { ...currentPlain, ...updates, updateTime: updates.updateTime ?? Date.now() };
    entriesToSave[index] = await enc.encryptPasswordEntry(updatedPlain, masterPassword ?? '', key);

    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: entriesToSave,
    });
  } catch (error) {
    logger.error('更新密码失败:', error);
    throw error;
  }
}

/**
 * 批量更新密码条目的非敏感元数据（单次 read-modify-write）
 *
 * 面向批量标签编辑等元数据批量操作：相比逐条调用 updatePassword，
 * 仅一次全量读 + 一次全量写，避免 N 次全量读写与 N 次 onChanged 广播，
 * 且写入原子（要么全部落盘要么全部不落盘，无中途失败的内存/磁盘分叉）。
 * 仅支持非敏感字段（在密文条目上就地更新，无需加解密与会话密钥），
 * 传入敏感字段立即抛错；与 updatePassword 一致，updateTime 尊重显式传入值（传原值即保持不变）。
 *
 * @param updates 条目 ID 与更新字段的列表；不存在的 ID 静默跳过
 */
export async function batchUpdatePasswordMetadata(
  updates: Array<{ id: string; updates: Partial<PasswordEntry> }>,
): Promise<void> {
  if (updates.length === 0) return;
  try {
    for (const { updates: fields } of updates) {
      if (updatesTouchSensitiveFields(fields)) {
        throw new Error('batchUpdatePasswordMetadata 仅支持非敏感元数据字段');
      }
    }
    const passwords = await getAllPasswordsRaw();
    const updateMap = new Map(updates.map(item => [item.id, item.updates]));
    let changed = false;
    const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = passwords.map(current => {
      const fields = updateMap.get(current.id);
      if (!fields) return current;
      changed = true;
      return { ...current, ...fields, updateTime: fields.updateTime ?? Date.now() } as
        | PasswordEntry
        | EncryptedPasswordEntry;
    });
    if (!changed) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: entriesToSave });
  } catch (error) {
    logger.error('批量更新密码元数据失败:', error);
    throw error;
  }
}

/**
 * 会话期内可更新的非敏感元数据字段（与 SENSITIVE_FIELDS 互补）——单一事实源
 *
 * 路由白名单（messageRouter ALLOWED_METADATA_FIELDS）、缓存修补字段集
 * （passwordCache）均必须从本常量派生，禁止另行硬编码；未来新增字段
 * 只需改这一处，避免漂移导致路由误收敏感字段破坏 at-rest 密文不变量。
 */
export const METADATA_FIELDS = ['favorite', 'favoriteUsedAt', 'lastUsedAt', 'updateTime', 'tag', 'order'] as const;

/**
 * 会话期内可更新的非敏感元数据字段子集类型
 *
 * 仅这些非敏感字段可经 updatePasswordInSession 更新，编译期禁止误传敏感字段
 * （username/password/url/remark，应走 updatePassword 的解密-重加密路径）。
 */
export type MetadataUpdate = Partial<Pick<PasswordEntry, (typeof METADATA_FIELDS)[number]>>;

/**
 * 基于内容校验两次 PASSWORDS 全量数据是否「仅元数据」差异（纯函数，跨上下文复用）
 *
 * SW 侧与元数据 flush 打标互为双重保险；面板侧用于 storage.onChanged 时
 * 就地修补列表、跳过全量解密重载。逐条对比 oldValue/newValue：长度与 id
 * 序列对齐（捕获增删），除白名单字段外无任何差异（捕获敏感字段编辑）才返回
 * true，确保误判场景回退全量失效/重载，不会把真实数据变更当作元数据 patch。
 *
 * @param oldValue 变更前全量条目
 * @param newValue 变更后全量条目
 * @returns true 表示确认为仅元数据变更
 */
export function isMetadataOnlyChange(oldValue: unknown, newValue: unknown): boolean {
  if (!Array.isArray(oldValue) || !Array.isArray(newValue) || oldValue.length !== newValue.length) {
    return false;
  }
  for (let i = 0; i < newValue.length; i++) {
    const oldEntry = oldValue[i] as Record<string, unknown> | undefined;
    const newEntry = newValue[i] as Record<string, unknown> | undefined;
    if (!oldEntry || !newEntry || oldEntry.id !== newEntry.id) return false;
    const keys = new Set([...Object.keys(oldEntry), ...Object.keys(newEntry)]);
    for (const key of keys) {
      if (oldEntry[key] !== newEntry[key] && !(METADATA_FIELDS as readonly string[]).includes(key)) return false;
    }
  }
  return true;
}

// ── 元数据批量写入（防抖） ──

/** 待刷新的元数据更新队列（id → 合并后的 updates） */
const _pendingMetadataUpdates = new Map<string, MetadataUpdate>();

/** 防抖定时器 */
let _metadataFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 待触发的 resolve 回调队列
 *
 * 防抖窗口内每次调用都会入队一个 resolve；flush 完成后统一触发，
 * 确保被 clearTimeout 取消定时器的历史调用其 Promise 仍能正常 resolve（杜绝永挂）。
 */
const _metadataFlushResolvers: Array<() => void> = [];

/** 防抖延迟（毫秒）：收集窗口内的多次更新合并为单次 storage 写入 */
const METADATA_FLUSH_DELAY_MS = 1500;

/** 元数据 flush 打标有效期（毫秒）：SW 监听器据此识别「仅元数据变更」，超期视为无效 */
export const METADATA_FLUSH_MARK_TTL_MS = 3000;

/**
 * 将队列中所有待更新的元数据一次性写入 storage
 *
 * 单次 read-modify-write 替代 N 次独立写入，减少序列化/反序列化开销。
 * 写入失败时不重试（下次填充会再次触发），仅记录日志。
 */
async function flushMetadataUpdates(): Promise<void> {
  _metadataFlushTimer = null;

  if (_pendingMetadataUpdates.size === 0) return;

  // 快照并清空队列（防止 flush 期间新入队的数据被本次写入覆盖）
  const batch = new Map(_pendingMetadataUpdates);
  _pendingMetadataUpdates.clear();

  try {
    const passwords = await getAllPasswordsRaw();
    let modified = false;

    for (const [id, updates] of batch) {
      const index = passwords.findIndex(p => p.id === id);
      if (index === -1) continue;
      // updateTime 优先尊重调用方显式传入：收藏/取消收藏传入原值即保持不变，
      // 填充类更新（lastUsedAt）未传时默认 Date.now()
      passwords[index] = { ...passwords[index], ...updates, updateTime: updates.updateTime ?? Date.now() } as
        | PasswordEntry
        | EncryptedPasswordEntry;
      modified = true;
    }

    if (modified) {
      // 先打标再写数据：SW 的 storage.onChanged 据此识别「仅元数据变更」，
      // 原地修补内存缓存与快照而非全量失效（避免使用痕迹落盘击穿侧边栏
      // 快照直读快路径导致重开白屏变长）；写入失败/中断时清除残留标记，
      // 防止 TTL 窗口内的真实数据变更被误判为元数据类而跳过全量失效
      try {
        await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.METADATA_FLUSH_AT]: Date.now() });
        await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: passwords });
      } catch (error) {
        void chrome.storage.session.remove(SESSION_MEMORY_KEYS.METADATA_FLUSH_AT).catch(() => {});
        throw error;
      }
    }
  } catch (error) {
    logger.error('批量更新元数据失败:', error);
  }
}

/**
 * 会话期内更新密码条目（轻量元数据更新，供 SidePanel 等前台 UI 使用）
 *
 * 采用防抖批量写入策略：1.5 秒内的多次更新合并为单次 storage 读写，
 * 避免每次填充操作都触发全量密码数组的序列化/反序列化。
 *
 * 调用方仅传入非敏感元数据（收藏/使用时间戳等），无需加解密。
 * 返回的 Promise 在数据实际写入 storage 后 resolve（调用方通常 fire-and-forget）。
 *
 * @param id 条目 ID
 * @param updates 要更新的非敏感元数据字段（见 MetadataUpdate）
 */
export function updatePasswordInSession(id: string, updates: MetadataUpdate): Promise<void> {
  // 合并同一 ID 的多次更新（后到覆盖先到）
  const existing = _pendingMetadataUpdates.get(id);
  _pendingMetadataUpdates.set(id, existing ? { ...existing, ...updates } : { ...updates });

  // 重置防抖定时器
  if (_metadataFlushTimer) clearTimeout(_metadataFlushTimer);

  return new Promise<void>(resolve => {
    // 入队 resolve：即使本次定时器随后被 clearTimeout 取消，
    // 也会在下一次 flush 完成时统一 resolve，避免 Promise 永挂
    _metadataFlushResolvers.push(resolve);
    _metadataFlushTimer = setTimeout(async () => {
      try {
        await flushMetadataUpdates();
      } finally {
        // 一次性 resolve 窗口内累积的全部调用（含 flush 异常场景）
        _metadataFlushResolvers.splice(0).forEach(r => r());
      }
    }, METADATA_FLUSH_DELAY_MS);
  });
}

/**
 * 删除密码条目（软删除：移入回收站）
 */
export async function deletePassword(id: string): Promise<void> {
  try {
    await moveToTrash([id]);
  } catch (error) {
    logger.error('删除密码失败:', error);
    throw error;
  }
}

/**
 * 批量删除密码条目（软删除：移入回收站）
 */
export async function deletePasswords(ids: string[]): Promise<void> {
  try {
    await moveToTrash(ids);
  } catch (error) {
    logger.error('批量删除密码失败:', error);
    throw error;
  }
}

/**
 * 获取所有密码条目（自动解密）
 *
 * storage.local 始终为密文（at-rest 不变量）：会话期用缓存数据密钥解密（无 PBKDF2），
 * 锁定态需显式传入 masterPassword。
 */
export async function getAllPasswords(masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const entries: (PasswordEntry | EncryptedPasswordEntry)[] =
      (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];

    const hasEncryptedEntries = entries.some(entry => 'encrypted' in entry && entry.encrypted === true);
    if (!hasEncryptedEntries) {
      // 全明文（空库或迁移前的边界态）：直接返回
      return entries as PasswordEntry[];
    }

    // 解析数据密钥：会话期用缓存密钥（无 PBKDF2），锁定态需显式 masterPassword
    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('需要主密码来解密数据');
    }

    const enc = await _getEncryption();
    // 并行解密：各条目独立，Promise.allSettled 避免单条失败中断整体
    const decryptResults = await Promise.allSettled(
      entries.map(entry => {
        if ('encrypted' in entry && entry.encrypted === true) {
          return enc.decryptPasswordEntry(entry, masterPassword ?? '', key);
        }
        return Promise.resolve(entry as PasswordEntry);
      }),
    );

    const decryptedEntries: PasswordEntry[] = [];
    for (let i = 0; i < decryptResults.length; i++) {
      const result = decryptResults[i];
      if (result.status === 'fulfilled') {
        decryptedEntries.push(result.value);
      } else {
        logger.warn('跳过无法解密的条目: ' + entries[i].id);
      }
    }

    return decryptedEntries;
  } catch (error) {
    logger.error('获取密码列表失败:', error);
    const err = new Error('加载密码列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
    (err as any).cause = error;
    throw err;
  }
}

/**
 * 根据URL搜索密码
 */
export async function getPasswordsByUrl(url: string, masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    const allPasswords = await getAllPasswords(masterPassword);

    const filteredPasswords = allPasswords.filter(p => {
      if (!p.url || p.url.trim() === '') return true;
      return isExactHostMatch(url, p.url);
    });

    await applySavedSortConfig(filteredPasswords, url);
    return filteredPasswords;
  } catch (error) {
    logger.error('根据URL搜索密码失败:', error);
    return [];
  }
}
