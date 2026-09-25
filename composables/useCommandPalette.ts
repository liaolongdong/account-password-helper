import { ref, computed, watch, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import { filterActions, nextActiveIndex, clampActiveIndex, type CommandAction } from '@/utils/commandPalette';

/**
 * 命令面板所需的最小键盘事件视图（鸭子类型）。
 *
 * 只声明判定所需字段，避开对 DOM 全局 `KeyboardEvent` 的依赖，使处理函数在无 jsdom 的
 * node 测试环境可直接以普通对象调用；真实 `keydown` 事件结构上满足该类型。
 */
interface PaletteKeyboardEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** 真实 keydown 事件恒有该字段；node 测试里构造的普通对象可省略（等价于未合成） */
  isComposing?: boolean;
  preventDefault: () => void;
}

/** useCommandPalette 依赖注入项 */
interface UseCommandPaletteOptions {
  /** 返回全量动作（含已翻译展示名）。面板打开时读取，故语言切换后重开即生效。 */
  getActions: () => CommandAction[];
  /** 是否允许打开（通常绑定「已认证」）。返回 false 时快捷键与 open() 均不生效。 */
  canOpen?: () => boolean;
}

/** useCommandPalette 返回值 */
interface CommandPaletteController {
  /** 面板是否可见 */
  visible: Ref<boolean>;
  /** 检索关键词（双向绑定到输入框） */
  keyword: Ref<string>;
  /** 当前高亮活动项索引 */
  activeIndex: Ref<number>;
  /** 过滤后的动作列表（保持分组预排顺序） */
  filtered: ComputedRef<CommandAction[]>;
  /** 打开面板（canOpen 为假时忽略） */
  open: () => void;
  /** 关闭面板并清空关键词 */
  close: () => void;
  /** 切换开关 */
  toggle: () => void;
  /** 上下移动活动项（循环） */
  move: (delta: number) => void;
  /** 执行活动项 */
  select: () => void;
  /** 执行指定索引动作 */
  runAt: (index: number) => void;
  /** 全局 keydown 处理器（Ctrl/Cmd+K 切换；打开时方向键/回车/Esc 导航） */
  handleKeydown: (event: PaletteKeyboardEvent) => void;
}

/**
 * 命令面板状态机 Composable
 *
 * 承载 Options 页 Ctrl/Cmd+K 命令面板的可见性、检索关键词与活动项导航，动作执行
 * 全部委托给调用方注入的 `run`（复用既有 handler，不新增业务行为）。过滤与索引推进
 * 由 `@/utils/commandPalette` 纯函数提供，本文件只负责响应式状态与生命周期。
 *
 * 全局快捷键监听仅在浏览器环境注册（node 测试环境无 `window` 时跳过，改由测试直接
 * 调用 `handleKeydown`）；随作用域销毁自动解绑，避免泄漏。
 *
 * @param options 动作工厂与打开门槛
 * @returns 面板控制器（供组件与 App.vue 绑定）
 */
export function useCommandPalette(options: UseCommandPaletteOptions): CommandPaletteController {
  const { getActions, canOpen } = options;

  const visible = ref(false);
  const keyword = ref('');
  const activeIndex = ref(0);

  const filtered = computed(() => filterActions(getActions(), keyword.value));

  // 关键词变化后回到首项
  watch(keyword, () => {
    activeIndex.value = 0;
  });

  // 过滤结果变短（如拼音预热完成翻转命中集）时收敛活动索引，避免越界
  watch(filtered, list => {
    activeIndex.value = clampActiveIndex(activeIndex.value, list.length);
  });

  const open = () => {
    if (canOpen && !canOpen()) return;
    keyword.value = '';
    activeIndex.value = 0;
    visible.value = true;
  };

  const close = () => {
    visible.value = false;
    keyword.value = '';
  };

  const toggle = () => {
    if (visible.value) close();
    else open();
  };

  const move = (delta: number) => {
    if (!visible.value) return;
    activeIndex.value = nextActiveIndex(activeIndex.value, filtered.value.length, delta);
  };

  const runAt = (index: number) => {
    const item = filtered.value[index];
    if (!item) return;
    // 先关闭面板再执行，确保遮罩退场后再弹出目标弹窗；run 复用既有 handler，
    // 其自身错误/降级路径与菜单点击完全一致，这里不额外处理。
    close();
    void item.run();
  };

  const select = () => {
    runAt(activeIndex.value);
  };

  const handleKeydown = (event: PaletteKeyboardEvent) => {
    // 输入法合成期间（中文/日文选词）的 Enter 是「上屏」、↑↓ 是候选翻页、Esc 是取消合成，
    // 此刻接管会演变成「字没打完就执行了高亮命令」，故整段放行给 IME。
    if (event.isComposing) return;

    const isMod = event.ctrlKey || event.metaKey;
    if (isMod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      toggle();
      return;
    }

    if (!visible.value) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        select();
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown);
    onScopeDispose(() => {
      window.removeEventListener('keydown', handleKeydown);
    });
  }

  return { visible, keyword, activeIndex, filtered, open, close, toggle, move, select, runAt, handleKeydown };
}
