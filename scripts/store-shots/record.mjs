/**
 * 录制 README 首屏的演示动图（中英各一套、两个场景）。
 *
 *   node record.mjs <path-to-.output/chrome-mv3> [zh|en] [login|totp]
 *
 * 输出：中文 `docs/<场景>.webp` + `docs/<场景>.gif`，英文 `docs/<场景>-en.webp`。
 * 旧的真机录屏含真实账号画面，已退役；这里全部走 `example.com` 占位演示页，不含任何真实凭据。
 *
 * - `login`：`admin` 站的一键登录（侧边栏），四帧。
 * - `totp`：`console` 站的两步验证接力（页内填充面板），六帧。
 *
 * 前置与 `capture.mjs` 相同：Chrome 带 `--remote-debugging-port=9333` 启动、
 * `demo-server.mjs` 在跑、**且已按同一语言 seed**（见同目录 README.md）。
 * 中英两套必须各用一个全新 profile 分别 seed，否则英文动图里会出现中文标签。
 *
 * 为什么是关键帧而不是逐帧录屏：页面级 CDP 截图抓不到系统指针，而侧边栏作为标签页
 * 处于后台时不产出动画帧，逐帧录屏拿不到它。这里按真实操作的**结果状态**逐帧截取，
 * 点击落点由合成阶段叠加的光标表示（坐标取自被点元素的 getBoundingClientRect）。
 *
 * `login` 的四个关键帧都是扩展自己的真实链路，脚本不代填任何字段：
 * 1. 空白登录页 + 侧边栏命中本站的 3 个账号；
 * 2. 光标悬停在条目的「填充并登录」图标上；
 * 3. 点击之后：扩展填好账号密码、自动勾选协议、自动点击登录，页面进入「Signing in...」；
 * 4. 站点受理完成，页面显示「Signed in」。
 * 第 3、4 帧是整幅页面而不是「网页 + 侧边栏」双栏——**填充成功后产品会自己收起侧边栏**
 * （FormDetector 在填充成功 300ms 后发 HIDE_SIDEPANEL），双栏构图到那里就散了。
 *
 * `totp` 走 GitHub 式两阶段登录的接力链路，同样没有一个字段是脚本填的：
 * 1. 登录页聚焦账号框，唤起**页内填充面板**（`OPEN_INLINE_DROPDOWN`，与 Cmd/Ctrl+Shift+K 同一条路）；
 * 2. 方向键 + 回车选中条目（面板的键盘通路）→ 账号密码进了输入框；
 * 3. 点页面上的 Sign in → 「Signing in...」；
 * 4. **同一标签页**跳到纯验证码页，扩展自动把活码胶囊锚定到输入框右内缘；
 * 5. 点胶囊的「填入」→ 动态码落进输入框，胶囊收起；
 * 6. 点 Verify，站点回执「Verified」。
 *
 * > 这里刻意用页内面板而不是侧边栏：接力标记 `SET_PENDING_TOTP` 走
 * > `isTrustedInternalSender`，该门控要求 `sender.tab === undefined`。真侧边栏满足
 * > （它不是标签页），而截图流水线只能把 `sidepanel.html` 开成标签页，消息会被判为
 * > 「未授权的请求来源」（同一门控也拒掉了流水线里的 `GET_INITIAL_DATA`，侧边栏数据
 * > 因此来自兜底路径）。页内面板走 `FILL_BY_ID`，由内容脚本发起、不经该门控，
 * > 同样会记录接力标记——不需要为了拍图伪造任何扩展状态。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAND,
  BODY,
  LEFT_W,
  PANEL_W,
  W,
  attachTo,
  closeStaleDemoTabs,
  closeTab,
  compose,
  evalIn,
  extUrl,
  grab,
  initExtension,
  metrics,
  newTab,
  openPanelScopedTo,
  wait,
  warmFavicons,
} from './shot.mjs';
import { COPY } from './copy.mjs';
import { DEMO_HOSTS, HOST_ADMIN, HOST_CONSOLE, pageUrl } from './demo-hosts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(HERE, '../../docs');

const EXT_DIR = process.argv[2];
const LANG = process.argv[3] || 'zh';
const SCENE = process.argv[4] || 'login';

/**
 * 场景表：入口站点、演示条目、关键帧停留时长（秒）与输出文件名主干。
 *
 * 两个场景都从 `demo-login.html?demo=status` 起步——`?demo=status` 才会渲染状态条，
 * 商店截图用的默认形态没有它（多了这个元素会把卡片撑高、弹窗位移）。
 */
