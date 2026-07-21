import { ref } from 'vue';
import { logger } from '@/utils/logger';
import { formatShortcut } from '@/utils/formatShortcut';

/**
 * 快捷键显示名称与对应 Chrome 命令名称的映射
 * key: 内部标识符，value: Chrome commands API 中的命令名称
 */
const SHORTCUT_NAME_MAP: Record<string, string> = {
  open_options: 'open_options',
  toggle_sidepanel: 'toggle_sidepanel',
};

/**
 * 默认快捷键（当 Chrome API 获取失败时的兜底值）
 */
const DEFAULT_SHORTCUTS: Record<string, string> = {
  open_options: formatShortcut('Ctrl+Shift+P'),
  toggle_sidepanel: formatShortcut('Ctrl+Shift+L'),
};

/**
 * 快捷键管理 Composable
 * 管理 Chrome 命令快捷键的获取与格式化，供 Popup 展示快捷键标签。
 * 不内置 onMounted，由调用方控制加载时机以支持并行初始化。
 */
export function useShortcuts() {
  /** 命令名称到格式化快捷键的映射（已绑定为真实按键，未绑定回退为建议按键文案） */
  const shortcuts = ref<Record<string, string>>({ ...DEFAULT_SHORTCUTS });

  /**
   * 命令是否已在 Chrome 中真正绑定快捷键
   *
   * Chrome 不会为“更新后新增的命令”自动绑定 suggested_key，此时 getAll() 返回的
   * shortcut 为空字符串。乐观默认为 true 以避免已绑定用户看到闪烁，加载后按真实状态回填。
   */
  const shortcutAssigned = ref<Record<string, boolean>>({
    open_options: true,
    toggle_sidepanel: true,
  });

  /**
   * 从 Chrome API 动态获取已绑定的快捷键
   * 用户在 chrome://extensions/shortcuts 修改后会自动同步
   */
  const loadShortcuts = async () => {
    try {
      const commands = await chrome.commands.getAll();
      const shortcutMap: Record<string, string> = {};
      const assignedMap: Record<string, boolean> = {};

      for (const cmd of commands) {
        if (cmd.name) {
          assignedMap[cmd.name] = Boolean(cmd.shortcut);
          if (cmd.shortcut) {
            shortcutMap[cmd.name] = formatShortcut(cmd.shortcut);
          }
        }
      }

      shortcuts.value = {
        open_options: shortcutMap[SHORTCUT_NAME_MAP.open_options] || DEFAULT_SHORTCUTS.open_options,
        toggle_sidepanel: shortcutMap[SHORTCUT_NAME_MAP.toggle_sidepanel] || DEFAULT_SHORTCUTS.toggle_sidepanel,
      };
      shortcutAssigned.value = {
        open_options: assignedMap[SHORTCUT_NAME_MAP.open_options] ?? false,
        toggle_sidepanel: assignedMap[SHORTCUT_NAME_MAP.toggle_sidepanel] ?? false,
      };
    } catch (error) {
      logger.warn('Popup: 获取快捷键失败，使用默认值:', error);
    }
  };

  return { shortcuts, shortcutAssigned, loadShortcuts };
}
