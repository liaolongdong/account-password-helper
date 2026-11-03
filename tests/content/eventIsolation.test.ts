/** @vitest-environment jsdom */

/**
 * 宿主级事件隔离工具的基础行为测试（eventIsolation）
 *
 * 覆盖两条核心承诺：
 * 1. 宿主的冒泡阶段统一终结点击/指针/触摸型事件的传播，document 冒泡监听收不到；
 * 2. 同一宿主重复挂载幂等（不叠加监听）。
 */
import { describe, expect, it, vi } from 'vitest';
import { attachHostEventIsolation } from '@/entrypoints/content/inlineDropdown/eventIsolation';

describe('attachHostEventIsolation', () => {
  it('宿主内的事件在冒泡阶段终结，不逃逸到 document', () => {
    const host = document.createElement('aph-test-root');
    document.body.appendChild(host);
    attachHostEventIsolation(host);

    const onDoc = vi.fn();
    document.addEventListener('click', onDoc);

    const inner = document.createElement('button');
    host.appendChild(inner);
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(onDoc).not.toHaveBeenCalled();
    document.removeEventListener('click', onDoc);
    host.remove();
  });

  it('同一宿主重复调用幂等，不叠加监听', () => {
    const host = document.createElement('aph-test-root');
    const spy = vi.spyOn(host, 'addEventListener');

    attachHostEventIsolation(host);
    const firstCount = spy.mock.calls.length;
    attachHostEventIsolation(host);

    expect(spy).toHaveBeenCalledTimes(firstCount);
  });
});
