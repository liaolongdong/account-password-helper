import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import type { DomainMatchMode } from '@/utils/domain';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * passwordCache.applyMetadataOnlyUpdate 单元测试
 *
 * 覆盖元数据原地修补的核心语义：
 * - 缓存缺失时返回 false（调用方回退全量失效）；
 * - 白名单字段同步拷入；
 * - at-rest 键删除（取消收藏移除 favoriteUsedAt）同步从内存缓存删除，
 *   避免缓存/快照残留陈旧字段与 storage 持续偏离；
 * - 敏感字段绝不拷入明文缓存（即使 newValue 携带变化后的密文）。
 *
 * 会话模块 mock 掉：getSessionDataKey 返回 null 使快照持久化提前返回，
 * 避免测试触碰真实加密链路。
 *
 * 另覆盖跨子域匹配档位的后台侧契约：档位镜像的读取/复位次数，以及
 * getMatchingAccounts 按档位放行条目并逐条下发 tier（内容脚本据此呈现来源标识）。
 */

const sessionMocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
  getSessionDataKey: vi.fn(() => null),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: sessionMocks.isSessionValid,
  isSessionActiveSync: sessionMocks.isSessionActiveSync,
  getSessionDataKey: sessionMocks.getSessionDataKey,
}));

const configMocks = vi.hoisted(() => ({
  getSidepanelSortConfig: vi.fn(async () => null),
  // 返回类型显式声明为完整档位：`as const` 会把 mock 的入参收窄成 'off'，
  // 让 setMode('wildcard') 这类合法切档在类型检查阶段就报 TS2322
  getDomainMatchConfig: vi.fn(async (): Promise<{ mode: DomainMatchMode }> => ({ mode: 'off' })),
}));

vi.mock('@/utils/storage/configManager', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage/configManager')>();
  return {
    ...actual,
    getSidepanelSortConfig: configMocks.getSidepanelSortConfig,
    getDomainMatchConfig: configMocks.getDomainMatchConfig,
  };
});

// 图标走本地 _favicon 端点 + fetch，与档位/tier 断言无关，打桩保持 hermetic
vi.mock('@/utils/favicon', () => ({
  fetchFaviconDataUrl: vi.fn(async () => ''),
  normalizeUrlForFavicon: vi.fn((url: string) => url),
}));

import {
  applyMetadataOnlyUpdate,
  consumePendingTotp,
  getCachedDomainMatchMode,
  getDecryptedEntryById,
  getCachedPasswords,
  getInlineTotpCode,
  getMatchingAccounts,
  invalidatePasswordCache,
  resetCredentialAccessBarrierForStartup,
  resetDomainMatchModeMirror,
  updatePasswordCache,
} from '@/entrypoints/background/passwordCache';
import { handleQuickFill } from '@/entrypoints/background/quickFillHandler';

beforeEach(async () => {
  // 重置模块级缓存状态，保证用例 hermetic
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  invalidatePasswordCache();
  resetCredentialAccessBarrierForStartup();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('applyMetadataOnlyUpdate', () => {
  it('内存缓存缺失时返回 false（回退全量失效）', async () => {
    const result = await applyMetadataOnlyUpdate([{ id: 'a' }]);
    expect(result).toBe(false);
  });

  it('入参非数组时返回 false', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a' })], '*', true);
    const result = await applyMetadataOnlyUpdate('not-an-array');
    expect(result).toBe(false);
  });

  it('白名单字段同步拷入缓存并返回 true', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', favorite: false, lastUsedAt: 0 })], '*', true);

    const result = await applyMetadataOnlyUpdate([
      { id: 'a', favorite: true, favoriteUsedAt: 123, lastUsedAt: 456, updateTime: 789 },
    ]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].favorite).toBe(true);
    expect(cached?.passwords[0].favoriteUsedAt).toBe(123);
    expect(cached?.passwords[0].lastUsedAt).toBe(456);
    expect(cached?.passwords[0].updateTime).toBe(789);
  });

  it('at-rest 键删除（取消收藏）同步从缓存删除陈旧 favoriteUsedAt', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', favorite: true, favoriteUsedAt: 111 })], '*', true);

    // 取消收藏落盘后 at-rest 条目不再含 favoriteUsedAt 键
    const result = await applyMetadataOnlyUpdate([{ id: 'a', favorite: false }]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].favorite).toBe(false);
    expect('favoriteUsedAt' in (cached?.passwords[0] ?? {})).toBe(false);
  });

  it('敏感字段绝不拷入明文缓存（密文变化被忽略）', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', password: 'plain-secret' })], '*', true);

    // 构造携带「新密文」的 newValue：修补只允许白名单字段，password 必须保持原明文
    const result = await applyMetadataOnlyUpdate([{ id: 'a', password: 'cipher-v2', lastUsedAt: 100 }]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].password).toBe('plain-secret');
    expect(cached?.passwords[0].lastUsedAt).toBe(100);
  });
});