const SCENES = {
  login: {
    copy: 'login',
    host: HOST_ADMIN,
    user: 'demo-admin@example.com',
    holds: { idle: 1.4, hover: 1.2, pending: 2, done: 2.4 },
    out: 'demo-login',
  },
  totp: {
    copy: 'handoff',
    host: HOST_CONSOLE,
    user: 'ops@example.com',
    holds: { panel: 1.5, filled: 1.4, submit: 1.3, handoff: 2.2, code: 1.6, verified: 2.1 },
    out: 'demo-totp',
  },
};

if (!EXT_DIR || !['zh', 'en'].includes(LANG) || !SCENES[SCENE]) {
  console.error('usage: node record.mjs <path-to-.output/chrome-mv3> [zh|en] [login|totp]');
  process.exit(1);
}

/** 输出尺寸：webp 给 README 首屏，gif 给引用 `.gif` 路径的推广文档。 */
const WEBP_SIZE = '1152:720';
const GIF_SIZE = '900:-2';
/** 「填充并登录」图标（每条都渲染，除非偏好里开了「自动触发登录」）。 */
const FILL_AND_LOGIN = '.auto-login-icon';

const S = SCENES[SCENE];
const C = COPY[LANG][S.copy];
const suffix = LANG === 'en' ? '-en' : '';
const HOLDS = S.holds;

/** 演示站点：条目按精确域名匹配，面板只会列出该站点的账号。 */
const DEMO_URL = `${pageUrl(S.host, 'demo-login.html')}?demo=status`;
/** 验证码页：接力标记按 tabId + hostname 比对，必须与登录页同域名、同标签页。 */
const CODE_URL = `${pageUrl(S.host, 'demo-2fa.html')}?demo=status`;

/**
 * 定位本站条目上的动作图标，回传矩形中心；`doClick` 为真时才真正点击。
 *
 * 悬停帧与点击帧共用同一份查找逻辑，保证光标画在实际被点的元素上。
 */
const entryAction = (sel, doClick) => `(() => {
  const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const items = [...document.querySelectorAll('.password-item')].filter(isVisible);
  const item = items.find((n) => (n.textContent || '').includes(${JSON.stringify(S.user)}));
  if (!item) {
    return JSON.stringify({ error: 'entry not found: ${S.user} (visible ' + items.length + ' items)' });
  }
  const target = item.querySelector(${JSON.stringify(sel)});
  if (!target) return JSON.stringify({ error: 'action not found: ' + ${JSON.stringify(sel)} });
  const r = target.getBoundingClientRect();
  ${doClick ? 'target.click();' : ''}
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})()`;

/** 两张演示页的提交按钮都在 `.card` 里（登录页 Sign in / 验证码页 Verify）。 */
const SUBMIT_BUTTON_RECT = `(() => {
  const b = document.querySelector('.card button[type=submit]');
  if (!b) return '';
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})()`;

/**
 * 回读演示页状态，用于断言「是扩展填的、不是脚本填的」。
 *
 * 密码只回传长度：占位数据虽非真实凭据，但按项目基线，密码明文不进日志。
 */
const PAGE_STATE = `JSON.stringify({
  email: document.getElementById('email').value,
  passwordChars: document.getElementById('password').value.length,
  remember: document.getElementById('remember').checked,
  status: document.getElementById('status').hidden ? '' : document.getElementById('status').textContent,
})`;

/** 验证码页状态（动态码是 30 秒即失效的一次性值，可以进日志）。 */
const CODE_STATE = `JSON.stringify({
  code: document.getElementById('code').value,
  status: document.getElementById('status').hidden ? '' : document.getElementById('status').textContent,
})`;

