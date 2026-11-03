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
const HEADER = readSource('components/options/HeaderBar.vue');
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

  it('骨架工具条的按钮占位数与真实头部同形（左 6 / 右 2 / 会话区含锁定）', () => {
    /**
     * 骨架是静态 HTML，不会跟着 Vue 组件重排。2026-10-22 头部从「左 4 + 右 5」改成
     * 「左 6 + 右 2」时，骨架仍画着 9 颗占位——加载瞬间先给一个不存在的工具条形状，
     * 落地后再收缩，正好是这条判据要防的那类静默回归。
     * 数字取自 `components/options/HeaderBar.vue`：左组 = 添加密码 / 安全体检 / 个人信息库 /
     * 数据管理▾ / 安全设置▾ / 偏好设置，右组 = 命令面板 / 帮助▾，第一行右端 = 会话胶囊 + 立即锁定。
     */
    const sliceGroup = (opening: string): string => {
      const at = HTML.indexOf(opening);
      expect(at, `找不到骨架占位容器 \`${opening}\``).toBeGreaterThanOrEqual(0);
      const rest = HTML.slice(at + opening.length);
      // 组的边界 = 下一个组开始，或 `</header>` 收尾（右组是最后一个）
      const bounds = [rest.indexOf('<div class="sk-action-group'), rest.indexOf('</header>')].filter(i => i >= 0);
      return rest.slice(0, bounds.length ? Math.min(...bounds) : rest.length);
    };
    const countBtns = (block: string): number => [...block.matchAll(/class="sk-block sk-btn/g)].length;
    expect(countBtns(sliceGroup('<div class="sk-action-group">')), '左组占位数与真实头部不一致').toBe(6);
    expect(countBtns(sliceGroup('<div class="sk-action-group sk-action-group--right">')), '右组占位数不一致').toBe(2);

    const metaAt = HTML.indexOf('<div class="sk-header-meta">');
    expect(metaAt, '找不到第一行右端的会话区').toBeGreaterThanOrEqual(0);
    const meta = HTML.slice(metaAt, HTML.indexOf('<div class="sk-header-row">', metaAt));
    expect(meta.match(/class="sk-session"/g), '会话胶囊必须只有一个').toHaveLength(1);
    expect([...meta.matchAll(/class="sk-block sk-btn/g)], '会话徽标旁缺了「立即锁定」占位').toHaveLength(1);

    /**
     * 备份徽标占位（2026-10-24 补）
     *
     * 头部加了备份徽标那天，骨架没跟着加：淡出那一帧整组右端向左顶开约 130px，
     * 正是本文件注释里 2026-10-22「左 4 + 右 5 → 左 6 + 右 2」那次的同一类回归。
     * 顺序也要对——真实头部是「备份 → 会话 → 锁定」，反了会在淡出瞬间左右互换。
     */
    expect(meta.match(/class="sk-backup"/g), '备份徽标必须只有一枚（真实头部只有一枚）').toHaveLength(1);
    for (const part of ['sk-backup__dot', 'sk-backup__icon', 'sk-backup__text']) {
      expect(meta, `备份徽标缺了 \`${part}\` 占位`).toContain(part);
    }
    expect(meta.indexOf('sk-backup'), '骨架里备份徽标与会话胶囊的顺序与真实头部相反').toBeLessThan(
      meta.indexOf('sk-session'),
    );

    // 真实头部若改掉这三枚控件的类名（增删/改名），先在这里露出来，再去看骨架要不要跟
    for (const cls of ['backup-chip', 'session-chip', 'lock-btn']) {
      expect(HEADER, `真实头部不再有 .${cls}，骨架占位需要同步`).toContain(`class="${cls}"`);
    }

    /**
     * 占位高度必须等于真实徽标高度（评审报告 P2-13）。
     *
     * 上面只断言「存在 + 顺序」，量不到尺寸：骨架徽标一度是 28px 对真实 32px，
     * 淡出那一帧整行往下坠 4px——位置对、尺寸错同样是一次可见位移。
     */
    const realHeight = (cls: string): string | undefined =>
      HEADER.match(new RegExp(`\\.${cls} \\{[^}]*?height: (\\d+px)`))?.[1];
    const skeletonHeight = (cls: string): string | undefined =>
      HTML.match(new RegExp(`\\.${cls} \\{[\\s\\S]*?height: (\\d+px)`))?.[1];
    for (const [skeletonCls, realCls] of [
      ['sk-backup', 'backup-chip'],
      ['sk-session', 'session-chip'],
    ] as const) {
      const want = realHeight(realCls);
      expect(want, `真实头部读不到 .${realCls} 的高度，本条判据需要先修取证方式`).toBeTruthy();
      expect(skeletonHeight(skeletonCls), `骨架 .${skeletonCls} 与真实 .${realCls} 高度不一致`).toBe(want);
    }
  });

  it('有效期入口与侧边栏 / 悬浮按钮的管理入口都按会话状态预判首屏', () => {
    expect(ROUTER).toContain("openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_VALIDITY, undefined, 'vault')");
    expect(OPTIONS_MANAGER).toContain('OPTIONS_FIRST_VIEW_PARAM');
    expect(OPTIONS_MANAGER).toContain('chrome.tabs.create({ url: optionsUrl })');

    // OPEN_OPTIONS_PAGE 可能来自锁定界面，不能无条件写死 vault；有效时才提示
    expect(ROUTER).toContain('async function resolveOptionsFirstView');
    expect(ROUTER).toContain('isSessionValid({ skipConsistencyCheck: true })');
    expect(ROUTER).toContain("? 'vault' : undefined");
    expect(ROUTER).toContain('openOptionsPage(firstView)');
  });
});
