/** @vitest-environment jsdom */
/**
 * 保存成功后的浮层提示必须说清「这次到底改了什么」
 *
 * 缺陷本体：`handleSave` 只看 `response.success` 就报「账号密码已保存」
 * （`entrypoints/content/LoginAutoSave.ts:982-984`），而存储层有三种 `success: true`
 * ——新存一条、更新已有、以及「该账号已存有密码，本次未改动」
 * （`utils/storage/autoSaveManager.ts:352-354`）。第三种一条字节都没写，浮层却说存好了；
 * 同一时刻后台的 OS 通知正文里老实写着「本次未改动」，同一次操作的两个呈现面互相矛盾。
 * 用户据此以为验证码登录已入库，下次仍然填不出东西。
 *
 * 判据：浮层直接用后台回执里的结局文案；回执没带文案才退回通用的「已保存」。
 * 失败分支必须照旧走 `cs.notify.saveFailedMsg`，不许被这次收口顺手咽掉。
 *
 * 白盒调用私有 `handleSave`（同 `loginAutoSave.tagPrefill.test.ts` 的取舍）：
 * 要看的是「保存这条路径最终给用户看了什么字」，而不是弹窗自身怎么渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCredentials } from '@/entrypoints/content/types';

vi.mock('@/entrypoints/content/NativeNotification', () => ({
  showNativeNotification: vi.fn(),
}));

vi.mock('@/entrypoints/content/SavePasswordPrompt', () => ({
  showSavePasswordPrompt: vi.fn(() => ({ updateUsername: vi.fn(), updatePassword: vi.fn() })),
  dismissSavePasswordPrompt: vi.fn(),
}));

import { showNativeNotification } from '@/entrypoints/content/NativeNotification';
import { LoginAutoSave } from '@/entrypoints/content/LoginAutoSave';
import { MessageType } from '@/utils/types';

/** 「空口令不许覆盖已有真口令」分支的结局文案（存储层已本地化，内容侧原样呈现） */
const KEPT = '该账号已存有密码，本次未改动';

/** `handleSave` 的白盒视图 */
interface SaveInternals {
  handleSave(pending: PendingCredentials): Promise<void>;
}

const pending = (overrides: Partial<PendingCredentials> = {}): PendingCredentials => ({
  username: '13800000000',
  password: '',
  mobileLogin: true,
  url: 'https://passport.example.com',
  tag: '',
  remark: '自动保存',
  tagEdited: false,
  remarkEdited: false,
  timestamp: Date.now(),
  ...overrides,
});

/** 装好扩展上下文，并把 AUTO_SAVE_PASSWORD 的回执钉成给定形状 */
const stubResponse = (response: unknown) => {
  Object.defineProperty(chrome.runtime, 'id', { value: 'aph-test-extension', configurable: true });
  return vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(response as never);
};

const chipCalls = () => vi.mocked(showNativeNotification).mock.calls;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('保存成功后的浮层提示', () => {
  it('回执带结局文案时，浮层说的是这个结局，不是笼统的「已保存」', async () => {
    stubResponse({ success: true, message: KEPT });
    await new (LoginAutoSave as unknown as new () => SaveInternals)().handleSave(pending());

    expect(chipCalls(), '保存成功却没有弹出任何提示').toHaveLength(1);
    const [text, kind] = chipCalls()[0];
    expect(text, `浮层把「${KEPT}」说成了「${text}」`).toBe(KEPT);
    expect(kind).toBe('success');
  });

  it('回执没带文案才退回通用的「已保存」', async () => {
    stubResponse({ success: true });
    await new (LoginAutoSave as unknown as new () => SaveInternals)().handleSave(pending());

    expect(chipCalls()).toHaveLength(1);
    // 反空转：兜底文案必须是那条通用串，不能恰好等于某个结局文案
    expect(chipCalls()[0][0]).toContain('已保存');
    expect(chipCalls()[0][0]).not.toBe(KEPT);
  });

  it('失败分支照旧把后台原因并进「保存失败」提示', async () => {
    const send = stubResponse({ success: false, message: '上限已满' });
    await new (LoginAutoSave as unknown as new () => SaveInternals)().handleSave(pending());

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: MessageType.AUTO_SAVE_PASSWORD }));
    expect(chipCalls()).toHaveLength(1);
    const [text, kind] = chipCalls()[0];
    expect(kind).toBe('warning');
    expect(text).toContain('上限已满');
  });
});
