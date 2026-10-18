/**
 * 主密码验证弹窗自动聚焦的接线守卫
 *
 * 行为测试（`tests/utils/dialogFocus.test.ts`）只能证明 `focusAfterDialogOpen`
 * 在 Element Plus 弹窗里能赢过 focus-trap；若 SFC 改回同一 tick 的 `nextTick`
 * 或删掉聚焦调用，行为测试不会变红。这里钉住真正生效的那一行接线。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const DIALOG = 'components/options/MasterPasswordVerifyDialog.vue';

describe('主密码验证弹窗的自动聚焦接线', () => {
  const source = readSource(DIALOG);

  it('打开弹窗时经 focusAfterDialogOpen 聚焦密码输入框', () => {
    expect(source).toContain("import { focusAfterDialogOpen } from '@/utils/dialogFocus';");
    expect(source).toContain('focusAfterDialogOpen(focusPasswordInput);');
    expect(source).toContain('inputRef.value?.focus();');
  });

  it('不再用 nextTick + querySelector 直接抢焦点', () => {
    expect(source).not.toContain("querySelector?.('.el-input__inner')");
  });
});
