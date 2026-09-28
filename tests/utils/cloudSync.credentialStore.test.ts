import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 凭证加密存取测试（设计规格 §7.2、§14）
 *
 * 锁定：加密存取往返、锁定后不可读（locked）、错误密钥解密失败（corrupted，
 * 模拟 rekey 后旧密文不可解）、双平台凭证互不覆盖、清除语义。
 *
 * 会话数据密钥从 `@/utils/storage/facades` 接缝注入；加解密走真实
 * `utils/encryption`（AES-256-GCM，Node 原生 Web Crypto），验证真实密文形态。
 */

const { getSessionDataKey } = vi.hoisted(() => ({
  getSessionDataKey: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('@/utils/storage/facades', () => ({
  getSessionDataKey,
}));

import { clearCredentials, loadCredentials, saveCredentials } from '@/utils/cloudSync/credentialStore';

/** 64-char hex 测试密钥（非真实密钥） */
const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);

const FEISHU = { appId: 'cli_test', appSecret: 'secret_test' };
const TENCENT = { clientId: 'cid_test', openId: 'oid_test', accessToken: 'token_test' };

async function readCipher(): Promise<string | undefined> {
  const result = await fakeBrowser.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS);
  return result[STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS] as string | undefined;
}

beforeEach(() => {
  fakeBrowser.reset();
  getSessionDataKey.mockReset();
  getSessionDataKey.mockResolvedValue(KEY_A);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveCredentials / loadCredentials：加密往返', () => {
  it('飞书凭证保存后可读回（status ok）', async () => {
    await saveCredentials('feishu', FEISHU);
    const result = await loadCredentials('feishu');
    expect(result).toEqual({ status: 'ok', credentials: FEISHU });
  });

  it('腾讯凭证保存后可读回', async () => {
    await saveCredentials('tencent', TENCENT);
    const result = await loadCredentials('tencent');
    expect(result).toEqual({ status: 'ok', credentials: TENCENT });
  });

  it('落盘为密文：storage 中不出现凭证原文', async () => {
    await saveCredentials('feishu', FEISHU);
    const cipher = await readCipher();
    expect(cipher).toBeTruthy();
    expect(cipher).not.toContain('secret_test');
    expect(cipher).not.toContain('cli_test');
  });

  it('双平台凭证共存，写入一边不清空另一边', async () => {
    await saveCredentials('feishu', FEISHU);
    await saveCredentials('tencent', TENCENT);
    expect(await loadCredentials('feishu')).toEqual({ status: 'ok', credentials: FEISHU });
    expect(await loadCredentials('tencent')).toEqual({ status: 'ok', credentials: TENCENT });
  });

  it('同平台重复保存覆盖旧值', async () => {
    await saveCredentials('feishu', FEISHU);
    await saveCredentials('feishu', { appId: 'cli_new', appSecret: 'secret_new' });
    const result = await loadCredentials('feishu');
    expect(result.status === 'ok' && result.credentials.appId).toBe('cli_new');
  });
});

describe('loadCredentials：四态结果', () => {
  it('未配置任何凭证 → empty', async () => {
    expect(await loadCredentials('feishu')).toEqual({ status: 'empty' });
  });

  it('仅配置了另一平台 → empty', async () => {
    await saveCredentials('feishu', FEISHU);
    expect(await loadCredentials('tencent')).toEqual({ status: 'empty' });
  });

  it('会话锁定（数据密钥不可得）→ locked', async () => {
    await saveCredentials('feishu', FEISHU);
    getSessionDataKey.mockResolvedValue(null);
    expect(await loadCredentials('feishu')).toEqual({ status: 'locked' });
  });

  it('rekey 后旧密文用新密钥不可解 → corrupted（GCM 校验失败）', async () => {
    await saveCredentials('feishu', FEISHU);
    getSessionDataKey.mockResolvedValue(KEY_B);
    expect(await loadCredentials('feishu')).toEqual({ status: 'corrupted' });
  });

  it('密文损坏（非法 Base64 载荷）→ corrupted', async () => {
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS]: '!!!not-base64!!!' });
    expect(await loadCredentials('feishu')).toEqual({ status: 'corrupted' });
  });

  it('存储读取异常 → empty（降级不抛错）', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('IO'));
    expect(await loadCredentials('feishu')).toEqual({ status: 'empty' });
  });

  it('解密出的 blob 中该平台字段不完整 → empty', async () => {
    // 直接以真实加密写入一个缺字段的 blob
    const enc = await import('@/utils/encryption');
    const cipher = await enc.encryptData(JSON.stringify({ feishu: { appId: '' } }), KEY_A);
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS]: cipher });
    expect(await loadCredentials('feishu')).toEqual({ status: 'empty' });
  });
});