describe('浏览器启动重锁凭据边界', () => {
  it('pending 期间快捷填充与内联凭据入口都不恢复旧会话或下发数据', async () => {
    vi.useFakeTimers();
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]: { status: 'pending', updatedAt: Date.now() },
    });
    updatePasswordCache(
      [makePasswordEntry({ id: 'secret', password: 'plain-secret', totp: 'JBSWY3DPEHPK3PXP' })],
      '*',
      true,
    );
    resetCredentialAccessBarrierForStartup();

    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage');
    const checks = Promise.all([
      getCachedPasswords(),
      getMatchingAccounts('example.com'),
      getDecryptedEntryById('secret'),
      getInlineTotpCode('secret'),
      consumePendingTotp(1, 'example.com'),
      handleQuickFill({ id: 1, url: 'https://example.com', windowId: 1 } as chrome.tabs.Tab),
    ]);

    await vi.advanceTimersByTimeAsync(1500);
    const [cached, matching, entry, totp, pending] = await checks;

    expect(cached).toBeNull();
    expect(matching).toEqual({ locked: true, accounts: [] });
    expect(entry).toBeNull();
    expect(totp).toBeNull();
    expect(pending).toBeNull();
    expect(sessionMocks.isSessionValid).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('getMatchingAccounts 下发给内容脚本的字段口径', () => {
  it('缺失的展示字段一律以空串下发，内容脚本可直接按 string 筛选', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'h', salt: 's' },
    });
    // 复刻历史/手工存储数据：username 键整个缺失（类型上必填，运行时不可信）。
    // 内容脚本内联下拉的筛选对四个字段一律 toLowerCase()，undefined 会让面板停在半渲染态
    const legacy = { ...makePasswordEntry({ id: 'legacy', url: '' }), username: undefined } as unknown as PasswordEntry;
    updatePasswordCache([legacy], '*', true);

    const { accounts } = await getMatchingAccounts('example.com');

    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.username).toBe('');
    expect(accounts[0]!.tag).toBe('');
    expect(accounts[0]!.remark).toBe('');
    expect(accounts[0]!.url).toBe('');
  });
});

