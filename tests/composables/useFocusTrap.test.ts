/** @vitest-environment jsdom */

/**
 * 模态焦点陷阱测试（composables/useFocusTrap.ts）
 *
 * 锁定四件事：
 * - 打开记录原主、关闭归还（原主被卸载时不硬聚焦也不报错）；
 * - Tab / Shift+Tab 在容器首尾回环，焦点已逃出容器时被拉回边界；
 * - 非 Tab 键、关闭后、作用域销毁后一律不拦截（监听不越界、不泄漏）；
 * - 容器节点在打开之后才到位（Teleport + `v-if` 的真实时序），到位后陷阱仍生效。
 *
 * 环境为 jsdom：`HTMLElement.prototype.focus` 对 input / button / a[href] / 带 tabindex
 * 的元素有效，`disabled` 元素不可聚焦，正好用来验证候选集筛选。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, type Ref } from 'vue';
import { collectFocusables, FOCUSABLE_SELECTOR, useFocusTrap } from '@/composables/useFocusTrap';

/** 面板内外各若干节点；`#mid` 不可聚焦，用于验证「焦点落在容器上」的拉回分支 */
function buildDom(): void {
  document.body.innerHTML = `
    <button id="opener">唤起方</button>
    <div id="panel">
      <input id="first" />
      <div id="mid">静态文本</div>
      <input id="last" />
    </div>
  `;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** 在指定节点上派发一个可被拦截的按键事件 */
function keyOn(el: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

/** 在 effectScope 内装配陷阱，返回 scope 供销毁 */
function setup(container: Ref<HTMLElement | null | undefined>, enabled: Ref<boolean>): () => void {
  const scope = effectScope();
  scope.run(() => useFocusTrap(container, enabled));
  return () => scope.stop();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collectFocusables', () => {
  it('按文档顺序收集可聚焦元素，排除禁用项与 tabindex="-1"', () => {
    buildDom();
    const panel = byId('panel');
    panel.insertAdjacentHTML(
      'beforeend',
      '<button id="off" tabindex="-1">不可达</button><input id="gone" disabled><a id="link" href="#x">链接</a>',
    );

    expect(collectFocusables(panel).map(el => el.id)).toEqual(['first', 'last', 'link']);
  });

  it('选择集覆盖六类宿主元素', () => {
    for (const fragment of [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ]) {
      expect(FOCUSABLE_SELECTOR).toContain(fragment);
    }
  });

  it('带 tabindex="-1" 的原生控件不算候选（选中它会让用户走不出去）', () => {
    const panel = document.createElement('div');
    panel.innerHTML = '<button id="b1"></button><button id="b2" tabindex="-1"></button>';
    document.body.appendChild(panel);

    expect(collectFocusables(panel).map(el => el.id)).toEqual(['b1']);
  });
});

describe('useFocusTrap 焦点归还', () => {
  it('打开时记住唤起方，关闭后把焦点还回去', async () => {
    buildDom();
    const opener = byId('opener');
    const panel = byId('panel');
    opener.focus();

    const enabled = ref(false);
    const scope = setup(ref(panel), enabled);

    enabled.value = true;
    await nextTick();
    byId('first').focus();
    expect(document.activeElement).toBe(byId('first'));

    enabled.value = false;
    await nextTick();
    expect(document.activeElement).toBe(opener);

    scope();
  });

  it('唤起方在面板打开期间被移除时，不硬聚焦也不抛错', async () => {
    buildDom();
    const opener = byId('opener');
    opener.focus();

    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    opener.remove();
    enabled.value = false;
    await nextTick();

    expect(document.activeElement).toBe(document.body);
    scope();
  });

  it('可见性未翻转时不重复记录原主（容器节点更换不会把原主改成面板内部元素）', async () => {
    buildDom();
    const opener = byId('opener');
    opener.focus();

    const container = ref<HTMLElement | null>(byId('panel'));
    const enabled = ref(true);
    const scope = setup(container, enabled);
    await nextTick();

    // 模拟 v-if 重建面板：焦点此时已在面板内，若重新记录原主就会指向面板自己
    const replacement = document.createElement('div');
    replacement.innerHTML = '<input id="new-first">';
    byId('panel').replaceWith(replacement);
    container.value = replacement;
    byId('new-first').focus();
    await nextTick();

    enabled.value = false;
    await nextTick();
    expect(document.activeElement).toBe(opener);

    scope();
  });
});

describe('useFocusTrap Tab 回环', () => {
  it('在最后一个元素上按 Tab：拦截并回到第一个', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    byId('last').focus();
    const event = keyOn(byId('last'));

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));
    scope();
  });

  it('在第一个元素上按 Shift+Tab：拦截并回到最后一个', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    byId('first').focus();
    const event = keyOn(byId('first'), { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
    scope();
  });

  it('焦点不在候选集里（落在静态文本上）时拉回边界，而不是放它走出模态层', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    // jsdom 不会把焦点停在不可聚焦元素上，这里直接构造「焦点在面板外」的状态
    byId('opener').focus();
    const forward = keyOn(byId('mid'));
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('first'));

    byId('opener').focus();
    const backward = keyOn(byId('mid'), { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
    scope();
  });

  it('中间元素之间正常前进：不拦截、不移焦点', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    byId('first').focus();
    const event = keyOn(byId('first'));

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(byId('first'));
    scope();
  });

  it('非 Tab 键与空候选集一律放行（语义导航仍归父级处理）', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    byId('first').focus();
    expect(keyOn(byId('first'), { key: 'Enter' }).defaultPrevented).toBe(false);
    expect(keyOn(byId('first'), { key: 'Escape' }).defaultPrevented).toBe(false);

    const emptyPanel = ref(document.createElement('div'));
    document.body.appendChild(emptyPanel.value);
    const emptyScope = setup(emptyPanel, ref(true));
    await nextTick();
    expect(keyOn(emptyPanel.value).defaultPrevented).toBe(false);

    emptyScope();
    scope();
  });
});

describe('useFocusTrap 生命周期', () => {
  it('容器在打开之后才到位（Teleport + v-if 时序），到位后陷阱生效', async () => {
    buildDom();
    const container = ref<HTMLElement | null>(null);
    const enabled = ref(true);
    const scope = setup(container, enabled);

    await nextTick();
    container.value = byId('panel');
    await nextTick();

    byId('last').focus();
    expect(keyOn(byId('last')).defaultPrevented).toBe(true);
    scope();
  });

  it('关闭后监听随之解绑，面板内的 Tab 不再被拦截', async () => {
    buildDom();
    const enabled = ref(true);
    const scope = setup(ref(byId('panel')), enabled);
    await nextTick();

    enabled.value = false;
    await nextTick();

    byId('last').focus();
    expect(keyOn(byId('last')).defaultPrevented).toBe(false);
    scope();
  });

  it('作用域销毁后解绑，重复打开只保留一份监听', async () => {
    buildDom();
    const panel = byId('panel');
    const enabled = ref(true);
    const scope = setup(ref(panel), enabled);
    await nextTick();

    // 开关一轮：若绑定未幂等，第二次关闭后仍会有监听残留
    enabled.value = false;
    await nextTick();
    enabled.value = true;
    await nextTick();

    byId('last').focus();
    expect(keyOn(byId('last')).defaultPrevented).toBe(true);

    scope();
    byId('last').focus();
    expect(keyOn(byId('last')).defaultPrevented).toBe(false);
  });
});
