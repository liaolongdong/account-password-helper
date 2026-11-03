/**
 * 跨 frame 填充共享工具
 *
 * 供 sidepanel（useSidepanelFill）与 background（quickFillHandler）复用：
 * - getFillableFrameIds：获取可安全填充的 frame 集合（含 about: 帧父链回溯判定）
 * - fillPasswordInFrames：逐 frame 并行下发 FILL_PASSWORD 取首个成功响应
 *
 * @module utils/frameFill
 */
import type { AuthorizedFillDocument, FillResult, RuntimeMessage } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { isSameMainDomain } from '@/utils/domain';

/** webNavigation frame 节点的最小形状（仅取判定所需字段） */
type FrameNode = { frameId: number; parentFrameId: number; url?: string };

/**
 * 判定单个 frame 是否可安全接收明文凭证：顶层 frame 恒可填；
 * about: 系列（about:blank / about:srcdoc）沿父链回溯至首个非 about: 祖先再判定，
 * 其余 frame 仅当与顶层同主域名时才纳入——避免跨域 iframe 及其派生的 about: 子帧截获凭证。
 *
 * @param frame 待判定 frame
 * @param framesById 以 frameId 为键的 frame 映射（用于 about: 帧父链回溯）
 * @param topUrl 顶层 frame 的 URL
 * @returns 是否可安全填充
 */
const isFillableFrame = (frame: FrameNode, framesById: Map<number, FrameNode>, topUrl: string): boolean => {
  const visited = new Set<number>();
  let current: FrameNode | undefined = frame;
  while (current && !visited.has(current.frameId)) {
    if (current.frameId === 0) return true;
    visited.add(current.frameId);
    const url = current.url || '';
    if (!url.startsWith('about:')) return isSameMainDomain(url, topUrl);
    current = framesById.get(current.parentFrameId);
  }
  return false;
};

/**
 * 获取可安全填充的 frame ID 列表：仅顶层 frame 及与顶层同主域名的 frame（about: 帧沿父链回溯）。
 *
 * 仅供「不含凭据」的探测/注入与元数据门控使用（PING、字段等待、内联下拉展开）。
 * 任何携带明文凭据的投递必须改用 getFillableDocuments + sendToAuthorizedDocument，
 * 把接收者绑到授权那一刻的具体文档实例，导航后的新文档不会继承接收资格。
 *
 * @param tabId 标签页ID
 * @returns 可填充的 frame ID 列表；获取失败时回退到 [0]（仅顶层 frame）
 */
export const getFillableFrameIds = async (tabId: number): Promise<number[]> => {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length === 0) return [0];

    const topFrame = frames.find(f => f.frameId === 0);
    const topUrl = topFrame?.url;
    if (!topUrl) return [0];

    const framesById = new Map(frames.map(f => [f.frameId, f] as const));
    const fillable = frames.filter(f => isFillableFrame(f, framesById, topUrl)).map(f => f.frameId);
    return fillable.length > 0 ? fillable : [0];
  } catch (error) {
    logger.warn('获取可填充 frame 列表失败，回退到仅顶层 frame:', error);
    return [0];
  }
};

/**
 * 判定指定 frame 是否可安全接收（不含明文的）探测与元数据。
 *
 * 语义与旧实现保持一致；明文凭据投递请改用文档绑定路径。
 */
export const isFrameFillable = async (tabId: number, frameId: number | undefined): Promise<boolean> => {
  if (frameId === undefined || frameId === 0) return true;
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length === 0) return false;

    const topFrame = frames.find(f => f.frameId === 0);
    const topUrl = topFrame?.url;
    if (!topUrl) return false;

    const framesById = new Map(frames.map(f => [f.frameId, f] as const));
    const target = framesById.get(frameId);
    if (!target) return false;

    return isFillableFrame(target, framesById, topUrl);
  } catch (error) {
    logger.warn('判定 frame 可填充性失败，保守拒绝:', error);
    return false;
  }
};

/**
 * 取得「可安全接收明文凭证」的文档快照（顶层 + 与顶层同主域名的 frame，about: 帧沿父链回溯）。
 *
 * 与旧的纯 frameId 列表相比，这里额外绑定 documentId：授权时的判定与最终发送目标是同一个
 * 文档实例，期间发生导航的新文档不会继承接收凭据的资格。
 *
 * @param tabId 标签页 ID
 * @param expectedTopUrl 授权时顶层 URL；提供时要求当前仍是同一文档，防止导航后串站
 * @returns 可填充文档；无法取得可信 documentId 时返回空数组（调用方不得回退广播）
 */
