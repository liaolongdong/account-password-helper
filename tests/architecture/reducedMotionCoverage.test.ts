/**
 * 关键帧动画与交互态位移都必须配一份减弱动效兜底
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
 * 第二条判据补的是同一条规则漏掉的那半个运动来源：**没有 `@keyframes` 的交互态位移**。
 * 侧边栏列表行、空态卡片这类「一行 hover 就 translateX 一次」的效果全靠 `transition`，
 * 用户扫过 100 行就是 100 次往复位移，而文件里一个 `@keyframes` 都没有，于是旧判据对它们
 * 完全沉默（评审缺陷 M-1：`PasswordListItem.vue`、`SidepanelAuthView.vue`、`EmptyGuide.vue`
 * 三处各有 hover 位移而无减弱档，且长期无人发现）。判据刻意只认 `transform` 里的
 * translate/scale/rotate——只换颜色与阴影的 hover 不属于该缓解的运动量，不在此列。
 *
 * 这一轮把第二条判据再放宽两处，两处都是「守卫看着像全覆盖、实际有盲区」：
 * - **`:active` 与 `:hover` 同族**：按压缩放（`scale(0.9)` 之类）和悬浮位移是同一个运动来源，
 *   而旧选择器只认 `:hover`。侧边栏头部与 popup 的卡片一共 5 处按压缩放，整族静默逃逸。
 * - **第三处样式落点 `entrypoints/options/styles.css`**：扫描集此前只有 `.vue` 的 `<style>`
 *   和 `entrypoints/content` 下 `.ts` 的影子样式模板字符串，而这个被 `<style scoped>` 以
 *   `@import` 吸收的全局覆盖文件不在任何一列里，`:deep(.el-button:hover) { translateY(-1px) }`
 *   从来没进过判定。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：`<style>` 块里的组件样式、被 `@import` 吸收的裸样式表，以及内容脚本注入 UI 的影子样式 */
const STYLE_DIRS = ['components', 'entrypoints'];
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
 * 交互态伪类（悬浮与按压是同一个运动来源，只认前者会漏掉整族按压缩放）
 */
const INTERACTION_PSEUDO_RE = /:(?:hover|active)/;

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
  /** 该文件的交互态位移有意不配减弱档 */
  interaction?: string;
}

/**
 * 有意不配减弱档的位置（两轴各一张表，登记即说明理由）
 *
 * 不登记则守卫变红，避免「忘了写」和「故意不写」混成同一种状态；登记还必须是
 * **仍在赦免违规**的（判据见 `exceptionProblems`）——文件后来补上了减弱档，这条登记
 * 就该删掉，否则它会悄悄赦免掉下一次退化。
 *
 * keyframes 轴当前为空。`floatingButtons/styles.ts` 曾登记在该轴上，但 M-1 那轮为交互轴
 * 补的减弱档已让整文件满足这条**文件级**判据，登记不再赦免任何违规；「`spin` 有意不减弱」
 * 这件事改由该文件减弱档的注释承载。
 */
const MOTION_EXCEPTIONS: Record<string, MotionExceptionReasons> = {};

/**
 * 交互态位移轴的例外
 *
 * 这两处的共同点：位移量都在 1px / 5% 以内，属于本守卫开头写的「不属于该缓解的运动量」；
 * 而更实际的一条是——`.add-site-plus:active`、`.session-pill:active` 除了这个缩放**没有别的
 * 按压反馈**，把 `transform` 关掉等于让减弱档用户按下去什么都看不见，那是用一个用不到的
 * 无障碍开关换来的体验倒退。真出现大位移（入场、滑出、上浮超过一个字符高度）时，
 * 该做的仍然是补减弱档，而不是往这张表里加一行。
 *
 * `entrypoints/options/styles.css` 曾登记在本表（全局按钮 hover 上浮 1px）。备份轻提醒给这个
 * 文件补上减弱档时顺带把那两条上浮也关了：文件既然开始声明「尊重系统设置」，就不该再留
 * 不受它管的位移；而按钮在减弱档下仍有提亮与投影两条反馈，不落在上面那条豁免理由里。
 */
