/**
 * 扩展快捷键命令领域模块
 *
 * 命令清单的运行时单一事实来源：命令标识、默认按键与「打开浏览器快捷键管理页」动作。
 * 纯常量 + 类型 + 一个浏览器动作，不依赖 Vue，体积极小，可被 Popup / Options /
 * SidePanel 三个入口安全复用。
 *
 * 能力边界说明：Chrome `commands` API 仅提供 `getAll()` 与 `onCommand`，
 * **不存在** `chrome.commands.update()`（该方法属于 Firefox 的 `browser.commands.update()`）。
 * 因此扩展无法在自身界面内改键，只能展示真实绑定状态并引导用户前往浏览器管理页。
 *
 * 命令标识与 `wxt.config.ts` 中 `manifest.commands` 的键名严格一致，
 * 两处的一致性由 `tests/utils/shortcutCommands.test.ts` 静态校验，防止漂移。
 *
 * @module utils/shortcutCommands
 */
import { logger } from '@/utils/logger';
import { isFirefox } from '@/utils/env';
import { isMacPlatform } from '@/utils/platform';
import { CHROME_SHORTCUTS_PAGE_URL } from '@/utils/urls';

/** 扩展快捷键命令标识，与 manifest.commands 键名严格一致 */
export type ShortcutCommandId = 'open_options' | 'toggle_sidepanel' | 'quick_fill' | 'open_inline_dropdown';

/** 单个快捷键命令的静态元信息 */
export interface ShortcutCommandMeta {
  /** 命令标识 */
  readonly id: ShortcutCommandId;
  /**
   * 默认按键（取 manifest `suggested_key.default` 原值，非 Apple 平台生效）
   *
   * 仅在 `chrome.commands.getAll()` 不可用或该命令未绑定时作为兜底展示值，
   * 用于向用户提示「这个命令本应是什么按键」。展示前需经 `resolveDefaultShortcut`
   * 选择平台分支，并由 `formatShortcut` 格式化。
   */
  readonly defaultShortcut: string;
  /**
   * Apple 平台默认按键（取 manifest `suggested_key.mac` 原值）
   *
   * Chrome 按平台从 `default` / `mac` 中择一注册，因此兜底展示也必须跟随平台，
   * 否则 macOS 用户会在未绑定行看到 `Ctrl⇧P`，而实际绑定后得到 `⌘⇧P`。
   */
  readonly defaultShortcutMac: string;
}

/**
 * 快捷键命令清单（有序）
 *
 * 数组顺序即各处 UI 的展示顺序。Chrome 最多允许 4 个 `suggested_key`，当前已用满，
 * 新增命令将没有默认按键，需用户手动绑定。
 *
 * `defaultShortcut` / `defaultShortcutMac` 与 `wxt.config.ts` 中 `suggested_key` 的
 * `default` / `mac` 逐字一致，由 `tests/utils/shortcutCommands.test.ts` 静态校验。
 */
export const SHORTCUT_COMMANDS: readonly ShortcutCommandMeta[] = [
  { id: 'open_options', defaultShortcut: 'Ctrl+Shift+P', defaultShortcutMac: 'Command+Shift+P' },
  { id: 'toggle_sidepanel', defaultShortcut: 'Ctrl+Shift+L', defaultShortcutMac: 'Command+Shift+L' },
  { id: 'quick_fill', defaultShortcut: 'Ctrl+Shift+F', defaultShortcutMac: 'Command+Shift+F' },
  { id: 'open_inline_dropdown', defaultShortcut: 'Ctrl+Shift+K', defaultShortcutMac: 'Command+Shift+K' },
];

/**
 * 取当前平台应展示的兜底按键（manifest `suggested_key` 原值，尚未格式化）
 *
 * 必须与浏览器实际注册的平台分支保持一致：若固定返回 `default`，Apple 平台用户
 * 会在「未生效」预警行看到 `Ctrl⇧P`，与同一弹窗内已绑定行的 `⌘⇧P` 风格并存，
 * 且展示值与 manifest 声明不符，属于向用户传达了错误信息。
 *
 * @param meta - 命令静态元信息
 * @param isMac - 是否 Apple 平台，默认取 `isMacPlatform()` 的同步嗅探结果；
 *   显式传参仅供测试驱动两个分支，生产调用方无需传入
 * @returns 当前平台对应的默认按键字面值
 */
export function resolveDefaultShortcut(meta: ShortcutCommandMeta, isMac: boolean = isMacPlatform()): string {
  return isMac ? meta.defaultShortcutMac : meta.defaultShortcut;
}

/**
 * 打开浏览器内置的扩展快捷键管理页
 *
 * Firefox 无 `chrome://extensions/shortcuts` 页面，直接返回 false，
 * 由调用方降级为文案提示（引导至 `about:addons` 的「管理扩展快捷键」）。
 *
 * 本函数不关闭当前窗口——Popup 需要在跳转后自行 `window.close()`，
 * 而 Options / SidePanel 必须保持打开，收尾行为归调用方所有。
 *
 * @returns 成功发起跳转为 true；Firefox 或跳转失败为 false（不向外抛异常）
 */
export async function openShortcutsPage(): Promise<boolean> {
  if (isFirefox) return false;

  try {
    await chrome.tabs.create({ url: CHROME_SHORTCUTS_PAGE_URL });
    return true;
  } catch (error) {
    logger.error('打开快捷键管理页失败:', error);
    return false;
  }
}
