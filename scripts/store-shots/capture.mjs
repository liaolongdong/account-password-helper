/**
 * 截取并合成商店截图（中英各一套）。
 *
 *   node capture.mjs <extDir> seeded  [zh|en]   # 一键登录 / TOTP / 多环境 / 安全体检 / 收藏 / 详情 / 页内面板 / 悬浮按钮 / 自动保存 / 数据管理 / 生成器 / 回收站
 *   node capture.mjs <extDir> prefs   [zh|en]   # 偏好设置（主题 / 双语切换）
 *   node capture.mjs <extDir> firstrun [zh|en]  # 本地加密（首启设置主密码页）
 *   node capture.mjs <extDir> autosave [zh|en]  # 只重截自动保存弹窗（弹窗版式微调后无需重跑整批）
 *
 * 前置：Chrome 带 --remote-debugging-port=9333 启动、扩展已加载、demo-server.mjs
 * 在跑（本地 HTTPS 演示站），且已按对应语言 seed（英文页需要英文占位标签，必须换
 * 全新 profile 重新 seed）。详见同目录 README.md。输出写入 <repo>/assets/cws-store/，
 * 英文版文件名带 -en 后缀。
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
  warmFavicons,
} from './shot.mjs';
import { COPY, UI } from './copy.mjs';
import { DEMO_HOSTS, HOST_ADMIN, HOST_CONSOLE, pageUrl } from './demo-hosts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../assets/cws-store');

// 演示页地址与域名清单见 `demo-hosts.mjs`：必须用**域名**访问而不是 127.0.0.1
// （扩展条目按精确域名匹配），且必须是 `https://<host>` 这种不带端口的形态，
// favicon 缓存才会与条目网址对得上。

const EXT_DIR = process.argv[2];
const MODE = process.argv[3];
if (!EXT_DIR || !['seeded', 'prefs', 'firstrun', 'autosave'].includes(MODE)) {
  console.error('usage: node capture.mjs <path-to-.output/chrome-mv3> <seeded|prefs|firstrun|autosave> [zh|en]');
  process.exit(1);
}

const LANG = process.argv[4] || 'zh';
if (!['zh', 'en'].includes(LANG)) {
  console.error('lang must be zh or en');
  process.exit(1);
}

const C = COPY[LANG];
const out = name => resolve(OUT_DIR, name.replace(/\.png$/, `${C.suffix}.png`));

// 逻辑视口比目标宽一点，避免宽表格被裁切；像素尺寸由 compose() 归一。
const RW = 1440;
const RH = Math.round(BODY / (1280 / RW));

const wait = ms => new Promise(r => setTimeout(r, ms));

/** 演示主密码：seed.mjs 用它设置主密码，这里用它解锁 / 通过敏感入口的二次验证。 */
const DEMO_MASTER_PASSWORD = 'Demo!Pass2026';

/**
 * 在「验证主密码」弹窗里填入主密码并确认。
 *
 * 回收站等敏感入口会先要求二次验证，只点开菜单项只会停在验证框上（实测截图拍到的
 * 就是验证框而不是回收站内容）。
 */
const confirmMasterPassword = `(() => {
  const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const dialog = [...document.querySelectorAll('.el-dialog')].filter(isVisible).pop();
  if (!dialog) return 'no visible dialog';
  const el = [...dialog.querySelectorAll('input[type=password]')].find(isVisible);
  if (!el) return 'password input not found';
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  d.set.call(el, ${JSON.stringify(DEMO_MASTER_PASSWORD)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const btn = [...dialog.querySelectorAll('button')]
    .filter(isVisible)
    .find((b) => b.classList.contains('el-button--primary'));
  if (!btn) return 'confirm button not found';
  btn.click();
  return 'master password submitted';
})()`;

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
      d.set.call(el, DEMO_MASTER_PASSWORD);
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

/**
 * 点击侧边栏搜索行里的第 idx 个圆形按钮（0=搜索范围，1=只看收藏，2=排序）。
 *
 * 只有搜索范围按钮带 aria-label，另两个只挂在 tooltip 上，因此按结构取；
 * 回读 class 里的 `el-button--*` 供日志确认状态是否切换（只看收藏激活后会变 warning）。
 */
