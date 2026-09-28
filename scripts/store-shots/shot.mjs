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
import { closeTab, listTargets, Session, evalIn, newTab } from './cdp.mjs';

export { closeTab, listTargets, Session, evalIn, newTab };

export const W = 1280; // 画布逻辑宽（CSS px）
export const H = 800;
export const BAND = 78; // 顶部标题带高度（文字块按墨迹框上下等距，见 band()）
export const BODY = H - BAND;
export const PANEL_W = 380; // 侧边栏在合成图里的宽度
export const LEFT_W = W - PANEL_W;

const FONT = 'PingFang SC, Helvetica Neue, Arial, sans-serif';

/** 等待毫秒数（各脚本共用，避免为同一件事各写一份 Promise 包装）。 */
export const wait = ms => new Promise(r => setTimeout(r, ms));

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
 * 等待页面收敛到「动画结束后」的样子。
 *
 * 两道问题叠在一起：
 * 1. 侧边栏必须待在**后台标签**里才能命中演示域名（它按 `active + currentWindow`
 *    取标签，一旦置前就会把自己当目标页、退化成列出全部条目），而后台标签不跑
 *    `requestAnimationFrame`；
 * 2. Vue 的过渡在 nextFrame 回调里把 `*-enter-from` 换成 `*-enter-to`，回调不触发
 *    就意味着元素永远停在 `enter-from`（`opacity: 0` + `scaleX(0)`）——**看不见，
 *    却照常占位**，截图里就成了「网址前面凭空空出一块」。
 *
 * 因此先等真正在跑的动画收尾，再把残留的 enter 类摘掉，让元素回到过渡完成态。
 */
export async function settle(s, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const busy = await evalIn(
      s,
      `(document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'pending').length : 0)`,
    );
    if (!busy) break;
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 250));
  await evalIn(
    s,
    `(() => {
      let cleared = 0;
      for (const el of document.querySelectorAll('[class*="-enter-"]')) {
        for (const c of [...el.classList]) {
          if (/-enter-(from|to|active)$/.test(c)) {
            el.classList.remove(c);
            cleared++;
          }
        }
      }
      return cleared;
    })()`,
  );
  // 懒加载图片在后台标签里不会被取（SiteFavicon 的图标位置因此空白），
  // 截图前强制转成 eager 并等它们真正加载完，load/error/超时任一即放行。
  await evalIn(
    s,
    `(async () => {
      for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
      const pending = [...document.querySelectorAll('img')]
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise((res) => {
              img.addEventListener('load', res, { once: true });
              img.addEventListener('error', res, { once: true });
              setTimeout(res, 2000);
            }),
        );
      await Promise.all(pending);
      return pending.length;
    })()`,
  );
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
  await settle(s);
  const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
}

/** 读取 `/_favicon/` 端点返回的字节数（-1 表示非 200）。 */
async function faviconBytes(s, pageUrl) {
  return evalIn(
    s,
    `(async () => {
      const res = await fetch(
        chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(${JSON.stringify(pageUrl)}) + '&size=32'),
      );
      if (!res.ok) return -1;
      return (await res.arrayBuffer()).byteLength;
    })()`,
  );
}

/**
 * 预热 favicon 缓存，让每个演示域名都能命中站点自己的图标。
 *
 * Chrome 的 favicon 缓存按 `CanonicizeURL`（清掉 path/query，但**保留 scheme 与
 * port**）建索引，没访问过的域名只会拿到通用地球图标——「图标取自本地缓存」这个
 * 卖点就拍不出来。因此先逐个访问一遍演示域名（demo-server.mjs 会为每个 Host 合成
 * 不同底色的 `/favicon.png`），再按扩展页的 `/_favicon/` 返回值校验是否脱离地球基线。
 *
 * 校验只用于提示：个别域名没命中不阻断跑批（组件会降级渲染默认图标，不影响其余画面）。
 *
 * @param {string[]} hosts 需要预热的域名列表（不带协议）
 * @param {number} [timeout] 单个域名的最长等待毫秒数
 */
export async function warmFavicons(hosts, timeout = 4000) {
  const probeTab = await newTab(extUrl('options.html'));
  await new Promise(r => setTimeout(r, 2500));
  const { s: probe } = await attachTo(t => t.id === probeTab.id);
  // 从未访问过的地址 = 地球图标字节数基线
  const globe = await faviconBytes(probe, 'https://unwarmed-baseline.example/');

  const missed = [];
  for (const host of hosts) {
    const tab = await newTab(`https://${host}/`);
    const deadline = Date.now() + timeout;
    let bytes = globe;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 400));
      bytes = await faviconBytes(probe, `https://${host}`);
      if (bytes > 0 && bytes !== globe) break;
    }
    if (bytes <= 0 || bytes === globe) missed.push(host);
    await closeTab(tab.id);
  }

  await closeTab(probeTab.id);
  probe.close();
  if (missed.length) console.warn('favicon 未命中（将显示默认图标）:', missed.join(', '));
  else console.log(`favicon 预热完成: ${hosts.length} 个域名`);
}

/**
 * 打开侧边栏页面、把 active tab 切回目标页，再 reload 侧边栏，使其命中该站点账号。
 *
 * 侧边栏按 `active + currentWindow` 取目标标签，因此必须在 reload 之前把演示页置前，
 * 否则它会把自己当目标页、退化成「列出全部条目」。
 */
