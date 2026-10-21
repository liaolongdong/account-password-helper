/**
 * 偏好设置面板的「可滚动」可供性守卫
 *
 * 面板九行 + 五条提示语在 zh-CN 下实测内容高 861px，而侧边栏里滚动区只有 537px
 * （被 `.settings-panel` 的 `max-height: min(600px, 90vh)` 卡住）——**折叠线恒落在提示语中间**。
 * 改动前唯一的线索是一道 4px 浅灰滚动条，在 macOS 上几乎不可辨，用户读到的是「界面底部被切坏了」
 * 而不是「下面还有内容」。本轮靠 8px 常驻轨道的滚动条把这件事说出来。
 *
 * 曾试过再加一层「边缘滚动阴影」（`radial-gradient(farthest-side)` 那套椭圆投影），
 * 实测在白色卡片上是一坨中间深、两侧淡的灰，比原来的硬切更难看，已撤回；本轮改用**全宽线性淡出**。
 * 这两条通路共同的失效方式是**不报错**：删掉一层、把 sticky 改成 static、顺手补一行
 * `scrollbar-width: thin`，页面照常渲染、构建照常通过，只是可供性静默归零。所以判据必须落在源文本上。
 *
 * 钉的四件事（每条都配变异自证，见最后一个用例）：
 * 1. 滚动条宽度落在 (4, 8] —— 比改动前更可见，又不越过实测上限（10px 会把提示语挤出一行换行，
 *    内容高度 861 → 894，滚动条自己加深了滚动）；
 * 2. 轨道色与滑块色都必须与卡片白拉开对比，且滑块描边 == 轨道色——`border` 那圈和 track 是同一个
 *    视觉槽位上的两处字面量；只钉「规则存在」时把轨道改成 `transparent` 或把滑块改成 `#fff`，
 *    宽度读数一切正常、可供性却已归零，那正是本守卫要防的那类静默回归；
 * 3. 全表禁止 `scrollbar-width` / `scrollbar-color`：Chromium 一旦看到这两个标准属性就**整段忽略**
 *    `::-webkit-scrollbar` 规则，macOS 下退化成自动隐藏的 overlay 滚动条（实测占位 4px → 0px），
 *    可供性反而比改动前更低。两套体系只能留一套，这是本文件唯一一条「禁止存在」判据；
 * 4. 滚动容器的下圆角 == 卡片圆角，否则方角的滚动条末端会戳出 `.settings-panel` 的圆弧。
 *
 * 另有一组判据钉渐隐的四条不变量：`position: sticky` + `bottom: 0`（改成 static 就会跟着内容
 * 滚走、变成贴在末行上的一条白带）；`height ≤ 底部内边距`（越过就洗白末行的字，等号算合法——
 * 淡出强度不该被间距绑死）；`margin-bottom == -height`（归零则白给一段可滚距离）；渐变必须是
 * 「全透 → 卡片白」的**线性**两段，且全表 `radial-gradient` 计数为 0——最后这条是把上一版
 * 翻车的签名直接钉死，防止有人再「优化」回椭圆投影。
 *
 * 口径边界：本守卫钉的是**声明值**，它证明不了 8px 轨道在真机上肉眼可辨、也证明不了加宽不改变
 * 内容高度——那两件事由真浏览器量测负责（同一视口 A/B：scrollHeight 恒 861、clientHeight 恒 537，
 * 只有占位 4px → 8px）。样式重构时两边要一起复核。
 * 另有一条解析限制：`ruleBody` 用 `[^{}]*` 取声明体，被匹配的规则体里**不能出现 `${...}` 插值**
 * （花括号会截断体）。当前四维目标规则全部无插值；日后把面板底色改成插值形式，这里会以
 * 「样式里没有 X 这条规则」响亮失败，不是静默空跑，但报错信息会指错方向。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const SOURCE = 'entrypoints/content/floatingButtons/settingsPanelView.ts';

/** 取 `settingsPanelViewStyles` 模板字符串里的 CSS，并剥掉注释 */
function panelCss(): string {
  const src = readSource(SOURCE);
  const m = src.match(/export const settingsPanelViewStyles = `([\s\S]*?)`;/);
  if (!m) throw new Error(`${SOURCE} 里取不到 settingsPanelViewStyles 模板字符串`);
  // 注释里写着 `::-webkit-scrollbar` 这类 CSS 形状片段，不先剥会命中注释而不是规则本身
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

/** 从一条规则里读一个 `<n>px` 值 */
function pxOf(body: string, prop: string, where: string): number {
  const raw = decl(body, prop, where);
  const m = raw.match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`${where} 的 ${prop} 不是 px 值：${raw}`);
  return Number.parseFloat(m[1]);
}

/** 取一条颜色声明并归一化；`transparent` / `none` 原样返回，交给判据去拦 */
function colorOf(body: string, prop: string, where: string): string {
  return decl(body, prop, where).toLowerCase();
}

