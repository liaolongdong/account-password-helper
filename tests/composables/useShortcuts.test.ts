import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShortcuts } from '@/composables/useShortcuts';
import { formatShortcut } from '@/utils/formatShortcut';
import { SHORTCUT_COMMANDS } from '@/utils/shortcutCommands';
import { CHROME_SHORTCUTS_PAGE_URL } from '@/utils/urls';

/**
 * 平台判定桩（默认非 Apple 平台）
 *
 * Node 会把 `navigator.platform` 继承为运行机器的值（在 macOS 上为 `MacIntel`），
 * 而兜底按键经 `resolveDefaultShortcut` 按平台择一。不隔离平台的话，本文件
 * 所有「未绑定回退到 Ctrl+Shift+*」的断言会随 CI 宿主平台翻转。
 * Apple 分支由末尾专门用例切换验证；`isMacPlatform` 自身的嗅探逻辑
 * 由 `tests/utils/platform.test.ts` 覆盖。
 */
const { isMacPlatformMock } = vi.hoisted(() => ({ isMacPlatformMock: vi.fn(() => false) }));

vi.mock('@/utils/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/platform')>()),
  isMacPlatform: isMacPlatformMock,
}));

/**
 * useShortcuts 单元测试
 *
 * 重点验证「命令是否真正绑定」的派生逻辑：Chrome 不会为更新后新增的命令自动绑定
 * suggested_key，此时 chrome.commands.getAll() 返回的 shortcut 为空字符串。组件据此
 * 决定 Popup 展示真实按键还是「设置快捷键」入口。
 */
