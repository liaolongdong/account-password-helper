import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 锁定 / 过期时清空「以明文为键」的派生记忆缓存
 *
 * 背景：大列表性能改造新增了两把模块级记忆缓存——拼音命中区间
 * （`utils/searchMatch/core.ts` 的 `pinyinRangeCache`，键为「条目字段明文 + 关键词」）
 * 与标签呈现记录（`utils/tagUtils.ts` 的 `tagPresentationCache`，键为条目原始 tag 明文）。
 * 二者分别住在本上下文与刻意保活的 SW、可长期常驻的 options 页里：锁定后条目明文
 * 已从 `passwords.value` 移除，缓存却仍把那批明文字段留在内存中可被检索，
 * 与「不延长明文的存活时间、并在锁定/过期/异常路径执行既有清理」的安全基线不符。
 *
 * 锁定不变量（与 CryptoKey 句柄缓存同覆盖范围、同一先例）：
 * 1. 本上下文执行 `clearSession()` → 两把缓存同时失效（锁定、过期、改密三条路径共用该漏斗）；
 * 2. 其他上下文清除了会话（后台经 storage 监听调 `resetSessionMemoryState()`）→ 同样失效；
 * 3. 清空只丢记忆不丢正确性：重新查询得到等价结果。
 *
 * 断言口径：拼音侧用打桩匹配器**计数**（缓存真被清空才会再跑一次多音字 DP），
 * 标签侧用**对象身份**（未清空时恒返回同一冻结数组）。两侧都直接读写真实模块，
 * 因此同时验证了「登记处拿到的清理器就是那把缓存所在的同一实例」，
 * 以及清理**同步落地**（`clearSession()` resolve 时即已生效，不留异步窗口）。
 */

const { matchSpy } = vi.hoisted(() => ({ matchSpy: vi.fn() }));

vi.mock('pinyin-match', () => ({ default: { match: matchSpy } }));

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  deriveSessionKey: vi.fn(async () => 'session-key'),
  encryptData: vi.fn(async () => 'wrapped-data-key'),
  decryptData: vi.fn(async () => 'plain'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(),
  decryptPasswordEntry: vi.fn(),
}));

const { findMatchRange, warmPinyinMatcher } = await import('@/utils/searchMatch/core');
const { buildTagPresentationRecords } = await import('@/utils/tagUtils');
const { clearSession, resetSessionMemoryState } = await import('@/utils/sessionManager-storage');

/** 冲洗微任务与 0ms 定时器，等待 fire-and-forget 的缓存清理落地 */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  matchSpy.mockReset();
  matchSpy.mockReturnValue([0, 1]);
  await warmPinyinMatcher();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('本上下文 clearSession()', () => {
  it('清空拼音命中区间缓存：同一查询锁定后会重跑匹配器', async () => {
    expect(findMatchRange('锁定-拼音', 'gz')).toEqual([0, 1]);
    expect(findMatchRange('锁定-拼音', 'gz')).toEqual([0, 1]);
    expect(matchSpy).toHaveBeenCalledTimes(1);

    await clearSession();
    await flush();
    matchSpy.mockClear();

    // 缓存已清空 → 重新计算，结果口径不变
    expect(findMatchRange('锁定-拼音', 'gz')).toEqual([0, 1]);
    expect(matchSpy).toHaveBeenCalledTimes(1);

    // 新结果仍被记忆，紧接着的重复查询不再跑 DP
    matchSpy.mockClear();
    findMatchRange('锁定-拼音', 'gz');
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('清空标签呈现记录缓存：同一 tag 锁定后返回新的等价记录', async () => {
    const before = buildTagPresentationRecords('锁定-标签甲,锁定-标签乙');
    expect(buildTagPresentationRecords('锁定-标签甲,锁定-标签乙')).toBe(before);

    await clearSession();
    await flush();

    const after = buildTagPresentationRecords('锁定-标签甲,锁定-标签乙');
    expect(after).not.toBe(before);
    // 只丢记忆：颜色与名称逐项等价（同一标签恒得同一颜色）
    expect(after.map(r => r.name)).toEqual(['锁定-标签甲', '锁定-标签乙']);
    expect(after[0].style).toEqual(before[0].style);
  });
});

describe('跨上下文清除会话（resetSessionMemoryState）', () => {
  it('两把明文键缓存同样失效', async () => {
    findMatchRange('他上下文-拼音', 'gz');
    const tagBefore = buildTagPresentationRecords('他上下文-标签');
    expect(matchSpy).toHaveBeenCalledTimes(1);

    resetSessionMemoryState();
    matchSpy.mockClear();

    findMatchRange('他上下文-拼音', 'gz');
    expect(matchSpy).toHaveBeenCalledTimes(1);
    expect(buildTagPresentationRecords('他上下文-标签')).not.toBe(tagBefore);
  });
});
