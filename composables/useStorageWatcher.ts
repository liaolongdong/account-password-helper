import { onMounted, onUnmounted, type Ref } from 'vue';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS, adoptRekeyedSession } from '@/utils/sessionManager-storage';
import { logger } from '@/utils/logger';

/**
 * 需要重跑认证判定的 storage key 集合。
 * 外部（如 DevTools）清空或变更这些 key 时，需要同步重新评估主密码/会话状态。
 */
const AUTH_RELATED_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.MASTER_PASSWORD,
  STORAGE_KEYS.PASSWORDS,
  SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
  // 保留旧版键：兼容升级迁移期及 DevTools 手动清除场景
  SESSION_STORAGE_KEYS.MASTER_PASSWORD,
  SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
  SESSION_STORAGE_KEYS.VALIDITY_HOURS,
]);

/**
 * Storage 与可见性变化监听 Composable
 *
 * 封装 chrome.storage.onChanged 和 document.visibilitychange 监听逻辑，
 * 在认证相关 key 变动时触发认证检查，在密码数据变化时触发列表刷新，
 * 并在页面重新可见时触发认证状态检查。
 *
 * @param options.onAuthChange - 认证相关 storage 变化时的回调
 * @param options.onPasswordDataChange - 密码数据变化时的回调
 * @param options.skipIf - 当此 Ref 为 true 时，跳过 onPasswordDataChange 回调
 *   （用于本地操作标志位，避免 storage watcher 覆盖 Vue 层就地更新）
 * @param options.consumeSkip - 跳过一次密码变更后解除 skipIf 标志的回调（可选）。
 *   本地写入的 `onChanged` 到达时刻不可预测（大列表重渲染会把它推后数十毫秒以上），
 *   因此守卫必须由「事件确实被跳过」来解除，而不是由固定宏任务解除。
 * @param options.patchMetadataOnly - 外部写入的零解密快路径（可选）。收到
 *   `account_passwords` 变更且未被本地守卫吞掉时，先交给它尝试就地修补列表：
 *   返回 true 表示列表已与 storage 一致，本次不再请求整表重载；返回 false
 *   或抛错一律按「未修补」处理，回退 `onPasswordDataChange`。
 */
export function useStorageWatcher(options: {
  /** 认证相关 storage 变化时的回调 */
  onAuthChange: () => void;
  /** 密码数据变化时的回调 */
  onPasswordDataChange: () => void;
  /** 当值为 true 时跳过 onPasswordDataChange，避免本地操作触发全量重载 */
  skipIf?: Ref<boolean>;
  /** 消费一次跳过（解除本地操作守卫），与 skipIf 配套使用 */
  consumeSkip?: () => void;
  /** 仅元数据变更时就地修补列表；返回 true 表示无需整表重载 */
  patchMetadataOnly?: (change: chrome.storage.StorageChange) => Promise<boolean> | boolean;
}) {
  const { onAuthChange, onPasswordDataChange, skipIf, consumeSkip, patchMetadataOnly } = options;

  /** chrome.storage 变化监听 */
  const handleStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== 'local') return;
    const hasAuthChange = Object.keys(changes).some(key => AUTH_RELATED_STORAGE_KEYS.has(key));
    if (!hasAuthChange) return;
    // rekey 自愈：包裹数据密钥被更新（修改主密码/重新登录）且 newValue 存在时，
    // 失效本上下文旧数据密钥热缓存，确保后续 loadPasswords 用新密钥解密。
    // 删除语义（newValue === undefined，锁定流程）不触发，避免干扰竞态防护。
    const wrappedKeyChange = changes[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY];
    if (wrappedKeyChange?.newValue !== undefined) {
      adoptRekeyedSession(
        wrappedKeyChange.newValue as string,
        changes[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]?.newValue as number | undefined,
        changes[SESSION_STORAGE_KEYS.VALIDITY_HOURS]?.newValue as number | undefined,
      );
    }
    logger.debug('StorageWatcher: 检测到认证相关 storage 变动，重新检查认证状态');
    onAuthChange();
    // 密码数据变化时，重新加载密码列表
    // 若 skipIf 标志为 true（本地操作进行中），跳过重载，因为 Vue 层已就地更新状态
    if (STORAGE_KEYS.PASSWORDS in changes) {
      if (skipIf?.value) {
        logger.debug('StorageWatcher: 本地操作进行中，跳过密码列表重载');
        // 本次跳过即本次本地写入的变更事件：就地解除守卫，后续外部写入不再被吞掉
        consumeSkip?.();
        return;
      }
      logger.debug('StorageWatcher: 检测到密码数据变动，重新加载密码列表');
      if (patchMetadataOnly) {
        // 外部写入的零解密快路径：判据与修补由列表所有者执行，命中即免掉一次
        // 整表解密重载（issue #89 数据层报告 P0-3：N=2000 时那次重载是 5N 次 AES）。
        // 修补本身可能是异步的，故把「是否仍需重载」的判定放进微任务，事件顺序不变。
        const passwordsChange = changes[STORAGE_KEYS.PASSWORDS];
        void (async () => {
          try {
            if (await patchMetadataOnly(passwordsChange)) {
              logger.debug('StorageWatcher: 仅元数据变更已就地修补，跳过整表重载');
              return;
            }
          } catch (error) {
            logger.error('StorageWatcher: 元数据就地修补失败，回退整表重载:', error);
          }
          onPasswordDataChange();
        })();
        return;
      }
      onPasswordDataChange();
    }
  };

  /** 可见性变化监听：页面重新可见时重跑认证检查 */
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    logger.debug('StorageWatcher: 页面重新可见，重新检查认证状态');
    onAuthChange();
  };

  onMounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChanged);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onUnmounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(handleStorageChanged);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
}