/**
 * 轮询一段求值表达式，直到断言成立或超时。
 *
 * 不能只靠固定延时：从点击到「受理中」取决于扩展的填充节奏（约 0.4s），
 * 而 CDP 往返抖动可达数百毫秒，取早了会拍到还没填充的表单。
 */
async function pollState(s, expr, pred, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = JSON.parse(await evalIn(s, expr));
    if (pred(last)) return last;
    await wait(150);
  }
  throw new Error(`${label}未出现（最后状态「${last?.status || '空'}」），检查填充是否成功、?demo=status 是否生效`);
}

const waitForStatus = async (s, pred, timeoutMs) =>
  (await pollState(s, PAGE_STATE, st => pred(st.status), '登录状态', timeoutMs)).status;
const waitForCodeStatus = async (s, pred, timeoutMs) =>
  (await pollState(s, CODE_STATE, st => pred(st.status), '验证状态', timeoutMs)).status;

/**
 * 命中接力胶囊的「填入」按钮中心（视口坐标）。
 *
 * 胶囊在 **closed** Shadow DOM 里，页面 JS 取不到内部节点，只能靠命中测试反推：
 * `elementFromPoint` 会把影子树内的点重定向到宿主 `aph-totp-handoff-root`，
 * 沿验证码字段中线从右往左扫，第一个命中点就是胶囊右缘 R。
 * 之后按固定版式算按钮中心：右边框 1px + 右内边距 5px → 关闭按钮 15px → gap 5px
 * → 填入按钮 16px，故中心在 R-34。
 */
const CAPSULE_FILL_POINT = `(() => {
  const field = document.getElementById('code');
  if (!field) return JSON.stringify({ error: 'code field not found' });
  const fr = field.getBoundingClientRect();
  const y = Math.round(fr.top + fr.height / 2);
  for (let x = Math.round(fr.right); x > Math.round(fr.left) - 320; x--) {
    const el = document.elementFromPoint(x, y);
    if (el && el.localName === 'aph-totp-handoff-root') {
      return JSON.stringify({ x: x - 34, y, right: x });
    }
  }
  return JSON.stringify({ error: 'capsule not hittable around code field (y=' + y + ')' });
})()`;

/**
 * 判断页内填充面板是否真的展开（返回命中点数，0 表示没展开）。
 *
 * 不能查 `aph-inline-fill-root` 是否存在：触发图标和面板共用同一个 closed shadow 宿主，
 * 只要页面有账号输入框宿主就在了。改为只扫输入框**下方**区域——触发图标落在字段中线
 * （`positionTrigger` 取 `rect.top + (rect.height - 22) / 2`），扫不到它，命中点只可能
 * 来自面板（`positionPanel` 锚在 `rect.bottom + PANEL_GAP`，宽 300~380）。
 */
const INLINE_PANEL_PROBE = `(() => {
  const f = document.getElementById('email').getBoundingClientRect();
  let hits = 0;
  for (let x = Math.round(f.left); x < Math.round(f.right) + 320; x += 6) {
    for (let y = Math.round(f.bottom) + 2; y < Math.round(f.bottom) + 320; y += 6) {
      const el = document.elementFromPoint(x, y);
      if (el && el.localName === 'aph-inline-fill-root') hits++;
    }
  }
  return hits;
})()`;

/** 真实派发一次鼠标点击（页面级 CDP 抓不到系统指针，但事件是真的）。 */
async function realClick(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** 真实派发一次按键（页内面板的选中项靠方向键 + 回车，不做盲点坐标）。 */
async function realKey(s, key, code, text = '') {
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, text });
}

/**
 * 把指针挪到页面左上角的空白处。
 *
 * 指针位置不受脚本控制，不主动避开的话每次重录出来的帧内容都不一样：侧边栏收起后
 * 网页变宽，页内悬浮按钮正好落到系统指针下面并弹出提示气泡。
 */
async function parkCursor(s) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
}

