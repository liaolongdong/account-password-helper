/**
 * 偏好设置面板的「可滚动」可供性守卫
 *
 * 面板九行 + 五条提示语在 zh-CN 下实测内容高 861px，而侧边栏里滚动区只有 537px
 * （被 `.settings-panel` 的 `max-height: min(600px, 90vh)` 卡住）——**折叠线恒落在提示语中间**。
 * 改动前唯一的线索是一道 4px 浅灰滚动条，用户读到的是「界面底部被切坏了」而不是「下面还有内容」。
 * 本轮补了两层信号：钉在滚动视口上下沿的边缘投影（滚到端点自动消失）+ 8px 常驻轨道。
 *
 * 这两件事的共同点是**坏了不会报错**：删掉一层背景、把遮罩改半透明、顺手补一行
 * `scrollbar-width: thin`，页面照常渲染、构建照常通过，只是可供性静默归零。所以判据必须落在源文本上。
 *
 * 钉的七件事（每条都配变异自证，见最后一个用例）：
 * 1. `background-attachment` 恰为 `local, local, scroll, scroll`——遮罩随内容走、投影钉视口，
 *    两者配对缺一半都会退化成「常驻灰边」或「永远不消失的阴影」；
 * 2. 两层遮罩的高度 == `.settings-content` 的 padding-block，且 `background-position` 上下成对；
 *    遮罩比 padding 高就会去压第一行/最后一行的字，等于在另一端复刻同一个 bug；
 * 3. 遮罩是**不透明**渐变，且颜色与 `.settings-panel` 的底色同源；
 * 4. 滚动条宽度落在 (4, 8] —— 比改动前更可见，又不越过实测上限（10px 会把提示语挤出一行换行，
 *    内容高度 861 → 894，滚动条自己加深了滚动）；
 * 5. 全表禁止 `scrollbar-width` / `scrollbar-color`：Chromium 一旦看到这两个标准属性就**整段忽略**
 *    `::-webkit-scrollbar` 规则，macOS 下退化成自动隐藏的 overlay 滚动条（实测占位 4px → 0px），
 *    可供性反而比改动前更低。两套体系只能留一套，这是本文件唯一一条「禁止存在」判据；
 * 6. 滚动容器的下圆角 == 卡片圆角，否则方角的滚动条末端会戳出 `.settings-panel` 的圆弧；
 * 7. 轨道色与滑块色都必须与卡片白拉开对比，且滑块描边 == 轨道色——`border` 那圈和 track 是同一个
 *    视觉槽位上的两处字面量，只钉「规则存在」时把轨道改成 `transparent` 或把滑块改成 `#fff`，
 *    宽度读数一切正常、可供性却已静默归零，那正是本守卫声明要防的那一类回归。
 *
 * 口径边界：本守卫钉的是**声明值**，它证明不了投影在真机上肉眼可见、也证明不了 8px 不改变内容高度——
 * 那两件事由 `entrypoints/content/floatingButtons/settingsPanelView.ts` 注释里记录的实测数字
 * （同一视口 A/B：scrollHeight 恒 861、clientHeight 恒 537、底部 16 行亮度 255→215）负责，
 * 样式重构时两边要一起复核。
 * 另有一条解析限制：`ruleBody` 用 `[^{}]*` 取声明体，被匹配的规则体里**不能出现 `${...}` 插值**
 * （花括号会截断体）。当前七维目标规则全部无插值；日后把面板底色或主色改成插值形式，
 * 这里会以「样式里没有 X 这条规则」响亮失败，不是静默空跑，但报错信息会指错方向。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const SOURCE = 'entrypoints/content/floatingButtons/settingsPanelView.ts';

/** 取 `settingsPanelViewStyles` 模板字符串里的 CSS，并剥掉注释 */
function panelCss(): string {
  const src = readSource(SOURCE);
  const m = src.match(/export const settingsPanelViewStyles = `([\s\S]*?)`;/);
  if (!m) throw new Error(`${SOURCE} 里取不到 settingsPanelViewStyles 模板字符串`);
  // 注释里写着「background-attachment: local 跟着内容走」这类 CSS 形状片段，不先剥会命中注释
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 按选择器取一条规则的声明体；找不到即抛，不让「规则被删」读成「值不一样」 */
function ruleBody(css: string, selector: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = (match[1] ?? '').split(',').map(part => part.replace(/\s+/g, ' ').trim());
    if (parts.includes(selector)) return match[2];
  }
  throw new Error(`样式里没有 \`${selector}\` 这条规则`);
}