/** 从 `border` 简写里取末尾那个颜色值；不是「宽度 样式 颜色」三件套即抛 */
function borderColorOf(body: string, where: string): string {
  const raw = decl(body, 'border', where);
  const m = raw.match(/\s([a-z]+|#[0-9a-f]{3,8})$/i);
  if (!m) throw new Error(`${where} 的 border 不是「宽 样式 颜色」形态：${raw}`);
  return m[1].toLowerCase();
}

/**
 * 从 `padding` 简写里取下内边距（px）
 *
 * 3/4 值取下值；1/2 值时上下同值取首值。形态不认识就抛——静默按 0 算会把
 * 「内边距被改成不对称」读成正常值，而淡出高度正是靠这个值兜底的。
 */
function paddingBottomPx(body: string): number {
  const raw = decl(body, 'padding', '.settings-content');
  const parts = raw.split(/\s+/);
  const slot = parts.length >= 3 ? parts[2] : parts[0];
  const m = slot?.match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`.settings-content 的 padding 取不到下内边距：${raw}`);
  return Number.parseFloat(m[1]);
}

/**
 * 从 `margin` 简写里取下外边距（px，可为负）
 *
 * 只认 3/4 值简写：`margin-bottom` 单独写也行，但本文件的目标规则用的是简写，
 * 形态一变就该抛——静默按 0 算会把「负边距被删」读成正常值，那正是这条判据要拦的事。
 */
function marginBottomOf(body: string, where: string): number {
  const raw = decl(body, 'margin', where);
  const parts = raw.split(/\s+/);
  // 3/4 值取下值；1/2 值时上下同值，取首值（取错会把「只改简写第三值」读成没变）
  const slot = parts.length >= 3 ? parts[2] : parts[0];
  if (!slot) throw new Error(`${where} 的 margin 取不到下外边距：${raw}`);
  const m = slot.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`${where} 的 margin 下值不是 px 形态：${slot}（完整值 ${raw}）`);
  return Number.parseFloat(m[1]);
}

/** 四维读数，判据与变异自证共用同一份解析 */
interface Affordance {
  scrollbarWidth: number;
  trackColor: string;
  thumbColor: string;
  thumbBorderColor: string;
  panelBg: string;
  panelRadius: number;
  contentBottomRadius: number;
  standardScrollbarProps: string[];
  fadePosition: string;
  fadeBottom: string;
  fadeHeight: number;
  fadeMarginBottom: number;
  fadeImage: string;
  paddingBottom: number;
  radialGradients: number;
}

