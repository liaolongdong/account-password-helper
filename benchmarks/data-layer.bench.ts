/**
 * 数据层成本基准（issue #89「大 Vault 卡顿」评估配套测量）
 *
 * 目的：把「与条目数 N 相关、但分页/虚拟滚动完全治不到」的那部分成本量化——
 * 即加解密、整包 JSON 序列化、storage.session 加密快照读写、Base64 助手。
 * 渲染层成本另见 docs/PERF_LARGE_VAULT_EVALUATION.md 第三节与第九节。
 *
 * 运行：`pnpm exec vitest bench benchmarks/data-layer.bench.ts --run`
 * 输出：终端摘要（stderr）+ `benchmarks/results/data-layer.json`
 *   —— 该路径写死且**每轮覆盖**，需要留档请在跑下一轮前先复制一份（该目录整体被 gitignore）。
 *
 * 口径说明（读结果前必看）：
 * 1. **logger 被整体 mock 成空实现**，对齐生产构建（`isDev=false` 时 debug 不输出）。
 *    首轮未 mock 时「全库解密 600 条 = 1204 ms」里约一半是测试环境的 console 写入，
 *    该轮数字已作废，仅作 dev 构建副作用记录。
 * 2. 夹具为合成数据，字段形状贴近真实使用（约 1/7 无 URL、约一半无备注、每 5 条 1 条带 TOTP），
 *    每条约 3.5 次字段级 AES；不含任何真实凭据。
 * 3. 全部用例走 `precomputedKey` 分支，**不含 PBKDF2**（600k 迭代只在 createSession 走）。
 * 4. 每个用例 1～3 次迭代；绝对值受机器负载影响，**只有同一进程内的比值可信**。
 * 5. 这里**不含 chrome.storage.local 的磁盘 IO**，IO 部分另用真机探针测量。
 * 6. 「变体」列出的写法只是**定价口径**，落地状态逐个看：
 *    - 条目级并行（`整库重加密｜变体`）：**已落地**，但生产用的是 `utils/concurrency.ts` 的
 *      `mapWithConcurrency`（默认每批 64，批内并行），不是无上限 `Promise.all`；因此本行给的是并行收益上界。
 *      对应的 `整库重加密（…同口径）` 那条自写串行循环因此**不再等于线上代码**，只作为并行前的对照保留。
 *    - base64 分块解码 / `subarray`（`Base64 助手｜…` 与 `快照解密 + parse`）：**已落地**，
 *      故这些行的「现口径」列指的是**改造前的写法**，用于给出 P0 的定价，不是当前实现的读数。
 *    - 变体 A（字段级并行）与变体 B（整条目一次 AES）：**未落地**。前者实测无收益已被否决，
 *      后者属 at-rest 密文格式改造（C1），需单独拍板。
 *    - 键分片（E1）不在本文件口径内：它是 IO 侧成本，由真机探针 `benchmarks/measure-storage-io.mjs` 测量，
 *      设计见 `docs/PERF_E1_KEY_SHARDING_DESIGN.md`。
 */
import { afterAll, bench, describe, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { EncryptedPasswordEntry, PasswordEntry } from '@/utils/types';
import { decryptData, decryptPasswordEntry, encryptData, encryptPasswordEntry } from '@/utils/encryption';

// 生产构建里 debug 日志不输出，基准必须对齐这个前提
vi.mock('@/utils/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
}));

/** 测量结果累加器（供 afterAll 落盘与打印） */
const SUMMARY: Record<string, number | string | boolean> = {};

/** 与生产密钥同形状的 32 字节随机数据密钥（hex） */
const DATA_KEY_HEX = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(
  '',
);

