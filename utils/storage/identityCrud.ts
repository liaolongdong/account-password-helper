/**
 * 身份信息库存储门面（Identity Vault CRUD）
 *
 * 与密码库平行的第 4 个加密域，刻意整块加密（一个 encryptedPayload blob）
 * 而非逐字段加密：身份字段几乎全部敏感，逐字段等于 10 次 AES + 一份随字段
 * 增删维护的敏感清单；整块加密让「新增字段」永远不需要改加密层。
 *
 * at-rest 不变量（沿用本仓「恒加密由写路径保证」的真实口径，并加强读路径）：
 * - 写路径：无数据密钥直接抛错，绝不退回明文；
 * - 读路径：encryptedPayload 非非空字符串的记录视为无效，跳过 + 不回写。
 *
 * 依赖方向单向：只依赖既有底层能力（encryption / facades.getSessionDataKey /
 * generateId），既有模块不 import 本模块；唯一例外是 changeMasterPassword.ts
 * 必须纳入身份数据（否则换主密码后 PII 永久不可解）。
 *
 * 例外于「整块加密」的只有一样东西：列表排序档位（`IDENTITY_SORT_MODE`）。它是个
 * 四值枚举、不含任何 PII，也没有进密文的必要——把它塞进每条 payload 反而要整库重加密。
 */
import type { IdentityEntry, IdentityPayload, IdentityRecord, IdentitySortMode } from '@/utils/identity/types';
import { DEFAULT_IDENTITY_SORT_MODE, MAX_IDENTITIES, isIdentitySortMode } from '@/utils/identity/constants';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { generateId } from '@/utils/generateId';
import { mapWithConcurrency } from '@/utils/concurrency';
import { lazyImport } from '@/utils/lazyImport';
import { getSessionDataKey } from './facades';

/**
 * 延迟加载加密模块（encryptData / decryptData / deriveEncryptionKey）
 *
 * 仅在 saveIdentity / updateIdentity / getAllIdentity / reencryptAll 中按需使用，
 * 页面上下文（options）中 PBKDF2/AES-GCM 不进入首屏 chunk。
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/**
 * 解析用于加解密的数据密钥
 *
 * - 传入 masterPassword（锁定态显式操作）：PBKDF2 派生。
 * - 否则使用会话期缓存的数据密钥（storage.session / SW 内存，无 PBKDF2）。
 * 刻意不复用 passwordCrud 的私有实现，避免跨数据域耦合。
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
 * identityCrud 可被 UI 精确分流的错误码
 *
 * 对标 `backup.ts` 的 `IdentityBackupErrorCode`：控制流绑定稳定 code，面向用户的
 * 中文消息仅作展示、可自由措辞，二者解耦（App.vue 据此映射 i18n，不再 `includes` 散文）。
 */
export type IdentityCrudErrorCode = 'LIMIT_REACHED' | 'NOT_FOUND' | 'UPDATE_CONFLICT';

/** 构造带 code 的 Error：消息文本保持原样（旧断言与通用兜底展示仍依赖它） */
function identityCrudError(code: IdentityCrudErrorCode, message: string): Error {
  const err = new Error(message) as Error & { code: IdentityCrudErrorCode };
  err.code = code;
  return err;
}

/** 读取 identityCrud 抛错的错误码（非本模块错误、或无关 code 一律返回 undefined） */
export function getIdentityCrudErrorCode(error: unknown): IdentityCrudErrorCode | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'LIMIT_REACHED' || code === 'NOT_FOUND' || code === 'UPDATE_CONFLICT') {
      return code;
    }
  }
  return undefined;
}

/**
 * 获取所有身份条目（原始数据，不进行解密）
 *
 * 读取失败时向上抛出而非降级为空数组：所有调用方均为读-改-写路径
 * （保存/更新/删除/rekey），静默返回 [] 会导致真实列表被「仅含新条目」
 * 的数组整体覆盖，造成不可逆数据丢失（镜像 passwordCrud.ts:53-61）。
 */
export async function getAllIdentityRaw(): Promise<IdentityRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY);
    return (result[STORAGE_KEYS.IDENTITY] as IdentityRecord[] | undefined) || [];
  } catch (error) {
    logger.error('获取原始身份信息列表失败:', error);
    throw error;
  }
}

/**
 * 获取所有身份条目（自动解密）
 *
 * storage.local 始终为密文：会话期用缓存数据密钥解密（无 PBKDF2），
 * 锁定态需显式传入 masterPassword。Promise.allSettled 并行解密，
 * 单条失败按 id 跳过且不回写（镜像 passwordCrud.ts:453-460）。
 *
 * @returns 解密成功条目与不可解密（跳过）的 id 列表
 */
