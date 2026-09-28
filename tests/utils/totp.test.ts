import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  generateTOTP,
  getTotpPeriod,
  getTotpRemaining,
  isValidTotpInput,
  parseOtpAuth,
  type TotpAlgorithm,
} from '@/utils/totp';

/**
 * TOTP（RFC 6238 / RFC 4226）特征化测试
 *
 * 该模块此前零单测，而它直接决定用户能否登录二次校验站点：算错一位就是
 * 「可用性问题 + 安全错觉」——用户以为开了 2FA，实际拿到的码永远被服务端拒绝。
 *
 * 判据有两层，刻意不拿本实现的输出当预期：
 * 1. RFC 4226 附录 D 的 10 组标准 HOTP 向量（外部权威数值，逐字写死）；
 *    RFC 6238 附录 B 的 SHA-1 行 6 组八位向量同样逐字写死。
 * 2. 与 `node:crypto` 的 HMAC 独立实现全量交叉校验三种哈希 —— 与
 *    `tests/utils/encryption.test.ts` 用 pbkdf2Sync/hkdfSync 反查 KDF 参数同一套路。
 *    第 1 层保证「独立实现自身对齐了标准」，第 2 层才有资格断言本模块对齐标准。
 *
 * 另覆盖：Base32 解码（RFC 4648 第 10 节填充样例、大小写与空格容忍、非法字符抛错）、
 * otpauth URI 解析（非 totp 类型、缺密钥、位数与步长回落、百分号编码标签），
 * 以及倒计时取模语义。全部为纯计算，无 IO。
 */

/** RFC 6238 附录 B 种子："12345678901234567890"（20 字节 ASCII） */
const SEED_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
/** RFC 6238 附录 B 种子：32 字节 ASCII */
const SEED_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
/** RFC 6238 附录 B 种子：64 字节 ASCII */
const SEED_SHA512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

/** 三种哈希各自的 RFC 6238 附录 B 种子（与 Web Crypto 的 `SHA-256` 等命名对齐） */
const SEED_BY_ALGORITHM: Record<TotpAlgorithm, string> = {
  'SHA-1': SEED_SHA1,
  'SHA-256': SEED_SHA256,
  'SHA-512': SEED_SHA512,
};

/** node:crypto 的哈希名（本测试的独立参照实现） */
const NODE_HASH: Record<TotpAlgorithm, 'sha1' | 'sha256' | 'sha512'> = {
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-512': 'sha512',
};

/** RFC 6238 附录 B 的六个标准时刻（秒） */
const RFC_TIMES = [59, 1_111_111_109, 1_111_111_111, 1_234_567_890, 2_000_000_000, 20_000_000_000];

/** RFC 4226 附录 D 的 HOTP 标准向量（SHA-1、6 位、计数器 0~9） */
const RFC4226_VECTORS: ReadonlyArray<{ counter: number; expected: string }> = [
  { counter: 0, expected: '755224' },
  { counter: 1, expected: '287082' },
  { counter: 2, expected: '359152' },
  { counter: 3, expected: '969429' },
  { counter: 4, expected: '338314' },
  { counter: 5, expected: '254676' },
  { counter: 6, expected: '287922' },
  { counter: 7, expected: '162583' },
  { counter: 8, expected: '399871' },
  { counter: 9, expected: '520489' },
];

/** RFC 6238 附录 B 的 SHA-1 行八位向量（同表另有 SHA-256/512 行，见下方独立实现交叉校验） */
const RFC6238_SHA1_VECTORS: ReadonlyArray<{ time: number; expected: string }> = [
  { time: 59, expected: '94287082' },
  { time: 1_111_111_109, expected: '07081804' },
  { time: 1_111_111_111, expected: '14050471' },
  { time: 1_234_567_890, expected: '89005924' },
  { time: 2_000_000_000, expected: '69279037' },
  { time: 20_000_000_000, expected: '65353130' },
];

/** 拼出携带全部参数的 otpauth URI */
const otpauth = (secret: string, algorithm: TotpAlgorithm, digits = 6, period = 30): string =>
  `otpauth://totp/Example:alice?secret=${secret}&algorithm=${algorithm.replace('-', '')}&digits=${digits}&period=${period}`;