describe('saveCredentials：失败路径', () => {
  it('凭证字段不完整抛错，不落盘', async () => {
    await expect(saveCredentials('feishu', { appId: 'cli_test', appSecret: '' })).rejects.toThrow('凭证字段不完整');
    expect(await readCipher()).toBeUndefined();
  });

  it('会话失效抛错而非静默丢弃（避免假成功）', async () => {
    getSessionDataKey.mockResolvedValue(null);
    await expect(saveCredentials('feishu', FEISHU)).rejects.toThrow('会话已失效');
    expect(await readCipher()).toBeUndefined();
  });

  it('旧密文不可解（rekey 后）时以空聚合重建：本次写入生效，另一平台需重新录入', async () => {
    await saveCredentials('feishu', FEISHU);
    getSessionDataKey.mockResolvedValue(KEY_B);
    // 用新密钥写入腾讯凭证：旧飞书密文不可解，重建 blob
    await saveCredentials('tencent', TENCENT);
    expect(await loadCredentials('tencent')).toEqual({ status: 'ok', credentials: TENCENT });
    expect(await loadCredentials('feishu')).toEqual({ status: 'empty' });
  });
});

describe('clearCredentials', () => {
  it('清除指定平台，保留另一平台', async () => {
    await saveCredentials('feishu', FEISHU);
    await saveCredentials('tencent', TENCENT);
    await clearCredentials('feishu');
    expect(await loadCredentials('feishu')).toEqual({ status: 'empty' });
    expect(await loadCredentials('tencent')).toEqual({ status: 'ok', credentials: TENCENT });
  });

  it('清除最后一个平台后删除存储键', async () => {
    await saveCredentials('feishu', FEISHU);
    await clearCredentials('feishu');
    expect(await readCipher()).toBeUndefined();
  });

  it('会话锁定时静默返回（不抛错）', async () => {
    await saveCredentials('feishu', FEISHU);
    getSessionDataKey.mockResolvedValue(null);
    await expect(clearCredentials('feishu')).resolves.toBeUndefined();
    // 密文仍在，解锁后可恢复读取
    getSessionDataKey.mockResolvedValue(KEY_A);
    expect(await loadCredentials('feishu')).toEqual({ status: 'ok', credentials: FEISHU });
  });

  it('无凭证时清除为无操作', async () => {
    await expect(clearCredentials('tencent')).resolves.toBeUndefined();
  });
});

describe('webdav 凭证校验（WebDAV 规格 §7.4）', () => {
  it('username + password 完整 → 保存并读回', async () => {
    const creds = { username: 'dav-user', password: 'dav-pass' };
    await saveCredentials('webdav', creds);
    expect(await loadCredentials('webdav')).toEqual({ status: 'ok', credentials: creds });
  });

  it('仅 bearerToken（username/password 空）→ 合法', async () => {
    const creds = { username: '', password: '', bearerToken: 'tk-123' };
    await saveCredentials('webdav', creds);
    const result = await loadCredentials('webdav');
    expect(result.status).toBe('ok');
  });

  it('username 有但 password 空且无 bearerToken → 不完整，拒绝保存', async () => {
    await expect(saveCredentials('webdav', { username: 'u', password: '' })).rejects.toThrow('凭证字段不完整');
    expect(await readCipher()).toBeUndefined();
  });

  it('三字段全空 → 拒绝保存', async () => {
    await expect(saveCredentials('webdav', { username: '', password: '' })).rejects.toThrow('凭证字段不完整');
  });

  it('bearerToken 为空串时按 Basic 规则校验（username+password 必须齐全）', async () => {
    await expect(saveCredentials('webdav', { username: 'u', password: '', bearerToken: '' })).rejects.toThrow(
      '凭证字段不完整',
    );
  });

  it('webdav 与飞书/腾讯凭证共存互不覆盖', async () => {
    await saveCredentials('feishu', FEISHU);
    await saveCredentials('webdav', { username: 'dav', password: 'p' });
    await saveCredentials('tencent', TENCENT);
    expect((await loadCredentials('feishu')).status).toBe('ok');
    expect((await loadCredentials('webdav')).status).toBe('ok');
    expect((await loadCredentials('tencent')).status).toBe('ok');
  });
});