export async function getAllIdentity(
  masterPassword?: string,
): Promise<{ entries: IdentityEntry[]; skippedIds: string[] }> {
  try {
    const records = await getAllIdentityRaw();
    if (records.length === 0) return { entries: [], skippedIds: [] };

    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('需要主密码来解密数据');
    }

    const enc = await _getEncryption();
    const results = await Promise.allSettled(
      records.map(async record => {
        // 读路径不变量：encryptedPayload 非非空字符串视为无效
        if (typeof record.encryptedPayload !== 'string' || record.encryptedPayload === '') {
          throw new Error('invalid encrypted payload');
        }
        const json = await enc.decryptData(record.encryptedPayload, key);
        const payload = JSON.parse(json) as IdentityPayload;
        if (!payload || typeof payload !== 'object' || typeof payload.category !== 'string') {
          throw new Error('invalid payload shape');
        }
        return { ...record, payload };
      }),
    );

    const entries: IdentityEntry[] = [];
    const skippedIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        entries.push(result.value);
      } else {
        skippedIds.push(records[i].id);
        logger.warn('跳过无法解密的身份条目: ' + records[i].id);
      }
    }
    return { entries, skippedIds };
  } catch (error) {
    logger.error('获取身份信息列表失败:', error);
    const err = new Error('加载身份信息列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
    (err as { cause?: unknown }).cause = error;
    throw err;
  }
}

/**
 * 保存身份条目（整块加密落盘）
 *
 * 无数据密钥则抛错，绝不退回明文。条数上限在写入前校验。
 *
 * @param payload 身份明文负载
 * @param masterPassword 锁定态显式传入；会话有效时省略
 */
export async function saveIdentity(payload: IdentityPayload, masterPassword?: string): Promise<IdentityEntry> {
  try {
    const records = await getAllIdentityRaw();
    if (records.length >= MAX_IDENTITIES) {
      throw identityCrudError('LIMIT_REACHED', `身份信息条目已达上限（${MAX_IDENTITIES} 条）`);
    }

    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();

    const now = Date.now();
    const record: IdentityRecord = {
      id: generateId(),
      encryptedPayload: await enc.encryptData(JSON.stringify(payload), key),
      createTime: now,
      updateTime: now,
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: [...records, record] });

    return { ...record, payload };
  } catch (error) {
    logger.error('保存身份信息失败:', error);
    throw error;
  }
}

/**
 * 更新身份条目（read-modify-write + 并发令牌）
 *
 * - 目标 id 已不存在（被其他窗口删除）→ 抛错，调用方提示刷新，绝不静默成功；
 * - `expectedUpdateTime` 为读取时拿到的 updateTime：不匹配则拒绝并抛错
 *   （多 Options 标签页并存的真实场景），调用方提示刷新后重试。
 * 前向兼容：payload 整体替换为 `{ ...existing, ...patch, pv: 1 }`，
 * 未来版本新增的键经旧版本编辑后仍然存活。
 *
 * @param id 条目 ID
 * @param patch 变更的负载字段（category 由表单显式写出，不受合并影响）
 * @param expectedUpdateTime 读取时的 updateTime（并发令牌）
 * @param masterPassword 锁定态显式传入；会话有效时省略
 */
export async function updateIdentity(
  id: string,
  patch: Partial<IdentityPayload>,
  expectedUpdateTime: number,
  masterPassword?: string,
): Promise<void> {
  try {
    const records = await getAllIdentityRaw();
    const index = records.findIndex(r => r.id === id);
    if (index === -1) {
      throw identityCrudError('NOT_FOUND', '该身份信息已被删除，请刷新后重试');
    }

    const current = records[index];
    if (current.updateTime !== expectedUpdateTime) {
      throw identityCrudError('UPDATE_CONFLICT', '该身份信息已被其他窗口修改，请刷新后重试');
    }

    const key = await resolveDataKey(masterPassword);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();

    const json = await enc.decryptData(current.encryptedPayload, key);
    const existingPayload = JSON.parse(json) as IdentityPayload;
    const nextPayload = { ...existingPayload, ...patch, pv: 1 } as IdentityPayload;

    const entriesToSave = [...records];
    entriesToSave[index] = {
      ...current,
      encryptedPayload: await enc.encryptData(JSON.stringify(nextPayload), key),
      updateTime: Date.now(),
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: entriesToSave });
  } catch (error) {
    logger.error('更新身份信息失败:', error);
    throw error;
  }
}

/**
 * 硬删除身份条目（一期无回收站）
 *
 * @param ids 待删除条目 ID 列表；不存在的 ID 静默忽略
 */
export async function deleteIdentities(ids: string[]): Promise<void> {
  try {
    const records = await getAllIdentityRaw();
    const remaining = records.filter(r => !ids.includes(r.id));
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: remaining });
  } catch (error) {
    logger.error('删除身份信息失败:', error);
    throw error;
  }
}

/**
 * 用新密钥重加密全部身份条目（供 changeMasterPassword 调用）
 *
 * 解密失败的单条记录**原样携带**（不清空、不丢弃），并记录告警——
 * 与 getAllIdentity「跳过但不回写」口径一致，保证 rekey 不丢任何数据。
 *
 * @param raw 原始密文记录列表
 * @param oldKey 旧数据密钥（hex）
 * @param newKey 新数据密钥（hex）
 * @returns 全部记录（成功者已换新钥，失败者保持旧密文原样）
 */
