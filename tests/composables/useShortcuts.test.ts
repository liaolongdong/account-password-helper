import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShortcuts } from '@/composables/useShortcuts';
import { formatShortcut } from '@/utils/formatShortcut';

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
});