/** 取一个声明的值；缺失即抛 */
function decl(body: string, prop: string, where: string): string {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+?)\\s*(?:;|$)`));
  if (!m) throw new Error(`\`${where}\` 里没有 \`${prop}\` 声明`);
  return m[1].trim();
}

/** 深度感知地切 CSS 值列表：`radial-gradient(a, b, c)` 内部的逗号不算分层 */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** 取 `100% 16px` 这类尺寸值里的第二个长度（px）；不是 px 即抛 */
function secondLengthPx(layer: string, where: string): number {
  const m = layer.trim().match(/^100%\s+(\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`${where} 的尺寸不是 \`100% <n>px\` 形态：${layer}`);
  return Number.parseFloat(m[1]);
}

/** padding 简写的块向内边距（第一值）；只认两值简写，别的形态直接抛 */
function paddingBlockPx(body: string): number {
  const m = decl(body, 'padding', '.settings-content').match(/^(\d+(?:\.\d+)?)px\s+\d+(?:\.\d+)?px$/);
  if (!m) throw new Error('.settings-content 的 padding 不是「块 行」两值简写，联动口径需复核');
  return Number.parseFloat(m[1]);
}

/** 从一条规则里读一个 `<n>px` 值 */
function pxOf(body: string, prop: string, where: string): number {
  const raw = decl(body, prop, where);
  const m = raw.match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`${where} 的 ${prop} 不是 px 值：${raw}`);
  return Number.parseFloat(m[1]);
}

/** 一次取全七维读数，判据与变异自证共用同一份解析 */
interface Affordance {
  attachment: string[];
  coverHeights: number[];
  shadowHeights: number[];
  positions: string[];
  coverImages: string[];
  paddingBlock: number;
  scrollbarWidth: number;
  panelRadius: number;
  contentBottomRadius: number;
  coverColor: string;
  panelBg: string;
  trackColor: string;
  thumbColor: string;
  thumbBorderColor: string;
  standardScrollbarProps: string[];
}

/** 取一条颜色声明并归一化大小写；`transparent` / `none` 原样返回，交给判据去拦 */
function colorOf(body: string, prop: string, where: string): string {
  return decl(body, prop, where).trim().toLowerCase();
}

