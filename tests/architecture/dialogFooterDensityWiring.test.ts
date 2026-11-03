/**
 * 弹窗 / 抽屉 footer 一排文字按钮的间距守卫
 *
 * 弹窗 footer 的口径是**净间距 12px**，来源分两种：
 * - 容器不写 `gap` 的 footer（`WhatsNewDialog` / `HelpDialog` / `ChangeMasterPasswordDialog` /
 *   `SiteRulesDialog` 的裸按钮，以及 15 个 `.dialog-footer`）——间距恰好就是 Element Plus
 *   `.el-button + .el-button { margin-left: 12px }` 这一条，无需接管；
 * - 容器写了 `gap` 的 footer——EP 那条边距与 `gap` 是**叠加**而不是互相覆盖，必须显式接管成 0，
 *   否则净间距读成两者之和。个人信息库 `.identity-footer__left` 与评价引导 `.review-prompt__actions`
 *   都曾写着 `gap: 8px` 却没接管，实测 20px，正是用户看到的「间距偏大」，本轮两处收到 12px。
 *
 * 本守卫只覆盖**登记表里的四处**，不是全仓已达成状态：另有四处同样是「写了 `gap` 却没接管」，
 * 实测仍是 20px，本轮未动（改动会波及别的弹窗观感，待用户决定）——
 * `IdentityFormDialog` 的 `.identity-form-footer`、`PasswordDetailDrawer` 的 `.detail-footer`、
 * `QuickAddDialog` 的 `.quick-add-footer` 与 `.quick-add-actions`。修哪一处就把哪一行加进 `FOOTERS`。
 *
 * 登记表按**行**记预期值，不是全仓一个常量：「关于」抽屉是 400px 宽、要塞下三颗带图标的按钮，
 * 它的 6px 收紧是既有决定，由 `e2e/command-palette.spec.ts` 的「间距 ≤8px」几何断言钉住，
 * 本轮把它对齐到 12px 会直接撞红那条既有断言，故保持原值、只把按钮档位提到默认档。
 *
 * **为什么标准只能逐组件写、不能收进 `entrypoints/options/styles.css`**：那份文件是被
 * `entrypoints/options/App.vue` 的 `<style scoped>` 以 `@import` 引入的，产物里它的每条类选择器
 * 都带上了 App 的 scope id（`.dialog-footer[data-v-fd3d1564]`），而 App 模板里并不存在
 * `class="dialog-footer"`，于是它对**所有**使用方都不生效——只有 `:deep(...)` 那几条能穿透。
 * 这正是各弹窗各自复制一份 `.dialog-footer` 的原因，也是本守卫把口径钉在**各组件自己的
 * scoped 块**上的原因。把它收进全局文件属另一件事，需要单独评估与 14 份本地声明的同特异性竞争。
 *
 * 本守卫钉三件「改了会静默变差」的事：
 * 1. **每一处的净间距等于该行登记的预期值**，按 `gap + margin-left` 算出来，不写死字面量；
 * 2. **有 `gap` 就必须有对应的接管**——删掉接管那条不会报错、不会变红，只是间距静默多出 12px；
 * 3. **「关于」抽屉的三个按钮不得退回 `size="small"`**（12px 字 / 24px 高，既低于其余 footer 的
 *    默认档，也把命中区压在 WCAG 2.5.8 下限上零余量）。
 *
 * 新增写了 `gap` 的 footer 容器时，把选择器与预期值加进 `FOOTERS`，两条声明缺任一条即红。
 * 口径边界：钉的是**声明值**，它证明不了选择器压得过 EP（scoped 后是 (0,4,0) vs EP (0,2,0)），
 * 也证明不了英文态不溢出；那两件事由 `e2e/command-palette.spec.ts` 的几何断言与真机量具负责。
 * EP 升级若改了默认边距这里同样不会变红，要靠重跑 E2E 发现。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** Element Plus 2.14.4 给相邻按钮的默认左外边距（px），接管前净间距 = gap + 这个值 */