const clickSearchSection = idx => `(() => {
  const btns = [...document.querySelectorAll('.search-section button')];
  const b = btns[${idx}];
  if (!b) return 'button not found (' + btns.length + ' in row)';
  b.click();
  return 'clicked ' + [...b.classList].filter((c) => c.startsWith('el-button--')).join(' ');
})()`;

/**
 * 点开管理页顶栏的下拉菜单。
 *
 * 触发按钮上的文案里还带一个箭头图标，`textContent` 因此不是纯标签，用 `startsWith`
 * 匹配；顶栏里另有一个会话剩余时间按钮（同为 button），靠文案前缀区分。
 */
const openDropdownByLabel = label => `(() => {
  const wanted = ${JSON.stringify(label)};
  const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const btn = [...document.querySelectorAll('.header button')]
    .filter(isVisible)
    .find((b) => (b.innerText || '').trim().startsWith(wanted));
  if (!btn) return 'dropdown trigger not found: ' + wanted;
  btn.click();
  return 'dropdown opened: ' + wanted;
})()`;

/**
 * 点击下拉菜单里的一项。
 *
 * 不能复用 clickByLabel：菜单项带图标（`:icon`）时 `li` 里有子元素、文字是裸文本节点，
 * DOM 里不存在「文本恰好等于标签」的叶子元素，按叶子匹配会报 label not found。
 */
const clickMenuItem = label => `(() => {
  const wanted = ${JSON.stringify(label)};
  const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const item = [...document.querySelectorAll('.el-dropdown-menu__item')]
    .filter(isVisible)
    .find((n) => (n.textContent || '').trim() === wanted);
  if (!item) return 'menu item not found: ' + wanted;
  item.click();
  return 'menu item clicked: ' + wanted;
})()`;

/** 详情抽屉入口按钮选择器（按界面语言取 aria-label）。 */
const detailSel = `button[aria-label=${JSON.stringify(UI[LANG].detail)}]`;

/** 打开一个「网页 + 侧边栏」的并排截图；onPanel 用于在截图前操作侧边栏。 */
async function capturePagePlusPanel(url, ctx, fileName, onPanel) {
  const tab = await newTab(url);
  await wait(1500);
  const { s: page } = await attachTo(t => t.id === tab.id);
  await metrics(page, LEFT_W, BODY);
  const pageBuf = await grab(page);
  const { s: panel, panelId } = await openPanelScopedTo(tab.id);
  if (onPanel) await onPanel(panel);
  await metrics(panel, PANEL_W, BODY);
  const panelBuf = await grab(panel);
  await compose(
    ctx,
    [
      { buf: pageBuf, width: LEFT_W },
      { buf: panelBuf, width: PANEL_W },
    ],
    out(fileName),
  );
  page.close();
  panel.close();
  await closeTab(tab.id);
  await closeTab(panelId);
}

/** 只拍网页（整屏 1280 宽），用于页内注入 UI 的截图。 */
async function capturePageOnly(url, ctx, fileName, onReady) {
  const tab = await newTab(url);
  await wait(1800);
  const { s: page } = await attachTo(t => t.id === tab.id);
  await metrics(page, W, BODY);
  if (onReady) await onReady(page, tab);
  await compose(ctx, [{ buf: await grab(page), width: W }], out(fileName));
  page.close();
  await closeTab(tab.id);
}

/**
 * 自动保存登录凭证：提交一份库里没有的凭据，触发保存确认弹窗。
 *
 * 抽成独立函数是为了能单独重跑（`autosave` 模式）——弹窗版式很容易随文案微调
 * 而需要重截，没必要为此重跑整批。
 *
 * 前置：已按同一语言 seed（需要有效的数据库状态，后台才会走完捕获→弹窗链路）。
 */
