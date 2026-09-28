import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePassword, MAX_PASSWORD_LENGTH } from '@/utils/passwordGenerator';

/**
 * 密码生成器特征化测试
 *
 * 该模块此前零单测，而它产出的就是凭据本身：字符集遗漏会让用户在「以为用了强随机」
 * 的前提下拿到弱口令，位置偏差会让「至少含一个大写」这类保证只出现在开头几位。
 *
 * 判据分两类：
 * - 概率性属性用大量样本统计（长度、字母表封闭性、每类字符集必然出现、易混淆字符排除），
 *   走真实 Web Crypto；
 * - 需要精确复现的位置类断言用桩替换 `crypto.getRandomValues`，把「取模 → 选字符 →
 *   Fisher-Yates」整条链变成可推演的确定过程。
 *
 * 两处刻意留下的钉子：
 * 1. 长度必须被夹在 [6, MAX_PASSWORD_LENGTH]，包括 NaN 这类非数值输入不得缩短结果
 *    （表单里 `v-model.number` 清空即得 NaN，静默产出一个 4 位口令属于安全回归）；
 * 2. 洗牌必须真的打乱「每类字符集各出一个」的固定开头，否则前 4 位字符类别可预测。
 */

/** 各类字符集的完整字母表（与源码常量同口径，独立写出以免镜像实现） */
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = '1lI0O';

const charSetOf = (value: string): Set<string> => new Set(value);
const containsFrom = (password: string, charset: string): boolean => [...charset].some(c => password.includes(c));

const restoreRandom = vi.hoisted(() => ({ current: undefined as unknown }));

/** 用固定序列替换 crypto.getRandomValues（返回还原函数） */
const stubRandomWith = (values: number[]): (() => void) => {
  const original = crypto.getRandomValues.bind(crypto);
  restoreRandom.current = original;
  let index = 0;
  crypto.getRandomValues = ((array: Uint32Array) => {
    array[0] = values[index % values.length];
    index += 1;
    return array;
  }) as typeof crypto.getRandomValues;
  return () => {
    crypto.getRandomValues = restoreRandom.current as typeof crypto.getRandomValues;
  };
};

afterEach(() => {
  const original = restoreRandom.current as typeof crypto.getRandomValues | undefined;
  if (original) crypto.getRandomValues = original;
  restoreRandom.current = undefined;
  vi.restoreAllMocks();
});

describe('长度边界', () => {
  it('缺省配置产出 16 位', () => {
    expect(generatePassword()).toHaveLength(16);
  });

  it('上下界之外被夹回区间内', () => {
    expect(generatePassword({ length: 1 })).toHaveLength(6);
    expect(generatePassword({ length: 0 })).toHaveLength(6);
    expect(generatePassword({ length: -100 })).toHaveLength(6);
    expect(generatePassword({ length: 9999 })).toHaveLength(MAX_PASSWORD_LENGTH);
  });

  it('长度恰为 6 时四种字符集各占一位，不再截断', () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({ length: 6 });
      expect(password).toHaveLength(6);
      expect(containsFrom(password, UPPER)).toBe(true);
      expect(containsFrom(password, LOWER)).toBe(true);
      expect(containsFrom(password, DIGITS)).toBe(true);
      expect(containsFrom(password, SYMBOLS)).toBe(true);
    }
  });

  it('小数长度向下取整，不产出比请求更长的口令', () => {
    expect(generatePassword({ length: 12.7 })).toHaveLength(12);
    expect(generatePassword({ length: 6.5 })).toHaveLength(6);
  });

  /**
   * 长度归一的三条分支各自钉死（回归防护：修复前 `Math.max(6, Math.min(50, NaN))` 为 NaN，
   * 填充循环一次不进，四种字符集全开时静默产出 4 位口令 —— 用户以为生成的是 16 位强口令）。
   */
  it('非数值长度回落到默认 16 位，而不是缩成字符集数量的 4 位', () => {
    for (const length of [NaN, undefined, 'abc', {}] as unknown as number[]) {
      expect(generatePassword({ length })).toHaveLength(16);
    }
    expect(generatePassword({})).toHaveLength(16);
  });

  it('可归一为 0 的长度（null / 空串）夹到下界 6 位', () => {
    for (const length of [null, ''] as unknown as number[]) {
      expect(generatePassword({ length })).toHaveLength(6);
    }
  });

  it('数字字符串按数值使用，不做字符串拼接', () => {
    expect(generatePassword({ length: '12' as unknown as number })).toHaveLength(12);
  });
});

