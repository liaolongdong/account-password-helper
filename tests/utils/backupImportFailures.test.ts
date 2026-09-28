/**
 * `.aph` 加密备份导入的失败路径与容器契约回归测试
 *
 * 背景：`importEncryptedBackup` 的字节闸门（`tests/utils/importByteGate.test.ts`）与
 * 导出侧自检（`tests/utils/backupExport.test.ts`）各自成立，但**没有任何测试证明导出
 * 产出的容器能被导入侧读回**——salt/iv/ciphertext 的切分顺序、AES-GCM 参数、以及解密后
 * 交给 `parseBackupContainer` 的形状，全部靠两侧源码「看起来一致」维持。同时四条失败
 * 文案（格式无效 / 主密码错误或已损坏 / 结构不正确 / 导入失败）此前零断言，而它们正是
 * 用户在恢复钥匙失效时唯一能看到的提示。
 *
 * 本文件钉住：
 * 1. round-trip：导出的字节原样喂回导入侧，条目逐字段等值回来（含 totp / favorite）；
 * 2. 错主密码与密文被篡改（改一个字节）都落到 `backup.wrongPasswordOrCorrupted`，
 *    且 GCM 认证失败是**真实**发生在本机 Web Crypto 上的，不是桩；
 * 3. 最小容器长度边界：29 字节（16 salt + 12 iv + 1 密文）越过长度门后进解密并因
 *    校验和失败被拒，28 字节则直接判「格式无效」；
 * 4. 解密成功但结构非法时落 `backup.invalidStructure`，`cause` 保留机器可读 `code`；
 * 5. 原始异常（`SyntaxError` / 读文件失败）不外泄：提示条只见 i18n 文案，原文留在 `cause`；
 * 6. 三条失败文案在中英文语言包都存在（不出现英文环境下吐出中文、或退化成原始 key）。
 *
 * PBKDF2 迭代次数按实现写死 600k，单次约 4s。这里只把**代价值**降下来（拦截
 * `crypto.subtle.deriveKey` 改写 `iterations`，算法/salt/长度/用途全部照旧），
 * 使派生仍然真实、两侧仍然同钥，而整套测试不必花 12s 在同一个断言上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { BackupImportUserError, exportEncryptedBackup, importEncryptedBackup } from '@/utils/backupExport';
import { registerMessages, currentLocale, t, type Messages } from '@/utils/i18n';
import zhBackup from '@/utils/i18n/locales/zh-CN/backup.json';
import enBackup from '@/utils/i18n/locales/en/backup.json';

registerMessages('zh-CN', zhBackup as Messages);
registerMessages('en', enBackup as Messages);

// 导出成功后会记录「最近成功备份」时间戳，与本文件的断言无关，隔离真实 chrome.storage
vi.mock('@/utils/storage/configManager', () => ({
  markVerifiedBackupAt: vi.fn(async () => undefined),
}));

/** 派生代价下调后的迭代次数：仍走真实 PBKDF2-SHA256，只是不等 600k */
const CHEAP_ITERATIONS = 2_000;

const MASTER_PASSWORD = 'correct horse battery staple';

const entry = (id: string): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: `pw-${id}`,
  url: `https://${id}.example.com`,
  tag: 'demo',
  remark: `remark-${id}`,
  totp: 'JBSWY3DPEHPK3PXP',
  createTime: 1_700_000_000_000,
  updateTime: 1_700_000_001_000,
  order: 0,
  favorite: id === 'a',
});

const SOURCE_ENTRIES: PasswordEntry[] = [entry('a'), entry('b')];

/** 导入侧契约形状：无 id/order，缺省字段按 `readBoundedText` 归一为空串 */
const expectedImported = (passwords: PasswordEntry[]) =>
  passwords.map(p => ({
    username: p.username,
    password: p.password,
    url: p.url,
    tag: p.tag,
    remark: p.remark,
    totp: p.totp,
    createTime: p.createTime,
    updateTime: p.updateTime,
    favorite: p.favorite,
  }));

/** 最小 File 替身：只需 `size` 与 `arrayBuffer()`，不必构造真实 DOM File */
const fakeFile = (bytes: Uint8Array): File =>
  ({
    name: 'backup.aph',
    size: bytes.byteLength,
    type: '',
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  }) as unknown as File;

let clickedAnchors: { click: () => void; download: string }[];
let capturedBlobBytes: (() => Promise<Uint8Array>) | null;

/** 只把 PBKDF2 的代价值改小，算法、salt、hash、密钥长度与用途一概沿用实现入参 */
function withCheapIterations(algorithm: AlgorithmIdentifier): AlgorithmIdentifier {
  if (typeof algorithm === 'object' && algorithm.name === 'PBKDF2') {
    return { ...algorithm, iterations: CHEAP_ITERATIONS } as Pbkdf2Params;
  }
  return algorithm;
}