async function captureAutoSave() {
  await capturePageOnly(
    pageUrl(HOST_ADMIN, 'demo-login.html'),
    { title: C.autosave.title, sub: C.autosave.sub },
    'screen-11-auto-save.png',
    async page => {
      await evalIn(
        page,
        `(() => {
          const set = (id, v) => {
            const el = document.getElementById(id);
            const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
            d.set.call(el, v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          set('email', 'new-hire@example.com');
          set('password', 'Demo!Fresh2026x');
          return 'filled';
        })()`,
      );
      await wait(700);
      // 演示页的 form 是 onsubmit="return false"，申请提交只发事件不导航，正好停在弹窗上
      console.log(
        'submit:',
        await evalIn(
          page,
          `(() => {
            const f = document.querySelector('form');
            if (!f) return 'no form';
            f.requestSubmit();
            return 'submitted';
          })()`,
        ),
      );
      await wait(3000);
    },
  );
}

/** 只拍管理页（整屏 1280 宽），先确保已解锁并切到目标语言。 */
async function captureOptions(ctx, fileName, onReady) {
  const tab = await newTab(extUrl('options.html'));
  const { s } = await attachTo(t => t.id === tab.id);
  await metrics(s, RW, RH);
  await wait(2500);
  await unlockIfNeeded(s);
  await applyLocale(s);
  if (onReady) await onReady(s);
  await compose(ctx, [{ buf: await grab(s), width: 1280 }], out(fileName));
  s.close();
  await closeTab(tab.id);
}

await initExtension(EXT_DIR);

