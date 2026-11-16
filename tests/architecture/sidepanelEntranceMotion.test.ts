/**
 * 侧边栏首屏入场动画与换肤色彩过渡的接线守卫
 *
 * 这两件事都属于「坏了不报错」的动效：入场靠 finishOpen 挂 `is-opened` 类 + scoped CSS 关键帧，
 * 任何一环断掉（类没挂、选择器写错、令牌名拼错、减弱档被后来的同选择器规则压过）都只是
 * 「动画永远不播」，typecheck / lint / build 全绿。换肤过渡同理：六个静态主题面补了枚举
 * `transition` 后，若有人改回 `all` 或字面时长，UA 换装动画与令牌契约都会静默失守。
 *
 * 三组判据：
 * 1. 接线：模板根节点挂 ref、finishOpen 里挂类**恰好一次**，且位于 LIST_RENDERED 埋点之后、
 *    空闲预取之前——入场不得反过来延迟秒开测量链（SLA 约束，见 agents.md「侧边栏秒开」）；
 * 2. CSS：动画取 slow 档令牌、关键帧只动 transform（不做 opacity，避免与骨架屏交叉淡出叠成
 *    双层淡入）、减弱档撤销排在基规则之后（媒体查询不加特异性，源序后者胜）；
 * 3. 换肤：六个静态面的 transition 逐属性枚举、全部取 mid 档令牌，禁 `all` 与字面时长。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const APP = 'entrypoints/sidepanel/App.vue';
const AUTH_VIEW = 'components/sidepanel/SidepanelAuthView.vue';

/** 换肤过渡的六个静态面：选择器 → 必须枚举过渡的属性（有 hover 态的面刻意不在表内） */
const CROSSFADE_SURFACES: { file: string; selector: string; props: string[] }[] = [
  { file: APP, selector: '.auth-icon-circle', props: ['background-color'] },
  { file: APP, selector: '.auth-icon', props: ['color'] },
  { file: AUTH_VIEW, selector: '.scope-bar', props: ['color', 'background-color'] },
  { file: AUTH_VIEW, selector: '.empty-icon-circle', props: ['background-color'] },
  { file: AUTH_VIEW, selector: '.empty-icon', props: ['color'] },
  { file: AUTH_VIEW, selector: '.undecryptable-notice', props: ['background-color', 'border-color'] },
];

/** 取 `.vue` 的全部 `<style>` 块文本 */
function styleBlocks(source: string): string[] {
  return source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? [];
}

/** 取一条规则的声明块：选择器起点到第一个行首 `}`（只用于无嵌套的平铺规则） */
function ruleBlock(css: string, selector: string): string | null {
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const end = css.indexOf('\n}', start);
  return end < 0 ? null : css.slice(start, end);
}

