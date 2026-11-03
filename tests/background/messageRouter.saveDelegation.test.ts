import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMessageRouter } from '@/entrypoints/background/messageRouter';
import { isSessionValid, SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { MessageType } from '@/utils/types';

vi.mock('@/utils/sessionManager-storage', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/sessionManager-storage')>()),
  isSessionValid: vi.fn(async () => true),
}));
vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
}));

const top = { frameId: 0, parentFrameId: -1, url: 'https://app.example.com/', documentId: 'top-doc' };
const child = { frameId: 2, parentFrameId: 0, url: 'https://login.example.com/', documentId: 'source-doc' };
const prompt = {
  username: 'fixture-user',
  password: 'fixture-secret',
  url: 'login.example.com',
  tag: 'fixture-tag',
  remark: 'fixture-private-note',
  mode: 'update',
};
const editedData = { tag: 'edited', remark: 'edited-note', tagEdited: true, remarkEdited: true };
const sender = (frame = child, tabId = 1): chrome.runtime.MessageSender => ({
  id: chrome.runtime.id,
  tab: { id: tabId, url: top.url } as chrome.tabs.Tab,
  frameId: frame.frameId,
  documentId: frame.documentId,
  url: frame.url,
});
let frames = [top, child];
let send: ReturnType<typeof vi.spyOn>;
let listener: (message: unknown, source: chrome.runtime.MessageSender, reply: (value: unknown) => void) => unknown;
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const request = () => {
  const reply = vi.fn();
  expect(listener({ type: 'DELEGATE_SAVE_PROMPT', data: prompt }, sender(), reply)).toBe(true);
  return reply;
};
const requestId = () => {
  const call = send.mock.calls.find(
    (c: unknown[]) => (c[1] as { type?: string }).type === 'SHOW_DELEGATED_SAVE_PROMPT',
  );
  expect(call).toBeDefined();
  return call![1].data.requestId as string;
};
const decide = async (id: string, source = sender(top), decision: unknown = { action: 'save', editedData }) => {
  const reply = vi.fn();
  listener({ type: 'SAVE_PROMPT_DECISION', data: { requestId: id, decision } }, source, reply);
  await flush();
  return reply;
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.mocked(isSessionValid).mockResolvedValue(true);
  frames = [top, child];
  await chrome.storage.local.set({ [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-fixture' });
  vi.spyOn(chrome.webNavigation, 'getAllFrames').mockImplementation(async () => frames as never);
  send = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((async () => ({ success: true })) as never);
  const spy = vi.spyOn(chrome.runtime.onMessage, 'addListener');
  setupMessageRouter();
  const lastCall = spy.mock.calls[spy.mock.calls.length - 1]!;
  listener = lastCall[0] as typeof listener;
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(30_001);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('保存委托可信路由', () => {
  it.each(['save', 'dismiss', 'neverAsk'])('同主域 iframe 的 %s 只回到原 runtime 请求且一次性', async action => {
    const reply = request();
    await flush();
    const id = requestId();
    expect(send).toHaveBeenCalledWith(
      1,
      { type: 'SHOW_DELEGATED_SAVE_PROMPT', data: { requestId: id, prompt } },
      { documentId: top.documentId },
    );
    expect(reply).not.toHaveBeenCalled();
    const decision = action === 'save' ? { action, editedData } : { action };
    expect(await decide(id, sender(top), decision)).toHaveBeenCalledWith({ success: true });
    expect(reply).toHaveBeenCalledExactlyOnceWith({ success: true, decision });
    expect(await decide(id)).toHaveBeenCalledWith({ success: false });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it.each(['tab', 'document', 'frame', 'extension'])('拒绝跨 %s 回执且不消耗合法请求', async kind => {
    const reply = request();
    await flush();
    const id = requestId();
    const forged = sender(top);
    if (kind === 'tab') forged.tab!.id = 2;
    if (kind === 'document') forged.documentId = 'other-doc';
    if (kind === 'frame') forged.frameId = 2;
    if (kind === 'extension') forged.id = 'other-extension';
    expect(await decide(id, forged)).toHaveBeenCalledWith({ success: false });
    expect(reply).not.toHaveBeenCalled();
    expect(await decide(id)).toHaveBeenCalledWith({ success: true });
  });

  it.each(['source', 'top', 'expired', 'locked', 'rekey'])('%s 后决定无效、待确认请求清理', async kind => {
    const reply = request();
    await flush();
    const id = requestId();
    if (kind === 'source') frames = [top, { ...child, documentId: 'navigated-source' }];
    if (kind === 'top') frames = [{ ...top, documentId: 'navigated-top' }, child];
    if (kind === 'expired') await vi.advanceTimersByTimeAsync(30_001);
    if (kind === 'locked') vi.mocked(isSessionValid).mockResolvedValue(false);
    if (kind === 'rekey') await chrome.storage.local.set({ [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'new-wrapped' });
    expect(await decide(id)).toHaveBeenCalledWith({ success: false });
    expect(reply).toHaveBeenCalledExactlyOnceWith({ success: false });
    expect(
      send.mock.calls.filter((c: unknown[]) => (c[1] as { type?: string }).type === 'SHOW_DELEGATED_SAVE_PROMPT'),
    ).toHaveLength(1);
  });

  it.each(['cross-domain', 'missing-document', 'external', 'oversized', 'url-mismatch'])(
    '拒绝 %s 请求，不投递凭据',
    async kind => {
      const source = sender();
      const data = { ...prompt };
      if (kind === 'cross-domain') frames = [top, { ...child, url: 'https://evil.test/' }];
      if (kind === 'missing-document') delete source.documentId;
      if (kind === 'external') source.id = 'other-extension';
      if (kind === 'oversized') data.remark = 'x'.repeat(100_001);
      if (kind === 'url-mismatch') data.url = 'evil.test';
      const reply = vi.fn();
      listener({ type: 'DELEGATE_SAVE_PROMPT', data }, source, reply);
      await flush();
      expect(reply).toHaveBeenCalledWith({ success: false });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('授权等待中来源或顶层导航，不把凭据投给替代文档', async () => {
    let resume!: (valid: boolean) => void;
    vi.mocked(isSessionValid).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resume = resolve;
        }),
    );
    const reply = request();
    await flush();
    frames = [
      { ...top, documentId: 'new-top' },
      { ...child, documentId: 'new-source' },
    ];
    resume(true);
    await flush();
    expect(reply).toHaveBeenCalledWith({ success: false });
    expect(
      send.mock.calls.filter((c: unknown[]) => (c[1] as { type?: string }).type === 'SHOW_DELEGATED_SAVE_PROMPT'),
    ).toHaveLength(0);
  });

  it('顶层不可达或展示抛错时原请求有失败回执', async () => {
    send.mockRejectedValue(new Error('Receiving end does not exist.'));
    const reply = request();
    await flush();
    expect(reply).toHaveBeenCalledExactlyOnceWith({ success: false });
  });

  it('未知请求（包括 SW 回收后的旧 ID）fail-closed', async () => {
    expect(await decide('lost-after-worker-restart')).toHaveBeenCalledWith({ success: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('非法编辑值不影响原决定，30 秒超时会取消顶层弹窗', async () => {
    const reply = request();
    await flush();
    const id = requestId();
    expect(
      await decide(id, sender(top), { action: 'save', editedData: { ...editedData, tagEdited: 'true' } }),
    ).toHaveBeenCalledWith({ success: false });
    expect(reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(reply).toHaveBeenCalledExactlyOnceWith({ success: false });
    expect(send).toHaveBeenCalledWith(
      1,
      { type: MessageType.CANCEL_DELEGATED_SAVE_PROMPT, data: { requestId: id } },
      { documentId: top.documentId },
    );
  });
});
