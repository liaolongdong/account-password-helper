import { ref, computed, watch, onUnmounted, type Ref } from 'vue';
import { generateTOTP, getTotpRemaining, parseOtpAuth, isValidTotpInput } from '@/utils/totp';
import { logger } from '@/utils/logger';

/**
 * 全局共享的每秒时钟
 *
 * 所有 useTotp 实例共用同一个 setInterval，避免长列表中每个条目各自计时导致的
 * 定时器泛滥；无订阅者时自动停止。
 */
const sharedNow = ref(Date.now());
let sharedTimer: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

/** 订阅共享时钟（首个订阅者启动定时器） */
function subscribeTick(): void {
  subscriberCount++;
  if (!sharedTimer) {
    sharedTimer = setInterval(() => {
      sharedNow.value = Date.now();
    }, 1000);
  }
}

/** 取消订阅共享时钟（无订阅者时停止定时器） */
function unsubscribeTick(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0 && sharedTimer) {
    clearInterval(sharedTimer);
    sharedTimer = null;
  }
}

/** useTotp 返回的响应式状态 */
export interface UseTotpReturn {
  /** 当前动态验证码（无效时为空字符串） */
  code: Ref<string>;
  /** 密钥是否有效 */
  valid: Ref<boolean>;
  /** 距离下次刷新的剩余秒数 */
  remaining: Ref<number>;
  /** 时间步长（秒） */
  period: Ref<number>;
  /** 当前周期进度（1 → 0，用于环形倒计时） */
  progress: Ref<number>;
}

/**
 * TOTP 动态码响应式 Composable
 *
 * 传入密钥引用，产出随时间自动刷新的动态码与倒计时。仅在周期切换时才重新计算码，
 * 每秒仅更新倒计时，性能开销极低。组件卸载时自动注销共享时钟订阅。
 *
 * @param secret 密钥引用（otpauth URI 或裸 Base32 密钥）
 * @returns 响应式的 code / valid / remaining / period / progress
 */
export function useTotp(secret: Ref<string | undefined>): UseTotpReturn {
  const code = ref('');
  const valid = ref(false);
  const period = ref(30);
  const remaining = ref(30);
  const progress = computed(() => (period.value > 0 ? remaining.value / period.value : 0));

  /** 上次计算码时的时间计数器，用于判断是否需要重算 */
  let lastCounter = -1;

  /**
   * 重新计算动态码与倒计时
   * @param force 强制重算码（密钥变更时使用）
   */
  const recompute = async (force = false): Promise<void> => {
    const input = (secret.value || '').trim();

    const params = input ? parseOtpAuth(input) : null;
    // 无效密钥（无法解析或解码为空）：清空展示，防御性 early-return 替代非空断言
    if (!params || !isValidTotpInput(input)) {
      valid.value = false;
      code.value = '';
      lastCounter = -1;
      return;
    }

    valid.value = true;
    period.value = params.period;

    const now = sharedNow.value;
    remaining.value = getTotpRemaining(params.period, now);

    const counter = Math.floor(now / 1000 / params.period);
    if (force || counter !== lastCounter) {
      lastCounter = counter;
      try {
        code.value = await generateTOTP(input, now);
      } catch (error) {
        logger.error('生成 TOTP 动态码失败:', error);
        valid.value = false;
        code.value = '';
      }
    }
  };

  // 每秒 tick：更新倒计时，周期切换时重算码
  watch(sharedNow, () => void recompute());
  // 密钥变更：立即强制重算
  watch(secret, () => void recompute(true), { immediate: true });

  subscribeTick();
  onUnmounted(() => unsubscribeTick());

  return { code, valid, remaining, period, progress };
}