const EP_SIBLING_MARGIN_PX = 12;

/** 一处 footer 按钮行 */
interface FooterRow {
  /** 展示名，同时是 `rowOf` 的取用键 */
  name: string;
  /** 仓库相对路径，取其中的 `<style>` 块 */
  file: string;
  /** 容器选择器，`gap` 声明在它身上 */
  container: string;
  /** EP 相邻按钮边距的接管选择器，逐字写在源文件里（SFC 走 `:deep(...)`） */
  takeover: string;
  /** 该行预期的净间距（px），接管后应恒等于容器 `gap` */
  expectedGapPx: number;
}

const FOOTERS: FooterRow[] = [
  {
    name: '评价引导弹窗',
    file: 'components/options/ReviewPrompt.vue',
    container: '.review-prompt__actions',
    takeover: '.review-prompt__actions :deep(.el-button + .el-button)',
    expectedGapPx: 12,
  },
  {
    name: '个人信息库弹窗',
    file: 'components/options/IdentityVaultDialog.vue',
    container: '.identity-footer__left',
    takeover: '.identity-footer__left :deep(.el-button + .el-button)',
    expectedGapPx: 12,
  },
  {
    // 选择栏右侧那两枚文字按钮（隐藏/展开全部机密、折叠/展开全部）：同一文件里的第二个
    // 相邻按钮行，写着 gap 却没接管就是 24px，用户看到的正是「间距有点大」。
    // 8px 而非 footer 档的 12px：`link` 按钮盒子含 1px 透明边框 + `is-link` 的 2px 内边距，
    // 字面可见间距是 8+3×2=14px，与本弹窗卡片动作行的净间距同档（真机读数见
    // e2e/identity-vault-selectbar-density.spec.ts）。footer 那两排是成组的确认/取消动作，保持 12px。
    name: '个人信息库选择栏',
    file: 'components/options/IdentityVaultDialog.vue',
    container: '.identity-selectbar__actions',
    takeover: '.identity-selectbar__actions :deep(.el-button + .el-button)',
    expectedGapPx: 8,
  },
  {
    name: '关于抽屉',
    file: 'components/options/AboutDrawer.vue',
    container: '.about-footer',
    takeover: '.about-footer :deep(.el-button + .el-button)',
    // 400px 抽屉的紧凑档，收紧到 ≤8px 由 e2e/command-palette.spec.ts 钉住，不跟弹窗 footer 同档
    expectedGapPx: 6,
  },
];

/** 按展示名取登记表条目；登记表被改名时抛，而不是让判据静默空跑 */
function rowOf(name: string): FooterRow {
  const row = FOOTERS.find(item => item.name === name);
  if (!row) throw new Error(`登记表里没有名为 \`${name}\` 的条目`);
  return row;
}

/**
 * 取 e2e 对「关于」抽屉页脚两两间距的几何上限（px）
 *
 * 从 `e2e/command-palette.spec.ts` 现读，而不是在本文件再抄一份数字：那条断言早于本守卫存在，
 * 把抽屉页脚钉在 ≤8px，本守卫的 6px 例外口径正是因为它才不并入弹窗档。
 */