const INTERACTION_EXCEPTIONS: Record<string, MotionExceptionReasons> = {
  'entrypoints/popup/App.vue': {
    interaction: '卡片按压缩放 ≤1%，且减弱档下仍保留背景与投影两条反馈，撤掉缩放不换来任何收益',
  },
  'components/sidepanel/SidepanelHeader.vue': {
    interaction: '圆钮按压 ≤5% 缩放；其中 .add-site-plus / .session-pill 的缩放是唯一按压反馈',
  },
};

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
  return blankComments(css.replace(/\$\{[^{}]*\}/g, 'INTERP'));
}

/**
 * 把 CSS 注释抹成等长空格
 *
 * `RULE_RE` 的选择器捕获组是 `[^{}]+`，注释里没有花括号，于是紧贴在规则前面的那段说明会被
 * 当成选择器的一部分收进来（`entrypoints/options/styles.css` 的减弱档覆写前面正有一段注释），
 * 分组选择器拆开后就再也对不上基规则。保留长度是为了让各条规则的 `index` 仍可跨函数比较——
 * 层叠顺序判据全靠这个偏移。
 */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
}

/**
 * 取样式文本：`.vue` 只取 `<style>` 块（脚本里的字符串不参与 CSS 判定），其余整文件
 *
 * 提取集与判定集必须走这同一个函数：`interacting` 用它建，违规检查也必须用它，
 * 否则「按 `<style>` 认定有位移、按整个文件判断有没有减弱档」会让脚本里的
 * `matchMedia('prefers-reduced-motion')` 顺带赦免一条没兜底的样式规则。
 * 插值拍平由 `interactionMovementSelectors` 负责，这里不重复处理。
 */
function styleSource(file: string, source: string): string {
  if (!file.endsWith('.vue')) return source;
  return (source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n');
}

/** 取出文件里「hover / active 时产生位移或缩放」的规则选择器 */
function interactionMovementSelectors(css: string): string[] {
  return [...flattenInterpolation(css).matchAll(RULE_RE)]
    .filter(rule => INTERACTION_PSEUDO_RE.test(rule[1]) && MOVE_RE.test(rule[2]))
    .map(rule => rule[1].trim().replace(/\s+/g, ' '));
}

/** 该文件是否「有交互态位移却缺减弱档」 */
function missingInteractionFallback(source: string): boolean {
  return interactionMovementSelectors(source).length > 0 && !REDUCED_MOTION_RE.test(source);
}

/**
 * 拆开选择器组（`a:hover, b:hover { … }`），只在圆括号深度 0 处按逗号切
 *
 * `:not(.is-link, .is-text)` 里就带逗号，机械 `split(',')` 会把一条选择器切成两截，
 * 于是减弱档里的分组撤销永远对不上任何一条基规则——正是 U1 那条死规则的藏身之处。
 */
function selectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim().replace(/\s+/g, ' '));
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim().replace(/\s+/g, ' '));
  return parts.filter(Boolean);
}

/** 取出交互态位移规则及其在（拍平后）文本中的偏移，供层叠顺序判定使用 */
function interactionMovementRules(css: string): { selector: string; start: number }[] {
  return [...flattenInterpolation(css).matchAll(RULE_RE)]
    .filter(rule => INTERACTION_PSEUDO_RE.test(rule[1]) && MOVE_RE.test(rule[2]))
    .flatMap(rule =>
      selectorList(rule[1]).map(selector => ({ selector, start: rule.index ?? 0 })),
    );
}

/**
 * 取出 `@media (prefers-reduced-motion)` 块的区间
 *
 * 手工配平花括号而不是再写一个 `[^{}]+` 正则：块里嵌的是规则本身，外层花括号会让
 * 逐规则正则以错位的方式切开它。
 */
function reducedMotionBlocks(css: string): { start: number; end: number; body: string }[] {
  const blocks: { start: number; end: number; body: string }[] = [];
  const headRe = /@media[^{}]*prefers-reduced-motion[^{}]*\{/g;
  let head: RegExpExecArray | null;
  while ((head = headRe.exec(css))) {
    let depth = 1;
    let i = head.index + head[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ start: head.index, end: i, body: css.slice(head.index + head[0].length, i - 1) });
  }
  return blocks;
}

