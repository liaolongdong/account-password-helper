import type { PingResponse } from '@/utils/types';

export interface ContentScriptProbeResult {
  response: PingResponse | null;
  responsiveFrameIds: number[];
}

type ProbeFrames = (tabId: number, frameIds: number[]) => Promise<ContentScriptProbeResult>;

interface ContentScriptReadinessResult {
  response: PingResponse | null;
  injectionError?: unknown;
}

/**
 * 检查并按给定安全 frame 集合注入 content script，随后用有界短退避确认消息监听器就绪。
 */
export async function ensureContentScriptReady(
  tabId: number,
  frameIds: number[],
  probeFrames: ProbeFrames,
): Promise<ContentScriptReadinessResult> {
  const existing = await probeFrames(tabId, frameIds);
  const responsiveFrameIds = new Set(existing.responsiveFrameIds);
  const missingFrameIds = frameIds.filter(frameId => !responsiveFrameIds.has(frameId));
  if (existing.response && missingFrameIds.length === 0) return { response: existing.response };

  // frame 可能在探测后、注入前因页面导航消失。逐 frame 并行注入可让仍有效的
  // 顶层/同主域 frame 继续就绪，避免一个失效 iframe 使整批 executeScript 拒绝。
  const injectionResults = await Promise.allSettled(
    missingFrameIds.map(frameId =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content-scripts/content.js'],
      }),
    ),
  );
  const expectedResponsiveFrameIds = new Set(existing.responsiveFrameIds);
  injectionResults.forEach((result, index) => {
    if (result.status === 'fulfilled') expectedResponsiveFrameIds.add(missingFrameIds[index]);
  });
  if (injectionResults.every(result => result.status === 'rejected')) {
    const firstFailure = injectionResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    return { response: existing.response, injectionError: firstFailure?.reason };
  }

  const retryDelays = [0, 50, 100, 150, 250];
  let lastResponse = existing.response;
  for (const delay of retryDelays) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const probe = await probeFrames(tabId, frameIds);
    if (probe.response) lastResponse = probe.response;
    const responsive = new Set(probe.responsiveFrameIds);
    if (probe.response && [...expectedResponsiveFrameIds].every(frameId => responsive.has(frameId))) {
      return { response: probe.response };
    }
  }
  return { response: lastResponse };
}
