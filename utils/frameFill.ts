/**
 * 跨 frame 填充共享工具
 *
 * 供 sidepanel（useSidepanelFill）与 background（quickFillHandler）复用：
 * - getFillableFrameIds：获取可安全填充的 frame 集合（含 about: 帧父链回溯判定）
 * - fillPasswordInFrames：逐 frame 并行下发 FILL_PASSWORD 取首个成功响应
 *
 * @module utils/frameFill
 */
import type { FillResult } from '@/utils/types';
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
  if (frame.frameId === 0) return true; // 顶层 frame 恒可填充
  const url = frame.url || '';
  if (url.startsWith('about:')) {
    const parent = framesById.get(frame.parentFrameId);
    // 无父帧信息或自引用：保守拒绝，避免误填
    if (!parent || parent.frameId === frame.frameId) return false;
    return isFillableFrame(parent, framesById, topUrl);
  }
  return isSameMainDomain(url, topUrl);
};

/**
 * 获取可安全填充的 frame ID 列表：仅顶层 frame 及与顶层同主域名的 frame。
 *
 * 安全加固：避免将凭证广播给页面内嵌的跨域第三方 iframe（如广告/统计）导致泄露。
 * 检测（PING）与填充（FILL）复用同一集合，保证"检测到即可填充"的一致性。
 *
 * about: 系列（about:blank / about:srcdoc）继承其父帧来源：沿父链回溯至首个非 about:
 * 祖先再判定，仅当该祖先为顶层或同主域名帧时才纳入——避免跨域 iframe 派生的 about: 子帧
 * （与该跨域帧同源）截获明文凭证。与自动保存路径的 isSameMainDomain 校验保持一致。
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
 * 判定指定 frame 是否可安全接收明文凭证（顶层或与顶层同主域名，about: 帧沿父链回溯）。
 *
 * 与 getFillableFrameIds 复用同一判定（isFillableFrame），供后台内联下拉/一键填充路径
 * （FILL_BY_ID / GET_MATCHING_ACCOUNTS）校验发起 frame，避免跨域 iframe（如第三方广告位）
 * 越权读取顶层站点账号元数据或骗取其明文凭证（与侧边栏 getFillableFrameIds 同一道防线）。
 *
 * @param tabId 标签页 ID
 * @param frameId 发起请求的 frame ID（undefined 或 0 视为顶层 frame，直接放行）
 * @returns 是否允许；获取 frame 信息失败时保守返回 false
 */
export const isFrameFillable = async (tabId: number, frameId: number | undefined): Promise<boolean> => {
  // 顶层 frame 无需查询，直接放行（热路径零开销，与 getFillableFrameIds 对顶层的处理一致）
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
 * 向所有 frame 发送填充消息，返回第一个成功的响应
 * 各 frame 的 FormDetector 收到消息后自行判断是否有匹配字段并尝试填充
 *
 * @param tabId 标签页ID
 * @param frameIds 所有 frame ID 列表
 * @param fillData 填充数据（用户名、密码、autoLogin）
 * @returns FillResult 或 null
 */
export const fillPasswordInFrames = async (
  tabId: number,
  frameIds: number[],
  fillData: { username: string; password: string; autoLogin: boolean },
): Promise<FillResult | null> => {
  // 并行向所有 frame 发送填充消息，避免顶层 frame 的慢响应（~9s 重试）阻塞 iframe 的快速填充（~0.2s）
  const results = await Promise.allSettled(
    frameIds.map(frameId =>
      chrome.tabs.sendMessage(
        tabId,
        {
          type: MessageType.FILL_PASSWORD,
          data: fillData,
        },
        { frameId },
      ),
    ),
  );

  // 取第一个成功的响应
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const response = result.value as FillResult | undefined;
      if (response?.success) {
        return response;
      }
    }
  }

  return null;
};
