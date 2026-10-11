/**
 * 动作图标的密度与热区守卫（条目详情抽屉 `.detail-value` ↔ 身份库卡片 `.identity-card__actions`）
 *
 * 这两处是同一类东西——字段值行末尾的一排 `link` 图标按钮，本轮把它们的净间距从 16px 收到 8px，
 * 并用 `::after` 把命中区撑回 WCAG 2.5.8 的 24px 下限。守卫钉两件「改了会静默变差」的事：
 *
 * ① **两处必须同密度**。它们是两份独立样式，谁也不是谁的派生，所以「抽屉改了、卡片没改」
 *    这种半截回归只能靠逐字比对登记表来发现（`tsc --noEmit` 看不见 `.vue` 的 `<style>`，
 *    Stylelint 只管属性顺序与写法、不管取值之间是否互相抵消；本仓惯例见
 *    `facetPopperContainmentWiring.test.ts`）。
 * ② **`gap` 与 `margin-left` 的叠加关系**。`link` 按钮之间的净间距是容器 `gap` 与
 *    Element Plus 那条 `.el-button + .el-button { margin-left: 12px }` 相加得来的，本仓把
 *    后者显式接管成与 `gap` 同值。任一侧单独改动（比如「优化」成 `gap: 8px` 同时删掉 margin
 *    覆盖）读数就会翻倍或归零，而两份文件各自看都「合理」。
 *
 * 热区那条（`::after`）进同一张登记表，是因为它与间距互为前提：间距收窄后若热区外扩重叠，
 * 误点就落在邻钮上；外扩不足则 20px 的盒子过不了 24px 下限。数值口径来自真浏览器实测，非推导：
 * - `link` 按钮盒子 20×20（14px 图标 + 2×2px padding + 2×1px 边框）；
 * - 净间距 8px（`gap: 4px` + `margin-left: 4px`），可见图标之间 14px；
 * - `inset: -4px` 因 `inset` 以 padding box 为基准、被那 1px 边框吃掉一格，实际单侧外扩 3px，
 *   热区 26×26；真鼠标点击盒子右缘外 +2px 仍能翻显隐、+3px 起落空（中性带确实存在）。
 *
 * 本文件钉的是**声明值**及由它算出的区间。EP 版本升级若改了 `.el-button` 的默认边距或边框，
 * 这里不会变红——那类漂移要靠重跑真机量具发现，注释里的数值也得一并复核。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

/** `link` 按钮盒子边长（真浏览器实测：14px 图标 + 2×2px padding + 2×1px 边框） */
const BUTTON_BOX = 20;
/** EP `link` 按钮的边框宽度：`inset` 以 padding box 为基准，外扩量要先还回这一格才落到真实几何 */
const BORDER = 1;
/** WCAG 2.5.8 Target Size (Minimum) 的 AA 下限 */
const MIN_TARGET = 24;

/**
 * 由声明值算出热区边长
 *
 * 浏览器按 padding box 摆 `inset`，所以热区 = (盒子 − 2×边框) + 2×|inset|，实测 18 + 6 = 26。
 * 这个口径只用于「够不够 24px」那一侧：它比直接拿 |inset| 当外扩量算出的 28 更严，因为 28 那条
 * 在 `inset: -2px`（真实热区 22）时仍会算出 24 而放行 —— 尺寸下限正是本守卫存在的理由，不能放宽。
 */
const hotspotOf = (afterInset: string) => BUTTON_BOX - 2 * BORDER + Math.abs(Number.parseFloat(afterInset)) * 2;

/**
 * 一处动作图标行
 *
 * `container` 同时是 `<style scoped>` 里那条容器规则的选择器；容器 `gap`、按钮 `position`
 * 与 `::after` 全部由它前缀派生，所以容器改名会一路查到红。
 */
const ICON_ROWS = [
  { name: '条目详情抽屉', file: 'components/options/PasswordDetailDrawer.vue', container: '.detail-value' },
  {
    name: '身份库卡片动作行',
    file: 'components/options/IdentityVaultDialog.vue',
    container: '.identity-card__actions',
  },
] as const;

