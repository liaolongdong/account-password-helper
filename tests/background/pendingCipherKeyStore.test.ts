/**
 * 待保存凭据密钥仓（S2）回归测试
 *
 * 背景：LoginAutoSave 曾把「待确认凭据密文」和「解密它的 XOR 密钥」一起放在宿主页面
 * sessionStorage 中，页面任意脚本一次读取即可还原明文账号密码。修复方案把密钥收进
 * 仅扩展上下文可见的 chrome.storage.session（默认 TRUSTED_CONTEXTS，内容脚本读不到），
 * 密文容器与键名不变（写入改为异步后，次序由内容脚本侧的代数守卫保证），因此密钥仓必须满足：
 * 按 tab + origin 稳定复用（同站导航后新文档仍能解回）、跨 origin/tab 隔离、
 * 绝不出现在 storage.local、无有效上下文时拒绝签发。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { issuePendingCipherKey, PENDING_CIPHER_KEY_TTL_MS } from '@/entrypoints/background/pendingCipherKeyStore';

/** 构造内容脚本发送方上下文 */
const contentSender = (url: string, tabId = 1): chrome.runtime.MessageSender =>
  ({ id: chrome.runtime.id, tab: { id: tabId, url } }) as chrome.runtime.MessageSender;

const readStore = async (): Promise<Record<string, { k: string; t: number }>> => {
  const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS);
  return (result[SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS] as Record<string, { k: string; t: number }>) ?? {};
};

describe('issuePendingCipherKey', () => {
  beforeEach(async () => {
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
  });

  it('同一 tab 同一 origin 重复申请返回同一密钥（同站导航后可解回旧密文）', async () => {
    const first = await issuePendingCipherKey(contentSender('https://example.com/login'));
    const second = await issuePendingCipherKey(contentSender('https://example.com/dashboard'));

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('密钥为 32 字节随机值的 hex 表示', async () => {
    const key = await issuePendingCipherKey(contentSender('https://example.com/'));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('opaque origin（about:blank）拒绝签发：其归属无法与密文容器一一对应', async () => {
    expect(await issuePendingCipherKey(contentSender('about:blank'))).toBeNull();
    expect(await readStore()).toEqual({});
  });

  it('不同 origin 之间密钥隔离', async () => {
    const a = await issuePendingCipherKey(contentSender('https://a.example/'));
    const b = await issuePendingCipherKey(contentSender('https://b.example/'));
    expect(a).not.toBe(b);
  });

  it('同一 origin 在不同 tab 之间密钥隔离', async () => {
    const a = await issuePendingCipherKey(contentSender('https://example.com/', 1));
    const b = await issuePendingCipherKey(contentSender('https://example.com/', 2));
    expect(a).not.toBe(b);
  });

  it('仅落在 storage.session 的单一聚合键下，storage.local 零痕迹', async () => {
    await issuePendingCipherKey(contentSender('https://example.com/'));

    const localAll = await chrome.storage.local.get(null);
    expect(Object.keys(localAll)).toEqual([]);
    expect(Object.keys(await readStore())).toHaveLength(1);
  });

  it('无 tab 上下文或无 url 时拒绝签发，且不写入任何存储', async () => {
    expect(await issuePendingCipherKey({ id: chrome.runtime.id } as chrome.runtime.MessageSender)).toBeNull();
    expect(
      await issuePendingCipherKey({ id: chrome.runtime.id, tab: { url: 'https://example.com/' } } as never),
    ).toBeNull();
    expect(await issuePendingCipherKey({ id: chrome.runtime.id, tab: { id: 1 } } as never)).toBeNull();

    expect(await readStore()).toEqual({});
  });

  it('并发申请不同 origin 的密钥互不覆盖', async () => {
    const keys = await Promise.all(
      ['https://a.example/', 'https://b.example/', 'https://c.example/'].map(url =>
        issuePendingCipherKey(contentSender(url)),
      ),
    );

    expect(new Set(keys).size).toBe(3);
    expect(Object.keys(await readStore())).toHaveLength(3);
  });

  it('超过 TTL 的旧密钥在下次申请时被清除', async () => {
    await issuePendingCipherKey(contentSender('https://stale.example/'));

    const stale = await readStore();
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS]: Object.fromEntries(
        Object.entries(stale).map(([storageKey, entry]) => [
          storageKey,
          { ...entry, t: Date.now() - PENDING_CIPHER_KEY_TTL_MS - 1 },
        ]),
      ),
    });

    const fresh = await issuePendingCipherKey(contentSender('https://fresh.example/'));

    const entries = Object.values(await readStore());
    expect(entries).toHaveLength(1);
    expect(entries[0].k).toBe(fresh);
  });
});
