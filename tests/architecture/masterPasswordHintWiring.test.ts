/**
 * 主密码提示语与找回向导的接线守卫
 *
 *  storage 侧的行为由 `tests/utils/masterPasswordHint.test.ts` 与
 * `tests/utils/changeMasterPasswordHint.test.ts` 覆盖；这里钉的是**只有源码能证明**、
 * 断掉后不会有任何测试变红的三类接线：
 *
 * 1. 阈值单一来源：`MAX_FAIL_BEFORE_HINT` 全仓只许有一处定义。解锁页与敏感操作复验弹窗
 *    共用同一档位，一旦有人就地写回 `3`，两处门槛会静默分叉（复验弹窗已改成 import）。
 * 2. 提示语的可见条件：必须同时要求「有提示语」与「连续输错达阈值」，
 *    缺前者会让空提示语渲染出一个空区块，缺后者等于第一次输错就把本机明文提示甩在脸上。
 * 3. 清空入口不再直通：解锁页的「忘记密码」必须先经过找回向导，
 *    向导终点才把 `reset` 交回 `useAuthFlow.resetMasterPassword`（其 `lockSession → clearAllData`
 *    序列与二次确认由 `useAuthFlow.resetMasterPassword.test.ts` 守着）。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

const VERIFY_VIEW = 'components/options/PasswordVerifyView.vue';
const SETUP_VIEW = 'components/options/MasterPasswordSetupView.vue';
const FORGOT_DIALOG = 'components/options/ForgotPasswordDialog.vue';
const AUTH_FLOW = 'composables/useAuthFlow.ts';
const OPTIONS_APP = 'entrypoints/options/App.vue';

/** 会被打包或运行的源码目录，与 `siblingImportAlias` / `lintBypassInventory` 同口径 */
const SCANNED_DIRS = ['components', 'composables', 'entrypoints', 'utils'];

describe('MAX_FAIL_BEFORE_HINT 的单一来源', () => {
  it('全仓只有一处定义，且落在 useAuthFlow（与 SHAKE_DURATION_MS 同一惯例）', () => {
    const definers = SCANNED_DIRS.flatMap(dir =>
      listSourceFiles(dir).filter(rel => /const MAX_FAIL_BEFORE_HINT\b/.test(readSource(rel))),
    ).sort();

    expect(definers).toEqual(['composables/useAuthFlow.ts']);
    expect(readSource(definers[0] as string)).toContain('export const MAX_FAIL_BEFORE_HINT = 3;');
  });

  it('复验弹窗改为消费该常量，不再自带一份字面量 3', () => {
    const dialog = readSource('components/options/MasterPasswordVerifyDialog.vue');
    expect(dialog).toContain("import { SHAKE_DURATION_MS, MAX_FAIL_BEFORE_HINT } from '@/composables/useAuthFlow';");
    expect(dialog).not.toMatch(/const MAX_FAIL_BEFORE_HINT\s*=\s*3/);
  });
});

describe('解锁页的提示语可见条件', () => {
  const source = readSource(VERIFY_VIEW);

  it('同时要求有提示语与连续输错达阈值', () => {
    expect(source).toMatch(/v-if="hint && failCount >= MAX_FAIL_BEFORE_HINT"/);
  });

  it('阈值与提示语都来自 props / 共享常量，没有就地写死的数字', () => {
    expect(source).toContain("import { SHAKE_DURATION_MS, MAX_FAIL_BEFORE_HINT } from '@/composables/useAuthFlow';");
    expect(source).toMatch(/hint: string;/);
    expect(source).toMatch(/failCount: number;/);
  });

  it('App 把两个新 props 接到 useAuthFlow 的状态上', () => {
    const app = readSource(OPTIONS_APP);
    expect(app).toContain(':hint="masterPasswordHint"');
    expect(app).toContain(':fail-count="verifyFailCount"');
    expect(app).toMatch(/\bmasterPasswordHint,/);
    expect(app).toMatch(/\bverifyFailCount,/);
  });
});

describe('清空入口经找回向导收口', () => {
  it('解锁页的「忘记密码」只打开向导，不再直接 emit reset', () => {
    const source = readSource(VERIFY_VIEW);
    expect(source).toContain('@click="showForgotDialog = true"');
    expect(source).not.toContain('@click="$emit(\'reset\')"');
    expect(source).toContain('@reset="handleConfirmReset"');
    expect(source).toContain("import ForgotPasswordDialog from './ForgotPasswordDialog.vue';");
  });

  it('向导自身不碰任何密钥与存储，终点只转发 reset 事件', () => {
    const source = readSource(FORGOT_DIALOG);
    // 判据只看代码面：注释里出现 clearAllData 这类词是在解释「为什么不调用」，不构成违规
    expect(source).not.toMatch(/from '@\/utils\/storage/);
    expect(source).not.toContain('chrome.storage.');
    expect(source).not.toMatch(/await\s+(StorageUtils|chrome)\./);
    expect(source).toContain("emit('reset')");
  });

  it('向导文案走 options 命名空间（Popup 的 auth 依赖图里不含 options，长文案不进弹窗包）', () => {
    const source = readSource(FORGOT_DIALOG);
    expect(source).toContain("t('options.forgot.title')");
    expect(source).not.toMatch(/t\('auth\./);
  });
});

describe('设置页把提示语交给存储', () => {
  it('提示语随表单双向同步并进入 setMasterPassword 的第二参', () => {
    const setup = readSource(SETUP_VIEW);
    expect(setup).toContain('hint: props.setupForm.hint');
    expect(setup).toContain('formModel.hint = val.hint;');
    expect(setup).toMatch(/prop="hint"/);

    const flow = readSource(AUTH_FLOW);
    expect(flow).toContain('StorageUtils.setMasterPassword(setupForm.value.password.trim(), setupForm.value.hint)');
  });

  it('输错计数只在密码错误分支自增，成功验证即归零', () => {
    const flow = readSource(AUTH_FLOW);
    // 计数只在 WRONG_PASSWORD 分流处自增：VAULT_BUSY（换钥进行中）与通用异常都不算密码错，
    // 否则一次换钥碰撞就把提示语门槛推高。三种分流的实际行为由
    // `tests/composables/useAuthFlow.unlockDerivation.dom.test.ts` 逐条验证，这里只锁源码形状。
    const busyBranch = flow.match(/if \(code === VAULT_BUSY\) \{([\s\S]*?)\n {8}\}/);
    expect(busyBranch, '换钥进行中分支缺失').toBeTruthy();
    expect(busyBranch![1]).not.toContain('verifyFailCount');

    const wrongBranch = flow.slice(flow.indexOf('if (code !== WRONG_PASSWORD) throw authError;'));
    expect(wrongBranch.length).toBeGreaterThan(0);
    expect(wrongBranch.slice(0, 240)).toContain('verifyFailCount.value++');

    expect(flow).toContain('verifyFailCount.value = 0;');
  });
});