function e2eAboutGapCeiling(): number {
  const spec = readSource('e2e/command-palette.spec.ts');
  const m = spec.match(/间距没有收紧'\)\.toBeLessThanOrEqual\((\d+)\)/);
  if (!m) {
    throw new Error('e2e/command-palette.spec.ts 里「间距没有收紧」那两条几何断言的形态变了，联动口径需复核');
  }
  return Number.parseInt(m[1], 10);
}

/**
 * 取一个 SFC 里 `<style scoped>` 的 CSS 文本（已去注释）
 *
 * 只认 scoped 块，是判据的一部分而非省事：接管那条的选择器编译后是
 * `.容器[data-v-x] .el-button+.el-button`，特异性 (0,4,0)，稳压 EP 的 (0,2,0)；一旦有人把它挪进
 * 非 scoped 块，就掉到 (0,2,0)、胜负改由样式注入顺序决定——正是
 * `docs/ARCHITECTURE.md`「动作图标密度」一节记过的那类陷阱。挪出去即「规则找不到」而红。
 *
 * 必须先剥注释：解释「12px 从哪来」的注释里就写着 `.el-button + .el-button { margin-left: 12px }`
 * 这样的 CSS 形状片段，按选择器定位会命中注释而不是规则本身。
 */
function cssOf(file: string): string {
  const css = [...readSource(file).matchAll(/<style scoped>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  if (!css.trim()) throw new Error(`${file} 里没取到 <style scoped> 块`);
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 每个文件只读一次；变异一律在这份快照上做，不落磁盘 */
const cssCache = new Map<string, string>();
function cssFor(row: FooterRow): string {
  const cached = cssCache.get(row.file);
  if (cached !== undefined) return cached;
  const css = cssOf(row.file);
  cssCache.set(row.file, css);
  return css;
}

/** 一条规则的位置：声明体在原文中的起止偏移与正文 */
interface Rule {
  bodyStart: number;
  bodyEnd: number;
  body: string;
}

/**
 * 按选择器定位一条规则，支持逗号选择器列表
 *
 * 取首个命中：`@media` 档里可能重名声明，而本守卫关心的是决定间距的那条基线声明。
 */
function locateRule(css: string, selector: string, where: string): Rule {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = (match[1] ?? '').split(',').map(part => part.replace(/\s+/g, ' ').trim());
    if (!parts.includes(selector)) continue;
    const bodyStart = (match.index ?? 0) + match[1].length + 1;
    return { bodyStart, bodyEnd: bodyStart + match[2].length, body: match[2] };
  }
  throw new Error(`${where} 里没有 \`${selector}\` 这条规则`);
}

/** 从声明体里取一个属性的值；缺失即抛，不让「属性被删」读成「值不同」 */
function decl(body: string, prop: string, selector: string): string {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+?)\\s*(?:;|$)`));
  if (!m) throw new Error(`\`${selector}\` 里没有 \`${prop}\` 声明`);
  return m[1];
}

/** 一处 footer 的两条间距来源，外加由它们相加得到的净间距 */
function densityOf(css: string, row: FooterRow): { gap: string; margin: string; netGap: number } {
  const gap = decl(locateRule(css, row.container, row.name).body, 'gap', row.container);
  const margin = decl(locateRule(css, row.takeover, row.name).body, 'margin-left', row.takeover);
  return { gap, margin, netGap: Number.parseFloat(gap) + Number.parseFloat(margin) };
}

/** 只改写某一条规则里的某个声明（全局首个匹配可能改到不相干的规则，故先定位再替换） */
function rewriteDecl(css: string, selector: string, prop: string, value: string, where: string): string {
  const { bodyStart, bodyEnd, body } = locateRule(css, selector, where);
  const pattern = new RegExp(`${prop}:[^;]+;`);
  if (!pattern.test(body)) throw new Error(`${where} 里 \`${selector}\` 没有 \`${prop}\` 声明，变异串是空的`);
  return css.slice(0, bodyStart) + body.replace(pattern, `${prop}: ${value};`) + css.slice(bodyEnd);
}

/** 跑一段可能抛异常的判据，把「规则不存在」转成可读标记，供变异自证使用 */
function probe(run: () => unknown): string {
  try {
    run();
    return 'ok';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('弹窗 / 抽屉 footer 一排文字按钮的间距', () => {
  it('四处按钮行的净间距各自等于登记的预期值', () => {
    for (const row of FOOTERS) {
      const { gap, margin, netGap } = densityOf(cssFor(row), row);
      expect(Number.parseFloat(gap), `${row.name}：容器 gap 不是登记的 ${row.expectedGapPx}px（${gap}）`).toBe(
        row.expectedGapPx,
      );
      expect(margin, `${row.name}：EP 的 ${EP_SIBLING_MARGIN_PX}px 相邻按钮边距没有被接管成 0`).toBe('0');
      expect(netGap, `${row.name}：净间距 ${netGap}px，说明 gap 与 EP 边距又叠加了`).toBe(row.expectedGapPx);
    }
  });

  it('「关于」抽屉的紧凑档与 e2e 几何上限同源，不各写一份', () => {
    // 上限从 e2e/command-palette.spec.ts 解析，不抄第二份数字：那条断言先于本守卫存在，
    // 把抽屉页脚钉在 ≤8px；谁要放宽，必须两处一起改，而不是只改一边留下静默冲突
    const ceiling = e2eAboutGapCeiling();
    const row = rowOf('关于抽屉');
    expect(row.expectedGapPx, `抽屉页脚 gap ${row.expectedGapPx}px 超出 e2e 的 ≤${ceiling}px 上限`).toBeLessThanOrEqual(
      ceiling,
    );
    expect(ceiling, 'e2e 上限被放宽到弹窗档，本守卫的例外口径需要重写').toBeLessThan(FOOTERS[0].expectedGapPx);
  });

  it('单侧漂移与摘掉接管都会被读出来（判据不是写死的）', () => {
    for (const row of FOOTERS) {
      const css = cssFor(row);
      const mutatedGap = row.expectedGapPx === 20 ? 33 : 20;

      const widened = rewriteDecl(css, row.container, 'gap', `${mutatedGap}px`, row.name);
      expect(
        Number.parseFloat(decl(locateRule(widened, row.container, row.name).body, 'gap', row.container)),
        `${row.name}：gap 改成 ${mutatedGap}px 却没被读到，判据是写死的`,
      ).toBe(mutatedGap);

      // 把接管放回 EP 默认值：净间距必须跟着加上那 12px，否则它不是算出来的
      const restored = rewriteDecl(css, row.takeover, 'margin-left', `${EP_SIBLING_MARGIN_PX}px`, row.name);
      expect(
        densityOf(restored, row).netGap,
        `${row.name}：margin 回到 ${EP_SIBLING_MARGIN_PX}px，净间距读数没变`,
      ).toBe(row.expectedGapPx + EP_SIBLING_MARGIN_PX);

      // 只删掉这一处的接管选择器：判据必须落在「接管缺失」上，而不是整条规则一起消失
      const dropped = css.replace(`${row.takeover} {`, `${row.takeover}-x {`);
      expect(dropped, `${row.name}：变异串没匹配上，这一维的自证是空跑`).not.toBe(css);
      expect(
        probe(() => densityOf(dropped, row)),
        `${row.name}：摘掉接管后判据仍然通过`,
      ).not.toBe('ok');
      expect(
        decl(locateRule(dropped, row.container, row.name).body, 'gap', row.container),
        `${row.name}：变异顺带弄坏了容器规则，自证落不到「接管缺失」这一维上`,
      ).toBe(`${row.expectedGapPx}px`);
    }
  });

  it('个人信息库 footer 保持「关闭」右对齐（space-between 是确认过的设计决定）', () => {
    const css = cssFor(rowOf('个人信息库弹窗'));
    expect(
      decl(locateRule(css, '.identity-footer', '个人信息库弹窗').body, 'justify-content', '.identity-footer'),
      '「关闭」不再常驻右缘，属交互位置变更',
    ).toBe('space-between');
  });

  it('「关于」抽屉三个按钮走默认档，不得退回 size="small"', () => {
    const src = readSource(rowOf('关于抽屉').file);
    const start = src.indexOf('<template #footer>');
    expect(start, '找不到 footer 模板块，判据落点已失效').toBeGreaterThan(-1);
    const footer = src.slice(start, src.indexOf('</template>', start));
    expect(footer.includes('size="small"'), 'footer 按钮退回 small 档（12px 字 / 24px 高）').toBe(false);
    expect((footer.match(/<el-button/g) ?? []).length, 'footer 按钮数量变了，本条守卫需一并复核').toBe(3);
  });

  it('扫描本身有效：三份文件、八条声明与 e2e 上限都真的读到了', () => {
    for (const row of FOOTERS) {
      expect(
        probe(() => densityOf(cssFor(row), row)),
        `${row.name}：两条间距声明取不全`,
      ).toBe('ok');
    }
    expect(e2eAboutGapCeiling(), 'e2e 几何上限没抽到，联动那条判据是空跑').toBeGreaterThan(0);
  });
});

/**
 * 模板上写了 `class="dialog-footer"`，本地就必须真的有这条声明
 *
 * 上一节的注释记着：`entrypoints/options/styles.css` 里那条 `.dialog-footer` 编译后带 App 的
 * scope id，对 teleport 到 body 的弹窗内容一概不生效。于是类名没有本地声明时不是「样式没写全」，
 * 而是**一个看起来生效的装饰**——渲染结果只是恰好由 `.el-dialog__footer { text-align: right }`
 * 兜住了，读代码的人却会以为页脚由这条类管着。2026-10-26 一轮「把页脚并到 `.dialog-footer` 约定」
 * 的改动就只加了 `<div class="dialog-footer">` 就收工，三个弹窗的页脚其实什么都没变。
 *
 * 例外表 `UNDECLARED` 是**已知未修**清单，不是「允许新增」的口子：加一项等于承认又留了一处死类名，
 * 故第三判据反过来盯它——例外一旦被修好，条目必须删掉，否则红。
 */
const UNDECLARED: Record<string, string> = {
  'components/options/ValiditySettingDialog.vue':
    '整个文件没有 `<style>` 块，`.form-tip` 同样落空；补声明会把提示文字从默认 14px 变成 12px 柔和色，属可见变化，待用户拍板',
};

/** 用了 `class="dialog-footer"` 的源文件（仓库相对路径，去重） */
function dialogFooterUsers(): string[] {
  return [...new Set([...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])])].filter(
    file => readSource(file).includes('class="dialog-footer"'),
  );
}

/**
 * 该文件是否在自己的 `<style>` 块里**真有一条** `.dialog-footer` 规则
 *
 * 只 grep 原文会被注释蒙过——在任意注释里写一句 `.dialog-footer {` 就能让「死类名」判据通过，
 * 而类名依旧没有生效。故这里剥掉注释、且只认 `<style>` 块内的声明，与上面 `cssOf()` 同一口径；
 * 区别是本判据不要求 scoped：非 scoped 块里的同名规则同样真实生效（特异性更低，但仍生效）。
 */
function declaresDialogFooter(file: string): boolean {
  const styleBlocks = [...readSource(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  return styleBlocks.some(css => /^\.dialog-footer\s*\{/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
}

describe('`.dialog-footer` 类名不得只写在模板上', () => {
  const users = dialogFooterUsers();

  it('扫描本身有效：使用方一个都没漏（登记表之外新增死类名会在这里露出来）', () => {
    expect(
      users.length,
      '只读到 ' + users.length + ' 处使用方，`class="dialog-footer"` 的写法或目录已变',
    ).toBeGreaterThanOrEqual(18);
  });

  it('每处使用方都自带 `.dialog-footer` 声明，例外必须登记', () => {
    for (const file of users) {
      if (UNDECLARED[file]) continue;
      expect(declaresDialogFooter(file), `${file} 用了 class="dialog-footer" 却没有本地声明——类名是死的`).toBe(true);
    }
  });

  it('登记表的例外确实还缺声明（修好了就删掉，不让例外变成永久豁免）', () => {
    for (const [file, reason] of Object.entries(UNDECLARED)) {
      expect(users, `${file} 已不在使用方里，例外该删（${reason}）`).toContain(file);
      expect(declaresDialogFooter(file), `${file} 已补上声明，例外条目该删（${reason}）`).toBe(false);
    }
  });
});
