/**
 * 管理页顶部工具条的间距守卫（HeaderBar 左右两组）
 *
 * 这条间距在本仓被「打理」过 5 处（SearchFilterBar / TrashDialog / SidepanelAuthView /
 * PasswordDetailDrawer / IdentityVaultDialog），唯独工具条漏了：Element Plus 的
 * `.el-button + .el-button { margin-left: 12px }` 与容器 `gap: 12px` 是**叠加**的，
 * 而它只命中「相邻兄弟恰好都是 .el-button」这一种结构。工具条左组的「数据管理」「安全设置」
 * 把按钮包在 `.el-dropdown` 里、`+` 不命中，右组四颗则全是直接兄弟 —— 接管前实测
 * 左组 24/12/12、右组 24/24/24，用户看到的「左右间距不一致」就是这个。
 *
 * 本守卫钉三件「改了会静默变差」的事：
 * 1. **三处 `gap` 同值**（行容器 + 左组 + 右组）。三份声明各自看都合理，只有横向比对才发现漂移；
 *    `tsc --noEmit` 看不见 `.vue` 的 `<style>`，Stylelint 只管属性顺序不管取值互相抵消。
 * 2. **EP 那条 margin 必须被接管成 0**。删掉它不报错、不变红，只是间距静默回到 24px。
 *    净间距按 `gap + margin-left` 算出来，不是写死的字面量。
 * 3. **接管必须同时覆盖左右两组**。只接管左组是本缺陷最可能的复发形态（右组当时"看着没问题"）。
 *
 * 口径边界：本文件钉的是**声明值**，它证明不了「我们的选择器压得过 EP」——那属特异性算术
 * （`.header-actions[data-v-x] .el-button + .el-button` = (0,4,0) vs EP (0,2,0)）。
 * EP 升级若改了默认边距这里也不会变红，要靠真机目测发现。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

/** 工具条的三处间距来源：外层行容器决定「左组↔右组」，两条组容器决定组内按钮之间 */
const GAP_CONTAINERS = ['.header-actions-row', '.header-actions', '.header-actions-right'] as const;

/** 组内按钮的两组容器（EP 边距的接管必须两组都覆盖） */
const BUTTON_GROUPS = ['.header-actions', '.header-actions-right'] as const;

/** 预期净间距（px）：接管 EP 边距后，按钮之间的间距应恒等于容器 gap */
const EXPECTED_GAP_PX = 12;

/** 取 `<style scoped>` 并摘掉注释 */
const scopedCss = (src: string) => {
  const style = src.match(/<style scoped>([\s\S]*?)<\/style>/);
  if (!style) throw new Error('找不到 `<style scoped>` 块');
  // 必须先去注释：解释「12px 从哪来」的注释里就写着 `.el-button + .el-button { margin-left: 12px }`
  // 这样的 CSS 形状片段，按选择器定位会命中注释而不是规则本身。
  return style[1].replace(/\/\*[\s\S]*?\*\//g, '');
};

/** 一条规则的位置：声明体在原文中的起止偏移与正文 */
interface Rule {
  bodyStart: number;
  bodyEnd: number;
  body: string;
}

/**
 * 按选择器定位一条规则，**支持选择器列表**
 *
 * 接管那条写成 `.header-actions :deep(...), .header-actions-right :deep(...) { ... }`，
 * 逗号列表是这条规则的写法本身，不能为了好定位而拆成两份重复声明。故按「逗号切分后的某一项
 * 恰好等于目标选择器」命中，而不是要求 `选择器 + 空格 + {` 相邻。
 *
 * 取首个命中：`@media` 块里还有同名选择器（`.header-actions` 在窄屏档被重新声明过），
 * 而本守卫关心的是决定间距的那条基线声明。
 */
const locateRule = (css: string, selector: string, where: string): Rule => {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = (match[1] ?? '').split(',').map(part => part.replace(/\s+/g, ' ').trim());
    if (!parts.includes(selector)) continue;
    const bodyStart = (match.index ?? 0) + match[1].length + 1;
    return { bodyStart, bodyEnd: bodyStart + match[2].length, body: match[2] };
  }
  throw new Error(`${where} 里没有 \`${selector}\` 这条规则`);
};

/** 从声明体里取一个属性的值；缺失即抛，不让「属性被删」读成「值不同」 */
const decl = (body: string, prop: string, selector: string) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+?)\\s*(?:;|$)`));
  if (!m) throw new Error(`\`${selector}\` 里没有 \`${prop}\` 声明`);
  return m[1];
};

/**
 * 只改写某一条规则里的某个声明
 *
 * 变异必须落在这一条上：`margin-left` 在整份 CSS 里不止一处（`.header-actions-right` 自己
 * 就写着 `margin-left: auto`），拿全局首个匹配去变异，可能改到不相干的规则、判据照样绿。
 */
