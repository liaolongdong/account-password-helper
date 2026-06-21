/**
 * 密码生成器工具模块
 *
 * 提供密码学安全的随机密码生成能力，支持自定义长度、字符集和易混淆字符排除。
 * 使用 Web Crypto API（crypto.getRandomValues）确保随机性安全。
 */

/** 密码生成配置接口 */
export interface PasswordGeneratorOptions {
  /** 密码长度，默认 16，范围 6~50 */
  length?: number;
  /** 是否包含大写字母，默认 true */
  uppercase?: boolean;
  /** 是否包含小写字母，默认 true */
  lowercase?: boolean;
  /** 是否包含数字，默认 true */
  numbers?: boolean;
  /** 是否包含特殊字符，默认 true */
  symbols?: boolean;
  /** 排除易混淆字符（1/l/I/0/O），默认 false */
  excludeAmbiguous?: boolean;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<PasswordGeneratorOptions> = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

/** 大写字母字符集 */
const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 小写字母字符集 */
const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';

/** 数字字符集 */
const NUMBER_CHARS = '0123456789';

/** 特殊字符字符集 */
const SYMBOL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/** 易混淆字符集合 */
const AMBIGUOUS_CHARS = new Set(['1', 'l', 'I', '0', 'O']);

/** 最小密码长度 */
const MIN_LENGTH = 6;

/** 最大密码长度 */
const MAX_LENGTH = 50;

/**
 * 从字符集中过滤易混淆字符
 * @param charset 原始字符集
 * @returns 过滤后的字符集
 */
function removeAmbiguous(charset: string): string {
  return charset
    .split('')
    .filter(c => !AMBIGUOUS_CHARS.has(c))
    .join('');
}

/**
 * 使用 Web Crypto API 获取密码学安全的随机整数
 * @param max 最大值（不含）
 * @returns [0, max) 范围内的随机整数
 */
function secureRandomInt(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

/**
 * 生成随机密码
 *
 * 根据配置参数生成密码学安全的随机密码。
 * 保证每种启用的字符集至少包含 1 个字符，其余位置随机填充。
 *
 * @param options 密码生成配置（可选，未传参时使用默认配置）
 * @returns 生成的随机密码字符串
 * @throws 当所有字符集均被禁用时抛出错误
 */
export function generatePassword(options?: PasswordGeneratorOptions): string {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const length = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, config.length));

  // 构建各字符集（考虑易混淆字符排除）
  const upperCharset = config.excludeAmbiguous ? removeAmbiguous(UPPERCASE_CHARS) : UPPERCASE_CHARS;
  const lowerCharset = config.excludeAmbiguous ? removeAmbiguous(LOWERCASE_CHARS) : LOWERCASE_CHARS;
  const numberCharset = config.excludeAmbiguous ? removeAmbiguous(NUMBER_CHARS) : NUMBER_CHARS;
  const symbolCharset = SYMBOL_CHARS; // 特殊字符无需排除

  // 收集启用的字符集
  const enabledCharsets: string[] = [];
  if (config.uppercase) enabledCharsets.push(upperCharset);
  if (config.lowercase) enabledCharsets.push(lowerCharset);
  if (config.numbers) enabledCharsets.push(numberCharset);
  if (config.symbols) enabledCharsets.push(symbolCharset);

  if (enabledCharsets.length === 0) {
    throw new Error('至少需要启用一种字符集');
  }

  // 合并所有启用的字符集
  const allChars = enabledCharsets.join('');

  // 第一步：保证每种启用的字符集至少包含 1 个字符
  const result: string[] = [];
  for (const charset of enabledCharsets) {
    result.push(charset[secureRandomInt(charset.length)]);
  }

  // 第二步：剩余位置从合并字符集中随机填充
  const remaining = length - result.length;
  for (let i = 0; i < remaining; i++) {
    result.push(allChars[secureRandomInt(allChars.length)]);
  }

  // 第三步：Fisher-Yates 洗牌，打乱字符顺序
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.join('');
}