export async function getFillableDocuments(tabId: number, expectedTopUrl?: string): Promise<AuthorizedFillDocument[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const top = frames?.find(frame => frame.frameId === 0);
    if (!top?.url || (expectedTopUrl !== undefined && top.url !== expectedTopUrl)) return [];
    const byId = new Map(frames!.map(frame => [frame.frameId, frame]));
    // 有 documentId 就绑文档；没有（Firefox、Chrome < 132）退回 frameId + 顶层文档身份。
    // 刻意不因缺字段而停投：那会让整个凭据投递面在 Firefox 上失效，回归比缺口更重。
    return frames!
      .filter(frame => isFillableFrame(frame, byId, top.url))
      .map(frame => ({
        tabId,
        frameId: frame.frameId,
        ...(frame.documentId ? { documentId: frame.documentId } : {}),
        ...(top.documentId ? { topDocumentId: top.documentId } : {}),
      }));
  } catch {
    return [];
  }
}

/** 只能授权浏览器盖章的发起文档，不能把旧请求移交同 frameId 的新文档。 */
export async function authorizeSenderDocument(
  sender: chrome.runtime.MessageSender,
): Promise<AuthorizedFillDocument | null> {
  if (sender.id !== chrome.runtime.id || typeof sender.tab?.id !== 'number' || typeof sender.frameId !== 'number') {
    return null;
  }
  const targets = await getFillableDocuments(sender.tab.id, sender.tab.url);
  if (sender.documentId) {
    return targets.find(t => t.frameId === sender.frameId && t.documentId === sender.documentId) ?? null;
  }
  // 平台不提供 documentId：仍要求「同一标签页 + 授权时记录的顶层 URL 未变」下的同一 frame
  return targets.find(t => t.frameId === sender.frameId && !t.documentId) ?? null;
}

/** 只检查已授权身份仍有效，绝不把导航后的新文档重新授权为敏感接收者。 */
export async function isAuthorizedDocumentCurrent(tabId: number, target: AuthorizedFillDocument): Promise<boolean> {
  if (!target || target.tabId !== tabId || !Number.isInteger(target.frameId)) return false;
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const top = frames?.find(frame => frame.frameId === 0);
    if (!top) return false;
    if (target.topDocumentId && top.documentId !== target.topDocumentId) return false;
    const current = frames?.find(frame => frame.frameId === target.frameId);
    if (!current) return false;
    return target.documentId ? current.documentId === target.documentId : !current.documentId;
  } catch {
    return false;
  }
}

/**
 * 敏感出口：复核身份后定向投递。
 * 有 documentId 时用它（浏览器保证「检查与发送之间导航」不会串到新文档）；
 * 没有时退回 frameId，由 `isAuthorizedDocumentCurrent` 的顶层文档身份比对兜住导航。
 */
export async function sendToAuthorizedDocument(
  tabId: number,
  target: AuthorizedFillDocument,
  message: RuntimeMessage,
): Promise<unknown> {
  if (!(await isAuthorizedDocumentCurrent(tabId, target))) throw new Error('Receiving end does not exist.');
  return chrome.tabs.sendMessage(
    tabId,
    message,
    target.documentId ? { documentId: target.documentId } : { frameId: target.frameId },
  );
}

/**
 * 向授权文档发送填充消息，返回第一个成功的响应
 * 各文档的 FormDetector 收到消息后自行判断是否有匹配字段并尝试填充
 *
 * @param tabId 标签页ID
 * @param documents 授权时的文档快照
 * @param fillData 填充数据（用户名、密码、autoLogin）
 * @returns FillResult 或 null
 */
export const fillPasswordInFrames = async (
  tabId: number,
  documents: AuthorizedFillDocument[],
  fillData: { username: string; password: string; autoLogin: boolean },
): Promise<FillResult | null> => {
  // 并行投递，慢文档不阻塞其它文档；每个敏感出口均绑定授权时的文档。
  const results = await Promise.allSettled(
    documents.map(target =>
      sendToAuthorizedDocument(tabId, target, { type: MessageType.FILL_PASSWORD, data: fillData }),
    ),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const response = result.value as FillResult | undefined;
      if (response?.success) return response;
    }
  }

  return null;
};

/**
 * 向授权文档并行发送 TOTP 动态码。
 *
 * 与 `fillPasswordInFrames` 同一道防线：接收者绑定 `getFillableDocuments` 那一刻的文档实例，
 * 取码到投递之间若 frame 导航成新文档，一次性码不会交给复用同一 frameId 的新站点。
 *
 * @param tabId 标签页 ID
 * @param code 本地计算得到的动态验证码
 * @returns `result` 为首个成功送达的响应；`firstResponse` 为首个非成功但确实送达的响应（供失败分档）
 */
export const fillTotpInFrames = async (
  tabId: number,
  code: string,
): Promise<{ result: FillResult | null; firstResponse: FillResult | null }> => {
  const documents = await getFillableDocuments(tabId);
  const results = await Promise.allSettled(
    documents.map(target =>
      sendToAuthorizedDocument(tabId, target, {
        type: MessageType.FILL_TOTP,
        data: { code },
      }),
    ),
  );

  let firstResponse: FillResult | null = null;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const response = result.value as FillResult | undefined;
      if (response?.success) return { result: response, firstResponse };
      if (response && !firstResponse) firstResponse = response;
    }
  }
  return { result: null, firstResponse };
};
