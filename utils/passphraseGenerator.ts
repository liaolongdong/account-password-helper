/**
 * 助记词组密码生成器模块
 *
 * 基于 EFF Diceware 理念，从预置词库中随机选取单词组合生成
 * 既安全又易于记忆的助记词组密码（Passphrase）。
 * 使用 Web Crypto API（crypto.getRandomValues）确保随机性安全。
 *
 * 安全性参考：
 * - 4 词组合 ≈ 44 bits 熵（等同 8 位随机密码）
 * - 5 词组合 ≈ 55 bits 熵（等同 10 位随机密码）
 * - 6 词组合 ≈ 66 bits 熵（等同 12 位随机密码）
 * - 7 词组合 ≈ 77 bits 熵（极高安全等级）
 *
 * @module utils/passphraseGenerator
 */

import { logger } from '@/utils/logger';

/** 助记词组生成配置接口 */
export interface PassphraseGeneratorOptions {
  /** 单词数量，默认 4，范围 3~8 */
  wordCount?: number;
  /** 单词分隔符，默认 '-' */
  separator?: string;
  /** 是否首字母大写，默认 true */
  capitalize?: boolean;
  /** 是否在末尾追加随机数字，默认 true */
  appendNumber?: boolean;
  /** 追加数字的位数，默认 2，范围 1~4 */
  numberDigits?: number;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<PassphraseGeneratorOptions> = {
  wordCount: 4,
  separator: '-',
  capitalize: true,
  appendNumber: true,
  numberDigits: 2,
};

/** 最小单词数 */
const MIN_WORD_COUNT = 3;

/** 最大单词数 */
const MAX_WORD_COUNT = 8;

/** 最小数字位数 */
const MIN_NUMBER_DIGITS = 1;

/** 最大数字位数 */
const MAX_NUMBER_DIGITS = 4;

/** 可选分隔符列表（供 UI 使用） */
export const SEPARATOR_OPTIONS = [
  { label: '-', value: '-' },
  { label: '_', value: '_' },
  { label: '.', value: '.' },
  { label: 'space', value: ' ' },
  { label: 'none', value: '' },
] as const;

/** 懒加载的词库数组 */
let _wordList: string[] | null = null;

/** 加载中的 Promise（防止并发 import 重复加载） */
let _loadingPromise: Promise<string[]> | null = null;

/**
 * 加载助记词词库（懒加载，仅首次触发 import）
 *
 * @returns 包含 2048 个常见英文单词的数组
 */
async function loadWordList(): Promise<string[]> {
  if (_wordList) return _wordList;

  if (!_loadingPromise) {
    _loadingPromise = import('@/utils/data/passphrase-words.json')
      .then(module => {
        const list = (module.default ?? module) as string[];
        _wordList = list;
        return _wordList;
      })
      .catch(error => {
        logger.warn('PassphraseGenerator: 词库加载失败:', error);
        // 不缓存失败结果，允许下次重试
        return [] as string[];
      })
      .finally(() => {
        _loadingPromise = null;
      });
  }

  return _loadingPromise;
}

/**
 * 使用 Web Crypto API 获取密码学安全的随机整数
 * @param max 最大值（不含）
 * @returns [0, max) 范围内的随机整数
 */
function secureRandomInt(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // 使用 rejection sampling 消除模偏差
  const limit = Math.floor(0xffffffff / max) * max;
  let value = array[0];
  while (value >= limit) {
    crypto.getRandomValues(array);
    value = array[0];
  }
  return value % max;
}

/**
 * 生成随机数字字符串
 * @param digits 位数
 * @returns 指定长度的随机数字字符串（允许前导零）
 */
function generateRandomDigits(digits: number): string {
  let result = '';
  for (let i = 0; i < digits; i++) {
    result += secureRandomInt(10).toString();
  }
  return result;
}

/**
 * 将单词首字母大写
 * @param word 原始单词
 * @returns 首字母大写后的单词
 */
function capitalizeWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * 生成助记词组密码（异步，首次调用需加载词库）
 *
 * 根据配置参数从词库中随机选取单词，组合为易记的助记词组密码。
 * 支持自定义分隔符、首字母大写、末尾追加数字等选项。
 *
 * @param options 助记词组生成配置（可选，未传参时使用默认配置）
 * @returns 生成的助记词组密码字符串
 * @throws 当词库加载失败或为空时抛出错误
 */
export async function generatePassphrase(options?: PassphraseGeneratorOptions): Promise<string> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const wordCount = Math.max(MIN_WORD_COUNT, Math.min(MAX_WORD_COUNT, config.wordCount));
  const numberDigits = Math.max(MIN_NUMBER_DIGITS, Math.min(MAX_NUMBER_DIGITS, config.numberDigits));

  const words = await loadWordList();
  if (!words || words.length === 0) {
    throw new Error('词库加载失败，无法生成助记词组密码');
  }

  // 从词库中随机选取单词（允许重复，但概率极低：2048^4 空间）
  const selectedWords: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const index = secureRandomInt(words.length);
    let word = words[index];
    if (config.capitalize) {
      word = capitalizeWord(word);
    }
    selectedWords.push(word);
  }

  // 组合词组
  let passphrase = selectedWords.join(config.separator);

  // 追加随机数字
  if (config.appendNumber) {
    passphrase += generateRandomDigits(numberDigits);
  }

  return passphrase;
}

/**
 * 同步生成助记词组密码（需词库已预加载）
 *
 * 适用于词库已通过 generatePassphrase() 或 preloadWordList() 加载的场景。
 * 若词库未加载则抛出错误。
 *
 * @param options 助记词组生成配置（可选）
 * @returns 生成的助记词组密码字符串
 * @throws 当词库未加载时抛出错误
 */
export function generatePassphraseSync(options?: PassphraseGeneratorOptions): string {
  if (!_wordList || _wordList.length === 0) {
    throw new Error('词库未加载，请先调用 generatePassphrase() 或 preloadWordList()');
  }

  const config = { ...DEFAULT_OPTIONS, ...options };
  const wordCount = Math.max(MIN_WORD_COUNT, Math.min(MAX_WORD_COUNT, config.wordCount));
  const numberDigits = Math.max(MIN_NUMBER_DIGITS, Math.min(MAX_NUMBER_DIGITS, config.numberDigits));

  const selectedWords: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const index = secureRandomInt(_wordList.length);
    let word = _wordList[index];
    if (config.capitalize) {
      word = capitalizeWord(word);
    }
    selectedWords.push(word);
  }

  let passphrase = selectedWords.join(config.separator);

  if (config.appendNumber) {
    passphrase += generateRandomDigits(numberDigits);
  }

  return passphrase;
}

/**
 * 预加载词库到内存
 *
 * 可在应用空闲时调用，使后续 generatePassphraseSync() 可同步使用。
 * 重复调用安全（幂等）。
 */
export async function preloadWordList(): Promise<void> {
  await loadWordList();
}

/**
 * 检查词库是否已加载
 * @returns 词库是否已就绪
 */
export function isWordListLoaded(): boolean {
  return _wordList !== null && _wordList.length > 0;
}