/** 从 `border` 简写里取末尾那个颜色值；不是「宽度 样式 颜色」三件套即抛 */
function borderColorOf(body: string, where: string): string {
  const raw = decl(body, 'border', where).trim();
  const m = raw.match(/\s([a-z]+|#[0-9a-f]{3,8})$/i);
  if (!m) throw new Error(`${where} 的 border 不是「宽 样式 颜色」形态：${raw}`);
  return m[1].toLowerCase();
}

function read(css: string): Affordance {
  const content = ruleBody(css, '.settings-content');
  const images = splitLayers(decl(content, 'background-image', '.settings-content'));
  const sizes = splitLayers(decl(content, 'background-size', '.settings-content'));
  const track = ruleBody(css, '.settings-content::-webkit-scrollbar-track');
  const thumb = ruleBody(css, '.settings-content::-webkit-scrollbar-thumb');
  return {
    attachment: splitLayers(decl(content, 'background-attachment', '.settings-content')),
    coverHeights: sizes.slice(0, 2).map((layer, i) => secondLengthPx(layer, `第 ${i + 1} 层遮罩`)),
    shadowHeights: sizes.slice(2).map((layer, i) => secondLengthPx(layer, `第 ${i + 3} 层投影`)),
    positions: splitLayers(decl(content, 'background-position', '.settings-content')),
    coverImages: images.slice(0, 2),
    paddingBlock: paddingBlockPx(content),
    scrollbarWidth: pxOf(ruleBody(css, '.settings-content::-webkit-scrollbar'), 'width', '滚动条'),
    panelRadius: pxOf(ruleBody(css, '.settings-panel'), 'border-radius', '.settings-panel'),
    contentBottomRadius: pxOf(content, 'border-bottom-left-radius', '.settings-content'),
    coverColor: decl(content, 'background-color', '.settings-content'),
    panelBg: decl(ruleBody(css, '.settings-panel'), 'background', '.settings-panel'),
    trackColor: colorOf(track, 'background', '滚动条轨道'),
    thumbColor: colorOf(thumb, 'background-color', '滚动条滑块'),
    thumbBorderColor: borderColorOf(thumb, '滚动条滑块'),
    standardScrollbarProps: ['scrollbar-width', 'scrollbar-color'].filter(prop =>
      new RegExp(`(?:^|[;\\s])${prop}\\s*:`).test(css),
    ),
  };
}

/** 只替换首个出现片段，变异一律在内存快照上做，不落磁盘 */
function mutate(css: string, from: string, to: string): string {
  if (!css.includes(from)) throw new Error(`变异锚点没命中：${from}`);
  return css.replace(from, to);
}

describe('偏好设置面板的滚动可供性', () => {
  const css = panelCss();
  const a = read(css);

  it('遮罩与投影四层配对：local 随内容、scroll 钉视口，位置上下成对', () => {
    expect(a.attachment, `background-attachment 不是四层：${a.attachment.join('|')}`).toEqual([
      'local',
      'local',
      'scroll',
      'scroll',
    ]);
    expect(a.positions, `background-position 不是「0 0 / 0 100%」两对：${a.positions.join('|')}`).toEqual([
      '0 0',
      '0 100%',
      '0 0',
      '0 100%',
    ]);
    expect(a.shadowHeights.length, '投影层数不是两层').toBe(2);
  });

  it('遮罩高度恰等于 padding-block，端点不压任何一个字', () => {
    for (const height of a.coverHeights) {
      expect(height, `遮罩高 ${height}px 与 padding-block ${a.paddingBlock}px 不等：高出部分会洗淡首/末行的字`).toBe(
        a.paddingBlock,
      );
    }
  });

  it('遮罩是不透明纯色渐变，且与卡片底色同源', () => {
    for (const [i, image] of a.coverImages.entries()) {
      const m = image.match(/^linear-gradient\(\s*(#[0-9a-f]{3,8})\s*,\s*(#[0-9a-f]{3,8})\s*\)$/i);
      expect(m, `第 ${i + 1} 层遮罩不是「两端同色」的不透明渐变：${image}`).not.toBeNull();
      expect(m![1], `第 ${i + 1} 层遮罩两端不同色，中间会露出半透明`).toBe(m![2]);
      expect(m![1].toLowerCase(), `第 ${i + 1} 层遮罩色 ${m![1]} 与卡片底色 ${a.panelBg} 脱钩`).toBe(
        a.panelBg.toLowerCase(),
      );
    }
    expect(a.coverColor.toLowerCase(), 'background-color 与卡片底色脱钩，投影会叠在别的底色上').toBe(
      a.panelBg.toLowerCase(),
    );
  });

  it('滚动条比改动前更可见，且不超过实测的 8px 上限', () => {
    expect(a.scrollbarWidth, '滚动条退回 4px：可供性主力又没了').toBeGreaterThan(4);
    expect(a.scrollbarWidth, '滚动条宽到会挤出额外换行的档位（实测 10px → 内容 861→894）').toBeLessThanOrEqual(8);
  });

  it('轨道与滑块都得跟卡片白拉开对比，否则加宽也读不出来', () => {
    const invisible = ['transparent', 'none', a.panelBg.toLowerCase()];
    expect(invisible, `轨道色 ${a.trackColor} 与卡片底色同值或全透：滚动条占位再宽也是隐形条`).not.toContain(
      a.trackColor,
    );
    expect(invisible, `滑块色 ${a.thumbColor} 与卡片底色同值或全透：只剩轨道、滑块看不见`).not.toContain(a.thumbColor);
    // thumb 的 border 与 track 底色是同一个视觉槽位上的两处字面量，改一漏一就会露出白缝
    expect(a.thumbBorderColor, `滑块描边 ${a.thumbBorderColor} 与轨道 ${a.trackColor} 脱钩，滑块外圈会漏白`).toBe(
      a.trackColor,
    );
  });

  it('禁止 scrollbar-width / scrollbar-color——它们会让 Chromium 整段忽略 webkit 滚动条规则', () => {
    expect(
      a.standardScrollbarProps,
      '出现了标准滚动条属性：Chromium 会忽略 ::-webkit-scrollbar，macOS 下退化为自动隐藏的 overlay 滚动条',
    ).toEqual([]);
  });

  it('滚动容器下圆角与卡片圆角同值，滚动条末端不戳出圆弧', () => {
    expect(a.contentBottomRadius, `滚动容器下圆角 ${a.contentBottomRadius}px 与卡片 ${a.panelRadius}px 不一致`).toBe(
      a.panelRadius,
    );
  });

  it('七维读数本身有效，且每条判据都能被对应的变异打红', () => {
    expect(a.attachment, 'attachment 层数解析异常，扫描本身失效').toHaveLength(4);
    expect(a.coverHeights, '遮罩层数解析异常，扫描本身失效').toHaveLength(2);
    expect(a.paddingBlock, 'padding-block 没读到').toBeGreaterThan(0);
    expect(a.panelRadius, '卡片圆角没读到').toBeGreaterThan(0);
    expect(a.trackColor, '轨道色没读到').not.toBe('');
    expect(a.thumbBorderColor, '滑块描边色没读到').toBe(a.trackColor);

    // 逐条变异：改了却读不出差异，就说明那条判据是写死的
    const attach = mutate(
      css,
      'background-attachment: local, local, scroll',
      'background-attachment: local, scroll, scroll',
    );
    expect(read(attach).attachment, '把一层遮罩改成 scroll 后读数没变，配对判据是写死的').not.toEqual(a.attachment);

    const taller = mutate(css, '100% 16px,\n    100% 16px,', '100% 24px,\n    100% 16px,');
    expect(read(taller).coverHeights[0], '把遮罩抬高 8px 后读数没变，高度判据是写死的').not.toBe(a.paddingBlock);

    const translucent = mutate(css, 'linear-gradient(#fff, #fff),', 'linear-gradient(#fff, rgba(255,255,255,0)),');
    expect(read(translucent).coverImages[0], '遮罩改成半透明后没被读出来').not.toMatch(
      /^linear-gradient\(\s*(#[0-9a-f]{3,8})\s*,\s*\1\s*\)$/i,
    );

    const thin = mutate(css, '::-webkit-scrollbar {\n  width: 8px;', '::-webkit-scrollbar {\n  width: 4px;');
    expect(read(thin).scrollbarWidth, '滚动条退回 4px 后读数没变').toBe(4);

    const wide = mutate(css, 'width: 8px;\n}', 'width: 10px;\n}');
    expect(read(wide).scrollbarWidth, '滚动条宽到 10px 后读数没变').toBe(10);

    // 轨道改成全透 / 滑块改成卡片白：占位宽度没变，但可供性已经归零，必须被读出来
    const clearTrack = mutate(
      css,
      'scrollbar-track {\n  background: #f1f5f9;',
      'scrollbar-track {\n  background: transparent;',
    );
    expect(read(clearTrack).trackColor, '轨道改成 transparent 后读数没变，颜色判据是写死的').toBe('transparent');

    const whiteThumb = mutate(
      css,
      'scrollbar-thumb {\n  background-color: #cbd5e1;',
      'scrollbar-thumb {\n  background-color: #fff;',
    );
    expect(read(whiteThumb).thumbColor, '滑块改成卡片白后读数没变，颜色判据是写死的').toBe(a.panelBg.toLowerCase());

    // 只改轨道、漏改滑块描边（或反之）：两处字面量一旦分家，滑块外圈就漏白
    const drifted = mutate(css, 'border: 2px solid #f1f5f9;', 'border: 2px solid #e2e8f0;');
    const driftedRead = read(drifted);
    expect(driftedRead.thumbBorderColor, '描边色改了却没被读出来').not.toBe(a.trackColor);
    expect(driftedRead.thumbBorderColor === driftedRead.trackColor, '描边与轨道分家却仍判为同色').toBe(false);

    const standard = mutate(
      css,
      '.settings-content::-webkit-scrollbar {',
      '.settings-content { scrollbar-width: thin; }\n.settings-content::-webkit-scrollbar {',
    );
    expect(read(standard).standardScrollbarProps, '补一行 scrollbar-width 却不被发现，那把刀是空的').toContain(
      'scrollbar-width',
    );

    const square = mutate(css, 'border-bottom-left-radius: 10px;', 'border-bottom-left-radius: 0px;');
    expect(read(square).contentBottomRadius, '圆角归零后读数没变').not.toBe(a.panelRadius);
  });
});
