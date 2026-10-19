/**
 * Options 首屏骨架的视图切换守卫
 *
 * 骨架是 HTML 里的静态 DOM，认证态却要等 Vue 挂载后才可知。这里钉住三处接线，
 * 防止「锁定态先闪表格骨架」或「会话有效时骨架停在不存在的登录卡片」静默回归：
 * 1. 认证分支在 `loadPasswords()` 之前上报首个真实视图，且只上报一次；
 * 2. App 把回调接到 `useAuthFlow`，main.ts 监听事件并切换 skeleton 的 data-view；
 * 3. 骨架同时保留认证与表格两套形态，表格头部只有一个结构化会话胶囊
 *    （真实 HeaderBar 只有这一个节点，不是早期骨架里的两个通用 chip）。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const AUTH = readSource('composables/useAuthFlow.ts');
const APP_READY = readSource('entrypoints/options/appReady.ts');
const MAIN = readSource('entrypoints/options/main.ts');
const HTML = readSource('entrypoints/options/index.html');
const APP = readSource('entrypoints/options/App.vue');

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

  it('App 接线、main 监听并切换 data-view', () => {
    expect(APP).toContain('onFirstViewResolved: markOptionsFirstView');
    expect(APP_READY).toContain("OPTIONS_FIRST_VIEW_EVENT = 'aph:options-first-view'");
    expect(MAIN).toContain('OPTIONS_FIRST_VIEW_EVENT');
    expect(MAIN).toContain('skeleton.dataset.view = view');
  });

  it('骨架包含认证与表格两套形态，表格头部只有一个结构化会话胶囊', () => {
    expect(HTML).toContain('class="sk-auth"');
    expect(HTML).toContain('class="sk-vault"');
    expect(HTML).toContain('data-view="verify"');

    expect(HTML.match(/class="sk-session"/g), '会话胶囊必须只有一个（真实头部只有一个）').toHaveLength(1);
    expect(HTML).toContain('sk-session__dot');
    expect(HTML).toContain('sk-session__timer');
    expect(HTML).toContain('sk-session__time');
    expect(HTML, '旧的双 chip 结构又回来了').not.toContain('sk-chip');
    expect(HTML, '标题下的副标题占位又回来了').not.toContain('sk-subtitle');
  });
});