const rewriteDecl = (css: string, selector: string, prop: string, value: string, where: string) => {
  const { bodyStart, bodyEnd, body } = locateRule(css, selector, where);
  const pattern = new RegExp(`${prop}:[^;]+;`);
  if (!pattern.test(body)) throw new Error(`${where} 里 \`${selector}\` 没有 \`${prop}\` 声明，变异串是空的`);
  return css.slice(0, bodyStart) + body.replace(pattern, `${prop}: ${value};`) + css.slice(bodyEnd);
};

/** EP 相邻按钮边距的接管选择器（源文件里写成 `:deep(...)`，编译后落在同一批类名上） */
const siblingSelector = (container: string) => `${container} :deep(.el-button + .el-button)`;

/** 一处容器的两条间距来源，外加由它们相加得到的净间距 */
const densityOf = (css: string, container: string) => {
  const gap = decl(locateRule(css, container, container).body, 'gap', container);
  const margin = decl(
    locateRule(css, siblingSelector(container), container).body,
    'margin-left',
    siblingSelector(container),
  );
  return { gap, margin, netGap: Number.parseFloat(gap) + Number.parseFloat(margin) };
};

/** 跑一段可能抛异常的判据，把「规则不存在」转成可读的标记，供变异自证使用 */
const probe = (run: () => unknown): string => {
  try {
    run();
    return 'ok';
  } catch (error) {
    return (error as Error).message;
  }
};

const HEADER_BAR = 'components/options/HeaderBar.vue';

describe('管理页顶部工具条的间距', () => {
  const css = scopedCss(readSource(HEADER_BAR));

  it('三处容器 gap 同值，且等于登记表的 12px', () => {
    const gaps = GAP_CONTAINERS.map(container => decl(locateRule(css, container, container).body, 'gap', container));
    expect(new Set(gaps).size, `三处 gap 不一致：${gaps.join(' / ')}`).toBe(1);
    expect(Number.parseFloat(gaps[0]), `gap 不是登记的 ${EXPECTED_GAP_PX}px：${gaps.join(' / ')}`).toBe(
      EXPECTED_GAP_PX,
    );

    // 牙齿：单侧改动必须被读出来，而不是「各自看着合理」
    const mutated = rewriteDecl(css, GAP_CONTAINERS[1], 'gap', '20px', GAP_CONTAINERS[1]);
    const readBack = GAP_CONTAINERS.map(container =>
      decl(locateRule(mutated, container, container).body, 'gap', container),
    );
    expect(Number.parseFloat(readBack[1]), 'gap 改成 20px 却没有被读到，判据是写死的').toBe(20);
    expect(new Set(readBack).size, '单侧 gap 漂移没有被识别为不一致').toBe(2);
  });

  it('EP 的相邻按钮边距在左右两组都被接管成 0，净间距恒等于 gap', () => {
    for (const container of BUTTON_GROUPS) {
      const { margin, netGap } = densityOf(css, container);
      expect(margin, `${container}：EP 的 12px 相邻边距没有被接管成 0`).toBe('0');
      expect(netGap, `${container}：净间距不等于 gap，说明 gap 与 margin 又叠加了`).toBe(EXPECTED_GAP_PX);
    }

    // 牙齿（接管维）：把某一组的 margin 放回 EP 默认值，净间距必须跟着翻倍
    const restored = rewriteDecl(css, siblingSelector(BUTTON_GROUPS[1]), 'margin-left', '12px', BUTTON_GROUPS[1]);
    expect(
      densityOf(restored, BUTTON_GROUPS[1]).netGap,
      'margin 回到 12px，净间距读数仍是 12，说明它不是算出来的',
    ).toBe(24);

    // 牙齿（覆盖面维）：只接管左组、右组漏掉，正是本缺陷的原始形态 —— 判据必须落在右组上变红
    const droppedRight = css.replace(
      `${siblingSelector(BUTTON_GROUPS[1])} {`,
      `${siblingSelector(BUTTON_GROUPS[1])}-x {`,
    );
    expect(
      probe(() => densityOf(droppedRight, BUTTON_GROUPS[1])),
      '摘掉右组的接管后判据仍然通过',
    ).not.toBe('ok');
    // 同一次变异不能让左组也跟着失配，否则证明的是「整条规则没了」而不是「右组没覆盖」
    expect(
      probe(() => densityOf(droppedRight, BUTTON_GROUPS[0])),
      '变异顺带弄坏了左组，覆盖面维的自证不成立',
    ).toBe('ok');
  });

  it('扫描本身有效：目标文件与三条容器规则都真的读到了', () => {
    // 空跑防护：选择器一旦随重构改名，locateRule 会抛而不是静默通过——这里显式确认它没抛
    for (const container of GAP_CONTAINERS) {
      expect(
        probe(() => locateRule(css, container, container)),
        `${container} 规则定位失败`,
      ).toBe('ok');
    }
    for (const container of BUTTON_GROUPS) {
      expect(
        probe(() => densityOf(css, container)),
        `${container} 的间距两条声明取不全`,
      ).toBe('ok');
    }
  });
});