/**
 * 独立参照实现：Base32 解码 + RFC 4226 动态截断，HMAC 取自 node:crypto
 *
 * 与 `src` 侧实现完全无共享代码：位运算换成 BigInt、字节缓冲换成 Buffer、
 * HMAC 换成 Node 原生实现，故一方出错不会与另一方同步偏差。
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const referenceBase32 = (input: string): Buffer => {
  const bytes: number[] = [];
  let accumulator = 0n;
  let bits = 0;
  for (const char of input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`bad base32 char: ${char}`);
    accumulator = (accumulator << 5n) | BigInt(index);
    bits += 5;
    if (bits >= 8) {
      bytes.push(Number((accumulator >> BigInt(bits - 8)) & 0xffn));
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const referenceHotp = (secret: string, counter: number, digits: number, algorithm: TotpAlgorithm): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const signature = createHmac(NODE_HASH[algorithm], referenceBase32(secret)).update(message).digest();
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
};

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe('独立参照实现自身先对齐标准（否则下一节的交叉校验没有资格作为判据）', () => {
  it.each(RFC4226_VECTORS)('node:crypto 复现 RFC 4226 附录 D 计数器 $counter → $expected', ({ counter, expected }) => {
    expect(referenceHotp(SEED_SHA1, counter, 6, 'SHA-1')).toBe(expected);
  });
});

describe('generateTOTP：RFC 权威向量', () => {
  it.each(RFC4226_VECTORS)('六位码：计数器 $counter → 标准值 $expected', async ({ counter, expected }) => {
    // period=30 且时刻取 counter×30s ⇒ floor(atMs/1000/period) === counter
    await expect(generateTOTP(SEED_SHA1, counter * 30 * 1000)).resolves.toBe(expected);
  });

  it.each(RFC6238_SHA1_VECTORS)('八位码：SHA-1 在 T=$time → 标准值 $expected', async ({ time, expected }) => {
    await expect(generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 8), time * 1000)).resolves.toBe(expected);
  });

  it('码长不足位数时左补零（RFC 向量 07081804 自带前导零）', async () => {
    const code = await generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 8), 1_111_111_109 * 1000);
    expect(code).toBe('07081804');
    expect(code).toHaveLength(8);
  });

  it('七位码长度按 digits 生效', async () => {
    await expect(generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 7), 59 * 1000)).resolves.toMatch(/^\d{7}$/);
  });
});

describe('generateTOTP：与 node:crypto 独立实现全量交叉校验', () => {
  const cases: Array<[TotpAlgorithm, number]> = RFC_TIMES.flatMap(time =>
    (['SHA-1', 'SHA-256', 'SHA-512'] as TotpAlgorithm[]).map(algorithm => [algorithm, time] as [TotpAlgorithm, number]),
  );

  it.each(cases)('$algorithm 在 T=$time 的八位码与独立实现逐位相同', async (algorithm, time) => {
    const reference = referenceHotp(SEED_BY_ALGORITHM[algorithm], Math.floor(time / 30), 8, algorithm);
    await expect(generateTOTP(otpauth(SEED_BY_ALGORITHM[algorithm], algorithm, 8), time * 1000)).resolves.toBe(
      reference,
    );
  });

  it('三种哈希确实走到各自 HMAC（若 normalizeAlgorithm 静默回落 SHA-1，此处必红）', async () => {
    const codes = await Promise.all(
      (['SHA-1', 'SHA-256', 'SHA-512'] as TotpAlgorithm[]).map(algorithm =>
        generateTOTP(otpauth(SEED_SHA256, algorithm, 8), 1_234_567_890 * 1000),
      ),
    );
    expect(new Set(codes).size).toBe(3);
  });

  it('裸 Base32 密钥与显式 URI 等价（默认 SHA-1 / 6 位 / 30 秒）', async () => {
    await expect(generateTOTP(SEED_SHA1, 59 * 1000)).resolves.toBe(
      await generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 6), 59 * 1000),
    );
  });

  it('密钥带空格与大小写混排仍可用（用户手工转录的常见形态）', async () => {
    const messy = 'gezd gnbv gy3t qoJqG EZDG NBVg y3tq ojQ';
    await expect(generateTOTP(messy, 59 * 1000)).resolves.toBe(await generateTOTP(SEED_SHA1, 59 * 1000));
  });

  it('自定义 period 真正参与计数器计算（60 秒档与 30 秒档在同一时刻必须不同）', async () => {
    const [p30, p60] = await Promise.all([
      generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 6, 30), 1_700_000_000_000),
      generateTOTP(otpauth(SEED_SHA1, 'SHA-1', 6, 60), 1_700_000_000_000),
    ]);
    expect(p30).not.toBe(p60);
    expect(p60).toBe(referenceHotp(SEED_SHA1, Math.floor(1_700_000_000 / 60), 6, 'SHA-1'));
  });

  it('非法密钥抛错而不是静默返回一个"看起来像"的码', async () => {
    await expect(generateTOTP('not-a-base32-secret!!', 0)).rejects.toThrow('无效的 TOTP 密钥');
  });
});

describe('base32Decode：RFC 4648 第 10 节填充样例与容错', () => {
  it.each([
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6===', 'foo'],
    ['MZXW6YQ=', 'foob'],
    ['MZXW6YTB', 'fooba'],
    ['MZXW6YTBOI======', 'foobar'],
    [SEED_SHA1, '12345678901234567890'],
  ])('%s 解码为 %s', (input, expected) => {
    expect(ascii(base32Decode(input))).toBe(expected);
  });

  it('忽略大小写、内部空格与末尾填充', () => {
    expect(ascii(base32Decode(' mzxw 6ytb '))).toBe('fooba');
    expect(base32Decode('MZXW6YTB')).toEqual(base32Decode('mzxw6ytb===='));
  });

  it('非法字符抛出可识别错误（Base32 字母表为 A–Z 与 2–7，故 0/1/8/9 均非法）', () => {
    for (const input of ['AB1D', 'IL0U', '89AB', 'MZXW6-TB', '密钥']) {
      expect(() => base32Decode(input)).toThrow('无效的 Base32 字符');
    }
  });

  it('返回由 ArrayBuffer 支撑的定长视图（Web Crypto BufferSource 兼容性）', () => {
    const bytes = base32Decode('MZXW6YTB');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.buffer.byteLength).toBe(5);
    expect(bytes.byteOffset).toBe(0);
  });
});

describe('parseOtpAuth：参数回落与拒绝路径', () => {
  it('完整 URI 解析出发行方、标签与全部参数（标签需百分号解码）', () => {
    expect(
      parseOtpAuth(
        'otpauth://totp/GitHub:alice%40example.com?secret=MZXW6YTB&issuer=GitHub&algorithm=SHA512&digits=8&period=60',
      ),
    ).toEqual({
      secret: 'MZXW6YTB',
      algorithm: 'SHA-512',
      digits: 8,
      period: 60,
      issuer: 'GitHub',
      label: 'GitHub:alice@example.com',
    });
  });

  it('位数仅接受 7/8，其余（含 4/10/非数字/缺省）回落到 6', () => {
    for (const digits of ['4', '6', '9', '10', 'abc', '']) {
      expect(parseOtpAuth(`otpauth://totp/x?secret=MZXW6YTB&digits=${digits}`)?.digits).toBe(6);
    }
    expect(parseOtpAuth('otpauth://totp/x?secret=MZXW6YTB&digits=7')?.digits).toBe(7);
    expect(parseOtpAuth('otpauth://totp/x?secret=MZXW6YTB&digits=8')?.digits).toBe(8);
  });

  it('步长接受任意正整数，0/负数/非数字/缺省回落到 30', () => {
    expect(parseOtpAuth('otpauth://totp/x?secret=MZXW6YTB&period=60')?.period).toBe(60);
    expect(parseOtpAuth('otpauth://totp/x?secret=MZXW6YTB&period=15')?.period).toBe(15);
    for (const period of ['0', '-30', 'abc', '']) {
      expect(parseOtpAuth(`otpauth://totp/x?secret=MZXW6YTB&period=${period}`)?.period).toBe(30);
    }
  });

  it('算法名容忍 SHA1/SHA-256/sha512 三种写法，未知值回落 SHA-1', () => {
    for (const [raw, expected] of [
      ['SHA1', 'SHA-1'],
      ['SHA-256', 'SHA-256'],
      ['sha512', 'SHA-512'],
      ['MD5', 'SHA-1'],
      ['', 'SHA-1'],
    ] as const) {
      expect(parseOtpAuth(`otpauth://totp/x?secret=MZXW6YTB&algorithm=${raw}`)?.algorithm).toBe(expected);
    }
  });

  it('仅支持 totp：hotp 与缺密钥/非法密钥一律拒绝', () => {
    expect(parseOtpAuth('otpauth://hotp/x?secret=MZXW6YTB&counter=42')).toBeNull();
    expect(parseOtpAuth('otpauth://totp/x')).toBeNull();
    expect(parseOtpAuth('otpauth://totp/x?secret=')).toBeNull();
    expect(parseOtpAuth('otpauth://totp/x?secret=abc0189')).toBeNull();
  });

  it('畸形 URI 与空输入一律返回 null（不抛异常，供表单直接判空）', () => {
    for (const input of ['', '   ', 'otpauth://totp/x?secret=%%%', 'otpauth://']) {
      expect(parseOtpAuth(input)).toBeNull();
    }
  });

  it('落库的 secret 不残留填充等号（裸密钥与 URI 两路都要剥）', () => {
    expect(parseOtpAuth('MZXW6YTB====')?.secret).toBe('MZXW6YTB');
    expect(parseOtpAuth('otpauth://totp/x?secret=MZXW6YTB====')?.secret).toBe('MZXW6YTB');
  });
});

describe('isValidTotpInput / 周期辅助函数', () => {
  it('接受合法裸密钥与 URI，拒绝含非法字符的输入', () => {
    expect(isValidTotpInput(SEED_SHA1)).toBe(true);
    expect(isValidTotpInput(otpauth(SEED_SHA1, 'SHA-1'))).toBe(true);
    expect(isValidTotpInput('')).toBe(false);
    expect(isValidTotpInput('AB1D')).toBe(false);
    expect(isValidTotpInput('not-a-secret')).toBe(false);
  });

  it('字母串一律算合法（A–Z 全在 Base32 字母表内，含数字 0/1/8/9 才判非法）', () => {
    // 该口径由字母表决定，不是校验漏洞：Base32 与"可读单词"在字符集上本就重叠，
    // 真正的合法性只能由「能否解出足够长的密钥」保证，故这里把边界钉死留档。
    expect(isValidTotpInput('helloworld')).toBe(true);
    expect(isValidTotpInput('hello1')).toBe(false);
  });

  it('getTotpPeriod 未解析时回落 30，解析成功时透出 URI 声明值', () => {
    expect(getTotpPeriod('')).toBe(30);
    expect(getTotpPeriod(SEED_SHA1)).toBe(30);
    expect(getTotpPeriod(otpauth(SEED_SHA1, 'SHA-1', 6, 45))).toBe(45);
  });

  it('getTotpRemaining 落在 1..period，且在周期边界翻转', () => {
    expect(getTotpRemaining(30, 0)).toBe(30);
    expect(getTotpRemaining(30, 1000)).toBe(29);
    expect(getTotpRemaining(30, 29_000)).toBe(1);
    expect(getTotpRemaining(30, 30_000)).toBe(30);
    expect(getTotpRemaining(60, 45_000)).toBe(15);
  });

  it('非法 period（0 / 负数）回落默认步长，不产生除零或 NaN', () => {
    expect(getTotpRemaining(0, 1234)).toBe(29);
    expect(getTotpRemaining(-30, 1234)).toBe(29);
    expect(Number.isInteger(getTotpRemaining(0, 1234))).toBe(true);
  });
});
