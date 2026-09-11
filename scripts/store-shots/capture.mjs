/**
 * 截取并合成商店截图（中英各一套）。
 *
 *   node capture.mjs <extDir> seeded  [zh|en]   # 一键登录 / TOTP / 多环境 / 安全体检
 *   node capture.mjs <extDir> prefs   [zh|en]   # 偏好设置（主题 / 双语切换）
 *   node capture.mjs <extDir> firstrun [zh|en]  # 本地加密（首启设置主密码页）
 *
 * 前置：Chrome 带 --remote-debugging-port=9333 启动、扩展已加载、演示页静态服务在跑，
 * 且已按对应语言 seed（英文页需要英文占位标签，必须换全新 profile 重新 seed）。
 * 详见同目录 README.md。输出写入 <repo>/assets/cws-store/，英文版文件名带 -en 后缀。
 *
 * Dashboard 上中文页与 English (United States) 页的截图槽位互相独立，两套都要上传。
 * 标题带文案与商店四个字段同口径：零竞品品牌名、零绝对化表述。
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BODY,
  LEFT_W,
  PANEL_W,
  attachTo,
  compose,
  evalIn,
  extUrl,
  grab,
  initExtension,
  metrics,
  newTab,
} from './shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../assets/cws-store');

/**
 * 演示页必须用**域名**访问，不能用 127.0.0.1：扩展条目按精确域名匹配，
 * 只有 host 是 admin.example.com / console.example.com 时侧边栏才会命中对应账号
 * （这也是 Chrome 启动参数里 --host-resolver-rules 把这些域名指到本地的原因）。
 */
const PORT = process.env.SHOT_PORT || '8777';
const HOST_ADMIN = process.env.SHOT_HOST_ADMIN || 'admin.example.com';
const HOST_CONSOLE = process.env.SHOT_HOST_CONSOLE || 'console.example.com';
const pageUrl = (host, page) => `http://${host}:${PORT}/${page}`;

const EXT_DIR = process.argv[2];
const MODE = process.argv[3];
if (!EXT_DIR || !['seeded', 'prefs', 'firstrun'].includes(MODE)) {
  console.error('usage: node capture.mjs <path-to-.output/chrome-mv3> <seeded|prefs|firstrun> [zh|en]');
  process.exit(1);
}

const LANG = process.argv[4] || 'zh';
if (!['zh', 'en'].includes(LANG)) {
  console.error('lang must be zh or en');
  process.exit(1);
}

/** 标题带文案（中英各一份）。 */
const COPY = {
  zh: {
    suffix: '',
    login: {
      title: '一键登录：填充 → 勾选「记住我」→ 自动点击登录',
      sub: '侧边栏「填充并登录」，或在偏好设置中开启「自动触发登录」',
    },
    totp: {
      title: 'TOTP 两步验证：验证码和密码住在一起，不用摸手机',
      sub: '扫码或上传图片即可添加密钥，动态码在本机按 RFC 6238 生成',
    },
    audit: {
      title: '离线安全体检：0-100 分给密码健康打分，全程本机计算',
      sub: '复用 / 弱密码 / 常见泄露 / 长期未更新四维加权，不联网',
    },
    env: {
      title: '多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚',
      sub: '条目按精确域名匹配，各环境凭据互不混淆',
    },
    prefs: {
      title: '6 款主题 + 中英文双语界面，即时切换无需刷新',
      sub: '扩展页与注入页面的浮层同步生效，快捷键均可在浏览器页自定义',
    },
    encryption: {
      title: '本地加密：密码只存在你的浏览器里，加密后落盘',
      sub: 'PBKDF2 600,000 次迭代 + AES-256-GCM，密码数据不上传服务器',
    },
  },
  en: {
    suffix: '-en',
    login: {
      title: 'One-click login: fill, tick consent, click Sign in',
      sub: 'Use Fill and sign in in the side panel, or enable auto-submit in preferences',
    },
    totp: {
      title: 'TOTP two-factor: codes live right next to the passwords',
      sub: 'Add a key by scanning a QR code or uploading an image; codes are generated on your device per RFC 6238',
    },
    audit: {
      title: 'Offline security audit: a 0-100 score for password health',
      sub: 'Weighted across reuse, weakness, common leaks and staleness; all computed on your device',
    },
    env: {
      title: 'Multi-environment accounts: dev, test and prod kept apart',
      sub: 'Entries match the exact host name, so credentials never mix between environments',
    },
    prefs: {
      title: '6 color themes plus an English/Chinese UI, switched instantly',
      sub: 'Applies to extension pages and injected overlays; every shortcut is customizable',
    },
    encryption: {
      title: 'Encrypted locally: passwords stay in your browser, encrypted at rest',
      sub: 'PBKDF2 with 600,000 iterations plus AES-256-GCM; password data is never uploaded',
    },
  },
};