/** 侧边栏矩形（380 宽视口坐标）→ 双栏合成画布逻辑坐标。 */
const panelPoint = r => ({ x: LEFT_W + r.x, y: BAND + r.y });
/** 网页矩形（视口坐标）→ 合成画布逻辑坐标（标题带之下，故纵坐标加 BAND）。 */
const pagePoint = r => ({ x: r.x, y: BAND + r.y });

await initExtension(EXT_DIR);
await closeStaleDemoTabs();
// 侧边栏条目的网站图标来自浏览器本地缓存，没预热过的域名只会是通用地球图标。
await warmFavicons(DEMO_HOSTS);

const frameDir = resolve(tmpdir(), `aph-store-frames-${SCENE}-${LANG}`);
mkdirSync(frameDir, { recursive: true });
const frames = [];

/** 抓一帧并合成 2560×1600 帧图；`panes` 缺省为整幅网页。 */
async function captureFrame(s, name, cursor, panes) {
  const file = join(frameDir, `frame-${String(frames.length + 1).padStart(2, '0')}.png`);
  await compose(C, panes ?? [{ buf: await grab(s), width: W }], file, { cursor, quiet: true });
  frames.push({ file, hold: HOLDS[name] });
  console.log(`frame ${frames.length}: ${name} (${HOLDS[name]}s)`);
}

/** 打开演示页并固定设备指标。 */
async function openDemoPage(url, width) {
  const tab = await newTab(url);
  await wait(2000);
  const { s } = await attachTo(x => x.id === tab.id);
  await metrics(s, width, BODY);
  return { tab, s };
}

/**
 * 唤起页内填充面板。
 *
 * 内容脚本只收扩展页的 `tabs.sendMessage`，所以借管理页当发起方（与 `capture.mjs`
 * 的 screen-9 同一套）。注入是异步的，页面刚打开时偶发 "Receiving end does not exist"，
 * 因此重试到拿到响应为止；同 URL 的历史标签也要从后往前逐个试。
 */
async function openInlineDropdown(pageUrlWanted) {
  const ext = await newTab(extUrl('options.html'));
  await wait(2500);
  const { s: es } = await attachTo(t => t.id === ext.id);
  let last = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    last = await evalIn(
      es,
      `(async () => {
        const targets = await chrome.tabs.query({ url: ${JSON.stringify(pageUrlWanted)} });
        if (!targets.length) return 'demo tab not found';
        for (const t of [...targets].reverse()) {
          try {
            return 'ok ' + JSON.stringify(await chrome.tabs.sendMessage(t.id, { type: 'OPEN_INLINE_DROPDOWN', data: {} }));
          } catch (e) {
            var lastError = e.message;
          }
        }
        return 'failed: ' + lastError;
      })()`,
    );
    if (!String(last).includes('failed') && !String(last).includes('not found')) break;
    await wait(1500);
  }
  es.close();
  await closeTab(ext.id);
  if (String(last).includes('failed')) throw new Error(`唤起页内填充面板失败: ${last}`);
  await wait(1200);
}

/**
 * 等扩展把活码胶囊锚到验证码输入框旁，回传「填入」按钮中心。
 *
 * 胶囊是内容脚本检测完表单后自行挂上的，挂上还要等动态码取回才淡入，
 * 所以这里连宿主存在与否都要等，不能只查一次。
 */
async function waitForCapsule(s, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const hit = JSON.parse(await evalIn(s, CAPSULE_FILL_POINT));
    if (!hit.error) return hit;
    last = hit.error;
    await wait(250);
  }
  throw new Error(`接力胶囊没出现（${last}）：确认条目配了两步验证、验证码页与登录页同域名同标签页`);
}

/**
 * 点胶囊的「填入」，直到动态码真的进了输入框。
 *
 * 三个候选落点全部落在 16px 宽的按钮内：偏离按钮中心只会滑到左边的活码区（点了是复制，
 * 可重试），绝不往右滑进关闭按钮——关掉后本次页面生命周期内不再提示，这一条素材就废了。
 */
