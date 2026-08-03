import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * passwordCrud.ts 单元测试
 *
 * 覆盖：
 * - isMetadataOnlyChange：安全/正确性闸门（SW 与面板两上下文共用），
 *   仅元数据差异放行、增删/敏感字段差异/边界态一律拒绝；
 * - updatePasswordInSession 防抖 flush：同 ID 多次更新合并、后到覆盖先到、
 *   取消收藏 favoriteUsedAt:undefined 落盘后键被删除（chrome.storage JSON 语义）、
 *   flush 前打标 METADATA_FLUSH_AT、无匹配条目不落盘。
 *
 * chrome.storage 以内存桩打桩并在 set 时做 JSON 往返，模拟真实
 * chrome.storage 的序列化语义（undefined 值丢弃即删键），保持测试 hermetic。
 */

let localStore: Record<string, unknown>;
let sessionStore: Record<string, unknown>;

/** 模拟 chrome.storage 的 JSON 序列化：undefined 值被丢弃（等价删键） */
const jsonRoundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const localGet = vi.fn(async (key: string) => (key in localStore ? { [key]: localStore[key] } : {}));
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(items)) {
    localStore[key] = jsonRoundTrip(value);
  }
});
const sessionSet = vi.fn(async (items: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(items)) {
    sessionStore[key] = jsonRoundTrip(value);
  }
});
const sessionRemove = vi.fn(async (key: string) => {
  delete sessionStore[key];
});

beforeEach(() => {
  localStore = {};
  sessionStore = {};
  localGet.mockClear();
  localSet.mockClear();
  sessionSet.mockClear();
  sessionRemove.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet },
      session: { set: sessionSet, remove: sessionRemove },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

import { isMetadataOnlyChange, updatePasswordInSession } from '@/utils/storage/passwordCrud';

// ==================== isMetadataOnlyChange ====================

/** 构造 at-rest 条目（敏感字段为「密文字符串」形态，含 encrypted 标记） */
const atRestEntry = (overrides: Record<string, unknown> = {}) => ({
  ...makePasswordEntry({ id: '1', username: 'cipher-user', password: 'cipher-pass' }),
  encrypted: true,
  favorite: false,
  lastUsedAt: 0,
  ...overrides,
});

describe('isMetadataOnlyChange', () => {
  it('仅元数据字段差异（收藏/使用时间戳）时返回 true', () => {
    const oldValue = [atRestEntry()];
    const newValue = [atRestEntry({ favorite: true, favoriteUsedAt: 123, lastUsedAt: 456 })];
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(true);
  });

  it('元数据键被删除（取消收藏移除 favoriteUsedAt）时返回 true', () => {
    const oldValue = [atRestEntry({ favorite: true, favoriteUsedAt: 123 })];
    const newValue = [atRestEntry({ favorite: false })];
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(true);
  });

  it('敏感字段密文变化（条目被编辑）时返回 false', () => {
    const oldValue = [atRestEntry()];
    const newValue = [atRestEntry({ password: 'cipher-pass-v2' })];
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(false);
  });

  it('条目数量变化（新增/删除）时返回 false', () => {
    const oldValue = [atRestEntry()];
    const newValue = [atRestEntry(), atRestEntry({ id: '2' })];
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(false);
  });

  it('条目顺序/ID 变化时返回 false', () => {
    const oldValue = [atRestEntry({ id: '1' }), atRestEntry({ id: '2' })];
    const newValue = [atRestEntry({ id: '2' }), atRestEntry({ id: '1' })];
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(false);
  });

  it('两个空数组返回 true（无差异）', () => {
    expect(isMetadataOnlyChange([], [])).toBe(true);
  });

  it('非数组输入返回 false', () => {
    expect(isMetadataOnlyChange(undefined, [atRestEntry()])).toBe(false);
    expect(isMetadataOnlyChange([atRestEntry()], null)).toBe(false);
  });

  it('含缺失条目（undefined）时返回 false', () => {
    expect(isMetadataOnlyChange([atRestEntry()], [undefined])).toBe(false);
  });
});

// ==================== updatePasswordInSession 防抖 flush ====================

describe('updatePasswordInSession 防抖 flush', () => {
  it('取消收藏 favoriteUsedAt:undefined 落盘后键被删除', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [
      jsonRoundTrip(makePasswordEntry({ id: 'a', favorite: true, favoriteUsedAt: 111 })),
    ];
    vi.useFakeTimers();

    const pending = updatePasswordInSession('a', { favorite: false, favoriteUsedAt: undefined });
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    const saved = localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;
    expect(saved[0].favorite).toBe(false);
    expect('favoriteUsedAt' in saved[0]).toBe(false);
  });

  it('flush 前先打标 METADATA_FLUSH_AT（SW 元数据识别依据）', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(makePasswordEntry({ id: 'a' }))];
    vi.useFakeTimers();

    const pending = updatePasswordInSession('a', { lastUsedAt: 999 });
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(sessionSet).toHaveBeenCalled();
    expect(sessionStore[SESSION_MEMORY_KEYS.METADATA_FLUSH_AT]).toBeTypeOf('number');
  });

  it('防抖窗口内同 ID 多次更新合并为单次写入，后到覆盖先到', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(makePasswordEntry({ id: 'a' }))];
    vi.useFakeTimers();

    const first = updatePasswordInSession('a', { lastUsedAt: 100 });
    const second = updatePasswordInSession('a', { lastUsedAt: 200, favorite: true });
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all([first, second]);

    expect(localSet).toHaveBeenCalledTimes(1);
    const saved = localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;
    expect(saved[0].lastUsedAt).toBe(200);
    expect(saved[0].favorite).toBe(true);
  });

  it('队列中无匹配条目时不落盘（不写空变更）', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(makePasswordEntry({ id: 'other' }))];
    vi.useFakeTimers();

    const pending = updatePasswordInSession('not-exist', { lastUsedAt: 100 });
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(localSet).not.toHaveBeenCalled();
  });

  it('收藏传入原 updateTime 时保持不变（只改收藏时间，不推高 updateTime）', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(makePasswordEntry({ id: 'a', updateTime: 555 }))];
    vi.useFakeTimers();

    const pending = updatePasswordInSession('a', { favorite: true, favoriteUsedAt: 123, updateTime: 555 });
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    const saved = localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;
    expect(saved[0].favorite).toBe(true);
    expect(saved[0].favoriteUsedAt).toBe(123);
    expect(saved[0].updateTime).toBe(555);
  });

  it('填充类更新未传 updateTime 时默认推高为当前时间', async () => {
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(makePasswordEntry({ id: 'a', updateTime: 555 }))];
    vi.useFakeTimers();

    const pending = updatePasswordInSession('a', { lastUsedAt: 999 });
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    const saved = localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;
    expect(saved[0].updateTime).not.toBe(555);
    expect(saved[0].updateTime).toBeTypeOf('number');
  });
});
