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
 * 例外于「整块加密」的只有列表偏好两样：排序档位（`IDENTITY_SORT_MODE`，五值枚举）与
 * 手排序号数组（`IDENTITY_MANUAL_ORDER`，明文 `string[]`）。它们要么是枚举、要么是
 * `generateId()` 产出的随机 id，不含任何 PII，也没有进密文的必要——把它塞进每条 payload
 * 反而要整库重加密。
 */
import type { IdentityEntry, IdentityPayload, IdentityRecord, IdentitySortMode } from '@/utils/identity/types';
import { DEFAULT_IDENTITY_SORT_MODE, MAX_IDENTITIES, isIdentitySortMode } from '@/utils/identity/constants';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { generateId } from '@/utils/generateId';
import { mapWithConcurrency } from '@/utils/concurrency';
import { lazyImport } from '@/utils/lazyImport';
import { getSessionDataKey } from './facades';
import { moveIdentitiesToTrash } from './identityTrashManager';
import { withVaultCommit, withVaultMutation } from './vaultWriteLock';
import { verifyMasterPassword } from './masterPassword';

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
async function resolveDataKey(masterPassword?: string, forMutation = false): Promise<string | null> {
  if (masterPassword) {
    // lease 内校验当前配置，不能将换钥前验证过的主密码用于新的写入。
    if (forMutation && !(await verifyMasterPassword(masterPassword))) return null;
    const enc = await _getEncryption();
    return enc.deriveEncryptionKey(masterPassword);
  }
  return forMutation ? getSessionDataKey(true) : getSessionDataKey();
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
 * 落盘前重读 + 合并 + 单次 set，整段在跨上下文提交锁内完成。
 *
 * **调用前必须已经算好要落盘的密文**：`aph-vault-commit` 是全仓唯一一把排他提交锁，密码库、
 * 身份库、两个回收站共用它。把 PBKDF2 派生（600k 迭代 ×2，秒级）或整批逐条加密放进锁内，
 * 会让另一个上下文的「保存密码」无声排队——两库键位互不冲突，却被同一把锁串起，而
 * `navigator.locks` 的等待没有超时。密码域的 `commitPasswordRows` 一直是这个口径，此处对齐。
 *
 * @param mutate 收到最新列表，返回要落盘的列表；返回 `null` 表示本次不写。允许异步——
 *   但异步里只许做「一对 AES-GCM」级别的每条目即时加解密，密钥派生与批量重加密必须在外面算完。
 */
async function commitIdentityRows(
  mutate: (fresh: IdentityRecord[]) => IdentityRecord[] | null | Promise<IdentityRecord[] | null>,
): Promise<void> {
  await withVaultCommit(async () => {
    const fresh = await getAllIdentityRaw();
    const next = await mutate(fresh);
    if (next === null) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: next });
  });
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
  return withVaultMutation(() => saveIdentityInternal(payload, masterPassword));
}