/** 可复现伪随机（mulberry32） */
function makeRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(rand: () => number, min: number, max: number, alphabet: string): string {
  const len = min + Math.floor(rand() * (max - min + 1));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

const ALPHA_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ALPHA_DIGITS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 生成合成明文库 */
function createVault(size: number): PasswordEntry[] {
  const rand = makeRandom(20260923);
  return Array.from({ length: size }, (_, index) => ({
    id: `bench-${index}-${randomText(rand, 6, 6, ALPHA_DIGITS)}`,
    username: randomText(rand, 8, 16, ALPHA_DIGITS),
    password: randomText(rand, 16, 24, ALPHA_DIGITS),
    url:
      index % 7 === 0
        ? ''
        : `https://${randomText(rand, 5, 12, ALPHA_LOWER)}.example-${index % 37}.com/${randomText(rand, 3, 12, ALPHA_LOWER)}`,
    tag: index % 3 === 0 ? `group-${index % 8},team-${index % 5}` : index % 2 === 0 ? `region-${index % 3}` : '',
    remark: index % 2 === 0 ? randomText(rand, 30, 80, ALPHA_LOWER + ' ') : '',
    totp:
      index % 5 === 0
        ? `otpauth://totp/${randomText(rand, 6, 10, ALPHA_LOWER)}?secret=${randomText(rand, 16, 32, ALPHA_DIGITS)}`
        : '',
    favorite: index % 11 === 0,
    createTime: 1700000000000 + index,
    updateTime: 1760000000000 - index,
    order: index,
  }));
}

/** 变体 A：字段级并行解密（现实现是 5 个字段串行 await） */
async function decryptEntryParallelFields(entry: EncryptedPasswordEntry, key: string): Promise<PasswordEntry> {
  const { encrypted: _encrypted, ...rest } = entry;
  const [username, password, url, remark, totp] = await Promise.all([
    decryptData(entry.username, key),
    decryptData(entry.password, key),
    decryptData(entry.url, key),
    decryptData(entry.remark, key),
    entry.totp ? decryptData(entry.totp, key) : Promise.resolve(''),
  ]);
  return { ...rest, username, password, url, remark, totp } as PasswordEntry;
}

const SENSITIVE = ['username', 'password', 'url', 'remark', 'totp'] as const;

/** 变体 B：整条目一次 AES（把 5 个敏感字段打包成一个 JSON 再加密）——改格式的天花板 */
async function encryptEntrySinglePayload(entry: PasswordEntry, key: string): Promise<EncryptedPasswordEntry> {
  const payload = JSON.stringify(SENSITIVE.map(f => entry[f] ?? ''));
  const packed = await encryptData(payload, key);
  return {
    ...entry,
    username: packed,
    password: '',
    url: '',
    remark: '',
    totp: '',
    encrypted: true,
  } as EncryptedPasswordEntry;
}

async function decryptEntrySinglePayload(entry: EncryptedPasswordEntry, key: string): Promise<PasswordEntry> {
  const values = JSON.parse(await decryptData(entry.username, key)) as string[];
  const restored = { ...entry, encrypted: undefined } as Record<string, unknown>;
  SENSITIVE.forEach((field, i) => {
    restored[field] = values[i] ?? '';
  });
  delete restored.encrypted;
  delete restored.password;
  restored.password = values[1] ?? '';
  return restored as unknown as PasswordEntry;
}

/** 现口径 Base64 编码（与 `utils/encryption.ts:157` 逐字一致） */
function slowBytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

/** 变体：分块 String.fromCharCode 编码 */
function fastBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** 现口径 Base64 解码（与 `utils/encryption.ts:197` 逐字一致） */
function slowBase64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** 变体：for 循环填充解码 */
function fastBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 变体：小字段（≤64B）专用——现实现每次解密要 slice 两份完整缓冲 */
function smallFieldDecryptCost(bytes: Uint8Array): { iv: Uint8Array; ct: Uint8Array } {
  return { iv: bytes.slice(0, 12), ct: bytes.slice(12) };
}

const now = (): number => performance.now();

const SIZES = [600, 2000, 5000] as const;

for (const size of SIZES) {
  const plain = createVault(size);
  let encrypted: EncryptedPasswordEntry[] = [];
  let encryptedJson = '';
  let plainJson = '';
  let snapshotCipher = '';
  let packed: EncryptedPasswordEntry[] = [];

  describe(`N=${size}`, () => {
    bench(
      '准备夹具（整库加密 + 序列化，只跑一次）',
      async () => {
        const t0 = now();
        // 与 batchSavePasswords 同口径：for + await 串行逐条
        const out: EncryptedPasswordEntry[] = [];
        for (const entry of plain)
          out.push((await encryptPasswordEntry(entry, '', DATA_KEY_HEX)) as EncryptedPasswordEntry);
        const t1 = now();
        encrypted = out;
        encryptedJson = JSON.stringify(out);
        plainJson = JSON.stringify({ passwords: plain, sortConfig: null, timestamp: Date.now() });
        const t2 = now();
        snapshotCipher = await encryptData(plainJson, DATA_KEY_HEX);
        const t3 = now();
        // 变体 B 夹具：整条目一次 AES
        const packedOut: EncryptedPasswordEntry[] = [];
        for (const entry of plain) packedOut.push(await encryptEntrySinglePayload(entry, DATA_KEY_HEX));
        const t4 = now();
        SUMMARY[`N${size}.serialEncryptAllMs`] = +(t1 - t0).toFixed(1);
        SUMMARY[`N${size}.serializeJsonMs`] = +(t2 - t1).toFixed(1);
        SUMMARY[`N${size}.blobBytes`] = encryptedJson.length;
        SUMMARY[`N${size}.bytesPerEntry`] = +(encryptedJson.length / size).toFixed(1);
        SUMMARY[`N${size}.plainJsonBytes`] = plainJson.length;
        SUMMARY[`N${size}.snapshotBytes`] = snapshotCipher.length;
        SUMMARY[`N${size}.snapshotEncryptMs`] = +(t3 - t2).toFixed(1);
        SUMMARY[`N${size}.packedEncryptAllMs`] = +(t4 - t3).toFixed(1);
        SUMMARY[`N${size}.packedBlobBytes`] = JSON.stringify(packedOut).length;
        packed = packedOut;
      },
      { time: 1, iterations: 1, warmupIterations: 0 },
    );

    bench(
      '全库解密｜现口径（Promise.allSettled × 条目内 5 字段串行 await）',
      async () => {
        const t0 = now();
        const out = await Promise.allSettled(encrypted.map(e => decryptPasswordEntry(e, '', DATA_KEY_HEX)));
        SUMMARY[`N${size}.decryptAllCurrentMs`] = +(now() - t0).toFixed(1);
        SUMMARY[`N${size}.decryptAllCount`] = out.length;
      },
      { time: 1, iterations: 2, warmupIterations: 1 },
    );

    bench(
      '全库解密｜变体 A（字段级 Promise.all 并行，格式不变）',
      async () => {
        const t0 = now();
        await Promise.allSettled(encrypted.map(e => decryptEntryParallelFields(e, DATA_KEY_HEX)));
        SUMMARY[`N${size}.decryptAllParallelFieldsMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 2, warmupIterations: 1 },
    );

    bench(
      '全库解密｜变体 B（整条目一次 AES，需改 at-rest 格式）',
      async () => {
        const t0 = now();
        await Promise.allSettled(packed.map(e => decryptEntrySinglePayload(e, DATA_KEY_HEX)));
        SUMMARY[`N${size}.decryptAllSinglePayloadMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 2, warmupIterations: 1 },
    );

    bench(
      '整库重加密（改主密码 / 恢复备份 / 批量导入同口径）',
      async () => {
        const t0 = now();
        for (const entry of plain) await encryptPasswordEntry(entry, '', DATA_KEY_HEX);
        SUMMARY[`N${size}.reEncryptAllSerialMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 1, warmupIterations: 0 },
    );

    bench(
      '整库重加密｜变体（条目级并行 Promise.all）',
      async () => {
        const t0 = now();
        await Promise.all(plain.map(e => encryptPasswordEntry(e, '', DATA_KEY_HEX)));
        SUMMARY[`N${size}.reEncryptAllParallelMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 1, warmupIterations: 0 },
    );

    bench(
      '反序列化整包密文 JSON（storage 读到内存后的 parse 成本）',
      () => {
        const t0 = now();
        JSON.parse(encryptedJson);
        SUMMARY[`N${size}.parseJsonMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 3, warmupIterations: 1 },
    );

    bench(
      '整包序列化（保存 1 条要把 N 条重新 stringify）',
      () => {
        const t0 = now();
        JSON.stringify(encrypted);
        SUMMARY[`N${size}.restringifyMs`] = +(now() - t0).toFixed(1);
      },
      { time: 1, iterations: 3, warmupIterations: 1 },
    );

    bench(
      '快照解密 + parse（侧边栏冷启动直读快路径，现口径 base64）',
      async () => {
        const t0 = now();
        const json = await decryptData(snapshotCipher, DATA_KEY_HEX);
        const t1 = now();
        JSON.parse(json);
        SUMMARY[`N${size}.snapshotDecryptMs`] = +(t1 - t0).toFixed(1);
        SUMMARY[`N${size}.snapshotParseMs`] = +(now() - t1).toFixed(1);
      },
      { time: 1, iterations: 2, warmupIterations: 1 },
    );

    bench(
      'Base64 助手｜1MB 编解码（现口径 vs 变体）',
      () => {
        const bytes = new Uint8Array(1024 * 1024).fill(97);
        const t0 = now();
        const slow = slowBytesToBase64(bytes);
        const t1 = now();
        slowBase64ToBytes(slow);
        const t2 = now();
        const fast = fastBytesToBase64(bytes);
        const t3 = now();
        fastBase64ToBytes(slow);
        const t4 = now();
        SUMMARY[`N${size}.b64Encode1MB_slowMs`] = +(t1 - t0).toFixed(1);
        SUMMARY[`N${size}.b64Decode1MB_slowMs`] = +(t2 - t1).toFixed(1);
        SUMMARY[`N${size}.b64Encode1MB_fastMs`] = +(t3 - t2).toFixed(1);
        SUMMARY[`N${size}.b64Decode1MB_fastMs`] = +(t4 - t3).toFixed(1);
        SUMMARY[`N${size}.b64Match`] = slow === fast;
      },
      { time: 1, iterations: 2, warmupIterations: 1 },
    );

    bench(
      'Base64 助手｜小字段 3 万次（每条目 3.5 次解密都走这里）',
      () => {
        const small = new Uint8Array(48).fill(98);
        const b64 = slowBytesToBase64(small);
        const t0 = now();
        for (let i = 0; i < 30000; i++) slowBase64ToBytes(b64);
        const t1 = now();
        for (let i = 0; i < 30000; i++) fastBase64ToBytes(b64);
        const t2 = now();
        for (let i = 0; i < 30000; i++) smallFieldDecryptCost(small);
        SUMMARY[`N${size}.b64DecodeSmall30k_slowMs`] = +(t1 - t0).toFixed(1);
        SUMMARY[`N${size}.b64DecodeSmall30k_fastMs`] = +(t2 - t1).toFixed(1);
        SUMMARY[`N${size}.slicePair30kMs`] = +(now() - t2).toFixed(1);
      },
      { time: 1, iterations: 1, warmupIterations: 0 },
    );
  });
}

afterAll(() => {
  const lines = Object.entries(SUMMARY).map(([k, v]) => `${k} = ${String(v)}`);
  process.stderr.write(`\n===== data-layer cost summary =====\n${lines.join('\n')}\n\n`);
  try {
    writeFileSync(new URL('./results/data-layer.json', import.meta.url), JSON.stringify(SUMMARY, null, 2));
  } catch {
    /* results 目录不存在时忽略，终端已输出 */
  }
});
