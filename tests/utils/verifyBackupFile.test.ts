import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { verifyBackupFile } from '@/utils/backup/verifyBackupFile';
import { BackupImportUserError, exportEncryptedBackup } from '@/utils/backupExport';
import { buildIdentityBackupData, encryptIdentityBackup } from '@/utils/identity/backup';
import { MAX_PASSWORD_IMPORT_INPUT_BYTES } from '@/utils/backup/constants';
import { MAX_IDENTITY_IMPORT_INPUT_BYTES } from '@/utils/identity/constants';
import { PBKDF2_ITERATIONS } from '@/utils/cryptoParams';
import { currentLocale, registerMessages, t } from '@/utils/i18n';
import zhOptions from '@/utils/i18n/locales/zh-CN/options.json';
import enOptions from '@/utils/i18n/locales/en/options.json';
import zhBackup from '@/utils/i18n/locales/zh-CN/backup.json';
import enBackup from '@/utils/i18n/locales/en/backup.json';

const { markVerifiedBackupAt } = vi.hoisted(() => ({ markVerifiedBackupAt: vi.fn() }));
vi.mock('@/utils/storage/configManager', () => ({ markVerifiedBackupAt }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));

registerMessages('zh-CN', zhOptions, zhBackup);
registerMessages('en', enOptions, enBackup);

/** 全部凭据仅为合成夹具；PBKDF2 / AES-GCM 均走真实 Web Crypto。 */
const PASSWORD = 'synthetic-export-password';
const passwordData = {
  version: 1,
  exportedAt: 1,
  count: 1,
  entries: [{ username: 'fixture-only', password: 'not-a-real-credential', url: 'https://example.invalid' }],
};
const identityData = buildIdentityBackupData([
  {
    id: 'fixture-id',
    encryptedPayload: '',
    createTime: 1,
    updateTime: 2,
    payload: { pv: 1, category: 'person', name: 'Synthetic record' },
  },
]);

/** 独立构造旧版 .aph 字节布局，也用于真实加密的非法结构测试。 */
async function encryptedFixture(data: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSWORD), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return new Uint8Array([...salt, ...iv, ...new Uint8Array(ciphertext)]);
}

const fixtureFile = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name);

beforeEach(() => {
  fakeBrowser.reset();
  vi.stubGlobal('chrome', fakeBrowser);
  currentLocale.value = 'zh-CN';
  markVerifiedBackupAt.mockClear();
  // 仅降低测试派生成本，不伪造加解密结果，也不更改生产参数。
  const deriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation((algorithm, ...args) =>
    deriveKey(
      typeof algorithm === 'object' && algorithm.name === 'PBKDF2'
        ? ({ ...algorithm, iterations: 2_000 } as Pbkdf2Params)
        : algorithm,
      ...args,
    ),
  );
  for (const area of [chrome.storage.local, chrome.storage.session, chrome.storage.sync]) {
    vi.spyOn(area, 'set');
    vi.spyOn(area, 'remove');
    vi.spyOn(area, 'clear');
  }
});

afterEach(() => {
  // 所有成功和失败路径都不得导入、清空、更新备份状态或写入会话。
  for (const area of [chrome.storage.local, chrome.storage.session, chrome.storage.sync]) {
    expect(area.set).not.toHaveBeenCalled();
    expect(area.remove).not.toHaveBeenCalled();
    expect(area.clear).not.toHaveBeenCalled();
  }
  expect(markVerifiedBackupAt).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  currentLocale.value = 'zh-CN';
});

