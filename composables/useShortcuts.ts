import { computed, ref } from 'vue';
import { logger } from '@/utils/logger';
import { formatShortcut } from '@/utils/formatShortcut';
import {
  SHORTCUT_COMMANDS,
  openShortcutsPage,
  resolveDefaultShortcut,
  type ShortcutCommandId,
} from '@/utils/shortcutCommands';

/** 单个快捷键命令的运行时状态 */
export interface ShortcutEntry {
  /** 命令标识（与 manifest.commands 键名一致） */
  id: ShortcutCommandId;
  /** 格式化后的展示按键；未绑定时回退为当前平台的默认建议按键 */
  shortcut: string;
  /** 是否已在浏览器中真正绑定生效 */
  assigned: boolean;
}

/**
 * 构造兜底条目：按键取默认建议值，绑定状态乐观标记为 true
 *
 * 乐观默认是为了避免「已正常绑定的用户」在 getAll() 返回前看到一闪而过的
 * 「未生效」预警。加载成功后按真实状态回填；加载失败则维持兜底不打扰用户。
 */
function createFallbackEntries(): ShortcutEntry[] {
  return SHORTCUT_COMMANDS.map(meta => ({
    id: meta.id,
    shortcut: formatShortcut(resolveDefaultShortcut(meta)),
    assigned: true,
  }));
}

/**
 * 快捷键管理 Composable
 *
 * 从 `chrome.commands.getAll()` 读取四组命令的真实绑定状态并格式化，供 Popup /
 * Options 快捷键弹窗 / SidePanel 帮助弹窗展示。
 *
 * 不内置 onMounted，由调用方控制加载时机：Popup 需在初始化时并行加载，
 * SidePanel 的 HelpDialog 则必须推迟到弹窗打开时，避免侵入侧边栏首屏关键路径。
 */
export function useShortcuts() {
  /** 快捷键条目列表（单一事实来源，顺序与 SHORTCUT_COMMANDS 一致） */
  const entries = ref<ShortcutEntry[]>(createFallbackEntries());

  /** 命令名称到格式化快捷键的映射（已绑定为真实按键，未绑定回退为建议按键文案） */
  const shortcuts = computed<Record<string, string>>(() =>
    Object.fromEntries(entries.value.map(entry => [entry.id, entry.shortcut] as const)),
  );

  /**
   * 命令是否已在浏览器中真正绑定快捷键
   *
   * Chrome 不会为「更新后新增的命令」自动绑定 suggested_key，被系统或其他扩展
   * 占用的按键同样注册失败，这两种情况 getAll() 返回的 shortcut 均为空字符串。
   * 调用方据此决定展示真实按键还是「未生效」预警与设置入口。
   */
  const shortcutAssigned = computed<Record<string, boolean>>(() =>
    Object.fromEntries(entries.value.map(entry => [entry.id, entry.assigned] as const)),
  );

  /**
   * 从 Chrome API 动态获取已绑定的快捷键
   *
   * 用户在 chrome://extensions/shortcuts 修改后重新调用即可同步。
   * getAll() 结果中缺失的命令（或 shortcut 为空）一律判定为未绑定。
   * 获取失败时保留兜底条目，不清空已有状态。
   */
  const loadShortcuts = async () => {
    try {
      const commands = await chrome.commands.getAll();

      // 仅收录真正绑定了按键的命令，空字符串视为未绑定
      const boundMap = new Map<string, string>();
      for (const cmd of commands) {
        if (cmd.name && cmd.shortcut) boundMap.set(cmd.name, cmd.shortcut);
      }

      entries.value = SHORTCUT_COMMANDS.map(meta => {
        const bound = boundMap.get(meta.id);
        return {
          id: meta.id,
          shortcut: formatShortcut(bound ?? resolveDefaultShortcut(meta)),
          assigned: Boolean(bound),
        };
      });
    } catch (error) {
      logger.warn('useShortcuts: 获取快捷键失败，保持兜底展示:', error);
    }
  };

  return { entries, shortcuts, shortcutAssigned, loadShortcuts, openShortcutsPage };
}
