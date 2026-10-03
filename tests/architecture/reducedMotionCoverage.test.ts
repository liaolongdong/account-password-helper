/**
 * 关键帧动画与悬浮位移都必须配一份减弱动效兜底
 *
 * `@keyframes` 是纯 CSS，媒体查询对它有效（不像 JS 里的 `behavior: 'smooth'` 需要另一条
 * 守卫，见 `reducedMotionWiring.test.ts`）。但"有效"的前提是有人写了那条 `@media`：
 * 新增一个入场 / 滑出 / 抖动动画而忘了减弱档，系统设置里开了「减弱动态效果」的用户依然会
 * 被 20px 入场和 800px 滑出晃一下，而这件事不报错、不红、也不会有人提。
 *
 * 关键帧那一条判据落在文件粒度：声明了 `@keyframes` 的 `.vue` 必须同时出现
 * `prefers-reduced-motion`。只要求"有这条媒体查询"，具体关哪条动画由作者判断——1px 的
 * 悬浮上浮本就不属于该缓解的运动量，把每一条 `transition` 都关掉反而会让悬浮反馈消失。
 *
 * 第二条判据补的是同一条规则漏掉的那半个运动来源：**没有 `@keyframes` 的悬浮位移**。
 * 侧边栏列表行、空态卡片这类「一行 hover 就 translateX 一次」的效果全靠 `transition`，
 * 用户扫过 100 行就是 100 次往复位移，而文件里一个 `@keyframes` 都没有，于是旧判据对它们
 * 完全沉默（评审缺陷 M-1：`PasswordListItem.vue`、`SidepanelAuthView.vue`、`EmptyGuide.vue`
 * 三处各有 hover 位移而无减弱档，且长期无人发现）。判据刻意只认 `transform` 里的
 * translate/scale/rotate——只换颜色与阴影的 hover 不属于该缓解的运动量，不在此列。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：`<style>` 块里的组件样式，以及内容脚本注入 UI 的影子样式（内联模板字符串） */
const VUE_DIRS = ['components', 'entrypoints'];
const SHADOW_STYLE_DIRS = ['entrypoints/content'];

/** `@keyframes 名字` 声明 */
const KEYFRAMES_RE = /@keyframes\s+([a-zA-Z][\w-]*)/;

/** 减弱动效媒体查询（CSS 的 `@media` 与 JS 的 `matchMedia` 两种写法都算） */
const REDUCED_MOTION_RE = /prefers-reduced-motion/;

/**
 * `selector { declarations }` 规则对
 *
 * 嵌套写法（`@media { .x:hover { … } }`）里外层的花括号会让本正则跳过外层，
 * 直接从内层规则起匹配——所以减弱档内的那几条覆盖规则同样会被取到，
 * 而它们所在文件必然已带 `prefers-reduced-motion`，不会造成误报。
 */
const RULE_RE = /([^{}]+)\{([^{}]+)\}/g;

/**
 * 位移/缩放类 transform（`none` 与纯颜色变化都不在此列）
 */
const MOVE_RE = /transform\s*:\s*[^;]*(translate|scale|rotate)/;

/**
 * 例外登记：按**轴**分开，一条例外只豁免它登记的那一轴
 *
 * 曾经两轴共用一张表，于是「`styles.ts` 的 spin 因为只有关键帧被登记」顺带把它的
 * `.btn:hover { transform: scale(1.08) }` 也免了——登记理由说的是动画，
 * 生效范围却悄悄扩到悬浮位移，这正是本守卫要抓的那半个运动来源。
 */
interface MotionExceptionReasons {
  /** 该文件的 `@keyframes` 有意不配减弱档 */
  keyframes?: string;
  /** 该文件的悬浮位移有意不配减弱档 */
  hover?: string;
}

/**
 * 有 `@keyframes` 但有意不配减弱档的位置
 *
 * 登记即说明理由，不登记则守卫变红——避免"忘了写"和"故意不写"混成同一种状态。
 */
const MOTION_EXCEPTIONS: Record<string, MotionExceptionReasons> = {
  // 那枚 `spin` 是悬浮按钮 loading 态唯一的反馈：`AnimationController` 只加 `loading` 类，
  // 没有别的文字或图标变化。关掉动画等于把「正在处理」这个状态整个藏起来，
  // 比留着 0.8s 旋转更糟；要减弱它得先补一个非运动的态提示，属独立改动。
  // 只登记 keyframes 一轴：同文件的悬浮缩放已按减弱档补齐，不该被这条理由顺带免掉。
  'entrypoints/content/floatingButtons/styles.ts': {
    keyframes: 'spin 是悬浮按钮唯一的加载反馈，取消动画会丢状态提示',
  },
};

