/** @vitest-environment jsdom */
/**
 * issue #167 回归：保存以弹窗确认值为准，拒收文案指明字段
 *
 * 缺陷本体：保存时 `handleSave` 无条件重读 DOM，把站点提交处理器原地改写的密文/长串
 * 当成用户确认过的凭据发出去（前端 RSA/SM2 加密一类登录页每次必现），撞后台容量闸门后
 * 回「账号、密码或备注过长」——而弹窗里账号/密码只读、备注输入处已限死、标签根本不校验，
 * 用户删备注删标签永远救不回来。
 *
 * 判据：
 * - 无用户意图信号的重读（挂载同步、保存重读）只采纳容量内的值，越限保留确认值；
 * - input 事件带用户意图，照常采纳（真粘贴超长口令时如实拒收并指明字段）；
 * - 容量内的重读仍采纳，保住「弹窗期间用户补敲」的既有行为；
 * - 空串同样不是用户意图：站点提交后清空字段时回落捕获值，不得发出空凭据；
 * - 拒收文案点名越限字段与实际/上限。
 *
 * 白盒调用私有 `showPrompt` / `handleSave`（同 loginAutoSave.saveOutcome.test.ts 的取舍）：
 * 要看的是保存路径最终发出的载荷，而不是弹窗自身怎么渲染。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCredentials } from '@/entrypoints/content/types';
import { MessageType, type AutoSavePasswordData } from '@/utils/types';

const controls = { updateUsername: vi.fn(), updatePassword: vi.fn() };

vi.mock('@/entrypoints/content/NativeNotification', () => ({
  showNativeNotification: vi.fn(),
}));

vi.mock('@/entrypoints/content/SavePasswordPrompt', () => ({
  showSavePasswordPrompt: vi.fn(() => controls),
  dismissSavePasswordPrompt: vi.fn(),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  invalidatePasswordCache: vi.fn(),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    isSessionValid: vi.fn(async () => true),
    autoSavePassword: vi.fn(async () => ({ success: true, message: 'saved' })),
  },
}));

import { LoginAutoSave } from '@/entrypoints/content/LoginAutoSave';
import { handleAutoSavePassword } from '@/entrypoints/background/autoSaveHandler';
import { tl } from '@/utils/i18n-lite';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';

/** 站点提交后原地改写出的 RSA base64 密文长度（2048 位） */
const CIPHERTEXT_LENGTH = 344;

interface SaveInternals {
  lastCapturedForm: HTMLFormElement | null;
  lastCapturedPasswordField: HTMLInputElement | null;
  confirmedUsername: string | null;
  confirmedPassword: string | null;
  showPrompt(pending: PendingCredentials): void;
  handleSave(pending: PendingCredentials): Promise<void>;
  handleRuntimeMessage(message: { type: MessageType }): void;
  destroy(): void;
}

const pending = (overrides: Partial<PendingCredentials> = {}): PendingCredentials => ({
  username: 'user@example.com',
  password: 'Str0ng-Pass!23',
  mobileLogin: false,
  url: 'passport.example.com',
  tag: '',
  remark: '自动保存',
  tagEdited: false,
  remarkEdited: false,
  timestamp: Date.now(),
  ...overrides,
});

/** 本文件装过的实例：init() 会挂 document 监听与 MutationObserver，逐个用例必须销毁 */
const instances: SaveInternals[] = [];

/** 装一个登录表单，返回实例与字段引用 */
const mountLoginForm = () => {
  document.body.replaceChildren();
  const form = document.createElement('form');
  const username = document.createElement('input');
  username.type = 'text';
  username.name = 'username';
  username.value = 'user@example.com';
  const password = document.createElement('input');
  password.type = 'password';
  password.value = 'Str0ng-Pass!23';
  form.append(username, password);
  document.body.append(form);
  const instance = new (LoginAutoSave as unknown as new () => SaveInternals)();
  instances.push(instance);
  instance.lastCapturedForm = form;
  instance.lastCapturedPasswordField = password;
  return { instance, form, username, password };
};

const sentPayload = (): AutoSavePasswordData => {
  // chrome 类型把 sendMessage 的重载收成了四参形态，实际调用是一参形态，按运行时形状取
  const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls as unknown as {
    type: MessageType;
    data: AutoSavePasswordData;
  }[][];
  const saves = calls.filter(call => call[0]?.type === MessageType.AUTO_SAVE_PASSWORD);
  return saves[saves.length - 1][0].data;
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(chrome.runtime, 'id', { value: 'aph-test', configurable: true });
  vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({ success: true, message: 'saved' } as never);
});

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances.length = 0;
  vi.restoreAllMocks();
});

