/** @vitest-environment jsdom */

/**
 * 悬浮按钮显隐的站点覆盖（B1）在管理器层的回归测试
 *
 * 钉住的是「生效显隐 = 全局开关经站点规则替换」这条判定在三个时机的一致性：
 * 1. init 门禁：覆盖为隐藏时不创建任何 DOM（不是创建了再藏起来），只留监听等待改回；
 * 2. storage 过渡：规则撤销 / 全局开关拨回时补建 DOM，且反复切换不重复创建；
 * 3. 覆盖语义：显式 true 能在全局隐藏时单独唤出按钮，脏值跟随全局，
 *    含非默认端口的 host 键优先于 hostname 键（与 FormDetector / 拾取器同口径）。
 *
 * 容器的 hidden 类在 closed Shadow DOM 内部，外部断言够不着；那条门禁由
 * tests/architecture/siteBehaviorOverridesWiring.test.ts 的机械扫描钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingButtonManager } from '@/entrypoints/content/floatingButtons/FloatingButtonManager';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { SiteRule } from '@/utils/storage/siteRules';

const HOSTNAME = window.location.hostname;
const HOST = window.location.host;

const setRules = (rules: Record<string, Partial<SiteRule>>): Promise<void> =>
  chrome.storage.local.set({ [STORAGE_KEYS.SITE_RULES]: rules });

const setGlobalVisible = (visible: boolean): Promise<void> =>
  chrome.storage.local.set({ [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: { visible } });

const hostElements = (): NodeListOf<Element> => document.querySelectorAll('floating-button-root');

describe('悬浮按钮显隐的站点覆盖', () => {
  let manager: FloatingButtonManager;

  beforeEach(async () => {
    await chrome.storage.local.clear();
    document.body.innerHTML = '';
    manager = new FloatingButtonManager();
  });

  afterEach(async () => {
    manager.destroy();
    document.body.innerHTML = '';
    await chrome.storage.local.clear();
    vi.restoreAllMocks();
  });

  it('覆盖为隐藏时 init 不创建 DOM；规则撤销后经 storage 监听补建，反复切换不重复创建', async () => {
    await setRules({ [HOSTNAME]: { domain: HOSTNAME, floatingButton: false } });
    await manager.init();
    expect(hostElements()).toHaveLength(0);

    await setRules({});
    await vi.waitFor(() => expect(hostElements()).toHaveLength(1));

    // 再覆盖回隐藏：DOM 保留（hidden 类在 shadow 内部），但绝不新增第二份
    await setRules({ [HOSTNAME]: { domain: HOSTNAME, floatingButton: false } });
    await vi.waitFor(() => expect(hostElements()).toHaveLength(1));
    await setRules({});
    await vi.waitFor(() => expect(hostElements()).toHaveLength(1));
  });

  it('全局隐藏时站点覆盖为显示能单独唤出按钮（显式 true 是有效覆盖）', async () => {
    await setGlobalVisible(false);
    await setRules({ [HOSTNAME]: { domain: HOSTNAME, floatingButton: true } });
    await manager.init();
    expect(hostElements()).toHaveLength(1);
  });

  it('全局隐藏且无覆盖时保持隐藏；全局开关经 storage 拨回显示照常补建（存量行为不变）', async () => {
    await setGlobalVisible(false);
    await manager.init();
    expect(hostElements()).toHaveLength(0);

    await setGlobalVisible(true);
    await vi.waitFor(() => expect(hostElements()).toHaveLength(1));
  });

  it('脏覆盖值跟随全局：字符串 "false" 不得把默认显示的按钮藏掉', async () => {
    await setRules({ [HOSTNAME]: { domain: HOSTNAME, floatingButton: 'false' as never } });
    await manager.init();
    expect(hostElements()).toHaveLength(1);
  });

  it('含非默认端口的 host 键优先于 hostname 键', async () => {
    // 前提自检：jsdom 默认 URL 必须带非默认端口，否则两个键重合、本条失去意义
    expect(HOST).not.toBe(HOSTNAME);
    await setRules({
      [HOSTNAME]: { domain: HOSTNAME, floatingButton: true },
      [HOST]: { domain: HOST, floatingButton: false },
    });
    await manager.init();
    expect(hostElements()).toHaveLength(0);
  });

  it('只管选择器的规则不顺带改变显隐（缺省 = 跟随全局）', async () => {
    await setGlobalVisible(false);
    await setRules({ [HOSTNAME]: { domain: HOSTNAME, customSelectors: { username: '#u' } } });
    await manager.init();
    expect(hostElements()).toHaveLength(0);
  });
});
