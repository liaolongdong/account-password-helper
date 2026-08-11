import { ref, onScopeDispose } from 'vue';
import { t } from '@/utils/i18n';
import { lazyImport } from '@/utils/lazyImport';

/**
 * 延迟加载会话过期时间读取函数
 *
 * getSessionExpiryTime 位于 sessionManager-storage（模块体积较大），
 * 经 lazyImport 动态加载避免静态引入方（如侧边栏头部主 chunk）首屏体积膨胀；
 * 其内部仅内存镜像优先 + storage.local 只读兜底，不触碰加密链。
 */
const getSessionExpiryTime = lazyImport(() =>
  import('@/utils/sessionManager-storage').then(m => m.getSessionExpiryTime),
);

/** 剩余时间进入紧迫态的阈值（10 分钟内提醒用户续期） */
export const SESSION_URGENT_THRESHOLD_MS = 10 * 60 * 1000;

/** 剩余时间进入危急态的阈值（最后 1 分钟，最强警示信号） */
export const SESSION_CRITICAL_THRESHOLD_MS = 60 * 1000;

/**
 * 会话剩余时间紧凑格式化（复用 session.* 文案）
 *
 * 与 useSessionTimer 共用同一套展示规则：天/时/分/秒逐级降档。
 * @param expiryTime 会话过期时间戳（毫秒）
 * @returns 格式化后的剩余时间文本；已过期返回过期文案
 */
export function formatSessionRemaining(expiryTime: number): string {
  const remaining = expiryTime - Date.now();
  if (remaining <= 0) {
    return t('session.expired');
  }
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
  if (days > 0) {
    return t('session.dayHour', { days, hours });
  }
  if (hours > 0) {
    return t('session.hourMinute', { hours, minutes });
  }
  if (minutes > 0) {
    return t('session.minuteSecond', { minutes, seconds });
  }
  return t('session.second', { seconds });
}

/**
 * 轻量会话倒计时 Composable
 *
 * 供一级界面（options 头部徽标 / 侧边栏头部 / Popup 会话状态区）常驻展示
 * 会话剩余时间；与 useSessionTimer（有效期设置弹窗专用）职责分离：
 * - 每秒一次读取过期时间（内存镜像优先，成本可忽略），会话续期/清除后自动跟随；
 * - 无会话时 remainingText 为空串，由消费方决定隐藏；
 * - 剩余 10 分钟内 isUrgent 置真，供消费方切换警示样式；
 * - 剩余 1 分钟内 isCritical 置真（此时 isUrgent 亦为真），供消费方叠加危急样式。
 *
 * 生命周期由调用方显式控制（start/stop），作用域销毁自动停止。
 */
export function useSessionCountdown() {
  /** 剩余时间文本；空串表示无有效会话（消费方应隐藏展示） */
  const remainingText = ref('');
  /** 剩余时间是否进入紧迫态（≤10 分钟） */
  const isUrgent = ref(false);
  /** 剩余时间是否进入危急态（≤1 分钟，必伴随 isUrgent 为真） */
  const isCritical = ref(false);

  let timer: number | null = null;
  let disposed = false;

  /** 拉取最新过期时间并刷新展示状态（tick 与启动共用） */
  const refresh = async () => {
    try {
      const getExpiry = await getSessionExpiryTime();
      const expiryTime = await getExpiry();
      if (disposed) return;
      if (!expiryTime) {
        remainingText.value = '';
        isUrgent.value = false;
        isCritical.value = false;
        return;
      }
      remainingText.value = formatSessionRemaining(expiryTime);
      const remaining = expiryTime - Date.now();
      isUrgent.value = remaining > 0 && remaining <= SESSION_URGENT_THRESHOLD_MS;
      isCritical.value = remaining > 0 && remaining <= SESSION_CRITICAL_THRESHOLD_MS;
    } catch {
      // 读取失败保持上次展示，下一秒自动重试
    }
  };

  /** 启动倒计时（幂等） */
  const start = () => {
    if (timer !== null) return;
    void refresh();
    timer = window.setInterval(() => void refresh(), 1000);
  };

  /** 停止倒计时（幂等）：同步清空展示状态，避免锁屏/会话失效后残留冻结的剩余时间 */
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    remainingText.value = '';
    isUrgent.value = false;
    isCritical.value = false;
  };

  onScopeDispose(() => {
    disposed = true;
    stop();
  });

  return { remainingText, isUrgent, isCritical, start, stop };
}
