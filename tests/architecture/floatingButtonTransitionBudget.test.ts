/**
 * 悬浮按钮过渡预算守卫（B2：只动可证明行为等价的部分）
 *
 * 现状钉住的事实：拖拽逐帧写 transform、隐藏走 transform+opacity、
 * 换边/吸附是瞬时落位（left/right 只在 6px ↔ auto 之间切换，auto 不可插值，
 * 基态过渡里列 left/right 永远不会播放）。B2 撤掉了这两条死过渡并把
 * button-group 的 all 收窄为 gap；本守卫防止后续改动把布局轴或 transform
 * 重新塞回基态过渡——那会让拖拽滞后于鼠标、或把瞬时落位播成一段位移动画。
 *
 * 各条守住的漂移方向：
 * 1. 基态过渡不得含 left/right/top/transform（拖拽跟手与瞬时落位都靠「不过渡」）；
 * 2. hidden 态必须保留 transform+opacity 滑出与延迟 visibility（否则隐藏变硬切）；
 * 3. 组自身只过渡 gap，不得退回 all（all 会把继承/主题属性变化也播成动画）；
 * 4. 折叠硬切 `transition: none !important` 必须保留（拖拽起手势其他按钮立即让位）；
 * 5. 拖拽位移必须写 transform 而不是 left/top（布局轴逐帧写入会触发整页重排）。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const STYLES = 'entrypoints/content/floatingButtons/styles.ts';
const ANIMATION = 'entrypoints/content/floatingButtons/AnimationController.ts';

/** 取选择器起始到第一个行首 `}` 的规则块 */
const ruleBlock = (source: string, selector: string): string => {
  const start = source.indexOf(selector);
  expect(start, `锚点失配：${selector}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `规则块未闭合：${selector}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

/** 取规则块里某条声明的值（到分号为止，不带注释） */
const declaration = (block: string, prop: string): string => {
  const match = block.match(new RegExp(`${prop}:\\s*([^;]+);`));
  expect(match, `声明缺失：${prop}`).not.toBeNull();
  return match?.[1] ?? '';
};

describe('悬浮按钮过渡预算', () => {
  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    const styles = readSource(STYLES);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles).toContain('.floating-container {');
    expect(styles).toContain('.button-group {');
    expect(readSource(ANIMATION)).toContain('updateDragPosition(');
  });

  it('容器基态过渡只枚举 opacity/visibility：布局轴与 transform 都不得进入', () => {
    const block = ruleBlock(readSource(STYLES), '.floating-container {');
    const transition = declaration(block, 'transition');
    expect(transition).toContain('opacity 0.3s ease');
    expect(transition).toContain('visibility 0s linear 0s');
    // 拖拽逐帧写 transform、吸附直接落 top：进了基态过渡就会滞后于鼠标
    expect(transition).not.toMatch(/\b(left|right|top|transform)\b/);
  });

  it('hidden 态保留滑出三件套：transform + opacity + 延迟 visibility', () => {
    const block = ruleBlock(readSource(STYLES), '.floating-container.hidden {');
    const transition = declaration(block, 'transition');
    expect(transition).toContain('opacity 0.3s ease');
    expect(transition).toContain('visibility 0s linear 0.3s');
    expect(transition).toContain('transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('按钮组只过渡 gap：data-state 三档里组自身没有别的属性变化', () => {
    const block = ruleBlock(readSource(STYLES), '.button-group {');
    const transition = declaration(block, 'transition');
    expect(transition).toBe('gap 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('折叠硬切保留：拖拽起手时其他按钮立即让位，不等过渡', () => {
    const block = ruleBlock(readSource(STYLES), '.button-group[data-state="collapsed"] .btn:not(.btn-options) {');
    expect(declaration(block, 'transition')).toBe('none !important');
  });

  it('拖拽位移写 transform 而非布局轴，复位回到垂直居中基态', () => {
    const source = readSource(ANIMATION);
    const update = source.slice(source.indexOf('updateDragPosition('), source.indexOf('updateDragPosition(') + 500);
    expect(update).toContain('requestAnimationFrame');
    expect(update).toContain('style.transform');
    expect(update).not.toMatch(/style\.(left|top)\s*=/);

    const reset = source.slice(source.indexOf('resetDragPosition()'), source.indexOf('resetDragPosition()') + 400);
    expect(reset).toContain("style.transform = 'translateY(-50%)'");
  });
});
