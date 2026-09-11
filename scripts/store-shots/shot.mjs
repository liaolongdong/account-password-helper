/**
 * 商店截图流水线 —— 共享工具
 *
 * 通过 Chrome DevTools Protocol 驱动一个本地 Chrome：加载解压后的扩展、
 * 注入占位演示数据、逐屏截图并合成品牌标题带。
 *
 * 之所以不用真机截图：macOS 的窗口级截屏需要「屏幕录制」权限，沙箱/CI 里拿不到，
 * 且真机截图容易把作者的真实账号带进商店素材。改用 CDP 页面级截图 + 矢量合成，
 * 结果可复现、无 PII，尺寸能精确落在 1280x800（@2x 输出 2560x1600）。
 */
import sharp from 'sharp';
import { listTargets, Session, evalIn, newTab } from './cdp.mjs';

export { listTargets, Session, evalIn, newTab };

export const W = 1280; // 画布逻辑宽（CSS px）
export const H = 800;
export const BAND = 124; // 顶部标题带高度（留足标题与副标题的行距）
export const BODY = H - BAND;
export const PANEL_W = 380; // 侧边栏在合成图里的宽度
export const LEFT_W = W - PANEL_W;

const FONT = 'PingFang SC, Helvetica Neue, Arial, sans-serif';

let EXT_ID = null;

/**
 * 通过 CDP 的 Extensions.loadUnpacked 加载扩展并返回其 ID。
 *
 * 解压扩展的 ID 由**绝对路径**派生，每台机器/每个 checkout 都可能不同，
 * 所以不能写死常量；调用方后续用 extId() 取用。
 */
export async function initExtension(extensionDir) {
  const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
  const s = await Session.attach(ver.webSocketDebuggerUrl);
  try {
    const r = await s.send('Extensions.loadUnpacked', { path: extensionDir });
    EXT_ID = r.id;
  } finally {
    s.close();
  }
  return EXT_ID;
}

export function extId() {
  if (!EXT_ID) throw new Error('call initExtension() first');
  return EXT_ID;
}

export function extUrl(page) {
  return `chrome-extension://${extId()}/${page}`;
}

export async function attachTo(pred) {
  const ts = await listTargets();
  const t = ts.find(pred);
  if (!t) throw new Error('target not found');
  return { t, s: await Session.attach(t.webSocketDebuggerUrl) };
}

/**
 * 固定设备指标输出。CDP 的 scale 参数实际会被忽略，像素尺寸统一在 compose()
 * 里归一，因此这里只负责给页面一个合适宽度的逻辑视口（宽一点可避免表格被裁切）。
 */
export async function metrics(s, width, height) {
  await s.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await new Promise(r => setTimeout(r, 900));
}

export async function grab(s) {
  const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
}

/**
 * 顶部标题带。
 *
 * 版式要点：左侧一条品牌色竖条做视觉锚点；标题与副标题拉开行距（基线相距 34px）；
 * 标题用略柔和的近白色而非纯白，避免深色带上大面积纯白字显得生硬。
 */
function band(ctx) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg width="${W * 2}" height="${BAND * 2}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0A1A38"/><stop offset="100%" stop-color="#123E77"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="56" y="40" width="5" height="44" rx="2.5" fill="#4C8DF6"/>
    <text x="80" y="68" font-family="${FONT}" font-size="33" font-weight="600" fill="#F4F8FF">${esc(ctx.title)}</text>
    <text x="80" y="102" font-family="${FONT}" font-size="18" fill="#93B4E4">${esc(ctx.sub)}</text>
  </svg>`;
}

/**
 * 合成一张商店截图：顶部标题带 + 下方并排的界面面板。
 *
 * @param {{title: string, sub: string}} ctx 标题带文案，须与商店文案同口径（无竞品品牌名、无绝对化表述）
 * @param {{buf: Buffer, width: number}[]} panes 面板，width 为 CSS px，总和须为 1280
 * @param {string} out 输出路径
 */
export async function compose(ctx, panes, out) {
  const layers = [];
  let x = 0;
  for (const p of panes) {
    let buf = p.buf;
    const meta = await sharp(buf).metadata();
    const tw = p.width * 2;
    const th = BODY * 2;
    if (meta.width !== tw || meta.height !== th) {
      buf = await sharp(buf).resize(tw, th, { fit: 'fill' }).toBuffer();
    }
    layers.push({ input: buf, left: x * 2, top: BAND * 2 });
    x += p.width;
    if (x < W) {
      layers.push({
        input: Buffer.from(
          `<svg width="4" height="${BODY * 2}" xmlns="http://www.w3.org/2000/svg"><rect width="4" height="100%" fill="#DCE3EE"/></svg>`,
        ),
        left: x * 2 - 2,
        top: BAND * 2,
      });
    }
  }
  await sharp({
    create: { width: W * 2, height: H * 2, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: Buffer.from(band(ctx)), left: 0, top: 0 }, ...layers])
    .png()
    .toFile(out);
  console.log('wrote', out);
}