/**
 * 减弱档里「撤销位移」的那几条，是否被**同选择器且排在它后面**的位移规则压过
 *
 * 这是本守卫原先看不见的那一半：文件级的 `REDUCED_MOTION_RE` 只证明「写了减弱档」，
 * 而媒体查询**不增加特异性**——同一条选择器在文件后面又出现一次，后者的值就赢了。
 * 结果是作者与守卫都以为减弱档生效了，真机减弱档下按钮照样上浮。
 *
 * @returns 被压过的选择器列表（空数组 = 该文件的撤销声明都真的有效）
 */
function deadReducedMotionOverrides(css: string): string[] {
  const flat = flattenInterpolation(css);
  const movements = interactionMovementRules(flat);
  const dead: string[] = [];
  for (const block of reducedMotionBlocks(flat)) {
    for (const rule of [...block.body.matchAll(RULE_RE)]) {
      if (!/transform\s*:\s*none/.test(rule[2])) continue;
      for (const selector of selectorList(rule[1])) {
        // `>=` 而不是 `>`：块闭合后的下一个字符就是后一条规则的起点，两者可以相邻相等
        if (movements.some(move => move.selector === selector && move.start >= block.end)) dead.push(selector);
      }
    }
  }
  return dead;
}

/**
 * 一条例外登记是否仍然成立：写了理由、且它豁免的那一轴在当前文件里真的有违规
 *
 * 返回问题清单而不是直接断言，是为了让「判据有牙」这条能拿**人造条目**自证：
 * 两张表都可能长期为空，只遍历真实条目的话这条判据会静默空跑并恒绿。
 */
function exceptionProblems(file: string, axes: MotionExceptionReasons): string[] {
  const source = readSource(file);
  const problems: string[] = [];
  // 按键是否存在判定，不按值真假：`{ interaction: '' }` 是「登记了这一轴但没写理由」，
  // 若用真值判断会被上面那条"没登记任何轴"顺手吃掉，理由缺失就永远报不出正确的名字
  const registered = (axis: keyof MotionExceptionReasons) => Object.prototype.hasOwnProperty.call(axes, axis);
  if (!registered('keyframes') && !registered('interaction')) problems.push(`${file} 的例外没登记任何轴`);
  if (registered('keyframes')) {
    if (!axes.keyframes?.trim()) problems.push(`${file} 的 keyframes 轴例外没写理由`);
    if (!missingReducedMotionFallback(source)) {
      problems.push(`${file} 已不再缺关键帧兜底，该轴例外该删`);
    }
  }
  if (registered('interaction')) {
    if (!axes.interaction?.trim()) problems.push(`${file} 的 interaction 轴例外没写理由`);
    if (!missingInteractionFallback(styleSource(file, source))) {
      problems.push(`${file} 已不再缺交互态位移兜底，该轴例外该删`);
    }
  }
  return problems;
}

