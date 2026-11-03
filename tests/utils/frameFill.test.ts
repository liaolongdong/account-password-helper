import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as frameFill from '@/utils/frameFill';
import { MessageType, type AuthorizedFillDocument } from '@/utils/types';

const data = { username: 'fixture-user', password: 'fixture-password', autoLogin: false };
const top = { frameId: 0, parentFrameId: -1, url: 'https://app.example.com', documentId: 'top-doc' };
const child = { frameId: 2, parentFrameId: 0, url: 'https://login.example.com', documentId: 'child-doc' };
let frames = [top, child];
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  frames = [top, child];
  vi.spyOn(chrome.webNavigation, 'getAllFrames').mockImplementation(async () => frames as never);
  send = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((async () => ({ success: true })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('敏感填充绑定授权文档', () => {
  it('旧 frameId 数组不能发送凭据，即使顶层仍存在', async () => {
    expect(await frameFill.fillPasswordInFrames(1, [0] as unknown as AuthorizedFillDocument[], data)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('保留同主域与 about 父链策略：跨域与循环父链被拒，缺 documentId 者按 frameId 退回', async () => {
    expect(frameFill.getFillableDocuments).toBeTypeOf('function');
    frames = [
      top,
      child,
      { frameId: 3, parentFrameId: 2, url: 'about:blank', documentId: 'about-doc' },
      { frameId: 4, parentFrameId: 0, url: 'https://evil.test', documentId: 'evil-doc' },
      { frameId: 5, parentFrameId: 4, url: 'about:srcdoc', documentId: 'evil-about' },
      { frameId: 6, parentFrameId: 0, url: child.url, documentId: '' },
      { frameId: 7, parentFrameId: 8, url: 'about:blank', documentId: 'loop-a' },
      { frameId: 8, parentFrameId: 7, url: 'about:blank', documentId: 'loop-b' },
    ];
    const targets = await frameFill.getFillableDocuments(1, top.url);
    // 6 号帧同主域但没有 documentId（旧 Chrome / Firefox）：纳入并退回 frameId 定向，
    // 4/5（跨域及其派生 about 帧）与 7/8（父链成环）必须被拒
    expect(targets.map(t => t.documentId ?? `frame-${t.frameId}`)).toEqual([
      'top-doc',
      'child-doc',
      'about-doc',
      'frame-6',
    ]);
    expect(await frameFill.fillPasswordInFrames(1, targets, data)).toEqual({ success: true });
    expect(send.mock.calls.map((c: unknown[]) => c[2])).toEqual([
      { documentId: 'top-doc' },
      { documentId: 'child-doc' },
      { documentId: 'about-doc' },
      { frameId: 6 },
    ]);
  });

  it.each(['source', 'top', 'tab'])('%s 改变后不会向复用 frameId 的新文档发送凭据', async kind => {
    expect(frameFill.getFillableDocuments).toBeTypeOf('function');
    const targets = (await frameFill.getFillableDocuments(1, top.url)).filter(t => t.frameId === 2);
    if (kind === 'source') frames = [top, { ...child, documentId: 'new-child', url: 'https://evil.test' }];
    if (kind === 'top') frames = [{ ...top, documentId: 'new-top' }, child];
    expect(await frameFill.fillPasswordInFrames(kind === 'tab' ? 2 : 1, targets, data)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('无法定位文档或顶层已导航时不回退敏感广播', async () => {
    expect(frameFill.getFillableDocuments).toBeTypeOf('function');
    expect(await frameFill.getFillableDocuments(1, 'https://old.test')).toEqual([]);
    frames = [];
    expect(await frameFill.getFillableDocuments(1)).toEqual([]);
    vi.mocked(chrome.webNavigation.getAllFrames).mockRejectedValue(new Error('unavailable'));
    expect(await frameFill.getFillableDocuments(1)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * 无 documentId 的平台形态（Firefox：`webNavigation.getAllFrames` 不提供该字段，
 * 自 Chrome 132 起才有）。退回 frameId 定向的前提是仍核顶层文档身份，
 * 且不得因缺字段而停投全部凭据路径。
 */
describe('缺 documentId 时的退回口径', () => {
  const bareTop = { frameId: 0, parentFrameId: -1, url: 'https://app.example.com' };
  const bareChild = { frameId: 2, parentFrameId: 0, url: 'https://login.example.com' };

  it('仍能授权并按 frameId 定向投递，顶层被替换时拒绝', async () => {
    frames = [bareTop, bareChild] as never;
    const targets = await frameFill.getFillableDocuments(1, bareTop.url);
    expect(targets.map(t => t.frameId)).toEqual([0, 2]);
    expect(targets[1]).toEqual({ tabId: 1, frameId: 2 });
    // 缺 documentId 时只能以「授权时记录的顶层 URL」为准：URL 变了（含跨站导航、换协议）
    // 一律整批拒绝，绝不为「拿不到文档身份」回退成广播
    expect(await frameFill.getFillableDocuments(1, 'https://elsewhere.test')).toEqual([]);

    const sender = {
      id: chrome.runtime.id,
      tab: { id: 1, url: bareTop.url },
      frameId: 2,
    } as unknown as chrome.runtime.MessageSender;
    const target = await frameFill.authorizeSenderDocument(sender);
    expect(target?.frameId).toBe(2);
    await expect(frameFill.sendToAuthorizedDocument(1, target!, { type: MessageType.PING })).resolves.toBeTruthy();
    expect(send).toHaveBeenLastCalledWith(1, { type: MessageType.PING }, { frameId: 2 });

    // 缺 documentId 时靠「授权时记录的顶层 URL」把关：顶层换了站点，整批不再授权
    frames = [{ ...bareTop, url: 'https://elsewhere.test' }, bareChild] as never;
    expect(await frameFill.getFillableDocuments(1, bareTop.url)).toEqual([]);
    // 顶层导航后 frameId 集合按规范重置，被授权的子帧不复存在
    frames = [bareTop] as never;
    await expect(frameFill.isAuthorizedDocumentCurrent(1, target!)).resolves.toBe(false);
  });
});
