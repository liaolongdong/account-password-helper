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

    /**
     * 判断 frame 是否可安全填充；about: 帧沿父链回溯判定，防止跨域 about: 子帧被误纳入。
     */
    const isFillable = (frame: { frameId: number; parentFrameId: number; url?: string }): boolean => {
      if (frame.frameId === 0) return true; // 顶层 frame 恒可填充
      const url = frame.url || '';
      if (url.startsWith('about:')) {
        const parent = framesById.get(frame.parentFrameId);
        // 无父帧信息或自引用：保守拒绝，避免误填
        if (!parent || parent.frameId === frame.frameId) return false;
        return isFillable(parent);
      }
      return isSameMainDomain(url, topUrl);
    };

    const fillable = frames.filter(f => isFillable(f)).map(f => f.frameId);
    return fillable.length > 0 ? fillable : [0];
  } catch (error) {
    logger.warn('获取可填充 frame 列表失败，回退到仅顶层 frame:', error);
    return [0];
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