function read(css: string): Affordance {
  const content = ruleBody(css, '.settings-content');
  const fadeRule = ruleBody(css, '.settings-content::after');
  const track = ruleBody(css, '.settings-content::-webkit-scrollbar-track');
  const thumb = ruleBody(css, '.settings-content::-webkit-scrollbar-thumb');
  const panel = ruleBody(css, '.settings-panel');
  return {
    scrollbarWidth: pxOf(ruleBody(css, '.settings-content::-webkit-scrollbar'), 'width', '滚动条'),
    trackColor: colorOf(track, 'background', '滚动条轨道'),
    thumbColor: colorOf(thumb, 'background-color', '滚动条滑块'),
    thumbBorderColor: borderColorOf(thumb, '滚动条滑块'),
    panelBg: decl(panel, 'background', '.settings-panel'),
    panelRadius: pxOf(panel, 'border-radius', '.settings-panel'),
    contentBottomRadius: pxOf(content, 'border-bottom-left-radius', '.settings-content'),
    standardScrollbarProps: ['scrollbar-width', 'scrollbar-color'].filter(prop =>
      new RegExp(`(?:^|[;\\s])${prop}\\s*:`).test(css),
    ),
    fadePosition: decl(fadeRule, 'position', '::after'),
    fadeBottom: decl(fadeRule, 'bottom', '::after'),
    fadeHeight: pxOf(fadeRule, 'height', '::after'),
    fadeMarginBottom: marginBottomOf(fadeRule, '::after'),
    fadeImage: decl(fadeRule, 'background', '::after'),
    paddingBottom: paddingBottomPx(content),
    radialGradients: (css.match(/radial-gradient/g) ?? []).length,
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
  /** 与卡片白同值或全透 = 滚动条隐形 */
  const invisibleColors = () => ['transparent', 'none', a.panelBg.toLowerCase()];

  it('滚动条比改动前更可见，且不超过实测的 8px 上限', () => {
    expect(a.scrollbarWidth, '滚动条退回 4px：可供性又没了').toBeGreaterThan(4);
    expect(a.scrollbarWidth, '滚动条宽到会挤出额外换行的档位（实测 10px → 内容 861→894）').toBeLessThanOrEqual(8);
  });

  it('轨道与滑块都得跟卡片白拉开对比，否则加宽也读不出来', () => {
    expect(invisibleColors(), `轨道色 ${a.trackColor} 与卡片底色同值或全透：占位再宽也是隐形条`).not.toContain(
      a.trackColor,
    );
    expect(invisibleColors(), `滑块色 ${a.thumbColor} 与卡片底色同值或全透：只剩轨道、滑块看不见`).not.toContain(
      a.thumbColor,
    );
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

  it('底缘渐隐是钉在底部的 sticky 线性淡出，且不越过底部内边距带', () => {
    expect(a.fadePosition, `渐隐不是 sticky 而是 ${a.fadePosition}：它会跟着内容滚走，变成常驻白带`).toBe('sticky');
    expect(a.fadeBottom, `渐隐没有钉在下缘（bottom: ${a.fadeBottom}）`).toBe('0');
    // 不变量是「≤」而不是「==」：淡出只要整块落得进末行下方的内边距带就不糊字。
    // 等号会把淡出强度绑死在间距上——底部内边距加到 26px 时淡出会被动变浓，而用户要的是间距。
    expect(
      a.fadeHeight,
      `渐隐高 ${a.fadeHeight}px 超过底部内边距 ${a.paddingBottom}px：滚到底时会洗白末行的字`,
    ).toBeLessThanOrEqual(a.paddingBottom);
    expect(
      a.fadeMarginBottom,
      `下外边距 ${a.fadeMarginBottom}px 不等于 -高度：为 0 会白给可滚距离，够不到负值则端点糊字`,
    ).toBe(-a.fadeHeight);
    const m = a.fadeImage.match(/^linear-gradient\(\s*rgba\(255,\s*255,\s*255,\s*0\)\s*,\s*(#[0-9a-f]{3,8})\s*\)$/i);
    expect(m, `渐隐不是「全透 → 不透明」的两段线性渐变，横向明暗会不均匀：${a.fadeImage}`).not.toBeNull();
    expect(m![1].toLowerCase(), `渐隐终点色 ${m![1]} 与卡片底色 ${a.panelBg} 脱钩，淡出会淡到别的颜色上`).toBe(
      a.panelBg.toLowerCase(),
    );
    // 上一版翻车的签名：radial-gradient 的 farthest-side 让灰在最深处落在水平中央
    expect(a.radialGradients, '样式里又出现了 radial-gradient：椭圆投影会在白卡片上糊成一坨灰').toBe(0);
  });

  it('四维读数本身有效，且每条判据都能被对应的变异打红', () => {
    expect(a.scrollbarWidth, '滚动条宽度没读到，扫描本身失效').toBeGreaterThan(0);
    expect(a.panelBg, '卡片底色没读到').not.toBe('');
    expect(a.panelRadius, '卡片圆角没读到').toBeGreaterThan(0);
    expect(a.paddingBottom, '底部内边距没读到（padding 简写形态变了？）').toBeGreaterThan(0);

    const thin = mutate(css, '::-webkit-scrollbar {\n  width: 8px;', '::-webkit-scrollbar {\n  width: 4px;');
    expect(read(thin).scrollbarWidth, '滚动条退回 4px 后读数没变，宽度判据是写死的').toBe(4);

    const wide = mutate(css, 'width: 8px;\n}', 'width: 10px;\n}');
    expect(read(wide).scrollbarWidth, '滚动条宽到 10px 后读数没变').toBe(10);

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
    expect(read(whiteThumb).thumbColor, '滑块改成卡片白后读数没变').toBe(a.panelBg.toLowerCase());

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

    const notSticky = mutate(css, '  position: sticky;\n  bottom: 0;', '  position: static;\n  bottom: 0;');
    expect(read(notSticky).fadePosition, '把渐隐改成非 sticky 后读数没变，它会被内容滚走').not.toBe('sticky');

    // 必须越过底部内边距（26px）才算违规；等于它仍然合法——这正是 ≤ 与 == 的分工
    const tallerFade = mutate(
      css,
      '  height: 16px;\n  margin: 0 -20px -16px;',
      '  height: 34px;\n  margin: 0 -20px -34px;',
    );
    const tallerRead = read(tallerFade);
    expect(
      tallerRead.fadeHeight <= tallerRead.paddingBottom,
      `渐隐抬到 ${tallerRead.fadeHeight}px、越过内边距 ${tallerRead.paddingBottom}px 却不被发现`,
    ).toBe(false);
    // 等号边界必须判为合法，否则这条判据退化成把淡出强度绑死在间距上的 ==
    const equalFade = mutate(
      css,
      '  height: 16px;\n  margin: 0 -20px -16px;',
      '  height: 26px;\n  margin: 0 -20px -26px;',
    );
    const equalRead = read(equalFade);
    expect(equalRead.fadeHeight <= equalRead.paddingBottom, '淡出等于内边距却被判违规，这条刀过紧了').toBe(true);

    const noPull = mutate(css, 'margin: 0 -20px -16px;', 'margin: 0 -20px 0px;');
    expect(read(noPull).fadeMarginBottom, '删掉负下边距（会白给可滚距离）后读数没变').toBe(0);

    const ellipse = mutate(
      css,
      'background: linear-gradient(rgba(255, 255, 255, 0), #fff);',
      'background: radial-gradient(farthest-side at 50% 100%, rgba(15, 23, 42, 0.26), rgba(15, 23, 42, 0));',
    );
    expect(read(ellipse).radialGradients, '把线性淡出换回椭圆投影却不被发现，那把刀是空的').toBeGreaterThan(0);
  });
});