/**
 * 取 `<style scoped>` 并摘掉注释
 *
 * 必须先去注释：两处解释「12px 从哪来」的注释里就写着 `.el-button + .el-button { margin-left: 12px }`
 * 这样的 CSS 形状片段，按选择器定位会命中注释而不是规则本身。
 */
const scopedCss = (src: string) => {
  const style = src.match(/<style scoped>([\s\S]*?)<\/style>/);
  if (!style) throw new Error('找不到 `<style scoped>` 块');
  return style[1].replace(/\/\*[\s\S]*?\*\//g, '');
};

/** 一条规则在 CSS 里的位置：起点（选择器起始）与声明体的起止偏移 */
const locateRule = (css: string, selector: string, where: string) => {
  const head = `${selector} {`;
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`${where} 里没有 \`${selector} {}\` 这条规则`);
  const bodyStart = at + head.length;
  const bodyEnd = css.indexOf('}', bodyStart);
  if (bodyEnd < 0) throw new Error(`${where} 里 \`${selector} {}\` 没有闭合`);
  return { bodyStart, bodyEnd, body: css.slice(bodyStart, bodyEnd) };
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
 * 变异必须落在这一条上：整份 CSS 里同名声明可能不止一处（`inset`、`content` 都可能有别的规则
 * 在用），拿 `String.replace` 的全局首个匹配去变异，可能改到的是不相干的规则、判据照样绿。
 */
const rewriteDecl = (css: string, selector: string, prop: string, value: string, where: string) => {
  const { bodyStart, bodyEnd, body } = locateRule(css, selector, where);
  const pattern = new RegExp(`${prop}:[^;]+;`);
  if (!pattern.test(body)) throw new Error(`${where} 里 \`${selector}\` 没有 \`${prop}\` 声明，变异串是空的`);
  return css.slice(0, bodyStart) + body.replace(pattern, `${prop}: ${value};`) + css.slice(bodyEnd);
};

/** 一处图标行的四条关键声明，外加由 `gap` 与 `margin-left` 相加得到的净间距 */
const densityOf = (css: string, container: string, name: string) => {
  const gap = decl(locateRule(css, container, name).body, 'gap', container);
  const sibling = `${container} .el-button + .el-button`;
  const margin = decl(locateRule(css, sibling, name).body, 'margin-left', sibling);
  const button = `${container} .el-button`;
  const after = `${button}::after`;
  return {
    name,
    gap,
    margin,
    boxGap: Number.parseFloat(gap) + Number.parseFloat(margin),
    buttonPosition: decl(locateRule(css, button, name).body, 'position', button),
    afterInset: decl(locateRule(css, after, name).body, 'inset', after),
    afterContent: decl(locateRule(css, after, name).body, 'content', after),
  };
};

/** 登记表：两处必须逐字相同，且净间距与外扩量落在下面两条区间的安全区内 */
const EXPECTED = {
  gap: '4px',
  margin: '4px',
  boxGap: 8,
  buttonPosition: 'relative',
  afterInset: '-4px',
  afterContent: "''",
};

describe('动作图标行的密度与热区', () => {
  const rows = ICON_ROWS.map(row => ({ ...row, css: scopedCss(read(row.file)) }));

  it('两处登记值逐字相同，且等于登记表', () => {
    for (const { css, container, name } of rows) {
      const actual = densityOf(css, container, name);
      expect(actual, `${name} 的密度/热区声明与登记表不一致`).toEqual({ ...EXPECTED, name });
    }

    // 牙齿：只改一处也必须红——这条判据证的是「两处同密度」，不是「各自看着合理」
    const sibling = `${rows[0].container} .el-button + .el-button`;
    const widenedMargin = rewriteDecl(rows[0].css, sibling, 'margin-left', '20px', rows[0].name);
    expect(densityOf(widenedMargin, rows[0].container, rows[0].name).margin, 'margin 改成 20px，读数没有跟着变').toBe(
      '20px',
    );

    // 牙齿：`gap` 单独放宽、margin 不动，净间距必须跟着动（证明 boxGap 是算出来的而非写死 8）
    const widenedGap = rewriteDecl(rows[0].css, rows[0].container, 'gap', '8px', rows[0].name);
    expect(densityOf(widenedGap, rows[0].container, rows[0].name).boxGap, 'gap 改成 8px，净间距读数没跟着动').toBe(12);
  });

  it('净间距与热区外扩互为前提：热区撑得到 24px 下限，且相邻不重叠', () => {
    for (const { css, container, name } of rows) {
      const { boxGap, afterInset } = densityOf(css, container, name);
      // 下限这一侧按真实几何算（`inset` 锚在 padding box，见 `hotspotOf`），实测 26 ≥ 24
      expect(hotspotOf(afterInset), `${name}：热区撑不到 ${MIN_TARGET}px 下限`).toBeGreaterThanOrEqual(MIN_TARGET);
      // 重叠那一侧反过来按 |inset| 的上限算（忽略边框会算得更宽 = 更严），实测余量 8 − 6 = 2px
      const expand = Math.abs(Number.parseFloat(afterInset));
      expect(expand * 2, `${name}：相邻两颗热区重叠，误点会落在邻钮上`).toBeLessThanOrEqual(boxGap);

      // 牙齿（达标维·边界）：外扩收到 −2px 时真实热区是 22，同一条算式必须落到下限以下。
      // 早期版本在这里写的是 20 + |inset|×2，那个口径把边框当作不存在，−2px 会算出 24 而放行。
      const fivePxShort = densityOf(
        rewriteDecl(css, `${container} .el-button::after`, 'inset', '-2px', name),
        container,
        name,
      ).afterInset;
      expect(hotspotOf(fivePxShort), 'inset 收到 -2px（真实热区 22），达标算式没有反应').toBeLessThan(MIN_TARGET);

      // 牙齿（达标维·收底）：收到 −1px（热区 18）也必须红，防止哪天把下限写成了恒真
      const shrunk = densityOf(
        rewriteDecl(css, `${container} .el-button::after`, 'inset', '-1px', name),
        container,
        name,
      ).afterInset;
      expect(hotspotOf(shrunk), 'inset 收到 -1px，达标算式没有反应').toBeLessThan(MIN_TARGET);

      // 牙齿（重叠维）：外扩放到 −6px（单侧 6px > 净间距的一半），重叠算式必须越界
      const grown = densityOf(
        rewriteDecl(css, `${container} .el-button::after`, 'inset', '-6px', name),
        container,
        name,
      ).afterInset;
      expect(Math.abs(Number.parseFloat(grown)) * 2, 'inset 放到 -6px，重叠算式没有反应').toBeGreaterThan(boxGap);
    }
  });

  it('热区靠伪元素撑出：绝对定位 + 空 content，且没动按钮自身尺寸', () => {
    for (const { css, container, name } of rows) {
      const after = `${container} .el-button::after`;
      const body = locateRule(css, after, name).body;
      expect(body, `${name}：::after 不是绝对定位，inset 落不到按钮外面`).toContain('position: absolute');
      // `content` 是伪元素是否存在的开关，写成 `none` 就没有盒子、热区静默消失
      expect(decl(body, 'content', after), `${name}：::after 的 content 不是空串`).toBe("''");
      // 按钮盒子没有被写死尺寸——写了就不是「视觉尺寸不动」了
      expect(
        locateRule(css, `${container} .el-button`, name).body,
        `${name}：按钮被显式改了宽高，视觉密度不再等于实测的 20px`,
      ).not.toMatch(/\b(?:width|height):/);

      // 牙齿：往同一条规则里插一句 `content: none`（规则还在、选择器也对，但热区不存在），
      // 取值判据必须读到它并变红
      const withNone = `${after} {\n  content: none;`;
      const mutated = css.replace(`${after} {`, withNone);
      expect(
        decl(locateRule(mutated, after, name).body, 'content', after),
        'content 被改成 none，读数仍是空串，说明这条判据是写死的',
      ).toBe('none');
    }
  });
});