export async function openPanelScopedTo(tabId) {
  const panel = await newTab(extUrl('sidepanel.html'));
  await wait(1200);
  const { s: ts } = await attachTo(t => t.id === tabId);
  await ts.send('Target.activateTarget', { targetId: tabId }).catch(() => {});
  ts.close();
  await wait(500);
  const { s: ps } = await attachTo(t => t.id === panel.id);
  await ps.send('Page.reload', { ignoreCache: true });
  await wait(4000);
  return { s: ps, panelId: panel.id };
}

/**
 * 关掉上一轮跑批遗留的演示页标签。
 *
 * 每次跑批都会重新 loadUnpacked 扩展，已打开页面里的内容脚本随之失效（孤立上下文）。
 * 这些标签如果留着，按 URL 反查标签的逻辑就可能命中它们并一直报
 * "Receiving end does not exist"（实测 screen-9 连续 5 次都打在陈旧标签上）。
 */
export async function closeStaleDemoTabs() {
  const stale = (await listTargets()).filter(t => t.type === 'page' && /^https:\/\/[^/]*\.example\.com\//.test(t.url));
  for (const t of stale) await closeTab(t.id);
  if (stale.length) console.log(`已清理 ${stale.length} 个遗留演示页标签`);
}

/**
 * 顶部标题带。
 *
 * 版式要点：左侧一条品牌色竖条做视觉锚点；标题与副标题拉开行距（基线相距 34px）；
 * 标题用略柔和的近白色而非纯白，避免深色带上大面积纯白字显得生硬。
 * 垂直位置按 CJK 墨迹框（基线上约 0.86em、下约 0.12em）而非基线居中——
 * 按基线居中会让文字贴顶、深色带下方空出一大条。
 */
function band(ctx) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const TITLE_SIZE = 33;
  const SUB_SIZE = 18;
  const LEADING = 34; // 两行基线间距
  const inkAbove = TITLE_SIZE * 0.86;
  const inkBelow = LEADING + SUB_SIZE * 0.12;
  const titleY = Math.round((BAND * 2 - inkAbove - inkBelow) / 2 + inkAbove);
  const subY = titleY + LEADING;
  return `<svg width="${W * 2}" height="${BAND * 2}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0A1A38"/><stop offset="100%" stop-color="#123E77"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="56" y="${titleY - inkAbove}" width="5" height="44" rx="2.5" fill="#4C8DF6"/>
    <text x="80" y="${titleY}" font-family="${FONT}" font-size="${TITLE_SIZE}" font-weight="600" fill="#F4F8FF">${esc(ctx.title)}</text>
    <text x="80" y="${subY}" font-family="${FONT}" font-size="${SUB_SIZE}" fill="#93B4E4">${esc(ctx.sub)}</text>
  </svg>`;
}

/**
 * 光标叠加层。
 *
 * 演示动图由若干关键帧组成，而页面级截图抓不到系统指针，「点了哪里」在画面里不可见。
 * 因此合成阶段按真实元素的矩形中心画箭头与点击涟漪——坐标取自点击时的 getBoundingClientRect，
 * 即点击确实发生在这些位置。入参是 1280×800 逻辑像素，输出画布为 2 倍，故整体缩放 2。
 */
function cursorLayer(x, y, pressed) {
  const ring = pressed
    ? '<circle cx="0" cy="0" r="17" fill="#4c8df6" fill-opacity="0.16" stroke="#4c8df6" stroke-opacity="0.65" stroke-width="2.5"/>'
    : '';
  return `<svg width="${W * 2}" height="${H * 2}" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(${x * 2} ${y * 2}) scale(2)">
      ${ring}
      <path d="M0 0 L0 15.4 L3.8 11.9 L6.1 17.3 L8.7 16.2 L6.4 10.9 L11.6 10.9 Z"
        fill="#ffffff" stroke="#1f2937" stroke-width="1.1" stroke-linejoin="round" />
    </g>
  </svg>`;
}

/**
 * 合成一张商店截图：顶部标题带 + 下方并排的界面面板。
 *
 * @param {{title: string, sub: string}} ctx 标题带文案，须与商店文案同口径（无竞品品牌名、无绝对化表述）
 * @param {{buf: Buffer, width: number}[]} panes 面板，width 为 CSS px，总和须为 1280
 * @param {string} out 输出路径
 * @param {{cursor?: {x: number, y: number, pressed?: boolean}, quiet?: boolean}} [opts]
 *   `cursor` 为逻辑像素坐标的光标叠加层（演示动图用）；`quiet` 关闭逐张写入日志
 */
export async function compose(ctx, panes, out, opts = {}) {
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
  const top = [];
  if (opts.cursor) {
    const { x: cx, y: cy, pressed } = opts.cursor;
    top.push({ input: Buffer.from(cursorLayer(cx, cy, pressed)), left: 0, top: 0 });
  }
  await sharp({
    create: { width: W * 2, height: H * 2, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: Buffer.from(band(ctx)), left: 0, top: 0 }, ...layers, ...top])
    .png()
    .toFile(out);
  if (!opts.quiet) console.log('wrote', out);
}
