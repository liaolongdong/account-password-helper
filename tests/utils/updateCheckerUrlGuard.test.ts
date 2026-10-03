/**
 * 更新跳转地址的协议闸门（评审缺陷 m-2）
 *
 * `downloadUrl` 的唯一来源是 GitHub Releases API 响应里的 `html_url`，而它的最终去向是
 * `chrome.tabs.create` —— 一条「用户点更新按钮」的可信导航路径。修复前它原样落库、原样打开：
 * 外部响应里给出 `javascript:` / `data:` 之类的值，就会被当作可信更新链接在新标签页里执行。
 *
 * 两道闸门各自对应的失效形状不同，所以都留了用例：
 * - 写入边界（`checkForUpdate`）：非法值不进存储，避免脏数据长期驻留、也被未来的新消费方读到；
 * - 跳转出口（`openUpdatePage`）：修复前**已缓存**的旧值仍在用户机器上，只改写入侧拦不住它。
 *
 * 判据复用条目跳转的同一个 `toNavigableUrl`（`utils/domain.ts`），两条路径对「什么算可导航」
 * 的答案必须一致，不各写一份协议白名单（该判据本身的用例见 `tests/utils/domain.test.ts`）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '@/utils/types';
import { CHROME_WEB_STORE_CHECK_URL, GITHUB_RELEASES_PAGE_URL } from '@/utils/urls';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { checkForUpdate, getCachedUpdateInfo, resetCwsAccessCache } from '@/utils/updateChecker';
import { useVersionUpdate } from '@/composables/useVersionUpdate';

/** 测试里当作"最新版本"的 release 地址（合法值原样保留，故用真实仓库域名） */
const RELEASE_URL = 'https://github.com/liaolongdong/account-password-helper/releases/tag/v9.9.9';

/** `chrome.storage.local` 的内存替身（本文件只用 get/set/remove 三个方法） */
function createStorageStub() {
  const store: Record<string, unknown> = {};
  return {
    store,
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (key: string) => {
        delete store[key];
      },
    },
  };
}

let storage: ReturnType<typeof createStorageStub>;
const tabsCreate = vi.fn();
const windowClose = vi.fn();

/**
 * 桩掉两处 fetch：CWS 探测 reject（判定「不可访问」，据此进入 GitHub 分支），
 * GitHub API 返回带指定 `html_url` 的 release 负载
 */
function stubReleaseResponse(htmlUrl: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input) === CHROME_WEB_STORE_CHECK_URL) throw new TypeError('network blocked');
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: 'v9.9.9', html_url: htmlUrl, body: '', published_at: '' }),
      };
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  storage = createStorageStub();
  tabsCreate.mockClear();
  windowClose.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
    storage,
    tabs: { create: tabsCreate },
  });
  vi.stubGlobal('window', { close: windowClose });
  resetCwsAccessCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCwsAccessCache();
});

describe('checkForUpdate 写入边界', () => {
  it('CWS 可访问时不查 GitHub，也不留更新提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch,
    );

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(storage.store[STORAGE_KEYS.UPDATE_INFO], '商店可访问时不该留下 GitHub 更新提示').toBeUndefined();
  });

  it('合法的 release 页面地址原样落库', async () => {
    stubReleaseResponse(RELEASE_URL);

    const info = await checkForUpdate();
    expect(info?.downloadUrl).toBe(RELEASE_URL);
    expect(storage.store[STORAGE_KEYS.UPDATE_INFO]).toMatchObject({ latestVersion: '9.9.9' });
  });

  it.each([
    ['javascript:alert(1)', '伪协议'],
    ['data:text/html,<script>alert(1)</script>', '内联数据'],
    ['file:///etc/passwd', '本地文件'],
    ['', '空字符串'],
    [undefined, '缺失字段'],
  ])('外部 html_url 为 %s（%s）时退回仓库 Releases 页，不带病进存储', async (raw, _label) => {
    stubReleaseResponse(raw);

    const info = await checkForUpdate();
    expect(info?.downloadUrl).toBe(GITHUB_RELEASES_PAGE_URL);
    expect((storage.store[STORAGE_KEYS.UPDATE_INFO] as UpdateInfo).downloadUrl).toBe(GITHUB_RELEASES_PAGE_URL);
  });

  it('闸门不改变既有的缓存读取行为', async () => {
    stubReleaseResponse(RELEASE_URL);
    await checkForUpdate();
    await expect(getCachedUpdateInfo()).resolves.toMatchObject({ latestVersion: '9.9.9', downloadUrl: RELEASE_URL });
  });
});

describe('openUpdatePage 跳转出口', () => {
  /**
   * 把缓存形状直接塞进 composable 的响应式状态后触发跳转
   *
   * 绕开 `initUpdateCheck` 是因为存储读取那条路径已由上一组覆盖；这里要验的是出口本身
   * 对「修复前已缓存的脏值」是否还有牙。
   */
  const openedUrl = (downloadUrl: string | undefined): { url: string } => {
    const { updateInfo, openUpdatePage } = useVersionUpdate();
    updateInfo.value =
      downloadUrl === undefined
        ? null
        : {
            downloadUrl,
            latestVersion: '9.9.9',
            releaseNotes: '',
            publishedAt: '',
            checkedAt: Date.now(),
          };
    openUpdatePage();
    return tabsCreate.mock.calls[tabsCreate.mock.calls.length - 1]![0] as { url: string };
  };

  it('合法地址原样打开', () => {
    expect(openedUrl(RELEASE_URL).url).toBe(RELEASE_URL);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', ''])(
    '已缓存的非法值 %s 在出口被拦下，退回 Releases 页',
    raw => {
      expect(openedUrl(raw).url).toBe(GITHUB_RELEASES_PAGE_URL);
    },
  );

  it('没有缓存信息时同样打开 Releases 页，且只开一个标签', () => {
    expect(openedUrl(undefined).url).toBe(GITHUB_RELEASES_PAGE_URL);
    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(windowClose).toHaveBeenCalledTimes(1);
  });
});
