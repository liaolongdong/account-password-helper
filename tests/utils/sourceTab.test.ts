/**
 * 来源标签页收口函数的回归测试
 *
 * 「回到原网页」这条链路把用户从管理页送回**他刚才待过的那个标签页**，因此 tabId 的
 * 归属必须是浏览器盖章的事实，绝不能是页面自报的取值：一个恶意页面若能自选这个数字，
 * 就等于让它在管理页里安放一枚「点一下把用户带去钓鱼页」的按钮——而那次点击还发生在
 * 「刚从库里复制了证件号」这个注意力最放松的时刻。
 *
 * 口径对齐既有的 `resolveTrustedContentUrl`（AUTO_SAVE_PASSWORD 的归属校验）与
 * `DELEGATE_PAGE_NOTICE`（tabId 只从 sender 推导），判据两处共用一份真源：
 *
 * 1. `normalizeSourceTabId`——消息边界上的形状收窄：非整数、负数、`NaN`、超大值一律当成没带。
 * 2. `resolveSourceTabId`——后台侧的归属 + 可导航性判定：URL 缺失或协议不在白名单即 fail-closed。
 * 3. `isNavigableSourceUrl`——协议白名单的唯一真源。入口（后台推导 tabId）与落地
 *    （`useVaultReturn.returnToSource` 切之前复核「来源页还在那个站点吗」）都读它；
 *    两处各写一份白名单，就会有一处在协议变化时静默落后。
 */
import { describe, it, expect } from 'vitest';
import { isNavigableSourceUrl, normalizeSourceTabId, resolveSourceTabId } from '@/utils/sourceTab';

describe('normalizeSourceTabId（消息边界形状收窄）', () => {
  it('接受非负整数', () => {
    expect(normalizeSourceTabId(0)).toBe(0);
    expect(normalizeSourceTabId(42)).toBe(42);
  });

  it('拒绝非数字、非整数、负数与超范围值', () => {
    for (const bad of [undefined, null, '12', NaN, Infinity, -1, -0.5, 1.5, true, {}, [], 2 ** 53]) {
      expect(normalizeSourceTabId(bad)).toBeUndefined();
    }
  });
});

describe('resolveSourceTabId（后台侧归属与可导航性）', () => {
  it('http / https / file 页面放行，取浏览器盖章的 tabId', () => {
    expect(resolveSourceTabId(7, 'https://example.com/register')).toBe(7);
    expect(resolveSourceTabId(8, 'http://127.0.0.1:3000/login')).toBe(8);
    expect(resolveSourceTabId(9, 'file:///Users/me/form.html')).toBe(9);
  });

  it('非浏览器页与扩展自身页面一律不收：那些位置跑不了我们的内容脚本', () => {
    for (const url of [
      'chrome://settings/passwords',
      'chrome-extension://abcdef/options.html',
      'about:blank',
      'devtools://devtools/bundled/panels/elements.html',
      'view-source:https://example.com/',
      'javascript:alert(1)',
    ]) {
      expect(resolveSourceTabId(7, url)).toBeUndefined();
    }
  });

  it('URL 缺失或非字符串时 fail-closed（宁可不给回程，也不给一个来路不明的标签页）', () => {
    for (const url of [undefined, null, '', 123, {}]) {
      expect(resolveSourceTabId(7, url)).toBeUndefined();
    }
  });

  it('tabId 形状非法时即使 URL 合法也不收', () => {
    expect(resolveSourceTabId('7', 'https://example.com/')).toBeUndefined();
    expect(resolveSourceTabId(undefined, 'https://example.com/')).toBeUndefined();
  });
});

describe('isNavigableSourceUrl（协议白名单单一真源）', () => {
  it('http / https / file 通过，伪协议与扩展页不通过', () => {
    for (const ok of ['https://a.test/', 'http://127.0.0.1:3000/', 'file:///Users/me/form.html']) {
      expect(isNavigableSourceUrl(ok)).toBe(true);
    }
    for (const bad of [
      'chrome://extensions',
      'devtools://devtools',
      'view-source:https://a.test/',
      'javascript:void(0)',
    ]) {
      expect(isNavigableSourceUrl(bad)).toBe(false);
    }
  });

  it('非字符串、空串与解析不了的脏值一律 false（切之前复核也走这一条）', () => {
    for (const bad of [undefined, null, '', 123, {}, []]) {
      expect(isNavigableSourceUrl(bad)).toBe(false);
    }
  });
});
