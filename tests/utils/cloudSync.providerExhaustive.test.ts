import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getCloudSyncConfig, getDocKey, patchProviderConfig } from '@/utils/cloudSync/configStore';
import { sanitizeEntry } from '@/utils/cloudSync/auditLog';
import type { AuditEntry } from '@/utils/cloudSync/types';

/**
 * provider 穷尽分派守卫（WebDAV 规格 §2）
 *
 * 锁定：每个 provider 的配置 / docKey / 审计平台字段都落在自己名下，
 * 防止二元分支把新 provider 静默归入错误平台（无报错的数据错误）。
 */
beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('provider 穷尽分派', () => {
  it('getDocKey：各 provider 读各自 target 字段', () => {
    expect(getDocKey('feishu', { appToken: 'a', tableId: 't', fileUrl: null })).toBe('a:t');
    expect(getDocKey('tencent', { fileId: 'f', sheetId: 's', fileUrl: null })).toBe('f:s');
    expect(getDocKey('feishu', { appToken: 'a', tableId: null, fileUrl: null })).toBeNull();
  });

  it('getDocKey：webdav 读 backupDirUrl，未探测时 null', () => {
    expect(
      getDocKey('webdav', {
        dirUrl: 'https://x/dav/',
        backupDirUrl: 'https://x/dav/aph-backup/',
        allowInsecure: false,
      }),
    ).toBe('https://x/dav/aph-backup/');
    expect(getDocKey('webdav', { dirUrl: 'https://x/dav/', backupDirUrl: null, allowInsecure: false })).toBeNull();
  });

  it('patchProviderConfig：写入落在对应 provider 名下，不污染另一边', async () => {
    await patchProviderConfig('tencent', { configured: true });
    const config = await getCloudSyncConfig();
    expect(config.providers.tencent.configured).toBe(true);
    expect(config.providers.feishu.configured).toBe(false);
    expect(config.providers.webdav.configured).toBe(false);
  });

  it('patchProviderConfig：webdav 写入自己名下且 mode 强制 encrypted', async () => {
    await patchProviderConfig('webdav', { configured: true, mode: 'plaintext' });
    const config = await getCloudSyncConfig();
    expect(config.providers.webdav.configured).toBe(true);
    expect(config.providers.webdav.mode).toBe('encrypted');
    expect(config.providers.tencent.configured).toBe(false);
    expect(config.providers.feishu.configured).toBe(false);
  });

  it('默认配置含 webdav 项：target 三字段齐全，mode=encrypted', async () => {
    const config = await getCloudSyncConfig();
    expect(config.providers.webdav).toEqual({
      configured: false,
      mode: 'encrypted',
      chunkSize: 48000,
      lastSyncAt: null,
      target: { dirUrl: null, backupDirUrl: null, allowInsecure: false },
    });
  });

  it('sanitizeEntry：合法 provider 原样保留，非法值回退 feishu（安全默认）', () => {
    const base: AuditEntry = { at: 1, provider: 'tencent', mode: 'encrypted', action: 'backup', docKey: 'd' };
    expect(sanitizeEntry(base).provider).toBe('tencent');
    expect(sanitizeEntry({ ...base, provider: 'feishu' }).provider).toBe('feishu');
    expect(sanitizeEntry({ ...base, provider: 'webdav' }).provider).toBe('webdav');
    expect(sanitizeEntry({ ...base, provider: 'bogus' as never }).provider).toBe('feishu');
  });
});
