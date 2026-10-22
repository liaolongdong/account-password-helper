import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry, PasswordHistoryRecord } from '@/utils/types';
import { logger } from '@/utils/logger';
import { mapWithConcurrency } from '@/utils/concurrency';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { verifyMasterPassword } from './masterPassword';
import { getAllPasswordsRaw } from './passwordCrud';
import { getAllTrashRaw } from './trashManager';
import { getAllHistoryRaw } from './passwordHistory';
import { getAllIdentityRaw, reencryptAll } from './identityCrud';
import { getAllIdentityTrashRaw } from './identityTrashManager';
import { lazyImport } from '@/utils/lazyImport';
import type { MasterPasswordConfig } from '@/utils/types';

/**
 * 延迟加载加密模块
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/**
 * 延迟加载会话管理模块
 */
const _getSessionManager = lazyImport(() => import('@/utils/sessionManager-storage'));

/**
 * 快照与盘上是否已不一致（只比顺序与身份键，不比密文内容）
 *
 * 供 rekey 在整数组覆写前复验：五个数据域的所有写路径都保序（追加或 filter），
 * 因此长度或同下标的身份键发生变化，就是「快照在重加密期间被并发写过期」的信号。
 *
 * **这套键只抓得到一部分并发写，别把它当成全部**：它抓得到增删、重排、条目编辑
 * （推高 `updateTime`）与回收站重进站（改 `deletedAt`）；抓不到的是收藏 / 备注这类
 * **刻意传入原 `updateTime`** 的元数据写（见 `passwordCrud.updatePassword` 的注释——
 * 收藏不该把条目顶到列表前部），内容变了而键没变，第 11 步的整数组覆写照样会把它抹掉。
 * 要补全这一半，要么给元数据写另设一个明文可比较的版本号，要么把那五个域的覆写改成
 * 按 id 的增量合并；两条都比本轮的「先止住最坏那种（记录凭空消失 / 已删 PII 复活）」更贵，
 * 因此如实记在这儿，不当作已解决。
 *
 * @param snapshot 步骤 3 读到的快照
 * @param fresh 覆写前重读到的当前值
 * @param keyOf 该域的身份键，须能区分同下标上的增删与内容编辑（回收站两域带 `deletedAt`）
 */
function isSnapshotStale<T>(snapshot: T[], fresh: T[], keyOf: (item: T) => string): boolean {
  if (snapshot.length !== fresh.length) return true;
  for (let i = 0; i < snapshot.length; i++) {
    if (keyOf(snapshot[i]) !== keyOf(fresh[i])) return true;
  }
  return false;
}

/**
 * 修改主密码（Rekey）
 *
 * 核心编排流程：验证旧密码 → 解密全部数据 → 用新密码重新加密 → 准备新会话密钥 → 原子写入。
 *
 * 安全保证：
 * - 步骤 1-9 任意失败直接抛出，storage 未被写入，数据安全无损
 * - 旧钥解不开的单条历史记录原样保留（仍为旧钥密文），rekey 不删除任何用户数据
 * - 步骤 11 使用单次 `chrome.storage.local.set()` 将数据密文与新会话密钥原子写入，
 *   不存在「新密文 + 旧会话密钥」的中间状态
 * - 步骤 10.5 在整数组覆写前复验五个域的快照：重加密那几秒里另一张管理页标签若写过
 *   回收站/条目，本次立即中止并清会话（`code: 'REKEY_CONCURRENT_WRITE'`），
 *   不用过期快照覆盖那条写入，也不让已彻底删除或已过期的 PII 在新密钥下复活
 * - 加密备份文件（.aph）不受影响：导入时使用导出时的密码解密，与当前主密码无关
 *
 * @param oldPassword 当前主密码（明文）
 * @param newPassword 新主密码（明文）
 * @throws 旧密码验证失败或 rekey 过程中任何错误
 */