/** 管理页上的入口文案（按界面语言不同）。 */
const UI = {
  zh: { audit: '安全体检', prefs: '偏好设置' },
  en: { audit: 'Health Check', prefs: 'Preferences' },
};

const C = COPY[LANG];
const out = name => resolve(OUT_DIR, name.replace(/\.png$/, `${C.suffix}.png`));

// 逻辑视口比目标宽一点，避免宽表格被裁切；像素尺寸由 compose() 归一。
const RW = 1440;
const RH = Math.round(BODY / (1280 / RW));

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * 把扩展界面语言切到目标语言。
 *
 * 与偏好设置面板里的「中文 / English」开关等效：同时写 localStorage 同步镜像
 * （扩展页同源共享，见 utils/i18n/index.ts）与 chrome.storage.local 持久值，
 * 重载页面即可让整套 UI 变成目标语言。
 */
async function applyLocale(s) {
  const locale = LANG === 'en' ? 'en' : 'zh-CN';
  await evalIn(
    s,
    `(async () => {
      localStorage.setItem('app_locale', ${JSON.stringify(locale)});
      await chrome.storage.local.set({ app_locale: ${JSON.stringify(locale)} });
      return 'locale set';
    })()`,
  );
  await s.send('Page.reload', { ignoreCache: true });
  await wait(3500);
}

/**
 * 会话失效时解锁管理页。
 *
 * 用结构判定而不是文案匹配（中英文提示语不同）：有主密码输入框且列表为空即视为锁定，
 * 提交按钮取 Element Plus 的主按钮。
 */
async function unlockIfNeeded(s) {
  const locked = await evalIn(
    s,
    `document.querySelectorAll('.el-table__row').length === 0 && !!document.querySelector('input[type=password]')`,
  );
  if (!locked) return;
  await evalIn(
    s,
    `(() => {
      const el = document.querySelector('input[type=password]');
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, 'Demo!Pass2026');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.classList.contains('el-button--primary')
      );
      if (b) b.click();
      return 'submitted';
    })()`,
  );
  await wait(4000);
}

/**
 * 点击含指定文案的入口。
 *
 * 管理页的「导入数据」「偏好设置」是卡片（div）而非 button，所以先找叶子节点再向上
 * 回溯到可点击祖先；「安全体检」按钮里除文字外还有个状态圆点，精确匹配会落空，
 * 因此再兜一层「按钮文案包含该词」。隐藏的下拉菜单项也会命中，故优先取可见节点。
 */
async function clickByLabel(s, label) {
  return evalIn(
    s,
    `(() => {
      const wanted = ${JSON.stringify(label)};
      const isVisible = (n) =>
        !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);

      const leaves = [...document.querySelectorAll('body *')].filter(
        (n) => n.children.length === 0 && (n.textContent || '').trim() === wanted
      );
      const leaf = leaves.find(isVisible) || leaves[0];
      if (leaf) {
        let el = leaf;
        while (
          el &&
          el !== document.body &&
          el.tagName !== 'BUTTON' &&
          el.tagName !== 'A'
        ) {
          el = el.parentElement;
        }
        const target = el && el !== document.body ? el : leaf;
        target.click();
        return 'clicked leaf ancestor ' + target.tagName;
      }

      const btns = [...document.querySelectorAll('button')].filter((x) =>
        (x.innerText || '').includes(wanted)
      );
      const b = btns.find(isVisible) || btns[0];
      if (!b) return 'label not found: ' + wanted;
      b.click();
      return 'clicked button';
    })()`,
  );
}

/** 打开侧边栏页面、把 active tab 切回目标页，再 reload 侧边栏，使其命中该站点账号。 */
async function openPanelScopedTo(tabId) {
  await newTab(extUrl('sidepanel.html'));
  await wait(1200);
  const { s: bs } = await attachTo(t => t.type === 'page');
  await bs.send('Target.activateTarget', { targetId: tabId }).catch(() => {});
  bs.close();
  await wait(500);
  const { s: ps } = await attachTo(t => t.url.includes('sidepanel.html'));
  await ps.send('Page.reload', { ignoreCache: true });
  await wait(4000);
  return ps;
}