/** 悬浮位移轴的例外（当前为空：确有位移且刻意不兜底时才登记，并写明理由） */
const HOVER_EXCEPTIONS: Record<string, MotionExceptionReasons> = {};

/** 该文件是否「声明了关键帧却缺减弱档」 */
function missingReducedMotionFallback(source: string): boolean {
  return KEYFRAMES_RE.test(source) && !REDUCED_MOTION_RE.test(source);
}

/**
 * 把模板字符串里的 `${…}` 插值换成占位符
 *
 * 内容脚本的影子样式是 JS 模板字符串，`${THEME_COLOR}` 自带一对花括号；
 * `RULE_RE` 的 `[^{}]` 会在它面前把整条声明块切开，于是**带插值的 hover 规则一条都取不到**
 * ——注入 UI（恰好是最需要减弱档的那一族样式）会整族静默逃逸。拍平成占位符后再匹配。
 */
function flattenInterpolation(css: string): string {
  return css.replace(/\$\{[^{}]*\}/g, 'INTERP');
}

/**
 * 取样式文本：`.vue` 只取 `<style>` 块（脚本里的字符串不参与 CSS 判定），其余整文件
 *
 * 提取集与判定集必须走这同一个函数：`hovering` 用它建，违规检查也必须用它，
 * 否则「按 `<style>` 认定有位移、按整个文件判断有没有减弱档」会让脚本里的
 * `matchMedia('prefers-reduced-motion')` 顺带赦免一条没兜底的样式规则。
 * 插值拍平由 `hoverMovementSelectors` 负责，这里不重复处理。
 */