describe('useShortcuts', () => {
  const getAllMock = vi.fn<() => Promise<chrome.commands.Command[]>>();

  beforeEach(() => {
    // 以测试桩覆盖 chrome.commands（fakeBrowser 默认未实现该命名空间）
    Object.defineProperty(chrome, 'commands', {
      configurable: true,
      writable: true,
      value: { getAll: getAllMock },
    });
    // 平台基线在每个用例前重建：Apple 分支用例会切换返回值，不清理则泄漏到后续用例。
    // 基线必须放 beforeEach 而非 afterEach——mockReturnValue 会覆盖 vi.fn 的初始实现，
    // 放 afterEach 将使「桩默认值」这个旋钮失效，用例沦为与平台无关的假通过。
    isMacPlatformMock.mockReset();
    isMacPlatformMock.mockReturnValue(false);
  });

  afterEach(() => {
    getAllMock.mockReset();
  });

  it('命令已绑定时，shortcuts 使用真实按键且 shortcutAssigned 为 true', async () => {
    getAllMock.mockResolvedValue([
      { name: 'open_options', shortcut: 'Ctrl+Shift+P' },
      { name: 'toggle_sidepanel', shortcut: 'Ctrl+Shift+L' },
    ]);

    const { shortcuts, shortcutAssigned, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(shortcutAssigned.value.open_options).toBe(true);
    expect(shortcutAssigned.value.toggle_sidepanel).toBe(true);
    expect(shortcuts.value.open_options).toBe(formatShortcut('Ctrl+Shift+P'));
    expect(shortcuts.value.toggle_sidepanel).toBe(formatShortcut('Ctrl+Shift+L'));
  });

  it('命令未绑定（shortcut 为空）时，shortcutAssigned 为 false 且回退到建议按键', async () => {
    getAllMock.mockResolvedValue([
      { name: 'open_options', shortcut: '' },
      { name: 'toggle_sidepanel', shortcut: '' },
    ]);

    const { shortcuts, shortcutAssigned, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(shortcutAssigned.value.open_options).toBe(false);
    expect(shortcutAssigned.value.toggle_sidepanel).toBe(false);
    // 未绑定时回退到默认建议按键文案，作为引导用户设置的提示
    expect(shortcuts.value.open_options).toBe(formatShortcut('Ctrl+Shift+P'));
    expect(shortcuts.value.toggle_sidepanel).toBe(formatShortcut('Ctrl+Shift+L'));
  });

  it('getAll 抛错时保持乐观默认（assigned 为 true，不打扰用户）', async () => {
    getAllMock.mockRejectedValue(new Error('API unavailable'));

    const { shortcutAssigned, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(shortcutAssigned.value.open_options).toBe(true);
    expect(shortcutAssigned.value.toggle_sidepanel).toBe(true);
  });

  it('entries 顺序与 SHORTCUT_COMMANDS 一致，不受 getAll 返回顺序影响', async () => {
    getAllMock.mockResolvedValue([
      { name: 'quick_fill', shortcut: 'Ctrl+Alt+F' },
      { name: 'open_options', shortcut: 'Ctrl+Shift+P' },
    ]);

    const { entries, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(entries.value.map(entry => entry.id)).toEqual(SHORTCUT_COMMANDS.map(meta => meta.id));
    // 用户改过键的命令展示真实按键，而非默认建议值
    expect(entries.value.find(entry => entry.id === 'quick_fill')).toEqual({
      id: 'quick_fill',
      shortcut: formatShortcut('Ctrl+Alt+F'),
      assigned: true,
    });
  });

  it('getAll 结果中缺失的命令判定为未绑定，并回退到默认建议按键', async () => {
    getAllMock.mockResolvedValue([{ name: 'open_options', shortcut: 'Ctrl+Shift+P' }]);

    const { entries, shortcuts, shortcutAssigned, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(shortcutAssigned.value.open_inline_dropdown).toBe(false);
    expect(shortcuts.value.open_inline_dropdown).toBe(formatShortcut('Ctrl+Shift+K'));
    expect(entries.value.find(entry => entry.id === 'open_inline_dropdown')).toEqual({
      id: 'open_inline_dropdown',
      shortcut: formatShortcut('Ctrl+Shift+K'),
      assigned: false,
    });
  });

  it('getAll 抛错时不覆盖已有 entries，维持兜底展示', async () => {
    getAllMock.mockRejectedValue(new Error('API unavailable'));

    const { entries, loadShortcuts } = useShortcuts();
    await loadShortcuts();

    expect(entries.value).toEqual(
      SHORTCUT_COMMANDS.map(({ id, defaultShortcut }) => ({
        id,
        shortcut: formatShortcut(defaultShortcut),
        assigned: true,
      })),
    );
  });

  /**
   * Apple 平台兜底分支
   *
   * Chrome 按平台从 suggested_key 的 default / mac 择一注册，兜底展示必须跟随，
   * 否则 macOS 用户会在「未生效」预警行看到 Ctrl⇧P，与同弹窗内已绑定行的
   * ⌘⇧P 风格并存，且与 manifest 声明不符。
   */
  describe('Apple 平台兜底按键', () => {
    it('未绑定时回退到 suggested_key.mac 而非 default', async () => {
      isMacPlatformMock.mockReturnValue(true);
      getAllMock.mockResolvedValue([{ name: 'open_options', shortcut: '' }]);

      const { entries, shortcuts, loadShortcuts } = useShortcuts();
      await loadShortcuts();

      expect(shortcuts.value.open_options).toBe(formatShortcut('Command+Shift+P'));
      expect(entries.value.find(entry => entry.id === 'quick_fill')).toEqual({
        id: 'quick_fill',
        shortcut: formatShortcut('Command+Shift+F'),
        assigned: false,
      });
    });

    it('getAll 抛错时的初始兜底 entries 也跟随平台', async () => {
      isMacPlatformMock.mockReturnValue(true);
      getAllMock.mockRejectedValue(new Error('API unavailable'));

      const { entries, loadShortcuts } = useShortcuts();
      await loadShortcuts();

      expect(entries.value).toEqual(
        SHORTCUT_COMMANDS.map(({ id, defaultShortcutMac }) => ({
          id,
          shortcut: formatShortcut(defaultShortcutMac),
          assigned: true,
        })),
      );
    });

    it('已绑定的真实按键不受平台兜底影响（平台分支仅作用于未绑定行）', async () => {
      isMacPlatformMock.mockReturnValue(true);
      getAllMock.mockResolvedValue([{ name: 'quick_fill', shortcut: 'Ctrl+Alt+F' }]);

      const { shortcuts, loadShortcuts } = useShortcuts();
      await loadShortcuts();

      // 用户改过的键以 getAll() 真实值为准，不被 mac 兜底覆盖
      expect(shortcuts.value.quick_fill).toBe(formatShortcut('Ctrl+Alt+F'));
    });
  });

  describe('openShortcutsPage', () => {
    let tabsCreateSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      tabsCreateSpy.mockRestore();
    });

    it('以浏览器内置快捷键管理页 URL 打开新标签并返回 true', async () => {
      // fakeBrowser 桩非 vi.fn，需 spy 包装；重载推导落在回调版签名上，返回值用 never 绕过
      tabsCreateSpy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);

      const { openShortcutsPage } = useShortcuts();
      await expect(openShortcutsPage()).resolves.toBe(true);
      expect(tabsCreateSpy).toHaveBeenCalledWith({ url: CHROME_SHORTCUTS_PAGE_URL });
    });

    it('chrome.tabs.create 抛错时返回 false 且不向外抛出', async () => {
      tabsCreateSpy = vi
        .spyOn(chrome.tabs, 'create')
        .mockRejectedValue(new Error('Opening chrome:// pages is not allowed'));

      const { openShortcutsPage } = useShortcuts();
      await expect(openShortcutsPage()).resolves.toBe(false);
    });
  });
});
