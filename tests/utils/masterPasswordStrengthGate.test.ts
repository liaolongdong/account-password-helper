import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/helpers/architectureScan';
import { evaluateStrengthCore } from '@/utils/passwordStrengthCore';
import { normalizeNewMasterPassword } from '@/utils/storage/recoveryState';

/**
 * 主密码强度门槛回归测试（创建 / 改密 / 恢复换钥同门槛）
 *
 * 背景：主密码强度就是数据密钥强度，但三条路径曾各说各话——
 * - 创建（`useAuthFlow.setupRules`）本地抄了一份正则，要求 长度+字母+数字+符号 全通过；
 * - 改密弹窗判的是 `level === 'weak'`，而 `level` 在通过数 ≥2 时即升为 `medium`
 *   （`utils/passwordStrengthCore.ts` 的等级映射），等于四条里只要求两条；
 * - 存储层 `changeMasterPassword` 完全不校强度，恢复链路却走 `allPassed`。
 *
 * 三个后果：① 改密可以把整库降级到「首次设置根本不允许」的密钥强度；② 同一串密码
 * 在启用 / 未启用离线恢复时得到两种结果（弹窗放行、提交被拒）；③ 门槛只做在 UI 上，
 * 任何绕过弹窗的调用都能写进弱密钥。
 *
 * 本套件锁定的不变量：
 * 1. 存储层门槛与 `evaluateStrengthCore().allPassed` 逐候选同判定（单一事实来源）；
 * 2. 四条未全通过的候选一律被 `normalizeNewMasterPassword` 拒为 `WEAK_PASSWORD`；
 * 3. 创建与改密两处 UI 都从核心模块取判定，不再本地抄正则、不再用 `level === 'weak'`。
 */

/** 候选新密码：`expected` 为「四条规则是否全通过」 */
const CANDIDATES: Array<{ label: string; password: string; expected: boolean }> = [
  { label: '四条全通过', password: 'Abcdef1!', expected: true },
  { label: '缺符号', password: 'Abcdefgh1', expected: false },
  { label: '缺数字', password: 'Abcdefgh!', expected: false },
  { label: '缺字母', password: '12345678!', expected: false },
  { label: '长度不足但含齐三类', password: 'Ab1!xy', expected: false },
  { label: '只满足两条（旧口径会放行）', password: 'abcdefgh1234', expected: false },
];

/** 取被抛异常的 `code` 字段；未抛错时返回 undefined，让「没拒绝」也能被断言抓住 */
function thrownCode(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : '<无 code 的异常>';
  }
  return undefined;
}

describe('normalizeNewMasterPassword 与核心判定同源', () => {
  it.each(CANDIDATES)('$label → allPassed=$expected', ({ password, expected }) => {
    expect(evaluateStrengthCore(password).allPassed).toBe(expected);
    if (expected) {
      expect(() => normalizeNewMasterPassword(password)).not.toThrow();
      expect(normalizeNewMasterPassword(password)).toBe(password);
    } else {
      expect(thrownCode(() => normalizeNewMasterPassword(password))).toBe('WEAK_PASSWORD');
    }
  });

  it('首尾空白按既有口径剥除后再判定，避免「看着合格实则不合格」', () => {
    expect(normalizeNewMasterPassword('  Abcdef1!  ')).toBe('Abcdef1!');
    expect(thrownCode(() => normalizeNewMasterPassword('   abcd1234   '))).toBe('WEAK_PASSWORD');
  });

  it('空密码仍走 EMPTY_PASSWORD，不与弱密码混成同一个码', () => {
    expect(thrownCode(() => normalizeNewMasterPassword('   '))).toBe('EMPTY_PASSWORD');
  });
});

describe('强度门槛不得只落在 UI 上', () => {
  it('首次设置存储层也拒绝弱主密码', async () => {
    const { setMasterPassword } = await import('@/utils/storage/masterPassword');
    await expect(setMasterPassword('weak-only-password')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('改密存储层在验旧密码之前先过强度门槛', async () => {
    const source = readSource('utils/storage/changeMasterPassword.ts');
    const gate = source.indexOf('normalizeNewMasterPassword(newPw)');
    const auth = source.indexOf('verifyMasterPassword(oldPw)');
    expect(gate).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(auth);
  });
});

describe('两条 UI 路径共用核心判定', () => {
  it('创建主密码不再本地抄正则，改走 evaluateStrengthRules', () => {
    const source = readSource('composables/useAuthFlow.ts');
    expect(source).toContain('evaluateStrengthRules');
    // 手抄的字符类一旦与核心漂移，就会出现「创建不允许、改密允许」的口径差
    expect(source).not.toMatch(/const hasSpecialChar = /);
    expect(source).not.toMatch(/\[!@#\$%\^&\*\(\)/);
  });

  it('改密弹窗按「四条全通过」收口，不再用会放过 2/4 的 level 判定', () => {
    const source = readSource('components/options/ChangeMasterPasswordDialog.vue');
    expect(source).toContain('passwordStrength.value.allPassed');
    expect(source).not.toContain("passwordStrength.value.level === 'weak'");
  });
});
