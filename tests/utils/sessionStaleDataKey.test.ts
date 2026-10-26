import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

/**
 * 跨上下文换钥后的「陈旧明文数据密钥」回归
 *
 * `storage.session` 里的 DATA_KEY 是明文数据密钥的跨上下文缓存，本身不携带版本。
 * 恢复 / 改密提交新钥后，另一个上下文可能在 `adoptRekeyedSession` 之前就读到旧缓存，
 * 带着旧钥写回五域密文——新密文用旧钥加密，全库当场解不开。
 * 因此缓存必须绑定它对应的那份 `WRAPPED_DATA_KEY`，配对不符就当没有。
 */
const DK_OLD = 'a'.repeat(64);
const DK_NEW = 'b'.repeat(64);

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

/** 用可控的假加密把「包裹密钥 → 明文密钥」做成可逆映射，避免真实 PBKDF2 拖慢判据 */
async function loadWithFakeCrypto() {
  vi.doMock('@/utils/encryption', () => ({
    encryptData: async (data: string, key: string) => `${key}|${data}`,
    decryptData: async (packed: string) => packed.split('|')[1],
    deriveEncryptionKey: async () => DK_NEW,
    deriveVerifierHash: async () => 'verifier',
    clearCryptoKeyCache: () => {},
  }));
  return import('@/utils/sessionManager-storage');
}

describe('getSessionDataKey 陈旧缓存门禁', () => {
  it('缓存里的明文密钥不再匹配盘上已提交的包裹密钥时，必须回源解包而不是交回旧钥', async () => {
    const session = await loadWithFakeCrypto();
    // 旧会话：盘上是一对旧钥材料，跨上下文缓存里躺着旧明文密钥
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAP_KEY]: 'wrap-old',
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrap-old|' + DK_OLD,
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 3_600_000,
      [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
    });
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: DK_OLD });

    // 另一个上下文完成换钥并提交新的一对（此时本上下文还没收到 storage 变更事件）
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAP_KEY]: 'wrap-new',
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrap-new|' + DK_NEW,
    });

    expect(await session.getSessionDataKey()).toBe(DK_NEW);
  });

  it('缓存与盘上配对一致时沿用快路径，不重复解包', async () => {
    const session = await loadWithFakeCrypto();
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAP_KEY]: 'wrap-old',
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrap-old|' + DK_OLD,
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 3_600_000,
      [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
    });
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.DATA_KEY]: DK_OLD,
      [SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED]: 'wrap-old|' + DK_OLD,
    });

    expect(await session.getSessionDataKey()).toBe(DK_OLD);
  });

  it('发布新会话材料时把配对标识一起写进缓存，供其它上下文核对', async () => {
    const session = await loadWithFakeCrypto();
    const prepared = await session.prepareSessionRekey(DK_NEW, 24);
    await chrome.storage.local.set(prepared);
    await session.publishSessionRekey(DK_NEW, prepared);

    const cached = await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED);
    expect(cached[SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED]).toBe(prepared[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]);
  });
});
