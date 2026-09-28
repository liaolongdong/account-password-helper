/** @vitest-environment jsdom */

/**
 * 密码表单保存的校验失败口径（usePasswordManagement.handlePasswordFormSave）
 *
 * 回归背景：校验与真实写入共用一个 `try/catch`，`formRef.validate()` 的 reject 会一路走到
 * `logger.error('保存密码失败')` + `ElMessage.error('保存失败')`。用户看到的是「字段内联提示 +
 * 系统级保存失败」双重反馈，且把 Element Plus 的字段错误对象当异常写进 error 日志——
 * 既误导排障，也与仓库既有约定（`SiteRulesDialog.vue` 的「校验失败由表单内联提示，无需额外弹 toast」）
 * 相冲突。
 *
 * 现在锁定的口径：
 * 1. 校验 reject → 不弹任何提示、不触碰存储、弹窗保持打开、loading 复位；
 * 2. 校验 resolve → 保存照常发生并提示成功（防止把早退写成「什么都不做」的假修复）；
 * 3. 未传 formRef 的调用方（无表单场景）不被新分支影响。
 *
 * 打桩 `globalThis.ElMessage` 而非 spy `element-plus` 导出的原因，见
 * `usePasswordManagement.delete.test.ts` 头部说明（AutoImport 只在真实构建期注入 import）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import type { FormInstance } from 'element-plus';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

interface EpStubs {
  ElMessage: Record<'success' | 'error' | 'warning' | 'info', Mock>;
}

describe('handlePasswordFormSave 的校验失败口径', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let ep: EpStubs;
  let saveSpy: ReturnType<typeof vi.spyOn>;
  let updateSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  /** 只关心 validate 结果的最小表单桩（其余 FormInstance 成员不参与本用例） */
  const formRefOf = (validate: () => Promise<unknown>): FormInstance => ({ validate }) as unknown as FormInstance;

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';

    ep = {
      ElMessage: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
      },
    };
    Object.assign(globalThis, ep);

    saveSpy = vi.spyOn(StorageUtils, 'savePassword').mockResolvedValue({
      id: 'new-1',
      username: 'alice',
      password: 'p',
      url: '',
      remark: '',
      totp: '',
      tag: '',
      createTime: 1,
      updateTime: 1,
      order: 1,
    } as never);
    updateSpy = vi.spyOn(StorageUtils, 'updatePassword').mockResolvedValue(undefined as never);
    // 校验失败的 reject 值不是 Error，落进 error 日志会污染排障线索
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    mgmt.openPasswordDialog('example.com');
    mgmt.applyPasswordFormPatch({ username: 'alice', password: 'p' });
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
  });

  it('校验失败：不弹「保存失败」，不写存储，弹窗与表单保持原状', async () => {
    const validate = vi.fn().mockRejectedValue({ username: [{ message: '用户名不能为空' }] });

    await mgmt.handlePasswordFormSave(formRefOf(validate));

    expect(validate).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    // 弹窗必须保持打开：校验失败不该把用户输入一并丢掉
    expect(mgmt.showPasswordDialog.value).toBe(true);
    expect(mgmt.passwordForm.value.username).toBe('alice');
    expect(mgmt.passwordFormLoading.value).toBe(false);
  });

  it('校验通过：保存照常发生并提示成功（早退分支不是万能静默）', async () => {
    const validate = vi.fn().mockResolvedValue(true);

    await mgmt.handlePasswordFormSave(formRefOf(validate));

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
    expect(ep.ElMessage.success).toHaveBeenCalledTimes(1);
    expect(mgmt.showPasswordDialog.value).toBe(false);
    expect(mgmt.passwordFormLoading.value).toBe(false);
  });

  it('写入真实失败仍然上报「保存失败」，收窄不能吞掉真异常', async () => {
    saveSpy.mockRejectedValue(new Error('storage write failed'));

    await mgmt.handlePasswordFormSave(formRefOf(vi.fn().mockResolvedValue(true)));

    expect(ep.ElMessage.error).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
    expect(mgmt.showPasswordDialog.value).toBe(true);
  });

  it('未传 formRef 时跳过校验，按原路径直接落盘', async () => {
    await mgmt.handlePasswordFormSave();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
  });
});