export async function reencryptAll(raw: IdentityRecord[], oldKey: string, newKey: string): Promise<IdentityRecord[]> {
  const enc = await _getEncryption();
  // 条目级并行（与 changeMasterPassword 的密码/回收站/历史三段同口径）：
  // 顺序与入参一致，单条失败仍「原样携带」，只是串行 await 的 ~2× 固定开销被批内并发摊掉。
  return mapWithConcurrency(raw, async record => {
    try {
      const json = await enc.decryptData(record.encryptedPayload, oldKey);
      const payload = JSON.parse(json) as IdentityPayload;
      return {
        ...record,
        encryptedPayload: await enc.encryptData(JSON.stringify(payload), newKey),
      };
    } catch {
      logger.warn('跳过无法重加密的身份条目（原样保留）: ' + record.id);
      return record;
    }
  });
}

/**
 * 整体替换身份条目（供导入合并使用）
 *
 * 命名对标 trashManager 的 getAllTrashRaw / replaceAllTrash 惯例。
 *
 * @param records 完整记录列表
 */
export async function replaceAllIdentityRaw(records: IdentityRecord[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: records });
  } catch (error) {
    logger.error('替换身份信息列表失败:', error);
    throw error;
  }
}

/**
 * 用会话密钥整体加密并替换身份条目（供导入合并写回）
 *
 * `mergeIdentityRecords` 产出的是**明文**记录列表（无 encryptedPayload），
 * 须在此统一加密为 encryptedPayload blob 后落盘（并发令牌由导入流
 * 上游保证）。入参只要求 id/createTime/updateTime/payload 四个键，
 * `IdentityEntry` 与 `IdentityBackupRecord` 均可直接传入。
 * 无有效会话且未提供主密码时抛错，绝不退回明文。
 *
 * **不丢弃不变量（镜像 reencryptAll「原样携带」）**：调用方传入的是**可解密**的明文列表，
 * 磁盘上可能另有 `getAllIdentity` 因解密失败而跳过、或并发期间其他窗口新增、因而未出现在
 * 该列表中的原始密文记录。写回前以时刻 `getAllIdentityRaw()` 为基，凡 id 不在入参列表中的
 * 原始记录一律**原样保留**（其密文不动），避免整体覆盖把这些记录静默删除；id 命中入参者以
 * 入参（新明文重加密）为准。读失败在任何写入发生前上抛（fail-closed）。
 *
 * @param entries 合并后的明文条目列表
 * @param masterPassword 锁定态显式传入；会话有效时省略
 */
export async function replaceAllIdentity(
  entries: Array<Pick<IdentityRecord, 'id' | 'createTime' | 'updateTime'> & { payload: IdentityPayload }>,
  masterPassword?: string,
): Promise<void> {
  const key = await resolveDataKey(masterPassword);
  if (!key) {
    throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
  }
  const enc = await _getEncryption();

  const existingRaw = await getAllIdentityRaw();
  const incomingIds = new Set(entries.map(entry => entry.id));
  const preserved = existingRaw.filter(record => !incomingIds.has(record.id));

  const reencrypted: IdentityRecord[] = [];
  for (const entry of entries) {
    reencrypted.push({
      id: entry.id,
      createTime: entry.createTime,
      updateTime: entry.updateTime,
      encryptedPayload: await enc.encryptData(JSON.stringify(entry.payload), key),
    });
  }
  await replaceAllIdentityRaw([...reencrypted, ...preserved]);
}

// ==================== 列表偏好（非 PII，明文单键） ====================

/**
 * 读取身份库列表排序档位
 *
 * 住在身份存储层而不是 `configManager`，是产物闭包的硬要求而非风格：`configManager`
 * 落在 sidepanel 首屏 `modulepreload` 闭包内（同一口径见 docs/ARCHITECTURE.md「管理页大 Vault
 * 渲染性能」一节里分页档位拆文件的理由），让它引用身份档位会把只有 Options 消费的判据一起拽进侧边栏预加载。
 *
 * 读失败与非法值一律回落默认档，不向上抛：这是视图偏好，坏值不值得阻断弹窗打开，
 * 也不该把异常透给用户（与 `getVaultPageSize` 同取舍）。
 */
export async function getIdentitySortMode(): Promise<IdentitySortMode> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY_SORT_MODE);
    const mode = result[STORAGE_KEYS.IDENTITY_SORT_MODE];
    return isIdentitySortMode(mode) ? mode : DEFAULT_IDENTITY_SORT_MODE;
  } catch (error) {
    logger.error('获取身份信息排序档位失败:', error);
    return DEFAULT_IDENTITY_SORT_MODE;
  }
}

/**
 * 保存身份库列表排序档位
 *
 * 非法档位忽略写入并告警（照 `saveVaultPageSize` 的取舍）：视图偏好不值得为一次坏写入
 * 向用户报错，但把非法状态落盘会长期影响排序结果。写入本身失败会抛出，由调用方按非致命处理。
 */
export async function saveIdentitySortMode(mode: IdentitySortMode): Promise<void> {
  if (!isIdentitySortMode(mode)) {
    logger.warn('忽略非法的身份信息排序档位写入');
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY_SORT_MODE]: mode });
  } catch (error) {
    logger.error('保存身份信息排序档位失败:', error);
    throw error;
  }
}
