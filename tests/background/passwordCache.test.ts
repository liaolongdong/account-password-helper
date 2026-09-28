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
 *
 * 还钉住内联下拉下发口径的两件事：一次响应的条目上界（超出部分只报总数、
 * 不为被截断的条目生成 favicon dataURL），以及主密码存在性只在锁定分支才被读一次。
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

/**
 * 主密码存在性判定的打桩
 *
 * 本波次把这一趟 `storage.local` 读从 `getMatchingAccounts` 入口挪进了「确实要返回
 * 锁定态」那条分支，于是「有效会话的检索路径上它一次都不该被调用」成了需要断言的
 * 性能不变量。整模块 mock 会连这条往返一起屏蔽掉、断言失去意义，因此走 partial mock，
 * 其余导出（`setMasterPassword` 等）保持真实实现。
 */
const masterPasswordMocks = vi.hoisted(() => ({
  hasMasterPassword: vi.fn(async () => true),
}));

vi.mock('@/utils/storage/masterPassword', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage/masterPassword')>();
  return { ...actual, hasMasterPassword: masterPasswordMocks.hasMasterPassword };
});

import {
  applyMetadataOnlyUpdate,
  consumePendingTotp,
  getCachedDomainMatchMode,
  getDecryptedEntryById,
  getCachedPasswords,
  getInlineTotpCode,
  getMatchingAccounts,
  INLINE_MAX_RESULT_ROWS,
  invalidatePasswordCache,
  resetCredentialAccessBarrierForStartup,
  resetDomainMatchModeMirror,
  sortMatchesForDomain,
  updatePasswordCache,
} from '@/entrypoints/background/passwordCache';
import { fetchFaviconDataUrl } from '@/utils/favicon';
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

