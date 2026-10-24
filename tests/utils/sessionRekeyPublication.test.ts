import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

const KEY = '1234567890abcdef'.repeat(4);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

describe('rekey session publication', () => {
  it('prepares wrapped material without publishing an uncommitted key', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const beforeLocal = await chrome.storage.local.get(null);
    const beforeSession = await chrome.storage.session.get(null);
    const prepared = await session.prepareSessionRekey(KEY, 24);
    expect(prepared[session.SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeTypeOf('string');
    expect(await chrome.storage.local.get(null)).toEqual(beforeLocal);
    expect(await chrome.storage.session.get(null)).toEqual(beforeSession);
    expect(await session.getSessionDataKey()).toBeNull();
  });

  it('does not publish until the matching local commit exists', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await session.publishSessionRekey(KEY, prepared);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
    await chrome.storage.local.set(prepared);
    await session.publishSessionRekey(KEY, prepared);
    expect((await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY]).toBe(KEY);
  });

  it('cannot republish prepared material after the session was locked', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    await session.clearSession();
    await session.publishSessionRekey(KEY, prepared);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
  });
});