export async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<void> {
  // 口令归一化唯一入口：必须与 setMasterPassword / verifyMasterPassword 的 trim 口径一致。
  // 若此处不 trim，落盘的校验值由「带空格的密码」派生，而解锁时输入会被 trim，
  // 二者永远比对不上 —— 全库锁死。
  const oldPw = String(oldPassword || '').trim();
  const newPw = String(newPassword || '').trim();
  if (!newPw) {
    throw Object.assign(new Error('密码不能为空'), { code: 'EMPTY_PASSWORD' });
  }

  // 1. 验证旧密码
  const isValid = await verifyMasterPassword(oldPw);
  if (!isValid) {
    throw Object.assign(new Error('当前密码验证失败'), { code: 'WRONG_PASSWORD' });
  }

  const enc = await _getEncryption();

  // 2. 派生旧数据密钥
  const oldKey = await enc.deriveEncryptionKey(oldPw);

  // 3. 读取三块密文数据（身份库主列表与身份回收站为第 4、5 个加密域，读取置于任何写入之前，
  //    故读取失败会在任何写入发生前中止整次 rekey）
  const rawPasswords = await getAllPasswordsRaw();
  const rawTrash = await getAllTrashRaw();
  const rawHistory = await getAllHistoryRaw();
  const identityRaw = await getAllIdentityRaw();
  // 身份回收站必须同批纳入 rekey：漏掉它会让软删除条目在换钥后永久不可解、
  // 更不可恢复（PII 唯一「可找回通道」被静默销毁），与主列表漏 rekey 同等致命
  const identityTrashRaw = await getAllIdentityTrashRaw();

  // 4. 用旧密钥解密 passwords
  // 条目级并行（批内 64）：结果顺序与 rawPasswords 一致；单条解密失败仍按原样向上抛出，
  // 由步骤 1-9「任意失败直接抛出、storage 未被写入」的安全保证兜底。
  const decryptedPasswords = await mapWithConcurrency(rawPasswords, async entry =>
    'encrypted' in entry && entry.encrypted === true
      ? enc.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey)
      : (entry as PasswordEntry),
  );

  // 5. 用旧密钥解密 trash
  const decryptedTrash: (TrashedPasswordEntry & { _plainFields?: PasswordEntry })[] = await mapWithConcurrency(
    rawTrash,
    async entry => {
      if ('encrypted' in entry && entry.encrypted === true) {
        const plain = await enc.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey);
        return { ...plain, deletedAt: entry.deletedAt } as TrashedPasswordEntry;
      }
      return entry;
    },
  );

  // 6. 用旧密钥解密 history 中的密码字段
  // 解不开的记录原样保留（仍为旧钥密文），不参与重加密：rekey 不得顺带删除用户数据，
  // 与 identityCrud.reencryptAll「失败者原样携带」及 getAllHistory「跳过但不回写」同口径。
  // 消费侧（详情抽屉 / 编辑弹窗）本就以「解密失败」提示处理这类记录。
  // 并行后仍按输入下标回填两个数组，顺序与串行版本逐字一致（可解项保持原序，不可解项整体置于末尾）。
  const historyOutcomes = await mapWithConcurrency(rawHistory, async record => {
    try {
      return { plainPassword: await enc.decryptData(record.password, oldKey) };
    } catch {
      logger.warn(`历史记录无法用旧密钥解密，已原样保留（不参与 rekey）: entryId=${record.entryId}`);
      return null;
    }
  });
  const decryptedHistory: PasswordHistoryRecord[] = [];
  const unrecoverableHistory: PasswordHistoryRecord[] = [];
  historyOutcomes.forEach((outcome, i) => {
    if (outcome) decryptedHistory.push({ ...rawHistory[i], password: outcome.plainPassword });
    else unrecoverableHistory.push(rawHistory[i]);
  });

  // 7. 派生新数据密钥
  const newKey = await enc.deriveEncryptionKey(newPw);

  // 8. 用新密钥重新加密所有数据（条目级并行，输出顺序与解密结果一致）
  const reEncryptedPasswords = await mapWithConcurrency(decryptedPasswords, entry =>
    enc.encryptPasswordEntry(entry, '', newKey),
  );

  const reEncryptedTrash = await mapWithConcurrency(decryptedTrash, async entry => {
    const { deletedAt, ...plainEntry } = entry as any;
    const encrypted = await enc.encryptPasswordEntry(plainEntry as PasswordEntry, '', newKey);
    return { ...encrypted, deletedAt } as TrashedPasswordEntry;
  });

  const reEncryptedHistory = await mapWithConcurrency(decryptedHistory, async record => ({
    ...record,
    password: await enc.encryptData(record.password, newKey),
  }));
  // 不可解记录置于末尾原样落盘（数组顺序对消费侧无意义：读取按 changedAt 排序，
  // 截断亦按 changedAt 计算），保证 rekey 前后记录条数严格不变
  reEncryptedHistory.push(...unrecoverableHistory);

  const reEncryptedIdentity = await reencryptAll(identityRaw, oldKey, newKey);
  // 回收站同走 reencryptAll（单条失败原样携带）；`reencryptAll` 成功分支会把记录
  // 归一化为四个标准键，因此换钥后必须按输入顺序回填 `deletedAt`——TTL 与剩余天数
  // 读数都读这个明文键，漏回填会让到期清理把换钥前的回收站条目当成永不到期的驻留数据。
  const reEncryptedIdentityTrashRaw = await reencryptAll(identityTrashRaw, oldKey, newKey);
  const reEncryptedIdentityTrash = reEncryptedIdentityTrashRaw.map((record, i) => ({
    ...record,
    deletedAt: identityTrashRaw[i].deletedAt,
  }));

  // 9. 生成新的校验哈希（保留原 salt！）
  // 注意：deriveEncryptionKey 内部从 storage 读取 salt 来派生数据密钥，
  // 若此处替换为新 salt，则后续解密时会派生出不同的密钥，导致数据永久不可解密。
  // salt 的安全作用是防彩虹表，更换密码本身已提供足够安全性，无需更新 salt。
  const masterPwResult = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
  const existingConfig = masterPwResult[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;
  const existingSalt = existingConfig.salt;
  const newVerifierHash = await enc.deriveVerifierHash(newPw, existingSalt);

  // 10. 准备新会话密钥材料（rekey）
  // salt 未变，步骤 7 派生的 newKey 即新会话数据密钥；prepareSessionRekey 会同步
  // 更新本上下文内存镜像与 storage.session，并返回需一并原子落盘的会话键值对。
  const sessionResult = await chrome.storage.local.get(SESSION_STORAGE_KEYS.VALIDITY_HOURS);
  const validityHours = (sessionResult[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
  const sessionManager = await _getSessionManager();
  const sessionKeysToWrite = await sessionManager.prepareSessionRekey(newKey, validityHours);

  // 10.5 覆写前的快照复验。
  // 步骤 3 的快照与步骤 11 的落盘之间隔着整库重加密（2000 条量级要跑几秒），
  // 而 Chrome 允许开两个管理页标签：另一页在这几秒里删/恢复/彻底写回收站或改条目时，
  // 步骤 11 的**整数组覆写**会把那条写入连根抹掉（两侧皆无，不可恢复），
  // 或让已彻底删除/已过期的 PII 在新密钥下复活——直接打掉回收站的 30 天承诺。
  // 只比「顺序 + 身份键」不比密文：所有写路径都保序（追加或 filter），顺序或键一变
  // 即说明快照过期。宁可让用户重跑一次，也不带过期快照落盘。
  const [freshPasswords, freshTrash, freshHistory, freshIdentity, freshIdentityTrash] = await Promise.all([
    getAllPasswordsRaw(),
    getAllTrashRaw(),
    getAllHistoryRaw(),
    getAllIdentityRaw(),
    getAllIdentityTrashRaw(),
  ]);
  if (
    isSnapshotStale(rawPasswords, freshPasswords, entry => `${entry.id}:${entry.updateTime}`) ||
    isSnapshotStale(rawTrash, freshTrash, entry => `${entry.id}:${entry.deletedAt}`) ||
    isSnapshotStale(rawHistory, freshHistory, record => `${record.entryId}:${record.changedAt}`) ||
    isSnapshotStale(identityRaw, freshIdentity, record => `${record.id}:${record.updateTime}`) ||
    isSnapshotStale(identityTrashRaw, freshIdentityTrash, record => `${record.id}:${record.deletedAt}`)
  ) {
    // 与步骤 11 写失败同一处置：步骤 10 已把会话密钥材料换成新值，
    // 不清会话就会留下「新密钥 + 旧密文」的不一致状态
    await sessionManager.clearSession().catch(() => {});
    throw Object.assign(new Error('检测到其他页面的改动刚刚写入，本次修改已安全取消，请重试'), {
      code: 'REKEY_CONCURRENT_WRITE',
    });
  }

  // 11. 原子写入：数据密文 + 校验哈希 + 新会话密钥单次 chrome.storage.local.set()，
  // 全成功或全失败，消除「新密文已落盘、会话密钥仍是旧值」的竞态窗口
  // （各上下文的 storage 监听器会用旧密钥解密新密文全部失败，导致列表被清空）
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: reEncryptedPasswords,
      [STORAGE_KEYS.TRASH]: reEncryptedTrash,
      [STORAGE_KEYS.PASSWORD_HISTORY]: reEncryptedHistory,
      [STORAGE_KEYS.IDENTITY]: reEncryptedIdentity,
      [STORAGE_KEYS.IDENTITY_TRASH]: reEncryptedIdentityTrash,
      [STORAGE_KEYS.MASTER_PASSWORD]: {
        hashedPassword: newVerifierHash,
        salt: existingSalt,
        kdf: 'pbkdf2-sha256' as const,
      },
      ...sessionKeysToWrite,
    });
  } catch (error) {
    // 写入失败时数据仍为旧密文，但会话密钥材料（内存/storage.session）已更新为新值，
    // 主动清除会话强制重新验证，避免「新密钥 + 旧密文」的不一致状态
    await sessionManager.clearSession().catch(() => {});
    throw error;
  }

  // 12. 清理旧版遗留的主密码密文（若存在），与 createSession 的清理行为保持一致
  await chrome.storage.local.remove(SESSION_STORAGE_KEYS.MASTER_PASSWORD);

  logger.info('主密码修改成功，所有数据已重新加密');
}
