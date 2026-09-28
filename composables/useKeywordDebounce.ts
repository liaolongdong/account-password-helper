import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { KEYWORD_DEBOUNCE_MS } from '@/utils/keywordMatch';

/**
 * 关键词输入的「即时回显 + 延后过滤」防抖副本
 *
 * 存在的理由：三处列表（管理页密码表、回收站弹窗、侧边栏列表）的过滤都是
 * 「整表重排 + 命中行逐格高亮」，而驱动过滤的关键词与输入框里的字符**不需要**同步——
 * 用户看的是停顿之后的结果，连续击键期间的中间态只贡献成本。
 * 本 composable 把此前散落在 `usePasswordManagement` 与 `TrashDialog` 里逐字相同的
 * 那份 watcher 收成单点：`v-model` 仍绑原始 ref，只有返回的 `debounced` 驱动过滤。
 *
 * 语义与手写实现逐字等价：每次源变化重置计时器、以最后一次的值落地、
 * 作用域销毁时清计时器（避免向已停用作用域赋值）。
 *
 * `flush()` 是防抖唯一的安全阀：键盘回车 / 点击行这类「以当前列表为准」的动作
 * 必须先把未落地的关键词同步进来，否则会出现「字打完了、回车填的还是上一个列表」
 * 这种在慢机器上无法复现、在快机器上偶发的错位。
 */
export interface KeywordDebounced {
  /** 驱动过滤的关键词副本（初始与源相同） */
  debounced: Ref<string>;
  /** 立即落地未生效的关键词（无待处理更新时为零成本赋值） */
  flush: () => void;
}

/**
 * 为关键词源建立防抖副本
 *
 * @param source 输入框即时值（`v-model` 绑定的那个 ref）
 * @param delayMs 延后时长，缺省取共享常量 {@link KEYWORD_DEBOUNCE_MS}
 * @returns 防抖副本与 `flush` 手动落地入口
 */
export function useKeywordDebounce(source: Ref<string>, delayMs: number = KEYWORD_DEBOUNCE_MS): KeywordDebounced {
  const debounced = ref(source.value);
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(source, value => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      debounced.value = value;
    }, delayMs);
  });

  // 作用域销毁时清理未触发的防抖定时器，避免向已停用作用域赋值
  onScopeDispose(() => clearTimeout(timer));

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    debounced.value = source.value;
  };

  return { debounced, flush };
}