/** 组件样式 + 裸样式表 + 注入影子样式的全量扫描集 */
const scannedFiles = [
  ...STYLE_DIRS.flatMap(dir => listSourceFiles(dir, ['.vue', '.css'])),
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

  /**
   * 两张表都要校验。此前只遍历 `MOTION_EXCEPTIONS`，于是 `INTERACTION_EXCEPTIONS` 里
   * 「空理由 / 指向早已没有位移的文件」的豁免不会被任何断言拦住，而 violations
   * （下方那条 filter）照样按它赦免一个真实违规——登记门槛必须和它影响的判据一样严。
   */
  it('例外登记仍在赦免它登记的那一轴，且两轴同判（挪了地方就要重新说明）', () => {
    const problems: string[] = [];
    for (const table of [MOTION_EXCEPTIONS, INTERACTION_EXCEPTIONS]) {
      for (const [file, axes] of Object.entries(table)) {
        problems.push(...exceptionProblems(file, axes));
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);

    // 判据有牙（两张表都可能长期为空时，上面那段循环一次都不跑，只能靠人造条目证明它不是空壳）：
    expect(
      exceptionProblems('components/sidepanel/PasswordListItem.vue', { interaction: '  ' }).length,
      '空理由必须被判为问题',
    ).toBeGreaterThan(0);
    expect(
      exceptionProblems('components/sidepanel/PasswordListItem.vue', { interaction: '有位移但刻意不兜底' }).length,
      '减弱档已补齐的文件，其登记必须被判为「该删」',
    ).toBeGreaterThan(0);
    expect(
      exceptionProblems('utils/logger.ts', { interaction: '有位移但刻意不兜底' }).length,
      '根本没有该轴运动的文件必须被判为问题',
    ).toBeGreaterThan(0);
  });

  it('每个声明关键帧的文件都带减弱动效兜底（或已登记 keyframes 轴例外）', () => {
    const violations = animated.filter(
      file => !MOTION_EXCEPTIONS[file]?.keyframes && missingReducedMotionFallback(readSource(file)),
    );
    expect(violations, `以下文件有 @keyframes 却没有 prefers-reduced-motion：\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('交互态位移与减弱动效兜底配对', () => {
  const interacting = scannedFiles.filter(
    file => interactionMovementSelectors(styleSource(file, readSource(file))).length > 0,
  );

  it('扫描到足够规模的交互位移规则（判据不是空跑）', () => {
    expect(interacting.length).toBeGreaterThanOrEqual(12);
    // 这几处是评审 M-1 点名补上的，任一处退回「只有交互位移、没有减弱档」都会红；
    // `styles.ts` 靠插值拍平才被抓到，它同时是那条拍平逻辑的载荷
    for (const file of [
      'components/sidepanel/PasswordListItem.vue',
      'components/sidepanel/SidepanelAuthView.vue',
      'components/options/EmptyGuide.vue',
      'entrypoints/content/floatingButtons/styles.ts',
    ]) {
      expect(interacting, `${file} 已不再声明交互位移，本条点名该删`).toContain(file);
    }
  });

  it('扫描面覆盖第三处样式落点与 :active 轴（两处盲区各有一处真实命中）', () => {
    // `.css` 落点：此前 `.vue` 的 `<style>` 与影子模板字符串之外无人扫描
    expect(interacting, '裸 `.css` 里的 hover 位移没进扫描集').toContain('entrypoints/options/styles.css');
    // `:active` 落点：只有按压缩放、没有悬浮位移的文件，靠 `:active` 才进得来
    expect(interacting, ':active 缩放没被当成运动源').toContain('entrypoints/popup/App.vue');
  });

  it('判据有牙：只有 hover 位移判缺兜底，配了减弱档与只换颜色都不误报', () => {
    expect(missingInteractionFallback('.row:hover { transform: translateX(2px); }')).toBe(true);
    expect(
      missingInteractionFallback(
        '.row:hover { transform: scale(1.02); }\n@media (prefers-reduced-motion: reduce) { .row:hover { transform: none; } }',
      ),
    ).toBe(false);
    expect(missingInteractionFallback('.row:hover { background: #f5f7fa; box-shadow: 0 2px 8px #0001; }')).toBe(false);
    // 以「保留定位位移、只撤放大」形式写成的 hover 规则同样算运动源，判据不认"这是定位不是动画"
    expect(missingInteractionFallback('.thumb:hover { transform: translate(-50%, -50%) scale(1.1); }')).toBe(true);
    // 按压缩放与悬浮位移同判：只有 `:active` 的文件过去整族逃逸，这一条就是那处盲区的反证
    expect(missingInteractionFallback('.pill:active { transform: scale(0.95); }')).toBe(true);
    // `:focus-visible` 只画焦点环，不属于该缓解的运动量，不能因为「也是个伪类」就报红
    expect(missingInteractionFallback('.pill:focus-visible { outline: 2px solid #409eff; }')).toBe(false);
    // 注入样式是 JS 模板字符串：`${VAR}` 自带花括号，不拍平就一条规则也取不到（整族影子样式静默逃逸）
    expect(missingInteractionFallback('.btn:hover { color: ${THEME_COLOR}; transform: scale(1.08); }')).toBe(true);
    // 提取集与判定集同源：`.vue` 里那句 JS `matchMedia('prefers-reduced-motion')` 不能赦免 `<style>` 内
    // 没有兜底的位移规则——否则守卫只认"这个文件提过减弱动效"，而不认"这条规则真的被关掉了"。
    const vueScriptOnlyFallback =
      '<script>const mq = matchMedia("(prefers-reduced-motion)");</script>\n' +
      '<style scoped>.a:hover { transform: translateX(2px); }</style>';
    //  whole-file 口径下这条文件是绿的（旧写法的漏洞），按 `<style>` 口径才判缺兜底
    expect(missingInteractionFallback(vueScriptOnlyFallback)).toBe(false);
    expect(missingInteractionFallback(styleSource('x.vue', vueScriptOnlyFallback))).toBe(true);
    // 反面对照：兜底写进 `<style>` 才算数
    expect(
      missingInteractionFallback(
        styleSource(
          'x.vue',
          '<script>const mq = matchMedia("(prefers-reduced-motion)");</script>\n' +
            '<style scoped>.a:hover { transform: translateX(2px); }\n' +
            '@media (prefers-reduced-motion: reduce) { .a:hover { transform: none; } }</style>',
        ),
      ),
    ).toBe(false);
  });

  it('每个有交互位移的文件都带减弱动效兜底（或已登记 interaction 轴例外）', () => {
    const violations = interacting.filter(
      file =>
        !INTERACTION_EXCEPTIONS[file]?.interaction && missingInteractionFallback(styleSource(file, readSource(file))),
    );
    expect(
      violations,
      `以下文件 hover/active 会产生位移或缩放却没有 prefers-reduced-motion：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * 层叠顺序判据（评审 2026-11-02 U1）
   *
   * 上面那条只证明「写了减弱档」。`entrypoints/options/styles.css` 的备份轻提醒把
   * `transform: none` 写在文件前段，而要撤销的那两条按钮上浮写在同文件后段——媒体查询
   * 不增加特异性，同选择器源序后者胜，于是减弱档一条都没撤销，而守卫与作者都以为撤销了。
   * 登记表的 interaction 轴豁免也正是按「这条已生效」的前提删掉的，所以这一判据同时是
   * 那次删除的前提校验。
   */
  it('减弱档里的撤销声明不得被同选择器的后来者压过', () => {
    const offenders = scannedFiles.flatMap(file =>
      deadReducedMotionOverrides(styleSource(file, readSource(file))).map(selector => `${file} → ${selector}`),
    );
    expect(
      offenders,
      [
        '以下选择器在 prefers-reduced-motion 块里写了 `transform: none`，但同文件后面又出现一条同选择器的位移规则。',
        '媒体查询不增加特异性，源序后者取胜——减弱档形同未写，真机减弱档下位移仍然发生：',
        offenders.join('\n'),
      ].join('\n'),
    ).toEqual([]);
  });

  it('层叠判据有牙：覆写在后被拒、覆写在前放行、不同选择器不互咬', () => {
    // 反例：撤销排在前，位移规则排在后 → 位移赢，撤销是死规则
    expect(
      deadReducedMotionOverrides(
        '@media (prefers-reduced-motion: reduce) { .x:hover { transform: none; } }\n' +
          '.x:hover { transform: translateY(-1px); }',
      ),
    ).toEqual(['.x:hover']);

    // 正例：位移规则在前，撤销排在后 → 减弱档真的生效
    expect(
      deadReducedMotionOverrides(
        '.x:hover { transform: translateY(-1px); }\n' +
          '@media (prefers-reduced-motion: reduce) { .x:hover { transform: none; } }',
      ),
    ).toEqual([]);

    // 不许扩大打击面：不同选择器之间不构成压制关系
    expect(
      deadReducedMotionOverrides(
        '@media (prefers-reduced-motion: reduce) { .y:hover { transform: none; } }\n' +
          '.x:hover { transform: translateY(-1px); }',
      ),
    ).toEqual([]);

    // 只撤销别的属性（如 opacity）不算声明了位移撤销，不能凭空制造违规
    expect(
      deadReducedMotionOverrides(
        '@media (prefers-reduced-motion: reduce) { .x:hover { opacity: 1; } }\n' +
          '.x:hover { transform: translateY(-1px); }',
      ),
    ).toEqual([]);
  });
});
