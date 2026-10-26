/**
 * 弹窗定位约定守卫：所有 `el-dialog` 一律垂直+水平居中
 *
 * 本仓库的弹窗只有一种定位：`el-dialog` 上挂 `align-center`。它同时解决两件事——
 * 1. EP 默认定位是 `top: 15vh` + 水平 margin 居中，**只有水平居中**，短窗口里视觉上明显偏下；
 * 2. 内容高过视口时，`top: 15vh` 会把弹窗往下推，溢出部分交给**页面级**滚动条：
 *    用户看到的是「弹窗没居中 + 整个管理页多了一根滚动条」，滚动还会连带背景列表一起走。
 *    `align-center` 把滚动收进遮罩层（`.el-overlay` 自身 `overflow: auto` + 弹窗 `margin: auto`），
 *    放得下就居中，放不下就在遮罩里滚、顶部不会被裁掉。
 *
 * 2026-10-26 用户就「改密弹窗没居中」点过一次名，并要求形成规范。此前它是唯一不带
 * `align-center` 的表单弹窗（更早一轮为了「不动存量定位」特意排除它），所以这条判据
 * 同时是对那次例外的更正。
 *
 * 配套的另一半约定在 `recoveryDialogScrollWiring.test.ts`：内容可能超长的弹窗，
 * 内滚走全局 `.dialog-body-scroll`，不许自造 `max-height`，也不许和那层再套一层。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 抽出每个 `<el-dialog ...>` 开标签（含跨行属性） */
function dialogOpenTags(relPath: string): string[] {
  const source = readSource(relPath);
  return [...source.matchAll(/<el-dialog\b[\s\S]*?>/g)].map(match => match[0]);
}

describe('弹窗一律 align-center 居中', () => {
  const files = [...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])];
  const withDialog = files.filter(rel => dialogOpenTags(rel).length > 0);
  const allTags = withDialog.flatMap(rel => dialogOpenTags(rel).map(tag => `${rel}\n${tag}`));

  it('确实扫到了弹窗，否则这条判据是空跑', () => {
    expect(withDialog.length).toBeGreaterThan(20);
    expect(allTags.length).toBeGreaterThan(25);
  });

  it('每个 el-dialog 都带 align-center', () => {
    const missing = withDialog
      .flatMap(rel =>
        dialogOpenTags(rel)
          .filter(tag => !/\balign-center\b/.test(tag))
          .map(tag => `${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`),
      )
      .sort();
    expect(missing, `这些弹窗没有居中：\n${missing.join('\n')}`).toEqual([]);
  });

  it('没有弹窗用 top 自行定位（那是 EP 默认的偏下定位，回到老问题）', () => {
    const offenders = withDialog
      .flatMap(rel =>
        dialogOpenTags(rel)
          .filter(tag => /\s(?::)?top=/.test(tag))
          .map(tag => `${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`),
      )
      .sort();
    expect(offenders, `这些弹窗又用 top 手动定位：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('没有弹窗用 CSS 覆盖回非居中定位', () => {
    const offenders: string[] = [];
    const files = [...withDialog, ...listSourceFiles('entrypoints', ['.css']), ...listSourceFiles('assets', ['.css'])];
    for (const rel of files) {
      const source = readSource(rel);
      // 只看**弹窗盒子本身**（`.el-dialog` / `.el-dialog.xxx`），不看 `.el-dialog__body`
      // 这类内部元素——它们的外边距是排版细节，不会把弹窗顶离中心。
      for (const match of source.matchAll(/(^|[\s,}])(\.el-dialog(?:\.[\w-]+)*)\s*\{([^}]*)\}/gm)) {
        const declarations = match[3]
          .split(/[;{\n]/)
          .map(line => line.trim())
          .filter(line => /^(margin|top)(-[a-z-]+)?\s*:/.test(line));
        if (declarations.length) offenders.push(`${rel}: ${match[2]} { ${declarations.join('; ')} }`);
      }
    }
    expect(offenders, `这些规则会把居中弹窗顶回去：\n${offenders.join('\n')}`).toEqual([]);
  });
});