describe('跨子域档位镜像与 tier 下发', () => {
  /** 同一主域下的多环境夹具：精确 / 通配 / apex / 兄弟子域 / 前缀碰撞 */
  const QQ_ENTRIES: PasswordEntry[] = [
    makePasswordEntry({ id: 'exact', url: 'mail.qq.com' }),
    makePasswordEntry({ id: 'sibling', url: 'music.qq.com' }),
    makePasswordEntry({ id: 'wild', url: '*.qq.com' }),
    makePasswordEntry({ id: 'apex', url: 'qq.com' }),
    makePasswordEntry({ id: 'collide', url: 'evil-qq.com' }),
  ];

  /** 设置档位并复位镜像，模拟 storage.onChanged 的处理结果 */
  const setMode = async (mode: DomainMatchMode): Promise<void> => {
    configMocks.getDomainMatchConfig.mockResolvedValue({ mode });
    resetDomainMatchModeMirror();
  };

  beforeEach(async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'h', salt: 's' } });
    updatePasswordCache(QQ_ENTRIES, '*', true);
  });

  it('档位镜像在同一份缓存上只读一次，复位后才重新读取', async () => {
    configMocks.getDomainMatchConfig.mockResolvedValue({ mode: 'off' });
    resetDomainMatchModeMirror();

    expect(await getCachedDomainMatchMode()).toBe('off');
    expect(await getCachedDomainMatchMode()).toBe('off');
    expect(configMocks.getDomainMatchConfig).toHaveBeenCalledTimes(1);

    await setMode('wildcard');
    expect(await getCachedDomainMatchMode()).toBe('wildcard');
    expect(configMocks.getDomainMatchConfig).toHaveBeenCalledTimes(2);
  });

  it('invalidatePasswordCache 一并复位档位镜像（锁定/数据变更后重新读取）', async () => {
    await setMode('off');
    expect(await getCachedDomainMatchMode()).toBe('off');

    invalidatePasswordCache();
    configMocks.getDomainMatchConfig.mockResolvedValue({ mode: 'sameMainDomain' });
    expect(await getCachedDomainMatchMode()).toBe('sameMainDomain');
  });

  it('off 档：内联下拉仅精确 host，与放宽前一致', async () => {
    await setMode('off');
    const { accounts } = await getMatchingAccounts('mail.qq.com');

    expect(accounts.map(a => a.id)).toEqual(['exact']);
    expect(accounts[0]!.tier).toBe(0);
  });

  it('空态计数：off 档把同主域候选数一并下发给内容脚本', async () => {
    await setMode('off');
    const empty = await getMatchingAccounts('chat.qq.com');

    expect(empty.accounts).toHaveLength(0);
    // 精确 / 通配 / apex / 兄弟子域四条都属同主域候选，前缀碰撞的 evil-qq.com 不算
    expect(empty.crossDomainCount).toBe(4);
  });

  it('面板有结果时不遍历全库算计数（恒为 0，深链据此不渲染）', async () => {
    await setMode('off');
    const { accounts, crossDomainCount } = await getMatchingAccounts('mail.qq.com');

    expect(accounts).toHaveLength(1);
    expect(crossDomainCount).toBe(0);
  });

  it('放宽到最宽档后同主域条目进入可见集，深链失去意义', async () => {
    await setMode('sameMainDomain');
    const widened = await getMatchingAccounts('chat.qq.com');

    expect(widened.accounts.map(a => a.id).sort()).toEqual(['apex', 'exact', 'sibling', 'wild']);
    expect(widened.crossDomainCount).toBe(0);
  });

  it('wildcard 档：仅额外放行通配条目，tier 按层级下发', async () => {
    await setMode('wildcard');
    const { accounts } = await getMatchingAccounts('mail.qq.com');

    expect(accounts.map(a => [a.id, a.tier])).toEqual([
      ['exact', 0],
      ['wild', 1],
    ]);
  });

  it('sameMainDomain 档：精确 → 通配 → apex → 兄弟子域，前缀碰撞仍被排除', async () => {
    await setMode('sameMainDomain');
    const { accounts } = await getMatchingAccounts('mail.qq.com');

    expect(accounts.map(a => [a.id, a.tier])).toEqual([
      ['exact', 0],
      ['wild', 1],
      ['apex', 2],
      ['sibling', 3],
    ]);
  });

  it('本地开发域名按端口过滤，tier 一律下发 0（不参与档位语义）', async () => {
    await setMode('sameMainDomain');
    updatePasswordCache(
      [
        makePasswordEntry({ id: 'p3000', url: 'http://localhost:3000' }),
        makePasswordEntry({ id: 'p8080', url: 'http://localhost:8080' }),
        makePasswordEntry({ id: 'remote', url: 'https://remote.example.com' }),
      ],
      '*',
      true,
    );

    const { accounts } = await getMatchingAccounts('localhost', '3000');
    // 8080 被端口口径挡掉；无端口的 remote 按既有行为放行，但不获跨子域放行（tier 0）
    expect(accounts.map(a => [a.id, a.tier])).toEqual([
      ['p3000', 0],
      ['remote', 0],
    ]);

    // 当前页无端口时放行全部条目（既有行为）：外站条目按 0 下发，不渲染来源标识
    const all = await getMatchingAccounts('localhost', '');
    expect(all.accounts.map(a => [a.id, a.tier])).toEqual([
      ['p3000', 0],
      ['p8080', 0],
      ['remote', 0],
    ]);
  });
});