async function saveIdentityInternal(payload: IdentityPayload, masterPassword?: string): Promise<IdentityEntry> {
  try {
    // 锁外预读只为保住错误优先级：达到上限必须先报 LIMIT_REACHED，而不是先报密钥不可用。
    // 权威的容量判定由 commitIdentityRows 对着落盘前的最新快照再做一次。
    const preview = await getAllIdentityRaw();
    if (preview.length >= MAX_IDENTITIES) {
      throw identityCrudError('LIMIT_REACHED', `身份信息条目已达上限（${MAX_IDENTITIES} 条）`);
    }

    const key = await resolveDataKey(masterPassword, true);
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

    await commitIdentityRows(fresh => {
      if (fresh.length >= MAX_IDENTITIES) {
        throw identityCrudError('LIMIT_REACHED', `身份信息条目已达上限（${MAX_IDENTITIES} 条）`);
      }
      return [...fresh, record];
    });

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
  // 租约内、提交锁外先完成密钥派生，再把「重读 + 令牌复验 + 一条加解密 + set」交给提交锁。
  return withVaultMutation(() => updateIdentityInternal(id, patch, expectedUpdateTime, masterPassword));
}

async function updateIdentityInternal(
  id: string,
  patch: Partial<IdentityPayload>,
  expectedUpdateTime: number,
  masterPassword?: string,
): Promise<void> {
  try {
    // 锁外预读只为保住错误优先级：条目缺失/令牌过期必须先于「密钥不可用」报出，
    // 否则锁定态编辑一条已被别的窗口删掉的记录时，用户会看到一句与实情无关的密钥错误。
    const preview = await getAllIdentityRaw();
    const previewIndex = preview.findIndex(r => r.id === id);
    if (previewIndex === -1) {
      throw identityCrudError('NOT_FOUND', '该身份信息已被删除，请刷新后重试');
    }
    if (preview[previewIndex].updateTime !== expectedUpdateTime) {
      throw identityCrudError('UPDATE_CONFLICT', '该身份信息已被其他窗口修改，请刷新后重试');
    }

    const key = await resolveDataKey(masterPassword, true);
    if (!key) {
      throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
    }
    const enc = await _getEncryption();

    // 权威判定在提交锁内对着最新快照重做一遍；这里留在锁内的只有一对 AES-GCM（亚毫秒），
    // 密钥派生已经挪到锁外——它才是把其它数据域一起拖住的那一段。
    await commitIdentityRows(async fresh => {
      const index = fresh.findIndex(r => r.id === id);
      if (index === -1) {
        throw identityCrudError('NOT_FOUND', '该身份信息已被删除，请刷新后重试');
      }
      const current = fresh[index];
      if (current.updateTime !== expectedUpdateTime) {
        throw identityCrudError('UPDATE_CONFLICT', '该身份信息已被其他窗口修改，请刷新后重试');
      }

      const json = await enc.decryptData(current.encryptedPayload, key);
      const existingPayload = JSON.parse(json) as IdentityPayload;
      const nextPayload = { ...existingPayload, ...patch, pv: 1 } as IdentityPayload;

      const next = [...fresh];
      next[index] = {
        ...current,
        encryptedPayload: await enc.encryptData(JSON.stringify(nextPayload), key),
        updateTime: Date.now(),
      };
      return next;
    });
  } catch (error) {
    logger.error('更新身份信息失败:', error);
    throw error;
  }
}

/**
 * 删除身份条目（软删除：移入回收站，30 天内可恢复）
 *
 * 命名保持不变（调用方零改动），语义由「硬删除」升级为与密码库同口径的软删除：
 * 实际搬迁由 `identityTrashManager.moveIdentitiesToTrash` 原子双写完成。
 *
 * @param ids 待移入回收站的条目 ID 列表；不存在的 ID 静默忽略
 */
export async function deleteIdentities(ids: string[]): Promise<void> {
  await moveIdentitiesToTrash(ids);
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
export async function reencryptAll(
  raw: IdentityRecord[],
  oldKey: string,
  newKey: string,
  onFailure?: (record: IdentityRecord) => void,
): Promise<IdentityRecord[]> {
  const enc = await _getEncryption();
  // 条目级并行（与 changeMasterPassword 的密码/回收站/历史三段同口径）：
  // 顺序与入参一致，单条失败仍「原样携带」，只是串行 await 的 ~2× 固定开销被批内并发摊掉。
  // `onFailure` 只给换钥编排层数条数用；日志不写 id，避免把条目元数据带进日志。
  return mapWithConcurrency(raw, async record => {
    try {
      const json = await enc.decryptData(record.encryptedPayload, oldKey);
      const payload = JSON.parse(json) as IdentityPayload;
      return {
        ...record,
        encryptedPayload: await enc.encryptData(JSON.stringify(payload), newKey),
      };
    } catch {
      onFailure?.(record);
      logger.warn('跳过无法重加密的身份条目（原样保留）');
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
  return withVaultMutation(() => withVaultCommit(() => replaceAllIdentityRawInternal(records)));
}

async function replaceAllIdentityRawInternal(records: IdentityRecord[]): Promise<void> {
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
 * 本函数把「重读磁盘 → 逐 id 按 updateTime 三方合并 → 容量复核 → 整体写回」收进
 * 同一个提交锁事务，因此调用方传的是**导入文件里的记录**，而不是自己按旧内存快照
 * 预先合并好的列表：
 *
 * - **不丢弃不变量（镜像 reencryptAll「原样携带」）**：磁盘上可能有 `getAllIdentity`
 *   因解密失败而跳过、因而从未出现在明文里的原始密文记录，它们一律原样保留（密文不动），
 *   避免整体覆盖把这些记录静默删除；
 * - **不覆盖并发编辑**：同 id 的三方（磁盘现值 / 入参 / 入参来源的旧快照）以 updateTime
 *   择优，磁盘上比入参更新的记录保留磁盘版本；
 * - **不越容量**：`MAX_IDENTITIES` 按最终落盘条数复核，超限整批拒绝——若按入参条数放行，
 *   并发新增会把结果推过上限，而这份库随后连自己的 `.aphid` 导出都解不开（自己的
 *   parser 判 INVALID_STRUCTURE）。
 *
 * 读失败在任何写入发生前上抛（fail-closed）。
 *
 * @param entries 待合并导入的明文记录（通常为备份文件里的记录）
 * @param masterPassword 锁定态显式传入；会话有效时省略
 */
export async function replaceAllIdentity(
  entries: Array<Pick<IdentityRecord, 'id' | 'createTime' | 'updateTime'> & { payload: IdentityPayload }>,
  masterPassword?: string,
): Promise<void> {
  return withVaultMutation(() => replaceAllIdentityInternal(entries, masterPassword));
}

async function replaceAllIdentityInternal(
  entries: Array<Pick<IdentityRecord, 'id' | 'createTime' | 'updateTime'> & { payload: IdentityPayload }>,
  masterPassword?: string,
): Promise<void> {
  const key = await resolveDataKey(masterPassword, true);
  if (!key) {
    throw new Error('无法获取加密密钥（会话已过期或未验证主密码）');
  }
  const enc = await _getEncryption();
  const existingRaw = await getAllIdentityRaw();

  // 入参按 id 索引；磁盘记录解密一份用于逐 id 择优（解不开的按「原样携带」处理）
  const incomingById = new Map(entries.map(entry => [entry.id, entry]));
  const decryptedExisting = await mapWithConcurrency(existingRaw, async record => {
    try {
      const json = await enc.decryptData(record.encryptedPayload, key);
      return { record, payload: JSON.parse(json) as IdentityPayload };
    } catch {
      return { record, payload: null as IdentityPayload | null };
    }
  });

  const finalById = new Map<
    string,
    Pick<IdentityRecord, 'id' | 'createTime' | 'updateTime'> & { payload: IdentityPayload }
  >();
  const carried: IdentityRecord[] = [];
  for (const { record, payload } of decryptedExisting) {
    const incoming = incomingById.get(record.id);
    if (!incoming) {
      // 磁盘独有：可解的进最终集，解不开的原样携带密文
      if (payload) finalById.set(record.id, { ...record, payload });
      else carried.push(record);
      continue;
    }
    if (payload && incoming.updateTime <= record.updateTime) {
      // 磁盘版本不比入参旧：并发期间别人改过（或本就相同），保留磁盘版本，不用旧快照覆盖
      finalById.set(record.id, { ...record, payload });
      continue;
    }
    if (!payload) {
      // 磁盘密文解不开而入参带同一 id：以入参为准（这正是导入要修复的场景）
      finalById.set(record.id, incoming);
      continue;
    }
    finalById.set(record.id, incoming);
  }
  for (const entry of entries) {
    if (!finalById.has(entry.id)) finalById.set(entry.id, entry);
  }

  const total = finalById.size + carried.length;
  if (total > MAX_IDENTITIES) {
    throw identityCrudError('LIMIT_REACHED', `身份信息条目已达上限（${MAX_IDENTITIES} 条）`);
  }

  // 逐条加密全部发生在提交锁之外：一次导入可达 MAX_IDENTITIES 条，锁内串行加密会把
  // 密码库的整包写一起拖住秒级。
  const merged: IdentityRecord[] = [];
  for (const entry of finalById.values()) {
    merged.push({
      id: entry.id,
      createTime: entry.createTime,
      updateTime: entry.updateTime,
      encryptedPayload: await enc.encryptData(JSON.stringify(entry.payload), key),
    });
  }
  // 本次已经逐个 id 定夺过的行（含磁盘原样携带的解不开者）；其余 id 一律以落盘前重读到的为准，
  // 这样并发期间新建、而我们那次预读里根本没有的条目不会被整包覆写抹掉。
  const decidedIds = new Set([...merged, ...carried].map(record => record.id));
  await commitIdentityRows(fresh => {
    const next = [...merged, ...carried, ...fresh.filter(record => !decidedIds.has(record.id))];
    // 容量以落盘前的最新快照为准再判一次：预读到落盘之间别人可能已经写到上限
    if (next.length > MAX_IDENTITIES) {
      throw identityCrudError('LIMIT_REACHED', `身份信息条目已达上限（${MAX_IDENTITIES} 条）`);
    }
    return next;
  });
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

/**
 * 收窄落盘的手排顺序数组
 *
 * 存储值属不可信输入（历史版本、手改、并发写坏都可能把它变成任意形状）：
 * 非数组、元素非非空字符串、含重复 id、长度超过条目上限（30）一律回落成空数组，
 * 而不是尽力修补——脏数组里的每个位置都不可信，修补出来的顺序会静默决定用户的
 * 手排结果；回落空数组则退化为「未登记 → 全部落末尾 + tieBreak」，列表照常显示。
 *
 * @param value 存储里的原始值
 * @returns 合法时返回新的字符串数组副本，任何非法形状返回空数组
 */
function sanitizeManualOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDENTITIES) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || seen.has(item)) return [];
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

/**
 * 读取身份库 `manual` 档的手排顺序（id 数组）
 *
 * 与排序档位同住身份存储层、同样不得进 `configManager`（侧边栏首屏闭包的硬约束，
 * 理由见 `getIdentitySortMode`）。读的是随机 id 而非密文，因此不需要数据密钥，
 * 会话失效时也能读——但它只对 Options 的列表弹窗有意义。
 *
 * 缺键、脏数据与读失败都回落空数组：手排序号是视图偏好，坏值只意味着「本次按默认
 * 兜底顺序显示」，不该阻断弹窗，也不该把异常透给用户（与 `getIdentitySortMode` 同取舍）。
 */
export async function getIdentityManualOrder(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY_MANUAL_ORDER);
    return sanitizeManualOrder(result[STORAGE_KEYS.IDENTITY_MANUAL_ORDER]);
  } catch (error) {
    logger.error('获取身份信息手动排序失败:', error);
    return [];
  }
}

/**
 * 保存身份库 `manual` 档的手排顺序（明文单键，上限即条目上限 `MAX_IDENTITIES`）
 *
 * 只在用户真的动了顺序（拖拽 / 键盘换位）时被调用，数组由调用方先经
 * `normalizeManualOrder` 剪枝 + 追加对齐过，故这里的形状校验只是第二道闸门：
 * 非法写入忽略并告警、不落盘（照 `saveIdentitySortMode` 的取舍）；写入本身失败会抛出，
 * 由调用方按非致命处理（视图偏好不值得为一次坏写入向用户报错）。
 */
export async function saveIdentityManualOrder(ids: readonly string[]): Promise<void> {
  if (ids.length > MAX_IDENTITIES || ids.some(id => typeof id !== 'string' || id === '')) {
    logger.warn('忽略非法的身份信息手动排序写入');
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY_MANUAL_ORDER]: [...ids] });
  } catch (error) {
    logger.error('保存身份信息手动排序失败:', error);
    throw error;
  }
}