if (MODE === 'seeded') {
  await closeStaleDemoTabs();
  // 条目列表与侧边栏都要展示网站图标，先把演示域名的 favicon 灌进浏览器本地缓存
  await warmFavicons(DEMO_HOSTS);

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
  const { s: panel1, panelId } = await openPanelScopedTo(loginTab.id);
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
  await closeTab(loginTab.id);
  await closeTab(panelId);

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
  await closeTab(optTab.id);

  // ---- 收藏置顶 + 只看收藏：切到全站视图，收藏的账号分属不同站点 ----
  await capturePagePlusPanel(
    pageUrl(HOST_ADMIN, 'demo-login.html'),
    { title: C.favorites.title, sub: C.favorites.sub },
    'screen-7-favorites.png',
    async panel => {
      console.log('scope:', await evalIn(panel, clickSearchSection(0)));
      await wait(1500);
      console.log('favorites:', await evalIn(panel, clickSearchSection(1)));
      await wait(1500);
    },
  );

  // ---- 条目详情抽屉：ops 那条同时带活码与多标签，展示字段最全 ----
  await captureOptions({ title: C.detail.title, sub: C.detail.sub }, 'screen-8-detail-drawer.png', async s => {
    console.log(
      'drawer:',
      await evalIn(
        s,
        `(() => {
            const rows = [...document.querySelectorAll('.el-table__row')];
            const row = rows.find((r) => (r.textContent || '').includes('ops@example.com')) || rows[0];
            const btn = row && row.querySelector(${JSON.stringify(detailSel)});
            if (!btn) return 'detail button not found';
            btn.click();
            return 'opened';
          })()`,
      ),
    );
    await wait(2000);
  });

  // ---- 页内填充面板：内容脚本只收扩展页的 tabs.sendMessage，借管理页当发起方 ----
  await capturePageOnly(
    pageUrl(HOST_ADMIN, 'demo-login.html'),
    { title: C.inline.title, sub: C.inline.sub },
    'screen-9-inline-fill.png',
    async (page, tab) => {
      await evalIn(page, `document.getElementById('email')?.focus()`);
      const ext = await newTab(extUrl('options.html'));
      await wait(2000);
      const { s: es } = await attachTo(t => t.id === ext.id);
      // 内容脚本注入是异步的：页面刚打开时偶发 "Receiving end does not exist"，
      // 此时下拉不会展开、截出来是一张没有面板的登录页，因此重试到拿到响应为止。
      //
      // 另外必须遍历**所有**同 URL 标签而不是取第一个：上一轮跑批遗留的同地址标签
      // 里，内容脚本已随扩展重载失效，取第一个会永远失败（实测连续 5 次命中陈旧标签）。
      // chrome.tabs.query 按窗口内顺序返回，新建的标签排在后面，故从后往前试。
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await evalIn(
          es,
          `(async () => {
            // CDP targetId 不是 chrome.tabs 的整数 id，只能按 URL 反查
            const wanted = ${JSON.stringify(tab.url)};
            const targets = await chrome.tabs.query({ url: wanted });
            if (!targets.length) return 'demo tab not found: ' + wanted;
            const failures = [];
            for (const t of [...targets].reverse()) {
              try {
                const res = await chrome.tabs.sendMessage(t.id, { type: 'OPEN_INLINE_DROPDOWN', data: {} });
                return 'tab ' + t.id + ' -> ' + JSON.stringify(res);
              } catch (e) {
                failures.push(t.id + ': ' + e.message);
              }
            }
            return 'all ' + targets.length + ' tab(s) failed: ' + failures.join(' | ');
          })()`,
        );
        console.log(`inline dropdown (attempt ${attempt}):`, res);
        if (!String(res).includes('failed')) break;
        await wait(1500);
      }
      es.close();
      await closeTab(ext.id);
      await wait(1500);
    },
  );

  // ---- 页面悬浮按钮：登录页上的可拖拽按钮（配置默认 visible: true）----
  await capturePageOnly(
    pageUrl(HOST_ADMIN, 'demo-login.html'),
    { title: C.floating.title, sub: C.floating.sub },
    'screen-10-floating-button.png',
    async page => {
      // 悬浮按钮的宿主是轻量 DOM 里的 <floating-button-root>，内部走 Closed Shadow DOM，
      // 因此只能确认宿主已挂载（视觉效果由页面截图体现），不穿透查询内部节点。
      console.log(
        'floating button:',
        await evalIn(
          page,
          `(() => {
            const host = document.querySelector('floating-button-root');
            if (!host) return 'host not mounted';
            const r = host.getBoundingClientRect();
            return 'host mounted, right=' + Math.round(r.right) + ' top=' + Math.round(r.top);
          })()`,
        ),
      );
      await wait(1200);
    },
  );

  // ---- 自动保存登录凭证：提交一份库里没有的凭据，触发保存确认弹窗 ----
  await captureAutoSave();

  // ---- 导入导出与加密备份：打开「数据管理」下拉，六项能力一屏可见 ----
  await captureOptions({ title: C.backup.title, sub: C.backup.sub }, 'screen-12-import-backup.png', async s => {
    console.log('data menu:', await evalIn(s, openDropdownByLabel(UI[LANG].data)));
    await wait(1200);
  });

  // ---- 密码生成器双模式：添加密码弹窗里的生成器面板 ----
  await captureOptions({ title: C.generator.title, sub: C.generator.sub }, 'screen-13-generator.png', async s => {
    console.log('add dialog:', await clickByLabel(s, UI[LANG].add));
    await wait(1800);
    console.log(
      'generator:',
      await evalIn(
        s,
        `(() => {
          const btn = document.querySelector('.generator-trigger-btn');
          if (!btn) return 'trigger not found';
          btn.click();
          return 'generator opened';
        })()`,
      ),
    );
    await wait(1500);
  });

  // ---- 回收站：数据管理 → 回收站，展示 30 天可恢复 ----
  await captureOptions({ title: C.trash.title, sub: C.trash.sub }, 'screen-14-trash.png', async s => {
    console.log('data menu:', await evalIn(s, openDropdownByLabel(UI[LANG].data)));
    await wait(1200);
    console.log('trash:', await evalIn(s, clickMenuItem(UI[LANG].trash)));
    // 回收站属于敏感入口，会先弹「验证主密码」，通过之后才是回收站内容
    await wait(1800);
    console.log('trash verify:', await evalIn(s, confirmMasterPassword));
    await wait(2500);
  });
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
  await closeTab(t.id);
} else if (MODE === 'autosave') {
  // ---- 只重截自动保存弹窗（需先按同一语言 seed）----
  await captureAutoSave();
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
        d.set.call(el, DEMO_MASTER_PASSWORD);
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
  await closeTab(t.id);
}
