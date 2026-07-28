/**
 * 二维码识别工具（TOTP 扫码添加）
 *
 * 识别流程全程本地完成：截取标签页可见区域（`chrome.tabs.captureVisibleTab`）
 * 或读取用户上传的图片 → Canvas 取像素 → jsQR 本地解码，
 * 不发起任何网络请求，契合插件「零网络」安全定位。
 *
 * jsQR（约 40KB gzip）在实际识别时按需动态导入，不进入页面首屏 chunk。
 *
 * @module utils/qrScanner
 */
import { logger } from '@/utils/logger';

/** 切换到目标标签页后等待页面完成绘制的延迟（毫秒） */
const CAPTURE_RENDER_DELAY_MS = 400;

/** 大图判定阈值（像素）：超过该宽度的截图在原尺寸识别失败后按 50% 缩放重试 */
const LARGE_IMAGE_THRESHOLD = 2000;

/** 扫码结果状态：成功 / 无可截取的网页标签页 / 未识别到二维码 */
export type QrScanStatus = 'success' | 'no-tab' | 'not-found';

/** 扫码结果 */
export interface QrScanResult {
  /** 结果状态 */
  status: QrScanStatus;
  /** 识别出的二维码文本（仅 status 为 success 时存在） */
  text?: string;
}

/**
 * 从标签页列表中挑选用户最近浏览的网页标签页（纯函数，便于单元测试）
 *
 * 仅考虑 http/https 页面（扩展页、chrome:// 等无法承载网站二维码），
 * 排除已被休眠的标签页（激活后需重新加载，截取时机不可控），
 * 按 `lastAccessed` 降序取最近浏览的一个——典型场景下即用户刚看过的
 * 「两步验证设置页」。
 *
 * @param tabs 标签页列表
 * @returns 最近浏览的网页标签页；无候选时返回 null
 */
export function pickMostRecentWebTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | null {
  const candidates = tabs.filter(
    tab => tab.id !== undefined && !!tab.url && /^https?:\/\//i.test(tab.url) && !tab.discarded,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0];
}

/**
 * 加载图片元素（dataURL / 本地对象 URL）
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/**
 * 将图片按缩放比例绘制到 Canvas 并取出像素数据
 */
function drawToImageData(img: HTMLImageElement, scale: number): ImageData | null {
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * 从图片源中识别二维码内容（本地 jsQR 解码）
 *
 * 原始尺寸优先识别；高分屏大尺寸截图识别失败时按 50% 缩放重试
 * （二维码模块过大反而可能影响 jsQR 定位）。
 *
 * @param src 图片源（dataURL 或对象 URL）
 * @returns 二维码文本内容；未识别到时返回 null
 */
export async function decodeQrFromImage(src: string): Promise<string | null> {
  const img = await loadImage(src);
  const { default: jsQR } = await import('jsqr');

  const scales = img.width > LARGE_IMAGE_THRESHOLD ? [1, 0.5] : [1];
  for (const scale of scales) {
    const imageData = drawToImageData(img, scale);
    if (!imageData) continue;
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (code?.data) return code.data;
  }
  return null;
}

/**
 * 延迟工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 短暂切换到目标标签页截取可见区域，完成后还原原始标签页/窗口焦点
 *
 * 无论截取是否成功，都会尽力还原用户原始浏览位置，不打断当前操作。
 *
 * @param originTab 发起扫码时的当前活动标签页（密码管理页）
 * @param target 待截取的目标网页标签页
 * @returns 截屏图像的 dataURL
 */
async function captureTabWithRestore(originTab: chrome.tabs.Tab | undefined, target: chrome.tabs.Tab): Promise<string> {
  const sameWindow = originTab?.windowId === target.windowId;
  try {
    // 切换到目标标签页（跨窗口时先聚焦目标窗口），等待绘制后截取可见区域
    if (!sameWindow) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    if (!target.active && target.id !== undefined) {
      await chrome.tabs.update(target.id, { active: true });
    }
    await sleep(CAPTURE_RENDER_DELAY_MS);
    return await chrome.tabs.captureVisibleTab(target.windowId, { format: 'png' });
  } finally {
    // 无论截取是否成功都还原原始标签页/窗口，避免用户停留在被切走的页面
    try {
      if (originTab?.id !== undefined) {
        if (sameWindow) {
          await chrome.tabs.update(originTab.id, { active: true });
        } else {
          await chrome.windows.update(originTab.windowId, { focused: true });
        }
      }
    } catch (restoreError) {
      logger.warn('扫码后还原原始标签页失败:', restoreError);
    }
  }
}

/**
 * 截取用户最近浏览的网页标签页并识别其中的二维码
 *
 * 流程：定位最近浏览的网页标签页 → 短暂切换过去等待绘制 →
 * `captureVisibleTab` 截屏 → 切回原页面 → 本地解码。
 *
 * @returns 扫码结果（成功携带二维码文本）
 */
export async function scanQrFromRecentTab(): Promise<QrScanResult> {
  const [originTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const allTabs = await chrome.tabs.query({});
  const target = pickMostRecentWebTab(allTabs);
  if (!target?.id) return { status: 'no-tab' };

  const dataUrl = await captureTabWithRestore(originTab, target);
  const text = await decodeQrFromImage(dataUrl);
  return text ? { status: 'success', text } : { status: 'not-found' };
}