/** 打开一个「网页 + 侧边栏」的并排截图。 */
async function capturePagePlusPanel(url, ctx, fileName) {
  const tab = await newTab(url);
  await wait(1500);
  const { s: page } = await attachTo(t => t.id === tab.id);
  await metrics(page, LEFT_W, BODY);
  const pageBuf = await grab(page);
  const ps = await openPanelScopedTo(tab.id);
  await metrics(ps, PANEL_W, BODY);
  const panelBuf = await grab(ps);
  await compose(
    ctx,
    [
      { buf: pageBuf, width: LEFT_W },
      { buf: panelBuf, width: PANEL_W },
    ],
    out(fileName),
  );
  page.close();
  ps.close();
}

await initExtension(EXT_DIR);

if (MODE === 'seeded') {
  // ---- 一键登录：演示登录页已填充 + 侧边栏命中该站点账号 ----
  const loginTab = await newTab(pageUrl(HOST_ADMIN, 'demo-login.html'));
  await wait(1500);
  const { s: ls } = await attachTo(t => t.id === loginTab.id);
  await metrics(ls, LEFT_W, BODY);
  await evalIn(
    ls,
    `(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('email', 'demo-admin@example.com');
      set('password', 'Demo!Prod2026x');
      const cb = document.getElementById('remember');
      if (!cb.checked) cb.click();
      return 'filled';
    })()`,
  );
  await wait(600);
  const loginBuf = await grab(ls);
  const panel1 = await openPanelScopedTo(loginTab.id);
  await metrics(panel1, PANEL_W, BODY);
  const panel1Buf = await grab(panel1);
  await compose(
    { title: C.login.title, sub: C.login.sub },
    [
      { buf: loginBuf, width: LEFT_W },
      { buf: panel1Buf, width: PANEL_W },
    ],
    out('screen-1-one-click-login.png'),
  );
  ls.close();
  panel1.close();

  // ---- TOTP 两步验证 ----
  await capturePagePlusPanel(
    pageUrl(HOST_CONSOLE, 'demo-2fa.html'),
    { title: C.totp.title, sub: C.totp.sub },
    'screen-2-totp.png',
  );

  // ---- 多环境账号 / 安全体检：同一管理页的两个状态 ----
  const optTab = await newTab(extUrl('options.html'));
  const { s: os } = await attachTo(t => t.id === optTab.id);
  await metrics(os, RW, RH);
  await wait(2500);
  await unlockIfNeeded(os);
  await applyLocale(os);

  await compose(
    { title: C.env.title, sub: C.env.sub },
    [{ buf: await grab(os), width: 1280 }],
    out('screen-3-multi-env.png'),
  );

  console.log('audit entry:', await clickByLabel(os, UI[LANG].audit));
  await wait(3500);
  await compose(
    { title: C.audit.title, sub: C.audit.sub },
    [{ buf: await grab(os), width: 1280 }],
    out('screen-4-security-audit.png'),
  );
  os.close();
} else if (MODE === 'prefs') {
  // ---- 偏好设置：主题换肤 + 双语切换（需先 seed，管理页处于已解锁状态）----
  const t = await newTab(extUrl('options.html'));
  const { s } = await attachTo(x => x.id === t.id);
  await metrics(s, RW, RH);
  await wait(2500);
  await unlockIfNeeded(s);
  await applyLocale(s);
  console.log('prefs entry:', await clickByLabel(s, UI[LANG].prefs));
  await wait(3000);
  await compose(
    { title: C.prefs.title, sub: C.prefs.sub },
    [{ buf: await grab(s), width: 1280 }],
    out('screen-5-preferences.png'),
  );
  s.close();
} else {
  // ---- 本地加密：全新 profile 的首启「设置主密码」页（含安全声明）----
  const t = await newTab(extUrl('options.html'));
  const { s } = await attachTo(x => x.id === t.id);
  await metrics(s, RW, RH);
  await wait(3000);
  await applyLocale(s);
  // 两个密码框都填上，校验通过且强度清单呈现实时状态
  await evalIn(
    s,
    `(() => {
      const els = [...document.querySelectorAll('input[type=password]')];
      if (els.length < 2) return 'not first-run';
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(els[0]), 'value');
      for (const el of els) {
        d.set.call(el, 'Demo!Pass2026');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      els[0].focus();
      return 'typed ' + els.length;
    })()`,
  );
  await wait(1500);
  await compose(
    { title: C.encryption.title, sub: C.encryption.sub },
    [{ buf: await grab(s), width: 1280 }],
    out('screen-6-local-encryption.png'),
  );
  s.close();
}