describe('getMatchingAccounts 的关键词检索（内联下拉的拼音档）', () => {
  /**
   * 三条目同 host，检索字段分布在用户名 / 标签 / 备注三个不同字段上，
   * 用来证明后台过滤与侧边栏共用同一份字段清单（`keywordFieldsOf`）；
   * `li` 的密码刻意取 `zhangsan-secret`——与 `zhang` 的用户名全拼同形，
   * 一旦密码参与匹配该串就会命中，反向坐实「密码不出扩展、也不进检索」。
   * updateTime 互不相同，使默认排序（及其子序列关系）成为可判定断言。
   */
  const SEARCH_ENTRIES: PasswordEntry[] = [
    makePasswordEntry({ id: 'zhang', url: 'example.com', username: '张三', tag: '工作', updateTime: 3 }),
    makePasswordEntry({
      id: 'li',
      url: 'example.com',
      username: '李四',
      remark: '生产环境只读',
      password: 'zhangsan-secret',
      updateTime: 2,
    }),
    makePasswordEntry({ id: 'note', url: 'example.com', username: 'svc', tag: '工作资料', updateTime: 1 }),
  ];

  beforeEach(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'h', salt: 's' },
    });
    updatePasswordCache(SEARCH_ENTRIES, '*', true);
  });

  /** 取某个关键词下的命中 id 序列（省略关键词即全量口径） */
  const idsOf = async (keyword?: string): Promise<string[]> => {
    const { accounts } = await getMatchingAccounts('example.com', '', keyword);
    return accounts.map(a => a.id);
  };

  it('省略关键词与空白关键词均返回全量，与拆分前口径一致', async () => {
    const all = await idsOf();
    expect(all).toHaveLength(3);
    expect(await idsOf('')).toEqual(all);
    expect(await idsOf('   ')).toEqual(all);
  });

  it('中文用户名的首字母缩写与全拼都命中（拼音能力落在后台，内容脚本无需加载 chunk）', async () => {
    expect(await idsOf('zs')).toEqual(['zhang']);
    expect(await idsOf('lisi')).toEqual(['li']);
  });

  it('标签与备注同属检索字段：备注命中的条目会被保留', async () => {
    expect(await idsOf('schj')).toEqual(['li']);
    expect(await idsOf('gz')).toEqual(['zhang', 'note']);
  });

  it('过滤只做减法、不重排：命中顺序始终是全量顺序的子序列', async () => {
    const order = await idsOf();
    const hits = await idsOf('gz');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(order.length);

    let cursor = 0;
    for (const id of hits) {
      cursor = order.indexOf(id, cursor);
      expect(cursor, `命中顺序被重排: ${hits.join('→')} 不属于 ${order.join('→')}`).toBeGreaterThanOrEqual(0);
      cursor += 1;
    }
  });

  it('密码字段不参与匹配：以条目自身密码为关键词不命中任何账号', async () => {
    expect(await idsOf('zhangsan')).toEqual(['zhang']);
    expect(await idsOf('zhangsan-secret')).toEqual([]);
  });

  it('检索不改变 crossDomainCount 的口径：本站有账号时恒为 0', async () => {
    const { crossDomainCount } = await getMatchingAccounts('example.com', '', 'zzzz-无匹配');
    expect(crossDomainCount).toBe(0);
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

/**
 * 内联下拉一次下发的条目上界
 *
 * 放宽档位下本站匹配集可以覆盖整库（2000 条上限），而内联面板是贴在登录框上的下拉层：
 * 上界必须砍在「排序之后、逐条组装之前」，才能既保住「内联首条 == 侧边栏首条」这条同源
 * 不变量，又不为看不见的行生成 favicon dataURL（一条就是 KB 级的 runtime 消息体）。
 */
describe('getMatchingAccounts 的条目上界与命中总数', () => {
  /** 造 N 条同 host 条目：`hitCount` 条的标签可被关键词 `alp` 命中，其余不可 */
  const buildEntries = (total: number, hitCount = total): PasswordEntry[] =>
    Array.from({ length: total }, (_, i) =>
      makePasswordEntry({
        id: `e${i}`,
        url: 'example.com',
        tag: i < hitCount ? 'alp' : 'zzz',
        updateTime: i,
      }),
    );

  /** 上界之外再多 20 条，够证明「截断发生」又不至于让夹具本身变慢 */
  const OVER_CAP_TOTAL = INLINE_MAX_RESULT_ROWS + 20;

  beforeEach(() => {
    masterPasswordMocks.hasMasterPassword.mockResolvedValue(true);
    // 档位实现值会被前面的 describe 留下（mockResolvedValue 不随 clearAllMocks 复位），
    // 本组用例只关心「上界切在哪」，显式钉回缺省档避免跨 describe 串味
    configMocks.getDomainMatchConfig.mockResolvedValue({ mode: 'off' });
    resetDomainMatchModeMirror();
  });

  it('超出上界时只下发前 N 条，且这 N 条就是侧边栏顺序的前 N 条', async () => {
    const entries = buildEntries(OVER_CAP_TOTAL);
    updatePasswordCache(entries, '*', true);

    const response = await getMatchingAccounts('example.com');
    // 期望顺序由同一份排序函数（侧边栏与内联共用的那条路径）独立算出，
    // 断言「截断保留了正确的头部」而不是「截断保留了输入顺序」
    const expectedOrder = (await sortMatchesForDomain(entries, 'example.com', '')).slice(0, INLINE_MAX_RESULT_ROWS);

    expect(response.accounts.map(a => a.id)).toEqual(expectedOrder.map(e => e.id));
    expect(response.totalMatched).toBe(OVER_CAP_TOTAL);
  });

  it('被截断的条目不再产出 favicon dataURL（消息体的主要成本）', async () => {
    updatePasswordCache(buildEntries(OVER_CAP_TOTAL), '*', true);

    await getMatchingAccounts('example.com');

    // 每条都要取图的上界：`fetchFaviconDataUrl` 的调用次数即「真正下发出去的行数」
    expect(fetchFaviconDataUrl).toHaveBeenCalledTimes(INLINE_MAX_RESULT_ROWS);
  });

  it('关键词命中数才是上界与总数的口径：截断发生在检索之后', async () => {
    const hitCount = INLINE_MAX_RESULT_ROWS + 10;
    updatePasswordCache(buildEntries(OVER_CAP_TOTAL, hitCount), '*', true);

    const response = await getMatchingAccounts('example.com', '', 'alp');

    // 未命中的 10 条不该被算进 totalMatched，否则尾部的「还有 N 条」读数会虚高
    expect(response.totalMatched).toBe(hitCount);
    expect(response.accounts).toHaveLength(INLINE_MAX_RESULT_ROWS);
    expect(response.accounts.every(a => a.tag === 'alp')).toBe(true);
  });

  it('未触顶时 totalMatched 与实际下发条数相等（内容脚本据此不显示读数）', async () => {
    const small = buildEntries(3);
    updatePasswordCache(small, '*', true);

    const all = await getMatchingAccounts('example.com');
    expect(all.accounts).toHaveLength(3);
    expect(all.totalMatched).toBe(3);

    // 检索后一条不剩：总数与列表同为 0，而不是留下「还有 3 条」的错误读数
    const none = await getMatchingAccounts('example.com', '', 'zzzz-无匹配');
    expect(none.accounts).toEqual([]);
    expect(none.totalMatched).toBe(0);
  });
});

/**
 * 主密码存在性判定的时机
 *
 * 「已锁定」与「从未设置主密码」共用一次 `storage.local` 读，但内联下拉的每一次防抖检索
 * 都会走到这里：判定留在入口时，Windows 慢盘 / 杀软扫描下每敲一段关键词就多一趟存储往返。
 * 依据是会话有效即主密码配置存在（重置全部数据先 `lockSession()` 再 `clearAllData()`），
 * 因此把这次读取收进锁定分支，同时保住两条锁定语义可区分。
 */
describe('getMatchingAccounts 读取主密码配置的时机', () => {
  beforeEach(() => {
    updatePasswordCache([makePasswordEntry({ id: 'a', url: 'example.com' })], '*', true);
  });

  it('会话有效的正常检索（含带关键词的防抖检索）一趟都不读主密码配置', async () => {
    masterPasswordMocks.hasMasterPassword.mockResolvedValue(true);

    const response = await getMatchingAccounts('example.com');
    expect(response.locked).toBe(false);
    await getMatchingAccounts('example.com', '', 'a');

    expect(masterPasswordMocks.hasMasterPassword).not.toHaveBeenCalled();
  });

  it('会话失效且已设置主密码：只报锁定，不带 noMasterPassword', async () => {
    sessionMocks.isSessionActiveSync.mockReturnValueOnce(false);
    sessionMocks.isSessionValid.mockResolvedValueOnce(false);
    masterPasswordMocks.hasMasterPassword.mockResolvedValueOnce(true);

    expect(await getMatchingAccounts('example.com')).toEqual({ locked: true, accounts: [] });
    expect(masterPasswordMocks.hasMasterPassword).toHaveBeenCalledTimes(1);
  });

  it('从未设置主密码：锁定响应额外带 noMasterPassword，供面板渲染设置引导卡片', async () => {
    sessionMocks.isSessionActiveSync.mockReturnValueOnce(false);
    sessionMocks.isSessionValid.mockResolvedValueOnce(false);
    masterPasswordMocks.hasMasterPassword.mockResolvedValueOnce(false);

    expect(await getMatchingAccounts('example.com')).toEqual({
      locked: true,
      noMasterPassword: true,
      accounts: [],
    });
  });
});
