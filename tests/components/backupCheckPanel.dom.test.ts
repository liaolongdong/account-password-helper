/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vue from 'vue';
import { createApp, h, nextTick, shallowRef, type App, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { ModuleKind, transpileModule } from 'typescript';
import { runInNewContext } from 'node:vm';
import { ElAlert, ElButton, ElInput } from 'element-plus';
import { readSource } from '@/tests/helpers/architectureScan';
import { BackupImportUserError } from '@/utils/backupExport';
import { verifyBackupFile } from '@/utils/backup/verifyBackupFile';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import CapsLockHint from '@/components/CapsLockHint.vue';
import type { BackupVerificationResult } from '@/utils/backup/type';
import { currentLocale, registerMessages, t, useI18n } from '@/utils/i18n';
import enCommon from '@/utils/i18n/locales/en/common.json';
import enOptions from '@/utils/i18n/locales/en/options.json';

// 解密正确性由 verifyBackupFile.test 的真实 Web Crypto 往返覆盖；这里控制异步完成时机。
vi.mock('@/utils/backup/verifyBackupFile', () => ({ verifyBackupFile: vi.fn() }));
vi.mock('@/utils/storage/configManager', () => ({ markVerifiedBackupAt: vi.fn() }));
registerMessages('en', enCommon, enOptions);

/**
 * WxtVitest 不带 SFC 插件；用已有 Vue 编译器和 TypeScript 编译真实组件，免改依赖/配置。
 * 仅执行仓库自身受信源码，依赖显式注入；模板与生命周期均不在测试里重写。
 */
function loadPanel(): Component {
  const source = readSource('components/options/BackupCheckPanel.vue');
  const { descriptor, errors } = parse(source);
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: 'backup-check-test', inlineTemplate: true });
  const compiled = transpileModule(script.content, { compilerOptions: { module: ModuleKind.CommonJS } });
  const exports: { default?: Component } = {};
  const dependencies: Record<string, unknown> = {
    vue,
    '@/utils/backup/verifyBackupFile': { verifyBackupFile },
    '@/utils/backupExport': { BackupImportUserError },
    '@/utils/i18n': { useI18n },
    '@/composables/useCapsLockDetection': { useCapsLockDetection },
    '@/components/CapsLockHint.vue': { default: CapsLockHint },
  };
  runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected component dependency: ${name}`);
      return dependencies[name];
    },
    /**
     * vm 上下文默认不带定时器，而冷却 tick 用的是全局 `setInterval`。
     * 早先没注入时，`startCooldown` 在设完剩余秒数那一行就当场抛错（vitest 记一条 unhandled
     * rejection 并警告「可能是假通过」），30 秒到期→解禁这条路径静默不执行，测试却照样绿。
     * 这里延迟取当前 globalThis，测试里 `vi.useFakeTimers()` 换掉的假定时器才接得上。
     */
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    /**
     * vm 上下文自带另一个 realm 的 `Date`，vitest 的假时钟够不着它——冷却 tick 按
     * `until - Date.now()` 反推剩余秒数，用的是宿主 realm 的时间，于是推进假时钟读数纹丝不动。
     * 也不能直接塞 `globalThis.Date`：上下文在导入期就建好了，那一刻快照到的是**真** Date，
     * 之后 `useFakeTimers()` 换掉的只是宿主 globalThis 上的属性。故给一个延迟取用的 `now`，
     * 组件只用到 `Date.now()`，这一层就够，拨动假时钟后倒计时才真的往下走。
     */
    Date: { now: () => Date.now() },
  });
  if (!exports.default) throw new Error('Compiled component is missing');
  return exports.default;
}

const BackupCheckPanel = loadPanel();
let app: App;
let host: HTMLDivElement;
const visible = shallowRef(true);

const element = <T extends Element>(selector: string): T => {
  const node = host.querySelector<T>(selector);
  expect(node, selector).not.toBeNull();
  return node!;
};

async function selectFile(name = 'synthetic.aph'): Promise<File> {
  const file = new File(['synthetic ciphertext'], name);
  const input = element<HTMLInputElement>('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  return file;
}

async function enterPassword(value = 'synthetic-password'): Promise<void> {
  const input = element<HTMLInputElement>('input[type="password"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

/** 非计时轮询：排空验证 Promise 及其触发的 Vue 渲染。 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await nextTick();
  await nextTick();
}

function pendingCheck() {
  let resolve!: (result: BackupVerificationResult) => void;
  let reject!: (error: unknown) => void;
  vi.mocked(verifyBackupFile).mockReturnValueOnce(
    new Promise<BackupVerificationResult>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return { resolve, reject };
}

beforeEach(async () => {
  vi.mocked(verifyBackupFile).mockReset();
  currentLocale.value = 'en';
  visible.value = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  app = createApp({ render: () => (visible.value ? h(BackupCheckPanel) : null) });
  app.component('ElAlert', ElAlert);
  app.component('ElButton', ElButton);
  app.component('ElInput', ElInput);
  app.mount(host);
  await nextTick();
});

afterEach(() => {
  app.unmount();
  host.remove();
  vi.restoreAllMocks();
  // 冷却那条用例换了假时钟，不还原会把假定时器漏给后面的用例
  vi.useRealTimers();
  currentLocale.value = 'zh-CN';
});

describe('BackupCheckPanel 只读交互', () => {
  it('文件和密码有可读标签；缺输入或空白密码时不能验证', async () => {
    const file = element<HTMLInputElement>('input[type="file"]');
    const password = element<HTMLInputElement>('input[type="password"]');
    expect(file.labels?.[0]?.textContent).toContain(t('options.forgot.checkFile'));
    expect(password.labels?.[0]?.textContent).toContain(t('options.forgot.checkPassword'));
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await selectFile();
    await enterPassword('   ');
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(verifyBackupFile).not.toHaveBeenCalled();
  });

  it('文件选择经 el-button 转发到隐藏 input，选中的文件名可见回显', async () => {
    // 原生 input 已 `display:none`，取文件入口必须是那颗按钮；而 `input.value` 在拿到
    // 文件后立即清空（否则重挑同一份文件不再触发 change），所以「选到了哪份」只能由组件自己说。
    const file = element<HTMLInputElement>('input[type="file"]');
    const picker = element<HTMLButtonElement>('button[type="button"]');
    const nativeClick = vi.spyOn(file, 'click');
    picker.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(t('common.noFileSelected'));

    await selectFile('my-backup.aph');
    expect(host.textContent).toContain(t('common.fileSelected', { name: 'my-backup.aph' }));
    expect(host.textContent).not.toContain(t('common.noFileSelected'));
    expect(file.value).toBe('');
  });

  it('等待时禁止重复验证，成功仅播报类型与条数并明确尚未导入', async () => {
    const pending = pendingCheck();
    const file = await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await nextTick();
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    element<HTMLButtonElement>('button[type="submit"]').click();
    expect(verifyBackupFile).toHaveBeenCalledTimes(1);
    expect(verifyBackupFile).toHaveBeenCalledWith(file, 'synthetic-password');
    pending.resolve({ kind: 'passwords', count: 3 });
    await settle();
    const status = element<HTMLElement>('[aria-live="polite"]');
    expect(status.textContent).toContain(
      t('options.forgot.checkSuccess', { kind: t('options.forgot.checkPasswords'), count: 3 }),
    );
    expect(host.textContent).toContain(t('options.forgot.checkOnly'));
    expect(host.textContent).not.toContain('synthetic-password');
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
  });

  /**
   * 锁定页也能用这块验证区，而且它不需要当前主密码（评审报告 P2-12）。
   *
   * 没有节流时，任何拿到 `.aph` / `.aphid` 文件的人都能在这里无限次磨「导出那一刻的主密码」，
   * 每次还白付一次 600k 迭代的 PBKDF2。连续三次失败后进入 30 秒冷却，按钮禁用并给出剩余秒数。
   */
  it('连续三次失败进入冷却：按钮禁用、给出剩余秒数，且不再调用解密', async () => {
    vi.useFakeTimers();
    vi.mocked(verifyBackupFile).mockRejectedValue(new BackupImportUserError('synthetic-mismatch'));
    const submit = () => element<HTMLButtonElement>('button[type="submit"]');
    await selectFile();
    await enterPassword();

    for (let attempt = 0; attempt < 3; attempt++) {
      submit().click();
      await settle();
    }

    expect(verifyBackupFile).toHaveBeenCalledTimes(3);
    expect(submit().disabled, '冷却期内不得继续磨口令').toBe(true);
    expect(host.textContent).toContain('30');

    submit().click();
    await settle();
    expect(verifyBackupFile).toHaveBeenCalledTimes(3);

    /**
     * 倒计时与解禁：冷却不是「按钮永久灰掉」。
     * tick 按 `until - Date.now()` 反推剩余，故推进假时钟即可断言真实读数；
     * 到期后连续失败计数归零，第四次尝试要能再次走进解密。
     */
    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(host.textContent).toContain('20');
    submit().click();
    await settle();
    expect(verifyBackupFile).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(20_000);
    await nextTick();
    expect(submit().disabled, '30 秒已过后按钮应重新可用').toBe(false);
    submit().click();
    await settle();
    expect(verifyBackupFile).toHaveBeenCalledTimes(4);
  });

  it('成功一次会清零连续失败计数，冷却只针对「连续」失败', async () => {
    const submit = () => element<HTMLButtonElement>('button[type="submit"]');
    const failOnce = () =>
      vi.mocked(verifyBackupFile).mockRejectedValueOnce(new BackupImportUserError('synthetic-mismatch'));
    await selectFile();
    await enterPassword();

    failOnce();
    submit().click();
    await settle();
    failOnce();
    submit().click();
    await settle();
    vi.mocked(verifyBackupFile).mockResolvedValueOnce({ kind: 'passwords', count: 1 });
    submit().click();
    await settle();

    failOnce();
    submit().click();
    await settle();
    failOnce();
    submit().click();
    await settle();

    expect(verifyBackupFile).toHaveBeenCalledTimes(5);
    expect(submit().disabled, '非连续失败不该触发冷却').toBe(false);
  });

  it('身份库空备份显示正确类型与零条数', async () => {
    vi.mocked(verifyBackupFile).mockResolvedValue({ kind: 'identities', count: 0 });
    await selectFile('synthetic.aphid');
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await settle();
    expect(host.textContent).toContain(
      t('options.forgot.checkSuccess', { kind: t('options.forgot.checkIdentities'), count: 0 }),
    );
  });

  it.each(['file', 'password'])('修改 %s 后清除已成功结果', async changed => {
    vi.mocked(verifyBackupFile).mockResolvedValue({ kind: 'passwords', count: 2 });
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await settle();
    const success = t('options.forgot.checkSuccess', { kind: t('options.forgot.checkPasswords'), count: 2 });
    expect(host.textContent).toContain(success);
    if (changed === 'file') await selectFile('other.aph');
    else await enterPassword('different-password');
    expect(host.textContent).not.toContain(success);
  });

  it.each(['file', 'password'])('验证期间修改 %s，迟到成功不能显示', async changed => {
    const pending = pendingCheck();
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await nextTick();
    if (changed === 'file') await selectFile('other.aphid');
    else await enterPassword('different-password');
    // Web Crypto 无取消 API，旧任务完成前仍禁按钮，避免叠加昂贵解密。
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    pending.resolve({ kind: 'passwords', count: 9 });
    await settle();
    expect(host.textContent).not.toContain(
      t('options.forgot.checkSuccess', { kind: t('options.forgot.checkPasswords'), count: 9 }),
    );
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
  });

  it('修改输入后，迟到失败也不能覆盖新输入的状态', async () => {
    const pending = pendingCheck();
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await enterPassword('different-password');
    pending.reject(new BackupImportUserError('old-error'));
    await settle();
    expect(host.textContent).not.toContain('old-error');
  });

  it('失败显示可读错误而非成功，未知异常不泄露原始内容', async () => {
    vi.mocked(verifyBackupFile).mockRejectedValueOnce(new BackupImportUserError('File exceeds allowed size'));
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button[type="submit"]').click();
    await settle();
    expect(element<HTMLElement>('[aria-live="polite"]').textContent).toContain('File exceeds allowed size');
    expect(host.querySelector('.el-alert--success')).toBeNull();
    vi.mocked(verifyBackupFile).mockRejectedValueOnce(new Error('synthetic-sensitive-details'));
    element<HTMLButtonElement>('button[type="submit"]').click();
    await settle();
    expect(host.textContent).toContain(t('options.forgot.checkFailed'));
    expect(host.textContent).not.toContain('synthetic-sensitive-details');
    expect(host.querySelector('.el-alert--success')).toBeNull();
  });

  it('关闭卸载再打开，文件/密码/结果全空，旧任务无法污染新实例', async () => {
    const pending = pendingCheck();
    await selectFile();
    await enterPassword();
    const oldPassword = element<HTMLInputElement>('input[type="password"]');
    element<HTMLButtonElement>('button[type="submit"]').click();
    visible.value = false;
    await nextTick();
    expect(oldPassword.value).toBe('');
    visible.value = true;
    await nextTick();
    pending.resolve({ kind: 'passwords', count: 99 });
    await settle();
    expect(element<HTMLInputElement>('input[type="file"]').value).toBe('');
    expect(element<HTMLInputElement>('input[type="password"]').value).toBe('');
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(host.textContent).not.toContain('99');
    expect(host.textContent).not.toContain('synthetic.aph');
  });
});