describe('字符集取舍', () => {
  it('启用哪些字符集，产出就只含哪些字符', () => {
    const cases: Array<[{ uppercase?: boolean; lowercase?: boolean; numbers?: boolean; symbols?: boolean }, string]> = [
      [{ uppercase: true, lowercase: false, numbers: false, symbols: false }, UPPER],
      [{ uppercase: false, lowercase: true, numbers: false, symbols: false }, LOWER],
      [{ uppercase: false, lowercase: false, numbers: true, symbols: false }, DIGITS],
      [{ uppercase: false, lowercase: false, numbers: false, symbols: true }, SYMBOLS],
    ];
    for (const [options, alphabet] of cases) {
      const allowed = charSetOf(alphabet);
      for (let i = 0; i < 50; i++) {
        const password = generatePassword({ ...options, length: 24 });
        expect([...password].every(c => allowed.has(c))).toBe(true);
      }
    }
  });

  it('每种启用的字符集至少出现一次（不随随机波动）', () => {
    for (let i = 0; i < 300; i++) {
      const password = generatePassword({ length: 12 });
      expect(containsFrom(password, UPPER)).toBe(true);
      expect(containsFrom(password, LOWER)).toBe(true);
      expect(containsFrom(password, DIGITS)).toBe(true);
      expect(containsFrom(password, SYMBOLS)).toBe(true);
    }
  });

  it('全部字符集禁用时抛错，而不是回退成一个弱口令', () => {
    expect(() => generatePassword({ uppercase: false, lowercase: false, numbers: false, symbols: false })).toThrow(
      '至少需要启用一种字符集',
    );
  });

  it('排除易混淆后，1/l/I/0/O 一个都不出现', () => {
    for (let i = 0; i < 300; i++) {
      const password = generatePassword({ excludeAmbiguous: true, length: 40 });
      expect([...password].some(c => AMBIGUOUS.includes(c))).toBe(false);
    }
  });

  it('默认不排除易混淆字符（多次采样必然出现其中之一）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const c of generatePassword({ length: 40 })) if (AMBIGUOUS.includes(c)) seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('只留数字 + 排除易混淆：字母表收窄到 8 个字符但仍满足长度', () => {
    const allowed = charSetOf('23456789');
    for (let i = 0; i < 50; i++) {
      const password = generatePassword({
        uppercase: false,
        lowercase: false,
        numbers: true,
        symbols: false,
        excludeAmbiguous: true,
        length: 10,
      });
      expect(password).toHaveLength(10);
      expect([...password].every(c => allowed.has(c))).toBe(true);
    }
  });
});

describe('随机源与位置分布', () => {
  it('取样彼此独立（同一口令连出两次的概率可忽略）', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 200; i++) samples.add(generatePassword({ length: 16 }));
    expect(samples.size).toBe(200);
  });

  it('确实调用 Web Crypto 而非 Math.random', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    generatePassword({ length: 20 });
    expect(spy).toHaveBeenCalled();
  });

  it('洗牌生效：固定随机序列下，四类字符不会按「上写下数再符号」的顺序排列', () => {
    // 序列刻意让前四次取值各选中本字符集首字符（索引 0），若洗牌缺失或失效，
    // 结果就会是 "Aa0!" 打头 —— 这行断言把「顺序可预测」变成可判定的失败。
    const restore = stubRandomWith([0, 0, 0, 0, 0, 0, 3, 3, 1, 1]);
    const password = generatePassword({ length: 10 });
    restore();
    expect(password).toHaveLength(10);
    expect(password.startsWith('Aa0!')).toBe(false);
  });

  it('随机取值按字符集长度取模，索引永不越界（越界会产出 undefined 字符）', () => {
    // 全部取 Uint32 最大值：max 取模后仍落在各字符集内，不得出现 undefined
    const restore = stubRandomWith([0xffffffff]);
    const password = generatePassword({ length: 30 });
    restore();
    expect(password).toHaveLength(30);
    expect(password.includes('undefined')).toBe(false);
    expect([...password].every(c => [...UPPER, ...LOWER, ...DIGITS, ...SYMBOLS].includes(c))).toBe(true);
  });
});