beforeEach(() => {
  clickedAnchors = [];
  capturedBlobBytes = null;
  // 以下每条失败路径都会 logger.error（预期行为），静默以保持输出整洁
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const realDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(
    (algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) =>
      realDeriveKey(withCheapIterations(algorithm), baseKey, derivedKeyAlgorithm, extractable, keyUsages),
  );

  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobBytes = async () => new Uint8Array(await blob.arrayBuffer());
    return 'blob:captured';
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const anchor = { click: vi.fn(), href: '', download: '' };
      clickedAnchors.push(anchor as unknown as { click: () => void; download: string });
      return anchor;
    }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  currentLocale.value = 'zh-CN';
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

/** 跑一次真实导出，取回落盘字节（导出侧自带 round-trip 自检，走到下载即已可信） */
const exportBytes = async (): Promise<Uint8Array> => {
  await exportEncryptedBackup(SOURCE_ENTRIES, MASTER_PASSWORD);
  if (!capturedBlobBytes) throw new Error('导出未产出文件，无法取回字节');
  return capturedBlobBytes();
};

vi.mock('@/utils/storage/configManager', () => ({
  markVerifiedBackupAt: vi.fn(async () => undefined),
}));

describe('.aph 容器 round-trip', () => {
  it('导出的字节能被导入侧原样读回，条目逐字段等值', async () => {
    const bytes = await exportBytes();

    const imported = await importEncryptedBackup(fakeFile(bytes), MASTER_PASSWORD);

    expect(imported).toEqual(expectedImported(SOURCE_ENTRIES));
  });

  it('两次导出的 salt 与 IV 各不相同（相同明文不得产出相同容器）', async () => {
    const first = await exportBytes();
    capturedBlobBytes = null;
    const second = await exportBytes();

    expect(first.slice(0, 16)).not.toEqual(second.slice(0, 16));
    expect(first.slice(16, 28)).not.toEqual(second.slice(16, 28));
  });
});

describe('解密失败：主密码错误与容器损坏', () => {
  it('用错误主密码解密 → 「主密码错误或备份文件已损坏」', async () => {
    const bytes = await exportBytes();

    const err = await importEncryptedBackup(fakeFile(bytes), 'not-the-password').catch(e => e);

    expect((err as Error).message).toBe(t('backup.wrongPasswordOrCorrupted'));
    // cause 是浏览器真实的 GCM 认证失败，不是被吞掉的字符串
    expect((err as Error).name).not.toBe('PasswordBackupError');
    expect((err as { cause?: { name?: string } }).cause?.name).toBe('OperationError');
  });

  it('密文被改一个字节 → 同一文案（GCM 完整性生效，不是静默解出乱码）', async () => {
    const bytes = await exportBytes();
    bytes[bytes.byteLength - 1] ^= 0xff;

    const err = await importEncryptedBackup(fakeFile(bytes), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.wrongPasswordOrCorrupted'));
  });

  it('长度边界：28 字节判「格式无效」，29 字节进解密后因校验和失败被拒', async () => {
    const tooShort = await importEncryptedBackup(fakeFile(new Uint8Array(28)), MASTER_PASSWORD).catch(e => e);
    expect((tooShort as Error).message).toBe(t('backup.invalidFile'));

    // 越过长度门只说明「形状像容器」，完整性仍须由 GCM 兜住
    const atMinLength = await importEncryptedBackup(fakeFile(new Uint8Array(29)), MASTER_PASSWORD).catch(e => e);
    expect((atMinLength as Error).message).toBe(t('backup.wrongPasswordOrCorrupted'));
  });
});

describe('解密成功但容器结构非法', () => {
  /** 让解密直接返回给定明文，跳过「构造一个合法密文」这层与实现同构的复杂度 */
  const decryptTo = (plaintext: unknown) => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(plaintext)).buffer as ArrayBuffer,
    );
  };

  /**
   * 沿 `cause` 链取机器可读 code。
   *
   * 结构类失败会先把 `PasswordBackupError` 映射为 i18n 用户文案（原始 code 落在 `cause` 上）。
   * 这里按链搜索而不是写死层数：「包了几层」是实现细节，「用户看到文案、诊断拿到 code」才是契约。
   */
  const codeInChain = (error: unknown): string | undefined => {
    let cursor = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; cursor && depth < 5; depth++) {
      if (typeof cursor.code === 'string') return cursor.code;
      cursor = cursor.cause as typeof cursor;
    }
    return undefined;
  };

  it('count 与 entries 条数不符 → 「备份数据结构不正确」，cause 保留 INVALID_STRUCTURE', async () => {
    decryptTo({ version: 1, exportedAt: 0, count: 9, entries: [] });

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.invalidStructure'));
    expect(codeInChain(err)).toBe('INVALID_STRUCTURE');
  });

  it('version 超出受支持上界 → 同一文案（前向兼容不做乐观放行）', async () => {
    decryptTo({ version: 99, count: 0, entries: [] });

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.invalidStructure'));
    expect(codeInChain(err)).toBe('INVALID_STRUCTURE');
  });

  it('条目字段是对象 → 不再产出 "[object Object]"，整批拒为 INVALID_ENTRY', async () => {
    decryptTo({ version: 1, count: 1, entries: [{ username: { a: 1 }, password: 'x' }] });

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.invalidStructure'));
    expect(codeInChain(err)).toBe('INVALID_ENTRY');
  });

  it('条目级非法也归入「结构不正确」文案，而不是退化成通用导入失败', async () => {
    // 与上一条同源：确认 INVALID_ENTRY 与 INVALID_STRUCTURE 共用面向用户的提示，
    // 且都带 code 供诊断区分（用户无需知道两者差异）
    decryptTo({ version: 1, count: 1, entries: ['not-an-object'] });

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.invalidStructure'));
    expect(codeInChain(err)).toBe('INVALID_ENTRY');
  });
});

