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
import type { BackupVerificationResult } from '@/utils/backup/type';
import { currentLocale, registerMessages, t, useI18n } from '@/utils/i18n';
import enOptions from '@/utils/i18n/locales/en/options.json';

// 解密正确性由 verifyBackupFile.test 的真实 Web Crypto 往返覆盖；这里控制异步完成时机。
vi.mock('@/utils/backup/verifyBackupFile', () => ({ verifyBackupFile: vi.fn() }));
vi.mock('@/utils/storage/configManager', () => ({ markVerifiedBackupAt: vi.fn() }));
registerMessages('en', enOptions);

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
  };
  runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected component dependency: ${name}`);
      return dependencies[name];
    },
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
  currentLocale.value = 'zh-CN';
});

describe('BackupCheckPanel 只读交互', () => {
  it('文件和密码有可读标签；缺输入或空白密码时不能验证', async () => {
    const file = element<HTMLInputElement>('input[type="file"]');
    const password = element<HTMLInputElement>('input[type="password"]');
    expect(file.labels?.[0]?.textContent).toContain(t('options.forgot.checkFile'));
    expect(password.labels?.[0]?.textContent).toContain(t('options.forgot.checkPassword'));
    expect(element<HTMLButtonElement>('button').disabled).toBe(true);
    await selectFile();
    await enterPassword('   ');
    expect(element<HTMLButtonElement>('button').disabled).toBe(true);
    expect(verifyBackupFile).not.toHaveBeenCalled();
  });

  it('等待时禁止重复验证，成功仅播报类型与条数并明确尚未导入', async () => {
    const pending = pendingCheck();
    const file = await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button').click();
    await nextTick();
    expect(element<HTMLButtonElement>('button').disabled).toBe(true);
    element<HTMLButtonElement>('button').click();
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
    expect(element<HTMLButtonElement>('button').disabled).toBe(false);
  });

  it('身份库空备份显示正确类型与零条数', async () => {
    vi.mocked(verifyBackupFile).mockResolvedValue({ kind: 'identities', count: 0 });
    await selectFile('synthetic.aphid');
    await enterPassword();
    element<HTMLButtonElement>('button').click();
    await settle();
    expect(host.textContent).toContain(
      t('options.forgot.checkSuccess', { kind: t('options.forgot.checkIdentities'), count: 0 }),
    );
  });

  it.each(['file', 'password'])('修改 %s 后清除已成功结果', async changed => {
    vi.mocked(verifyBackupFile).mockResolvedValue({ kind: 'passwords', count: 2 });
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button').click();
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
    element<HTMLButtonElement>('button').click();
    await nextTick();
    if (changed === 'file') await selectFile('other.aphid');
    else await enterPassword('different-password');
    // Web Crypto 无取消 API，旧任务完成前仍禁按钮，避免叠加昂贵解密。
    expect(element<HTMLButtonElement>('button').disabled).toBe(true);
    pending.resolve({ kind: 'passwords', count: 9 });
    await settle();
    expect(host.textContent).not.toContain(
      t('options.forgot.checkSuccess', { kind: t('options.forgot.checkPasswords'), count: 9 }),
    );
    expect(element<HTMLButtonElement>('button').disabled).toBe(false);
  });

  it('修改输入后，迟到失败也不能覆盖新输入的状态', async () => {
    const pending = pendingCheck();
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button').click();
    await enterPassword('different-password');
    pending.reject(new BackupImportUserError('old-error'));
    await settle();
    expect(host.textContent).not.toContain('old-error');
  });

  it('失败显示可读错误而非成功，未知异常不泄露原始内容', async () => {
    vi.mocked(verifyBackupFile).mockRejectedValueOnce(new BackupImportUserError('File exceeds allowed size'));
    await selectFile();
    await enterPassword();
    element<HTMLButtonElement>('button').click();
    await settle();
    expect(element<HTMLElement>('[aria-live="polite"]').textContent).toContain('File exceeds allowed size');
    expect(host.querySelector('.el-alert--success')).toBeNull();
    vi.mocked(verifyBackupFile).mockRejectedValueOnce(new Error('synthetic-sensitive-details'));
    element<HTMLButtonElement>('button').click();
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
    element<HTMLButtonElement>('button').click();
    visible.value = false;
    await nextTick();
    expect(oldPassword.value).toBe('');
    visible.value = true;
    await nextTick();
    pending.resolve({ kind: 'passwords', count: 99 });
    await settle();
    expect(element<HTMLInputElement>('input[type="file"]').value).toBe('');
    expect(element<HTMLInputElement>('input[type="password"]').value).toBe('');
    expect(element<HTMLButtonElement>('button').disabled).toBe(true);
    expect(host.textContent).not.toContain('99');
    expect(host.textContent).not.toContain('synthetic.aph');
  });
});
