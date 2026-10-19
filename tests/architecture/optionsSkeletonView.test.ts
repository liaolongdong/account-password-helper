/**
 * Options 首屏骨架的视图切换守卫
 *
 * 骨架是 HTML 里的静态 DOM，认证态却要等 storage 异步读取后才知道。这里钉住四层接线，
 * 防止「刷新 / 有效期入口先闪验证骨架」「锁定态先闪表格骨架」静默回归：
 * 1. 认证分支在 `loadPasswords()` 之前上报首个真实视图，且只上报一次；
 * 2. App 把回调接到 `useAuthFlow`；`markOptionsFirstView` 直接改 html 属性并写 sessionStorage，
 *    head 里的同步预判脚本用同一组键名在首帧前选形态；
 * 3. 骨架同时保留 boot / 认证 / 表格三套形态，表格头部只有一个结构化会话胶囊；
 * 4. 有效期入口新建标签页时带 `first-view=vault`，首帧直接落到表格骨架。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const AUTH = readSource('composables/useAuthFlow.ts');
const APP_READY = readSource('entrypoints/options/appReady.ts');
const MAIN = readSource('entrypoints/options/main.ts');
const HTML = readSource('entrypoints/options/index.html');
const APP = readSource('entrypoints/options/App.vue');
const VIEW_UTIL = readSource('utils/optionsFirstView.ts');
const PREFLIGHT = readSource('public/options-first-view.js');
const OPTIONS_MANAGER = readSource('entrypoints/background/optionsPageManager.ts');
const ROUTER = readSource('entrypoints/background/messageRouter.ts');

describe('Options 首屏骨架的视图切换', () => {
  it('认证结论在列表加载前上报，且只上报一次', () => {
    expect(AUTH).toContain('onFirstViewResolved');
    expect(AUTH).toContain('if (firstViewReported) return;');
    expect(AUTH).toContain("reportFirstView('setup')");
    expect(AUTH).toContain("reportFirstView('verify')");

    const vaultIndex = AUTH.indexOf("reportFirstView('vault')");
    const loadIndex = AUTH.indexOf('await loadPasswords()');
    expect(vaultIndex, '会话有效分支不再上报 vault').toBeGreaterThan(-1);
    expect(loadIndex, '找不到 checkAuth 里的列表加载').toBeGreaterThan(-1);
    expect(loadIndex, 'vault 形态上报晚于列表加载：骨架会在解密期间停留在认证形态').toBeGreaterThan(vaultIndex);
  });

  it('App 接线后直接校正 html 属性并记住视图，main 不再经事件切换', () => {
    expect(APP).toContain('onFirstViewResolved: markOptionsFirstView');
    expect(APP).toContain('rememberOptionsFirstView');
    expect(APP).toContain("rememberOptionsFirstView('verify')");
    expect(APP_READY).toContain('document.documentElement.dataset.optionsFirstView = view');
    expect(APP_READY).toContain('sessionStorage.setItem(OPTIONS_FIRST_VIEW_STORAGE_KEY, view)');
    expect(MAIN, 'main.ts 又接管了骨架形态切换：首帧预判会退化').not.toContain('skeleton.dataset.view');
  });

  it('head 同步预判脚本先于渲染执行，并与共享键名保持一致', () => {
    const scriptIndex = HTML.indexOf('<script src="/options-first-view.js"></script>');
    const headEnd = HTML.indexOf('</head>');
    expect(scriptIndex, '少了 head 里的同步预判脚本').toBeGreaterThan(-1);
    expect(headEnd).toBeGreaterThan(scriptIndex);

    expect(VIEW_UTIL).toContain("OPTIONS_FIRST_VIEW_PARAM = 'first-view'");
    expect(VIEW_UTIL).toContain("OPTIONS_FIRST_VIEW_STORAGE_KEY = 'aph-options-first-view'");
    expect(PREFLIGHT).toContain("'first-view'");
    expect(PREFLIGHT).toContain("'aph-options-first-view'");
    expect(PREFLIGHT).toContain('document.documentElement.dataset.optionsFirstView');

    // URL 参数会一直留在地址栏，必须让位于页面内更新过的 sessionStorage
    const storageIndex = PREFLIGHT.indexOf('sessionStorage.getItem');
    const queryIndex = PREFLIGHT.indexOf('new URLSearchParams');
    expect(storageIndex, '预判脚本不再读 sessionStorage').toBeGreaterThan(-1);
    expect(queryIndex, '预判脚本不再读 URL 参数').toBeGreaterThan(-1);
    expect(storageIndex, 'URL 参数优先于刷新提示：锁定后刷新会先闪表格骨架').toBeLessThan(queryIndex);
  });

  it('骨架包含 boot / 认证 / 表格三套形态，表格头部只有一个结构化会话胶囊', () => {
    expect(HTML).toContain('class="sk-boot"');
    expect(HTML).toContain('class="sk-auth"');
    expect(HTML).toContain('class="sk-vault"');
    expect(HTML).toContain("html[data-options-first-view='vault'] .sk-vault");
    expect(HTML, '骨架又退回静态 data-view：首帧无法预判').not.toContain('data-view=');

    expect(HTML.match(/class="sk-session"/g), '会话胶囊必须只有一个（真实头部只有一个）').toHaveLength(1);
    expect(HTML).toContain('sk-session__dot');
    expect(HTML).toContain('sk-session__timer');
    expect(HTML).toContain('sk-session__time');
    expect(HTML, '旧的双 chip 结构又回来了').not.toContain('sk-chip');
    expect(HTML, '标题下的副标题占位又回来了').not.toContain('sk-subtitle');
  });

  it('有效期入口新建标签页时把首屏预判为 vault', () => {
    expect(ROUTER).toContain("openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_VALIDITY, undefined, 'vault')");
    expect(OPTIONS_MANAGER).toContain('OPTIONS_FIRST_VIEW_PARAM');
    expect(OPTIONS_MANAGER).toContain('chrome.tabs.create({ url: optionsUrl })');
  });
});
