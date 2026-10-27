/** @vitest-environment jsdom */

/**
 * useVaultReturn 的来源记录与切回回归测试
 *
 * 这条链路的全部价值是「取完值一键回到刚才那一格」，全部风险是「一枚会切换标签页的按钮
 * 留在了不该留的地方」。因此锁四件事：
 *
 * 1. **来源必须此刻真实存在**。`chrome.tabs.get` 读不到（标签页已关、上下文已失效）就不启用
 *    出口——点下去什么都不发生的按钮比没有按钮更糟。
 * 2. **形状非法一律不记**。数字字符串、负数、小数都当「没有来源」，且不去碰 tabs API。
 * 3. **回程可反复、失败必清**。切成功留着意图——库弹窗不关，跨卡取值要来回跑几趟，每次切回的都是
 *    同一个幂等动作；切失败即清，来源页没了还留着按钮就是一个点下去什么都不发生的坏出口。
 * 4. **只读标签页元信息**。全程不碰身份库数据，也不产生任何库内副作用。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useVaultReturn } from '@/composables/useVaultReturn';

/** 各用例共用的 tabs/windows 桩 */
const tabsGet = vi.fn();
const tabsUpdate = vi.fn();
const windowsUpdate = vi.fn();

beforeEach(() => {
  tabsGet.mockReset();
  tabsUpdate.mockReset();
  windowsUpdate.mockReset();
  tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'https://example.com/register' });
  tabsUpdate.mockResolvedValue({});
  windowsUpdate.mockResolvedValue({});
  (globalThis as any).chrome = {
    tabs: { get: tabsGet, update: tabsUpdate },
    windows: { update: windowsUpdate },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

describe('remember（记录来源）', () => {
  it('来源标签页存在时启用出口，并把站点主机名作为展示标签', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.available.value).toBe(true);
    expect(vaultReturn.siteLabel.value).toBe('example.com');
  });

  it('只取浏览器盖章的 URL 主机名，不用页面自写的 title 当按钮旁文案', async () => {
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'https://bank.example.com/login', title: '你的银行' });
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.siteLabel.value).toBe('bank.example.com');
    expect(vaultReturn.siteLabel.value).not.toContain('你的银行');
  });

  it('file:// 拿不到主机名时仍可用，但标签是空串（文案侧走不点名站点的说法）', async () => {
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'file:///Users/me/form.html' });
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.available.value).toBe(true);
    expect(vaultReturn.siteLabel.value).toBe('');
  });

  it('来源页协议不在白名单时不启用出口', async () => {
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'chrome://extensions' });
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.available.value).toBe(false);
  });

  it('标签页已关闭时不启用出口', async () => {
    tabsGet.mockRejectedValue(new Error('No tab with id: 7'));
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.available.value).toBe(false);
  });

  it('URL 缺席时不启用出口（宁可不给按钮，也不给一个去路不明的按钮）', async () => {
    tabsGet.mockResolvedValue({ id: 7, windowId: 2 });
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    expect(vaultReturn.available.value).toBe(false);
  });

  it('非法 tabId 一律不记，且不去碰 tabs API', async () => {
    const vaultReturn = useVaultReturn();
    for (const bad of [undefined, null, '7', -1, 1.5, NaN, {}, true]) {
      await vaultReturn.remember(bad);
      expect(vaultReturn.available.value).toBe(false);
    }
    expect(tabsGet).not.toHaveBeenCalled();
  });

  it('后到的非法值会覆盖前一次记录，不留残余意图', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    expect(vaultReturn.available.value).toBe(true);

    await vaultReturn.remember(undefined);
    expect(vaultReturn.available.value).toBe(false);
    expect(vaultReturn.siteLabel.value).toBe('');
  });
});

describe('returnToSource（切回来源）', () => {
  it('激活来源标签页并聚焦其所在窗口，意图留着以便反复往返', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    await expect(vaultReturn.returnToSource()).resolves.toBe(true);
    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(2, { focused: true });
    // 库弹窗切走后仍开着，用户很可能回头再取一个字段：按钮必须还能按
    expect(vaultReturn.available.value).toBe(true);
  });

  it('可反复切回同一来源：每次都是同一个幂等动作', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    await vaultReturn.returnToSource();

    await expect(vaultReturn.returnToSource()).resolves.toBe(true);
    expect(tabsUpdate).toHaveBeenCalledTimes(2);
  });

  it('标签页在停留期间被关掉时返回失败并清掉意图，不留下坏按钮', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    tabsGet.mockRejectedValue(new Error('No tab with id: 7'));

    await expect(vaultReturn.returnToSource()).resolves.toBe(false);
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(vaultReturn.available.value).toBe(false);
  });

  /**
   * 来源页在取值期间自己跳走了
   *
   * 提示条上那串主机名是开库那一刻读的；来源页可能被 SPA 路由或页面自跳换到别的站点，
   * 此时按钮写「回到 example.com」却把人切去陌生页面，落点恰是「刚复制完证件号」那一瞬。
   * 判据与入口侧同源（协议白名单 + 主机名一致），不符就作废意图、拒绝切换。
   */
  it('来源页跳去别的站点时拒绝切换并作废意图', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'https://attacker.test/net' });

    await expect(vaultReturn.returnToSource()).resolves.toBe(false);
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(vaultReturn.available.value).toBe(false);
  });

  it('来源页落到白名单外协议（chrome://）时同样拒绝切换', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'chrome://settings' });

    await expect(vaultReturn.returnToSource()).resolves.toBe(false);
    expect(tabsUpdate).not.toHaveBeenCalled();
  });

  it('切之前读不到来源页 URL 时不盲切（复核不了就不切）', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    tabsGet.mockResolvedValue({ id: 7, windowId: 2 });

    await expect(vaultReturn.returnToSource()).resolves.toBe(false);
    expect(tabsUpdate).not.toHaveBeenCalled();
  });

  it('同站点内部的路由跳转不影响回程：主机名一致照切', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);
    tabsGet.mockResolvedValue({ id: 7, windowId: 2, url: 'https://example.com/step-two' });

    await expect(vaultReturn.returnToSource()).resolves.toBe(true);
    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });

  it('没有来源时直接失败，不产生任何 tabs 调用', async () => {
    const vaultReturn = useVaultReturn();

    await expect(vaultReturn.returnToSource()).resolves.toBe(false);
    expect(tabsGet).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
  });
});

describe('forget（作废意图）', () => {
  it('清空标签页 ID 与展示标签，重复调用无副作用', async () => {
    const vaultReturn = useVaultReturn();
    await vaultReturn.remember(7);

    vaultReturn.forget();
    vaultReturn.forget();
    expect(vaultReturn.available.value).toBe(false);
    expect(vaultReturn.siteLabel.value).toBe('');
  });
});