async function clickCapsuleFill(s) {
  const spot = await waitForCapsule(s, 8000);
  await captureFrame(s, 'handoff', pagePoint(spot));
  for (const dx of [-34, -38, -30]) {
    const x = spot.right + dx;
    await realClick(s, x, spot.y);
    const filled = await pollState(s, CODE_STATE, st => /^\d{6}$/.test(st.code), '动态码回填', 2500).catch(() => null);
    if (filled) return { x, y: spot.y };
    console.warn(`落点 R${dx} 未命中填入按钮，重试`);
  }
  throw new Error('胶囊「填入」三次落点都没回填动态码，检查版式常量是否与样式一致');
}

// ==================== 场景 A：侧边栏一键登录 ====================

/** 双栏起批：登录页 + 命中本站的侧边栏列表。 */
async function runLoginScene() {
  const { tab, s: page } = await openDemoPage(DEMO_URL, LEFT_W);
  const { s: panel, panelId } = await openPanelScopedTo(tab.id);
  await metrics(panel, PANEL_W, BODY);

  const entryCount = await evalIn(panel, `document.querySelectorAll('.password-item').length`);
  if (!entryCount) {
    throw new Error(
      '侧边栏没有条目：请先用同一语言跑 seed.mjs，' +
        '且确认扩展会话未失效（失效时侧边栏显示「去验证主密码」而不是列表）',
    );
  }
  console.log(`侧边栏条目数: ${entryCount}（界面语言 ${LANG}）`);

  // ---- 帧 1 / 2：空白表单 + 侧边栏列表，光标落到「填充并登录」图标上 ----
  const twoPane = async () => [
    { buf: await grab(page), width: LEFT_W },
    { buf: await grab(panel), width: PANEL_W },
  ];
  await captureFrame(page, 'idle', undefined, await twoPane());
  const hover = JSON.parse(await evalIn(panel, entryAction(FILL_AND_LOGIN, false)));
  if (hover.error) throw new Error(hover.error);
  await captureFrame(page, 'hover', panelPoint(hover), await twoPane());

  // ---- 点击：填充 → 自动勾选协议 → 自动点击登录（全部由扩展完成）----
  const clicked = JSON.parse(await evalIn(panel, entryAction(FILL_AND_LOGIN, true)));
  if (clicked.error) throw new Error(clicked.error);
  // 填充成功后产品会自己收起侧边栏，这里等它收完再改回整幅构图
  const pending = await waitForStatus(page, s => s.startsWith('Signing'), 8000);
  console.log('page after click:', pending, '| state:', await evalIn(page, PAGE_STATE));
  await closeTab(panelId);
  panel.close();
  await metrics(page, W, BODY);
  await parkCursor(page);

  const button = await evalIn(page, SUBMIT_BUTTON_RECT);
  const cursorOnLogin = button ? { ...pagePoint(JSON.parse(button)), pressed: true } : undefined;
  await captureFrame(page, 'pending', cursorOnLogin);

  // ---- 帧 4：站点受理完成 ----
  const done = await waitForStatus(page, s => s.startsWith('Signed'), 8000);
  console.log('page after submit:', done);
  await parkCursor(page);
  await captureFrame(page, 'done', cursorOnLogin);

  page.close();
  await closeTab(tab.id);
}

// ==================== 场景 B：两步验证接力 ====================

/**
 * 页内面板填充 → 提交 → 同标签页跳验证码页 → 胶囊接力 → 填入 → 验证。
 *
 * 六帧全部整幅构图：面板是注入在页面里的，收起后又回到一张干净的登录页。
 */