describe('issue #167：提交后的程序化改写不得顶替确认值', () => {
  it('口令被原地改写成密文时，保存发的仍是用户确认的明文，后台放行', async () => {
    const { instance, password } = mountLoginForm();
    instance.showPrompt(pending());
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    await instance.handleSave(pending({ tag: '', remark: '自动保存', tagEdited: true, remarkEdited: true }));

    const payload = sentPayload();
    expect(payload.password).toBe('Str0ng-Pass!23');
    const result = await handleAutoSavePassword(payload);
    expect(result.success).toBe(true);
  });

  it('账号被改写成超容量长串时，保存发的仍是确认账号', async () => {
    const { instance, username } = mountLoginForm();
    instance.showPrompt(pending());
    username.value = 'u'.repeat(PASSWORD_FIELD_LIMITS.username + 10);
    await instance.handleSave(pending());

    expect(sentPayload().username).toBe('user@example.com');
  });

  it('挂载同步同样不采纳越限改写：弹窗展示值保持捕获明文', async () => {
    const { instance, password } = mountLoginForm();
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    instance.showPrompt(pending());

    expect(controls.updatePassword).not.toHaveBeenCalledWith('M'.repeat(CIPHERTEXT_LENGTH));
    await instance.handleSave(pending());
    expect(sentPayload().password).toBe('Str0ng-Pass!23');
  });

  it('容量内的重读仍采纳：弹窗期间用户补敲（无 input 事件）不丢', async () => {
    const { instance, password } = mountLoginForm();
    instance.showPrompt(pending());
    password.value = 'Edited-789';
    await instance.handleSave(pending());

    expect(sentPayload().password).toBe('Edited-789');
  });

  it('input 事件带用户意图：弹窗期间改口令照常采纳，改写只影响确认值之后的部分', async () => {
    const { instance, password } = mountLoginForm();
    instance.showPrompt(pending());
    password.value = 'NewPass-456';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    await instance.handleSave(pending());

    expect(sentPayload().password).toBe('NewPass-456');
  });

  it('用户真粘贴超长短口令时如实拒收，文案指明密码与实际/上限', async () => {
    const { instance, password } = mountLoginForm();
    instance.showPrompt(pending());
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    password.dispatchEvent(new Event('input', { bubbles: true }));
    await instance.handleSave(pending());

    const result = await handleAutoSavePassword(sentPayload());
    expect(result.success).toBe(false);
    expect(result.message).toContain(tl('bg.autoSave.field.password'));
    expect(result.message).toContain(`${CIPHERTEXT_LENGTH}/${PASSWORD_FIELD_LIMITS.password}`);
  });

  it('更新态预填备注超容量时拒收文案点名备注，用户删得掉也看得懂', async () => {
    const { instance } = mountLoginForm();
    const longRemark = 'r'.repeat(PASSWORD_FIELD_LIMITS.remark + 1000);
    await instance.handleSave(pending({ remark: longRemark }));

    const result = await handleAutoSavePassword(sentPayload());
    expect(result.success).toBe(false);
    expect(result.message).toContain(tl('bg.autoSave.field.remark'));
    expect(result.message).toContain(`${longRemark.length}/${PASSWORD_FIELD_LIMITS.remark}`);
    expect(result.message).not.toContain(tl('bg.autoSave.field.password'));
  });
});

describe('issue #167：空值与生命周期不得吃掉确认值', () => {
  it('提交后站点清空口令框（form.reset / 密文塞隐藏域）时，保存仍发捕获明文', async () => {
    const { instance, password } = mountLoginForm();
    password.value = '';
    instance.showPrompt(pending());
    await instance.handleSave(pending());

    const payload = sentPayload();
    expect(payload.password).toBe('Str0ng-Pass!23');
    expect((await handleAutoSavePassword(payload)).success).toBe(true);
  });

  it('提交后站点清空账号框时，保存仍发捕获账号', async () => {
    const { instance, username } = mountLoginForm();
    username.value = '';
    instance.showPrompt(pending());
    await instance.handleSave(pending());

    expect(sentPayload().username).toBe('user@example.com');
  });

  it('未经本地弹窗（iframe 委托路径 confirmed* 恒 null）时回落捕获值', async () => {
    const { instance, password } = mountLoginForm();
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    await instance.handleSave(pending());

    expect(sentPayload().password).toBe('Str0ng-Pass!23');
  });

  it('新一轮弹窗不继承上一轮确认值', async () => {
    const { instance, password } = mountLoginForm();
    password.value = 'M'.repeat(CIPHERTEXT_LENGTH);
    instance.showPrompt(pending({ password: 'First-Pass1' }));
    instance.showPrompt(pending({ password: 'Second-Pass2' }));
    await instance.handleSave(pending({ password: 'Second-Pass2' }));

    expect(sentPayload().password).toBe('Second-Pass2');
  });

  it('会话过期广播清掉确认值，不在长生命周期实例上残留明文', () => {
    const { instance } = mountLoginForm();
    instance.showPrompt(pending());
    expect(instance.confirmedPassword).toBe('Str0ng-Pass!23');

    instance.handleRuntimeMessage({ type: MessageType.SESSION_EXPIRED });

    expect(instance.confirmedPassword).toBeNull();
    expect(instance.confirmedUsername).toBeNull();
  });
});