/** 从声明块里取某个属性的值 */
function declaration(block: string, prop: string): string | undefined {
  return new RegExp(`${prop}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

/** 手工配平花括号取出 `@keyframes 名字` 的块体（from/to 自带花括号，平铺正则会切错） */
function keyframesBody(css: string, name: string): string | null {
  const head = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(css);
  if (!head) return null;
  let depth = 1;
  let i = head.index + head[0].length;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(head.index + head[0].length, i - 1);
}

/** 减弱档是否真的撤销了入场动画：存在含该选择器 + `animation: none` 的媒体块，且排在基规则之后 */
function reducedMotionCancelsEntrance(css: string): boolean {
  const base = css.indexOf('.sidepanel-container.is-opened');
  if (base < 0) return false;
  const headRe = /@media[^{}]*prefers-reduced-motion[^{}]*\{/g;
  let head: RegExpExecArray | null;
  while ((head = headRe.exec(css))) {
    if (head.index <= base) continue;
    let depth = 1;
    let i = head.index + head[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    const block = css.slice(head.index + head[0].length, i - 1);
    if (block.includes('.sidepanel-container.is-opened') && /animation:\s*none/.test(block)) return true;
  }
  return false;
}

describe('入场动画的接线（秒开链路零占用）', () => {
  const source = readSource(APP);

  it('模板根节点挂 ref，脚本声明同名容器引用（扫描面自证非空）', () => {
    expect(source).toMatch(/ref="containerEl"\s*\n\s*class="sidepanel-container"/);
    expect(source).toContain('const containerEl = ref<HTMLElement | null>(null)');
  });

  it('挂类恰好一次，且位于 LIST_RENDERED 埋点之后、空闲预取之前', () => {
    const adds = source.match(/classList\.add\('is-opened'\)/g) ?? [];
    expect(adds, 'is-opened 挂类点应恰好一处（多处意味着会重播或散落触发）').toHaveLength(1);
    const addAt = source.indexOf("classList.add('is-opened')");
    const markAt = source.indexOf('markPerf(SP_PERF_MARKS.LIST_RENDERED)');
    const idleAt = source.indexOf('requestIdleCallback(preloadIdleModules)');
    expect(markAt, 'LIST_RENDERED 埋点没找到，判据失去锚点').toBeGreaterThan(-1);
    expect(addAt, '入场挂类不得先于 LIST_RENDERED 埋点（会污染秒开测量）').toBeGreaterThan(markAt);
    expect(addAt, '入场挂类应在 finishOpen 主流程内、空闲预取之前').toBeLessThan(idleAt);
    // 直接语句而非包在计时器/rAF 里：包一层就意味着入场被推迟，且引入新的清理义务
    expect(source).toMatch(/^\s*containerEl\.value\?\.classList\.add\('is-opened'\);$/m);
  });
});

describe('入场动画的 CSS 形状', () => {
  const css = styleBlocks(readSource(APP)).find(block => block.includes('.sidepanel-container.is-opened')) ?? '';

  it('动画规则存在且取 slow 档令牌（不是字面时长，也不带 fill-mode）', () => {
    const block = ruleBlock(css, '.sidepanel-container.is-opened {');
    expect(block, '入场规则不在任何 <style> 块里').not.toBeNull();
    expect(declaration(block!, 'animation')).toBe('sp-settle var(--aph-duration-slow) ease-out');
  });

  it('关键帧只动 transform：6px 上浮落定，不做 opacity（避免与骨架屏双层淡入）', () => {
    const body = keyframesBody(css, 'sp-settle');
    expect(body, '@keyframes sp-settle 缺失').not.toBeNull();
    expect(body).toContain('transform: translateY(6px)');
    expect(body).toContain('transform: translateY(0)');
    const props = [...body!.matchAll(/^\s*([a-z-]+)\s*:/gm)].map(m => m[1]);
    expect(props.length, '关键帧里应有声明（空块 = 动画不播）').toBeGreaterThan(0);
    expect([...new Set(props)], '关键帧只允许 transform，混入 opacity/位移属性会改变淡入与命中区语义').toEqual([
      'transform',
    ]);
  });

  it('减弱档撤销存在且排在基规则之后（源序后者胜，写在前面的撤销是死规则）', () => {
    expect(reducedMotionCancelsEntrance(css)).toBe(true);
  });
});

describe('换肤色彩过渡的六个静态面', () => {
  it('每个面都按属性枚举、取 mid 档令牌，禁 all 与字面时长', () => {
    const problems: string[] = [];
    for (const { file, selector, props } of CROSSFADE_SURFACES) {
      const css = styleBlocks(readSource(file)).join('\n');
      const block = ruleBlock(css, `${selector} {`);
      if (!block) {
        problems.push(`${file} 找不到 ${selector} 规则块`);
        continue;
      }
      const transition = declaration(block, 'transition');
      if (!transition) {
        problems.push(`${file} ${selector} 没有 transition（换肤瞬时跳色）`);
        continue;
      }
      if (/\ball\b/.test(transition)) problems.push(`${file} ${selector} 用了 all（UA 换装会被播成动画）`);
      if (/\d+m?s/.test(transition)) problems.push(`${file} ${selector} 用了字面时长（必须取令牌）`);
      for (const prop of props) {
        if (!transition.includes(`${prop} var(--aph-duration-mid) ease`)) {
          problems.push(`${file} ${selector} 缺 ${prop} 的 mid 档过渡`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

describe('判据有牙', () => {
  it('ruleBlock / declaration：取不到规则报 null，属性值精确匹配', () => {
    const css = '.a {\n  color: red;\n}\n.b {\n  animation: x 0.3s;\n}';
    expect(ruleBlock(css, '.a {')).toContain('color: red');
    expect(ruleBlock(css, '.missing {')).toBeNull();
    expect(declaration(ruleBlock(css, '.b {')!, 'animation')).toBe('x 0.3s');
  });

  it('keyframesBody：配平嵌套花括号，混入 opacity 会被形状判据抓到', () => {
    const body = keyframesBody(
      '@keyframes x {\n  from {\n    transform: translateY(6px);\n    opacity: 0;\n  }\n}',
      'x',
    );
    expect(body).toContain('opacity: 0');
    const props = [...body!.matchAll(/^\s*([a-z-]+)\s*:/gm)].map(m => m[1]);
    expect([...new Set(props)]).not.toEqual(['transform']);
    expect(keyframesBody('.a {}', 'x')).toBeNull();
  });

  it('reducedMotionCancelsEntrance：撤销在前是死规则，撤销在后才算数，缺撤销判 false', () => {
    const base = '.sidepanel-container.is-opened {\n  animation: sp-settle 0.3s;\n}';
    const cancel =
      '@media (prefers-reduced-motion: reduce) {\n  .sidepanel-container.is-opened {\n    animation: none;\n  }\n}';
    expect(reducedMotionCancelsEntrance(`${base}\n${cancel}`)).toBe(true);
    expect(reducedMotionCancelsEntrance(`${cancel}\n${base}`)).toBe(false);
    expect(reducedMotionCancelsEntrance(base)).toBe(false);
    // 只撤销别的类不算撤销入场
    expect(
      reducedMotionCancelsEntrance(
        `${base}\n@media (prefers-reduced-motion: reduce) {\n  .other {\n    animation: none;\n  }\n}`,
      ),
    ).toBe(false);
  });
});