async function runTotpScene() {
  const { tab, s: page } = await openDemoPage(DEMO_URL, W);

  // ---- 帧 1：聚焦账号框唤起页内面板（有匹配账号才会展开，无账号时只有一个触发图标）----
  const field = JSON.parse(
    await evalIn(page, `JSON.stringify(document.getElementById('email').getBoundingClientRect())`),
  );
  await realClick(page, Math.round(field.x + field.width / 2), Math.round(field.y + field.height / 2));
  await openInlineDropdown(tab.url);
  const hits = await evalIn(page, INLINE_PANEL_PROBE);
  if (!hits) {
    throw new Error('页内填充面板没展开（账号框下方没有任何命中点）：确认本站有匹配条目、fillMode 为 inline');
  }
  console.log(`页内面板命中点: ${hits}`);
  await captureFrame(page, 'panel');

  // ---- 帧 2：方向键 + 回车选中条目，账号密码由扩展填进输入框 ----
  await realKey(page, 'ArrowDown', 'ArrowDown');
  await wait(400);
  await realKey(page, 'Enter', 'Enter', '\r');
  const filledState = await pollState(
    page,
    PAGE_STATE,
    st => st.email === S.user && st.passwordChars > 0,
    `页内面板填充（${S.user}）`,
    6000,
  );
  console.log('page after panel fill:', filledState);
  await parkCursor(page);
  await captureFrame(page, 'filled');

  // ---- 帧 3：用户点登录，页面进入受理中 ----
  const signIn = JSON.parse(await evalIn(page, SUBMIT_BUTTON_RECT));
  await realClick(page, Math.round(signIn.x), Math.round(signIn.y));
  const pending = await waitForStatus(page, s => s.startsWith('Signing'), 8000);
  console.log('page after submit:', pending);
  await captureFrame(page, 'submit', { ...pagePoint(signIn), pressed: true });

  // ---- 帧 4：同一标签页跳到纯验证码页，扩展自动锚定活码胶囊 ----
  // 必须复用同一个 tab：pending 标记按 tabId + hostname 精确比对，新开标签不命中。
  await page.send('Page.navigate', { url: CODE_URL });
  await wait(1500);
  await metrics(page, W, BODY);
  // 胶囊靠 CSS 过渡淡入，标签页在后台时过渡不推进，会把 opacity 停在 0 的样子拍下来。
  await page.send('Target.activateTarget', { targetId: tab.id }).catch(() => {});
  await wait(800);
  await parkCursor(page);

  // ---- 帧 5：点胶囊的「填入」，动态码进输入框 ----
  const fillPoint = await clickCapsuleFill(page);
  console.log('capsule fill clicked at:', fillPoint);
  const verify = JSON.parse(await evalIn(page, SUBMIT_BUTTON_RECT));
  await captureFrame(page, 'code', pagePoint(verify));

  // ---- 帧 6：站点受理验证码 ----
  await realClick(page, Math.round(verify.x), Math.round(verify.y));
  const verified = await waitForCodeStatus(page, s => s.startsWith('Verified'), 8000);
  console.log('page after verify:', verified);
  await captureFrame(page, 'verified', { ...pagePoint(verify), pressed: true });

  page.close();
  await closeTab(tab.id);
}

if (SCENE === 'login') await runLoginScene();
else await runTotpScene();

// ---- 编码为动画 webp（README 首屏）与 gif（推广文档引用 .gif 路径）----
const list = join(frameDir, 'frames.txt');
writeFileSync(
  list,
  frames.map(f => `file '${f.file}'\nduration ${f.hold}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`,
);

const targets = [{ out: join(DOCS_DIR, `${S.out}${suffix}.webp`), size: WEBP_SIZE, kind: 'webp' }];
if (LANG === 'zh') targets.push({ out: join(DOCS_DIR, `${S.out}.gif`), size: GIF_SIZE, kind: 'gif' });

for (const t of targets) {
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
  const vf = `scale=${t.size}:flags=lanczos`;
  const args =
    t.kind === 'webp'
      ? [
          ...common,
          '-vf',
          vf,
          '-fps_mode',
          'passthrough',
          '-c:v',
          'libwebp',
          '-preset',
          'picture',
          '-quality',
          '72',
          '-loop',
          '0',
          t.out,
        ]
      : [
          ...common,
          '-filter_complex',
          `[0:v]${vf},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4[o]`,
          '-map',
          '[o]',
          '-fps_mode',
          'passthrough',
          '-loop',
          '0',
          t.out,
        ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`ffmpeg ${t.kind} 编码失败:\n${r.stderr}`);
    console.error(`关键帧与清单在 ${frameDir}，可原样重跑：\n  ffmpeg ${args.join(' ')}`);
    process.exit(1);
  }
  console.log(`wrote ${t.out} (${(statSync(t.out).size / 1024).toFixed(0)} KB)`);
}
