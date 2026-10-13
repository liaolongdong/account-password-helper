/**
 * 身份信息库复验策略的判定单测
 *
 * 这里钉的是**安全语义**，不是覆盖率：`utils/identityVaultAccess.ts` 决定「打开身份库前
 * 要不要再问一次主密码」，它的调用点在 `entrypoints/options/App.vue` 的开窗门槛里，
 * 而 typecheck / lint 都看不见 `.vue` 的 `<script setup>`，所以这条判断只能靠纯函数侧自证。
 *
 * 三条不可让的口径：
 * 1. 非法值一律回落 `always`（问得最多），**不得**回落默认值 —— 否则 storage 被外部改成
 *    任意字符串就等于「免复验」；
 * 2. 除显式选择 `followValidity` 外，任何路径下「未复验的首次打开」都必须要求复验；
 * 3. `perSession` 的免问只对「本会话已复验」成立，锁定后标记复位即重新要求（复位接线由
 *    `identityLookupFromDetailWiring.test.ts` 守卫）。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTITY_VERIFY_POLICY,
  IDENTITY_VERIFY_POLICIES,
  normalizeIdentityVerifyPolicy,
  shouldVerifyIdentityVault,
} from '@/utils/identityVaultAccess';

/** 非策略值的输入样本：类型上不可达，但 storage 是外部可写面，必须按不可信输入处理 */
const ILLEGAL_VALUES: unknown[] = [
  undefined,
  null,
  '',
  'ALWAYS',
  'always ',
  'followValidity ',
  0,
  1,
  {},
  [],
  'noVerify',
];

describe('策略归一化', () => {
  it('三个合法值原样通过', () => {
    for (const policy of IDENTITY_VERIFY_POLICIES) {
      expect(normalizeIdentityVerifyPolicy(policy)).toBe(policy);
    }
  });

  it('非法值一律回落最严格的 always，而不是默认值', () => {
    for (const value of ILLEGAL_VALUES) {
      expect(normalizeIdentityVerifyPolicy(value), `非法值 ${JSON.stringify(value)} 没有被回落`).toBe('always');
    }
    // 回落方向必须与默认值无关地偏严：默认档日后放宽时，这条仍证明「认不出 = 问得最多」
    const strictest = IDENTITY_VERIFY_POLICIES.indexOf('always');
    expect(strictest).toBeLessThan(IDENTITY_VERIFY_POLICIES.indexOf(DEFAULT_IDENTITY_VERIFY_POLICY));
  });

  it('大小写与首尾空白的变体不被当成合法值（防 storage 侧手改绕过）', () => {
    // 刻意挑「小写化后会落到别的合法档」的样本：'persession' → 'perSession'。
    // 若哪天实现改成先 toLowerCase 再比对，这条会红，而 'Always' 那种样本不会。
    expect(normalizeIdentityVerifyPolicy('PERSESSION')).toBe('always');
    expect(normalizeIdentityVerifyPolicy(' perSession')).toBe('always');
    expect(normalizeIdentityVerifyPolicy('FOLLOWVALIDITY')).toBe('always');
  });
});

describe('是否要求复验', () => {
  it('always：无论本会话是否已复验过，每次都要问', () => {
    expect(shouldVerifyIdentityVault('always', false)).toBe(true);
    expect(shouldVerifyIdentityVault('always', true)).toBe(true);
  });

  it('perSession：首次问，问过之后同一会话内不再问', () => {
    expect(shouldVerifyIdentityVault('perSession', false)).toBe(true);
    expect(shouldVerifyIdentityVault('perSession', true)).toBe(false);
  });

  it('followValidity：完全不问，这是用户显式选择的降级档', () => {
    expect(shouldVerifyIdentityVault('followValidity', false)).toBe(false);
    expect(shouldVerifyIdentityVault('followValidity', true)).toBe(false);
  });

  it('除 followValidity 外，未复验的首次打开不可能免问', () => {
    // 这条是整张真值表里唯一承载「默认不降级」承诺的：新增档位若忘了要求复验，这里先红
    const skipsVerify = IDENTITY_VERIFY_POLICIES.filter(policy => !shouldVerifyIdentityVault(policy, false));
    expect(skipsVerify, `这些档位在未复验时就免问：${skipsVerify.join(', ')}`).toEqual(['followValidity']);
  });

  it('非法值经归一化后仍然要求复验，即使记账位说「本会话已问过」', () => {
    // 攻击面组合：外部把策略改成垃圾值 + 用户此前复验过 → 不得静默放行
    const policy = normalizeIdentityVerifyPolicy('garbage-value');
    expect(shouldVerifyIdentityVault(policy, true)).toBe(true);
  });
});

describe('档位枚举自身', () => {
  it('三档齐备、无重复，且顺序是从最严格到最宽松', () => {
    expect([...IDENTITY_VERIFY_POLICIES]).toEqual(['always', 'perSession', 'followValidity']);
    expect(new Set(IDENTITY_VERIFY_POLICIES).size).toBe(IDENTITY_VERIFY_POLICIES.length);
  });

  it('默认档是 perSession，且它仍然会在首次打开时要求复验', () => {
    expect(DEFAULT_IDENTITY_VERIFY_POLICY).toBe('perSession');
    expect(shouldVerifyIdentityVault(DEFAULT_IDENTITY_VERIFY_POLICY, false)).toBe(true);
  });
});
