/**
 * TOTP / 两步验证码工具（RFC 6238 / RFC 4226）
 *
 * 纯本地实现：动态码由 Web Crypto HMAC 在本地计算，不产生任何网络请求，
 * 契合插件「密码绝不出浏览器」的零网络定位。
 *
 * 支持两种密钥输入形式：
 * - `otpauth://totp/<label>?secret=..&algorithm=..&digits=..&period=..` 标准 URI
 * - 裸 Base32 密钥字符串（回退默认参数 SHA-1 / 6 位 / 30 秒）
 */

/** Web Crypto 支持的 HMAC 哈希算法（对应 otpauth 的 SHA1/SHA256/SHA512） */
export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

/** 解析后的 TOTP 参数 */
export interface TotpParams {
  /** 规范化后的 Base32 密钥（大写、无空格、无填充） */
  secret: string;
  /** HMAC 哈希算法 */
  algorithm: TotpAlgorithm;
  /** 动态码位数（6/7/8） */
  digits: number;
  /** 时间步长（秒） */
  period: number;
  /** 服务发行方（可选，仅用于展示） */
  issuer?: string;
  /** 账户标签（可选，仅用于展示） */
  label?: string;
}

/** RFC 4648 Base32 字母表 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** TOTP 默认参数（未在 otpauth URI 中显式声明时使用） */
const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA-1';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;

/**
 * 解码 Base32 字符串为字节数组（RFC 4648）
 *
 * 忽略空格、大小写与末尾 `=` 填充；遇到非法字符抛出异常。
 *
 * @param input Base32 密钥字符串
 * @returns 解码后的字节数组
 */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('无效的 Base32 字符');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  // 以 ArrayBuffer 支撑构造，确保类型为 Uint8Array<ArrayBuffer> 以兼容 Web Crypto 的 BufferSource
  const bytes = new Uint8Array(new ArrayBuffer(output.length));
  bytes.set(output);
  return bytes;
}

/**
 * 将 otpauth 的算法名规范化为 Web Crypto 哈希名
 * @param raw otpauth `algorithm` 参数（如 "SHA1"）
 * @returns Web Crypto 哈希名，默认 SHA-1
 */
function normalizeAlgorithm(raw: string | null): TotpAlgorithm {
  switch ((raw || '').toUpperCase()) {
    case 'SHA256':
    case 'SHA-256':
      return 'SHA-256';
    case 'SHA512':
    case 'SHA-512':
      return 'SHA-512';
    default:
      return DEFAULT_ALGORITHM;
  }
}

/**
 * 解析 TOTP 密钥输入（otpauth URI 或裸 Base32 密钥）
 *
 * @param input 用户配置的密钥字符串
 * @returns 解析后的参数；无法解析或密钥为空时返回 null
 */
export function parseOtpAuth(input: string): TotpParams | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 形式一：otpauth:// URI
  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      // 仅支持 totp（不支持 hotp 计数器模式）
      if (url.host.toLowerCase() !== 'totp') return null;

      const secretRaw = (url.searchParams.get('secret') || '').replace(/\s+/g, '').toUpperCase();
      if (!secretRaw || !/^[A-Z2-7]+=*$/.test(secretRaw)) return null;

      const digitsRaw = parseInt(url.searchParams.get('digits') || '', 10);
      const digits = digitsRaw === 7 || digitsRaw === 8 ? digitsRaw : DEFAULT_DIGITS;

      const periodRaw = parseInt(url.searchParams.get('period') || '', 10);
      const period = Number.isFinite(periodRaw) && periodRaw > 0 ? periodRaw : DEFAULT_PERIOD;

      const label = decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined;

      return {
        secret: secretRaw.replace(/=+$/, ''),
        algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
        digits,
        period,
        issuer: url.searchParams.get('issuer') || undefined,
        label,
      };
    } catch {
      return null;
    }
  }

  // 形式二：裸 Base32 密钥
  const cleaned = trimmed.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(cleaned)) return null;

  return {
    secret: cleaned.replace(/=+$/, ''),
    algorithm: DEFAULT_ALGORITHM,
    digits: DEFAULT_DIGITS,
    period: DEFAULT_PERIOD,
  };
}

/**
 * 判断 TOTP 密钥输入是否有效（可解析且能解码出非空密钥）
 * @param input 用户配置的密钥字符串
 * @returns 是否为有效的 TOTP 密钥
 */
export function isValidTotpInput(input: string): boolean {
  const params = parseOtpAuth(input);
  if (!params) return false;
  try {
    return base32Decode(params.secret).length > 0;
  } catch {
    return false;
  }
}

/**
 * 将计数器转换为 8 字节大端字节序（RFC 4226 要求）
 * 使用除法而非位移，避免大计数器（> 32 位）的位运算溢出。
 * @param counter 时间计数器
 * @returns 8 字节大端表示
 */
function counterToBytes(counter: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(8));
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

/**
 * 计算当前时间对应的 TOTP 动态码
 *
 * @param input 密钥输入（otpauth URI 或裸 Base32 密钥）
 * @param atMs 计算时刻（毫秒时间戳），默认当前时间
 * @returns 左补零到指定位数的动态码字符串
 * @throws 当密钥无法解析或解码失败时抛出异常
 */
export async function generateTOTP(input: string, atMs: number = Date.now()): Promise<string> {
  const params = parseOtpAuth(input);
  if (!params) {
    throw new Error('无效的 TOTP 密钥');
  }

  const keyBytes = base32Decode(params.secret);
  if (keyBytes.length === 0) {
    throw new Error('TOTP 密钥为空');
  }

  const counter = Math.floor(atMs / 1000 / params.period);
  const counterBytes = counterToBytes(counter);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: params.algorithm }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));

  // RFC 4226 动态截断
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  const otp = binary % 10 ** params.digits;
  return otp.toString().padStart(params.digits, '0');
}

/**
 * 获取当前 TOTP 周期的剩余秒数（用于倒计时展示）
 * @param period 时间步长（秒），默认 30
 * @param atMs 计算时刻（毫秒时间戳），默认当前时间
 * @returns 距离下次刷新的剩余秒数（1 ~ period）
 */
export function getTotpRemaining(period: number = DEFAULT_PERIOD, atMs: number = Date.now()): number {
  const safePeriod = period > 0 ? period : DEFAULT_PERIOD;
  const seconds = Math.floor(atMs / 1000);
  return safePeriod - (seconds % safePeriod);
}

/**
 * 获取 TOTP 密钥的时间步长（供倒计时/进度计算使用）
 * @param input 密钥输入
 * @returns 时间步长（秒）；无法解析时返回默认 30
 */
export function getTotpPeriod(input: string): number {
  return parseOtpAuth(input)?.period ?? DEFAULT_PERIOD;
}
