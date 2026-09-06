/** @vitest-environment jsdom */
/**
 * 右键目标解析（contextMenuTarget）回归测试
 *
 * `resolveContextMenuInputTarget` 是「会话失效时把内联下拉解锁面板锚定到被右键的那个
 * 输入框」的落点来源：它必须与填充路径共用同一套有效性判定（连接性 / 可见性 / 可编辑），
 * 并把锚定范围收窄到 `HTMLInputElement`（内联面板的锚定 API 不接受 textarea）。
 * 一旦放松，解锁面板会锚到已脱离文档的旧节点、只读字段或 textarea 上，
 * 表现为「面板出现在错误位置」或「面板根本不出现」。
 *
 * 依赖 tests/helpers/domLayout.ts 驱动 offsetWidth/offsetHeight 与 getComputedStyle
 * （jsdom 无真实布局，未打桩时 isElementVisible 恒 false）；先做装置自检，
 * 防止补丁静默失配产出「看似合理实则全错」的结论。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rememberContextMenuTarget, resolveContextMenuInputTarget } from '@/entrypoints/content/contextMenuTarget';
import { installDomLayout, type DomLayout } from '@/tests/helpers/domLayout';

/** 输入框几何：非零宽高是让 isElementVisible 判真的前提 */
const INPUT_RECT = { left: 100, top: 50, width: 300, height: 40 };

let layout: DomLayout;
/** beforeEach 是否跑到底；装置自检抛错时避开 afterEach 级联出无关错误 */
let ready = false;

/** 构造一个挂在文档中的可见输入框 */
function mountInput(type: 'text' | 'password' = 'text'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  document.body.appendChild(input);
  layout.setRect(input, INPUT_RECT);
  return input;
}

beforeEach(() => {
  document.body.innerHTML = '';
  layout = installDomLayout();
  ready = true;
});

afterEach(() => {
  if (!ready) return;
  ready = false;
  layout.uninstall();
});

describe('测试装置自检（补丁失配会让以下所有结论失效）', () => {
  it('setRect 同时驱动 offsetWidth/offsetHeight，使 isElementVisible 能真实判真', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(input.offsetWidth).toBe(0);

    layout.setRect(input, INPUT_RECT);
    // 回带校验字段：确认读到的是登记的尺寸而非桩默认值
    expect([input.offsetWidth, input.offsetHeight]).toEqual([INPUT_RECT.width, INPUT_RECT.height]);
  });
});

describe('resolveContextMenuInputTarget', () => {
  it('被右键的可见输入框原样返回（锚定落点 = 用户注意力落点）', () => {
    const input = mountInput();
    rememberContextMenuTarget(input);

    expect(resolveContextMenuInputTarget()).toBe(input);
  });

  it('目标已被移除（SPA 重渲染）时返回 null，交由调用方回落到常规字段选取', () => {
    const input = mountInput();
    rememberContextMenuTarget(input);
    input.remove();

    expect(resolveContextMenuInputTarget()).toBeNull();
  });

  it('目标不可见（站点隐藏字段）时返回 null', () => {
    const input = mountInput();
    rememberContextMenuTarget(input);
    layout.setStyles(input, { display: 'none' });

    expect(resolveContextMenuInputTarget()).toBeNull();
  });

  it('目标为只读 / 禁用时返回 null（与填充路径同一套可编辑判定）', () => {
    const readOnlyInput = mountInput();
    rememberContextMenuTarget(readOnlyInput);
    readOnlyInput.readOnly = true;
    expect(resolveContextMenuInputTarget()).toBeNull();

    const disabledInput = mountInput();
    rememberContextMenuTarget(disabledInput);
    disabledInput.disabled = true;
    expect(resolveContextMenuInputTarget()).toBeNull();
  });

  it('目标是 textarea 时返回 null（内联面板只锚定 input）', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    layout.setRect(textarea, INPUT_RECT);
    rememberContextMenuTarget(textarea);

    expect(resolveContextMenuInputTarget()).toBeNull();
  });

  it('未记录右键目标（右键页面空白处）时返回 null', () => {
    mountInput();
    rememberContextMenuTarget(null);

    expect(resolveContextMenuInputTarget()).toBeNull();
  });
});
