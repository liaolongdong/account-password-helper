import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PingResponse } from '@/utils/types';
import { ensureContentScriptReady } from '@/utils/contentScriptReadiness';

const READY_RESPONSE: PingResponse = {
  success: true,
  ready: true,
  fieldsDetected: { username: 1, password: 1, mobile: 0, verifyCode: 0 },
};

const probe = (response: PingResponse | null, responsiveFrameIds: number[] = []) => ({
  response,
  responsiveFrameIds,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ensureContentScriptReady', () => {
  it('已就绪时不注入也不等待', async () => {
    const ping = vi.fn().mockResolvedValue(probe(READY_RESPONSE, [0, 3]));
    const inject = vi.spyOn(chrome.scripting, 'executeScript');

    await expect(ensureContentScriptReady(7, [0, 3], ping)).resolves.toEqual({ response: READY_RESPONSE });
    expect(inject).not.toHaveBeenCalled();
  });

  it('按安全 frameIds 注入并立即采纳就绪响应', async () => {
    const ping = vi
      .fn()
      .mockResolvedValueOnce(probe(null))
      .mockResolvedValueOnce(probe(READY_RESPONSE, [0, 3]));
    const inject = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue(undefined);

    await expect(ensureContentScriptReady(7, [0, 3], ping)).resolves.toEqual({ response: READY_RESPONSE });
    expect(inject).toHaveBeenCalledTimes(2);
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: ['content-scripts/content.js'],
    });
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] },
      files: ['content-scripts/content.js'],
    });
  });

  it('短暂未就绪时通过有界退避恢复', async () => {
    const ping = vi
      .fn()
      .mockResolvedValueOnce(probe(null))
      .mockResolvedValueOnce(probe(null))
      .mockResolvedValueOnce(probe(null))
      .mockResolvedValueOnce(probe(READY_RESPONSE, [0]));
    vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue(undefined);

    const pending = ensureContentScriptReady(7, [0], ping);
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual({ response: READY_RESPONSE });
  });

  it('重试预算耗尽时返回未就绪而不是无限等待', async () => {
    const ping = vi.fn().mockResolvedValue(probe(null));
    vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue(undefined);

    const pending = ensureContentScriptReady(7, [0], ping);
    await vi.advanceTimersByTimeAsync(550);

    await expect(pending).resolves.toEqual({ response: null });
    expect(ping).toHaveBeenCalledTimes(6);
  });

  it('受限页面注入失败时保留错误供现有提示路径处理', async () => {
    const injectionError = new Error('Cannot access a chrome:// URL');
    const ping = vi.fn().mockResolvedValue(probe(null));
    vi.spyOn(chrome.scripting, 'executeScript').mockRejectedValue(injectionError);

    await expect(ensureContentScriptReady(7, [0], ping)).resolves.toEqual({
      response: null,
      injectionError,
    });
  });

  it('一个 iframe 消失时仍允许有效 frame 完成注入与就绪握手', async () => {
    const ping = vi
      .fn()
      .mockResolvedValueOnce(probe(null))
      .mockResolvedValueOnce(probe(READY_RESPONSE, [0]));
    vi.spyOn(chrome.scripting, 'executeScript').mockImplementation(({ target }) => {
      const [frameId] = target.frameIds ?? [];
      return frameId === 3 ? Promise.reject(new Error('No frame with id 3')) : Promise.resolve([]);
    });

    await expect(ensureContentScriptReady(7, [0, 3], ping)).resolves.toEqual({ response: READY_RESPONSE });
  });

  it('顶层已就绪但同站 iframe 缺失时只注入缺失 frame', async () => {
    const ping = vi
      .fn()
      .mockResolvedValueOnce(probe(READY_RESPONSE, [0]))
      .mockResolvedValueOnce(probe(READY_RESPONSE, [0, 3]));
    const inject = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue(undefined);

    await expect(ensureContentScriptReady(7, [0, 3], ping)).resolves.toEqual({ response: READY_RESPONSE });
    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] },
      files: ['content-scripts/content.js'],
    });
  });
});