describe('verifyBackupFile 只读备份验证', () => {
  it('现有 .aph 导出字节往返后仅返回类型和条数，不返回明文', async () => {
    let exported: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      exported = blob as Blob;
      return 'blob:synthetic-backup';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', {
      createElement: () => ({ click() {}, href: '', download: '' }),
      body: { appendChild() {}, removeChild() {} },
    });
    await exportEncryptedBackup(
      [{ id: 'fixture', order: 0, ...passwordData.entries[0], tag: '', remark: '', createTime: 1, updateTime: 2 }],
      PASSWORD,
    );
    markVerifiedBackupAt.mockClear();
    expect(exported).toBeDefined();
    const file = new File([exported!], 'export.APH');
    await expect(verifyBackupFile(file, `  ${PASSWORD}\n`)).resolves.toEqual({ kind: 'passwords', count: 1 });
  });

  it('现有 .aphid 加密 API 往返，大小写扩展名和密码 trim 与 .aph 一致', async () => {
    const bytes = await encryptIdentityBackup(identityData, PASSWORD);
    await expect(verifyBackupFile(fixtureFile(bytes, 'export.ApHiD'), ` ${PASSWORD} `)).resolves.toEqual({
      kind: 'identities',
      count: 1,
    });
  });

  it('兼容旧版 .aph 容器，不依赖任何当前主密码或会话', async () => {
    const bytes = await encryptedFixture(passwordData);
    await expect(verifyBackupFile(fixtureFile(bytes, 'legacy.aph'), PASSWORD)).resolves.toEqual({
      kind: 'passwords',
      count: 1,
    });
  });

  it.each(['aph', 'aphid'])('%s 空备份成功返回 0，不能把空结果当失败', async extension => {
    const data =
      extension === 'aph' ? { ...passwordData, count: 0, entries: [] } : { ...identityData, count: 0, records: [] };
    await expect(
      verifyBackupFile(fixtureFile(await encryptedFixture(data), `empty.${extension}`), PASSWORD),
    ).resolves.toEqual({
      kind: extension === 'aph' ? 'passwords' : 'identities',
      count: 0,
    });
  });

  it.each(['aph', 'aphid'])('%s 错误密码和被篡改密文均不返回成功', async extension => {
    const data = extension === 'aph' ? passwordData : identityData;
    const bytes = await encryptedFixture(data);
    await expect(verifyBackupFile(fixtureFile(bytes, `wrong.${extension}`), 'wrong-password')).rejects.toThrow(
      t('backup.wrongPasswordOrCorrupted'),
    );
    bytes[bytes.length - 1] ^= 0xff;
    await expect(verifyBackupFile(fixtureFile(bytes, `damaged.${extension}`), PASSWORD)).rejects.toThrow(
      t('backup.wrongPasswordOrCorrupted'),
    );
  });

  it.each(['aph', 'aphid'])('%s 截断文件拒绝并提供可读错误', async extension => {
    await expect(verifyBackupFile(fixtureFile(new Uint8Array(28), `short.${extension}`), PASSWORD)).rejects.toThrow(
      t('backup.invalidFile'),
    );
  });

  it.each(['aph', 'aphid'])('%s 已认证但 count/记录结构错误仍拒绝', async extension => {
    const bytes = await encryptedFixture({ ...(extension === 'aph' ? passwordData : identityData), count: 99 });
    await expect(verifyBackupFile(fixtureFile(bytes, `invalid.${extension}`), PASSWORD)).rejects.toThrow(
      t('backup.invalidStructure'),
    );
  });

  it.each(['json', 'csv', 'aph.exe', ''])('不支持的后缀 %s 在读取前拒绝', async extension => {
    const file = new File(['not-read'], `backup.${extension}`);
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(verifyBackupFile(file, PASSWORD)).rejects.toThrow(t('options.forgot.checkUnsupported'));
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['aph', MAX_PASSWORD_IMPORT_INPUT_BYTES],
    ['aphid', MAX_IDENTITY_IMPORT_INPUT_BYTES],
  ] as const)('%s 超大文件在读取前拒绝', async (extension, max) => {
    const file = new File([], `large.${extension}`);
    Object.defineProperty(file, 'size', { value: max + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(verifyBackupFile(file, PASSWORD)).rejects.toThrow(BackupImportUserError);
    expect(read).not.toHaveBeenCalled();
  });

  it('空白密码在读取文件前拒绝', async () => {
    const file = new File([], 'backup.aph');
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(verifyBackupFile(file, ' \n ')).rejects.toThrow(t('options.forgot.checkPasswordRequired'));
    expect(read).not.toHaveBeenCalled();
  });

  it('identity 文件读取异常不把原始错误或文件内容暴露给用户', async () => {
    const file = new File([], 'backup.aphid');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('synthetic-sensitive-details'));
    await expect(verifyBackupFile(file, PASSWORD)).rejects.toThrow(t('options.forgot.checkFailed'));
  });

  it('误把 .aph 改名为 .aphid 时不能显示身份库验证成功', async () => {
    const bytes = await encryptedFixture(passwordData);
    await expect(verifyBackupFile(fixtureFile(bytes, 'wrong-kind.aphid'), PASSWORD)).rejects.toThrow(
      t('backup.invalidStructure'),
    );
  });

  it('英文环境返回已翻译的格式错误', async () => {
    currentLocale.value = 'en';
    await expect(verifyBackupFile(new File([], 'short.aphid'), PASSWORD)).rejects.toThrow('Invalid backup file format');
  });
});
