import { describe, expect, it } from 'vitest';

/**
 * 测试基建冒烟用例
 *
 * 仅验证 vitest + WxtVitest 基建是否可用，不涉及任何业务逻辑：
 * - Node 原生 Web Crypto 可用（加密测试无需 polyfill）；
 * - WxtVitest 已注入内存态 chrome 扩展 API 桩。
 */
describe('测试基建冒烟', () => {
  it('Node 原生提供 Web Crypto（加密测试无需 polyfill）', () => {
    expect(typeof globalThis.crypto?.subtle?.digest).toBe('function');
  });

  it('WxtVitest 注入了内存态 chrome 扩展 API 桩', () => {
    expect(typeof chrome).toBe('object');
    expect(typeof chrome.storage?.local?.get).toBe('function');
  });
});