describe('失败提示不外泄原始异常', () => {
  /** 让解密直接返回给定明文（可以不是合法 JSON），其余路径沿用真实 Web Crypto */
  const decryptToText = (plaintext: string) => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(new TextEncoder().encode(plaintext).buffer as ArrayBuffer);
  };

  it('明文不是合法 JSON → 落通用文案，英文 SyntaxError 原文不外泄', async () => {
    decryptToText('{ this is not json');

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e);

    // 修复前：外层 catch 用 `error.message || 通用文案` 重建 Error，浏览器原文因此直达提示条
    expect((err as Error).message).toBe(t('backup.importError'));
    expect((err as Error).message).not.toContain('JSON');
    // 原始异常仍在 cause 上，日志与诊断拿得到
    expect((err as { cause?: Error }).cause?.name).toBe('SyntaxError');
  });

  it('读文件失败 → 同一通用文案，底层原因只留在 cause', async () => {
    const file = fakeFile(new Uint8Array(40));
    vi.spyOn(file, 'arrayBuffer').mockRejectedValueOnce(new Error('user cancelled'));

    const err = await importEncryptedBackup(file, MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.importError'));
    expect((err as { cause?: Error }).cause?.message).toBe('user cancelled');
  });

  it('每条失败路径都以 BackupImportUserError 上抛（弹窗据此判据决定能否呈现 message）', async () => {
    const bytes = await exportBytes();
    decryptToText('{"version":1,"count":9,"entries":[]}');

    const failures = [
      await importEncryptedBackup(fakeFile(new Uint8Array(28)), MASTER_PASSWORD).catch(e => e),
      await importEncryptedBackup(fakeFile(bytes), 'not-the-password').catch(e => e),
      await importEncryptedBackup(fakeFile(new Uint8Array(40)), MASTER_PASSWORD).catch(e => e),
    ];

    expect(failures.length).toBe(3);
    for (const err of failures) {
      expect(err, '弹窗对非该类型的错误一律退到通用文案，漏挂类型会让真实原因被吞掉').toBeInstanceOf(
        BackupImportUserError,
      );
      expect((err as Error).name).toBe('BackupImportUserError');
    }
  });

  it('已是用户可读文案的错误不被外层 catch 二次包裹（cause 与文案同时保留）', async () => {
    // 「格式无效」在 try 内抛出，必须原样上抛：若被外层重建成通用导入失败，用户会看到
    // 与真实原因不符的提示；cause 也平白多一层。
    const err = await importEncryptedBackup(fakeFile(new Uint8Array(28)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe(t('backup.invalidFile'));
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('失败文案的中英文一致性', () => {
  const keys = [
    'backup.invalidFile',
    'backup.wrongPasswordOrCorrupted',
    'backup.invalidStructure',
    'backup.fileTooLarge',
    'backup.importError',
  ] as const;

  it('每条失败文案在两个语言包都有独立译文（英文环境不得吐中文或原始 key）', () => {
    for (const key of keys) {
      expect(zhBackup[key]).toBeTruthy();
      expect(enBackup[key]).toBeTruthy();
      expect(enBackup[key]).not.toBe(zhBackup[key]);
    }
  });

  it('切到英文后同一失败路径给出英文文案', async () => {
    currentLocale.value = 'en';

    const err = await importEncryptedBackup(fakeFile(new Uint8Array(4)), MASTER_PASSWORD).catch(e => e);

    expect((err as Error).message).toBe('Invalid backup file format');
    expect((err as Error).message).not.toBe('backup.invalidFile');
  });
});