function styleSource(file: string, source: string): string {
  if (!file.endsWith('.vue')) return source;
  return (source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n');
}

/** 取出文件里「hover 时产生位移或缩放」的规则选择器 */
function hoverMovementSelectors(css: string): string[] {
  return [...flattenInterpolation(css).matchAll(RULE_RE)]
    .filter(rule => rule[1].includes(':hover') && MOVE_RE.test(rule[2]))
    .map(rule => rule[1].trim().replace(/\s+/g, ' '));
}

/** 该文件是否「有悬浮位移却缺减弱档」 */
function missingHoverFallback(source: string): boolean {
  return hoverMovementSelectors(source).length > 0 && !REDUCED_MOTION_RE.test(source);
}

/** 组件样式 + 注入影子样式的全量扫描集 */
const scannedFiles = [
  ...VUE_DIRS.flatMap(dir => listSourceFiles(dir, ['.vue'])),
  ...SHADOW_STYLE_DIRS.flatMap(dir => listSourceFiles(dir, ['.ts'])),
];

describe('关键帧与减弱动效兜底配对', () => {
  const animated = scannedFiles.filter(file => KEYFRAMES_RE.test(readSource(file)));

  it('扫描到足够规模的组件与注入样式（判据不是空跑）', () => {
    expect(scannedFiles.length).toBeGreaterThan(60);
    expect(animated.length).toBeGreaterThanOrEqual(8);
  });

  it('判据有牙：只写动画会被判缺兜底，两者齐备与只有兜底都不误报', () => {
    expect(missingReducedMotionFallback('.a { animation: row-in 1s; } @keyframes row-in {}')).toBe(true);
    expect(
      missingReducedMotionFallback(
        '@keyframes row-in {}\n@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
      ),
    ).toBe(false);
    expect(missingReducedMotionFallback('.a { transition: all 0.2s; } /* 无关键帧 */')).toBe(false);
  });

  it('白名单里的例外仍在动画该在的文件上（挪了地方就要重新说明）', () => {
    for (const [file, axes] of Object.entries(MOTION_EXCEPTIONS)) {
      for (const [axis, reason] of Object.entries(axes)) {
        expect(reason?.trim(), `${file} 的 ${axis} 轴例外没写理由`).not.toBe('');
      }
      if (axes.keyframes) {
        expect(KEYFRAMES_RE.test(readSource(file)), `${file} 已不再声明 @keyframes，该轴例外该删`).toBe(true);
      }
      if (axes.hover) {
        const found = hoverMovementSelectors(styleSource(file, readSource(file))).length > 0;
        expect(found, `${file} 已不再声明 hover 位移，该轴例外该删`).toBe(true);
      }
    }
  });

  it('每个声明关键帧的文件都带减弱动效兜底（或已登记 keyframes 轴例外）', () => {
    const violations = animated.filter(
      file => !MOTION_EXCEPTIONS[file]?.keyframes && missingReducedMotionFallback(readSource(file)),
    );
    expect(violations, `以下文件有 @keyframes 却没有 prefers-reduced-motion：\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('悬浮位移与减弱动效兜底配对', () => {
  const hovering = scannedFiles.filter(file => hoverMovementSelectors(styleSource(file, readSource(file))).length > 0);

  it('扫描到足够规模的悬浮位移规则（判据不是空跑）', () => {
    expect(hovering.length).toBeGreaterThanOrEqual(12);
    // 这几处是评审 M-1 点名补上的，任一处退回「只有 hover 位移、没有减弱档」都会红；
    // `styles.ts` 靠插值拍平才被抓到，它同时是那条拍平逻辑的载荷
    for (const file of [
      'components/sidepanel/PasswordListItem.vue',
      'components/sidepanel/SidepanelAuthView.vue',
      'components/options/EmptyGuide.vue',
      'entrypoints/content/floatingButtons/styles.ts',
    ]) {
      expect(hovering, `${file} 已不再声明 hover 位移，本条点名该删`).toContain(file);
    }
  });

  it('判据有牙：只有 hover 位移判缺兜底，配了减弱档与只换颜色都不误报', () => {
    expect(missingHoverFallback('.row:hover { transform: translateX(2px); }')).toBe(true);
    expect(
      missingHoverFallback(
        '.row:hover { transform: scale(1.02); }\n@media (prefers-reduced-motion: reduce) { .row:hover { transform: none; } }',
      ),
    ).toBe(false);
    expect(missingHoverFallback('.row:hover { background: #f5f7fa; box-shadow: 0 2px 8px #0001; }')).toBe(false);
    // 以「保留定位位移、只撤放大」形式写成的 hover 规则同样算运动源，判据不认"这是定位不是动画"
    expect(missingHoverFallback('.thumb:hover { transform: translate(-50%, -50%) scale(1.1); }')).toBe(true);
    // 注入样式是 JS 模板字符串：`${VAR}` 自带花括号，不拍平就一条规则也取不到（整族影子样式静默逃逸）
    expect(missingHoverFallback('.btn:hover { color: ${THEME_COLOR}; transform: scale(1.08); }')).toBe(true);
    // 提取集与判定集同源：`.vue` 里那句 JS `matchMedia('prefers-reduced-motion')` 不能赦免 `<style>` 内
    // 没有兜底的位移规则——否则守卫只认"这个文件提过减弱动效"，而不认"这条规则真的被关掉了"。
    const vueScriptOnlyFallback =
      '<script>const mq = matchMedia("(prefers-reduced-motion)");</script>\n' +
      '<style scoped>.a:hover { transform: translateX(2px); }</style>';
    //  whole-file 口径下这条文件是绿的（旧写法的漏洞），按 `<style>` 口径才判缺兜底
    expect(missingHoverFallback(vueScriptOnlyFallback)).toBe(false);
    expect(missingHoverFallback(styleSource('x.vue', vueScriptOnlyFallback))).toBe(true);
    // 反面对照：兜底写进 `<style>` 才算数
    expect(
      missingHoverFallback(
        styleSource(
          'x.vue',
          '<script>const mq = matchMedia("(prefers-reduced-motion)");</script>\n' +
            '<style scoped>.a:hover { transform: translateX(2px); }\n' +
            '@media (prefers-reduced-motion: reduce) { .a:hover { transform: none; } }</style>',
        ),
      ),
    ).toBe(false);
  });

  it('每个有悬浮位移的文件都带减弱动效兜底（或已登记 hover 轴例外）', () => {
    const violations = hovering.filter(
      file => !HOVER_EXCEPTIONS[file]?.hover && missingHoverFallback(styleSource(file, readSource(file))),
    );
    expect(
      violations,
      `以下文件 hover 会产生位移/缩放却没有 prefers-reduced-motion：\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
