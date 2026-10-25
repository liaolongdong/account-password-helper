/**
 * 恢复弹窗的滚动与定位约定守卫
 *
 * 本仓库的弹窗滚动只有一套机制：`el-dialog` 上 `align-center` + 正文裹一层全局
 * `.dialog-body-scroll`（`entrypoints/options/App.vue` 定义 70vh、细滚动条）。
 * 新组件另起炉灶自造 `max-height: 65vh` 会带来两个后果：短窗口下 footer 被推出折叠线，
 * 以及同一页面里出现两种滚动条样式。这类「又复制了一份机制」的问题 ESLint 与 Stylelint
 * 都看不见，只能靠源码文本断言钉住（与 `dialogFooterDensityWiring.test.ts` 同一手法）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('恢复相关弹窗沿用统一的滚动约定', () => {
  it.each(['components/options/RecoverySettingsDialog.vue', 'components/options/RecoveryResetDialog.vue'])(
    '%s 使用 align-center 与 .dialog-body-scroll',
    file => {
      const text = source(file);
      expect(text, `${file} 缺少 align-center`).toMatch(/align-center/);
      expect(text, `${file} 正文未走 .dialog-body-scroll`).toContain('class="dialog-body-scroll');
      expect(text, `${file} 仍在自造内滚高度`).not.toMatch(/max-height:\s*65vh/);
    },
  );

  /**
   * 改密弹窗的定位在 2026-10-26 由用户改口：它此前是唯一不带 `align-center` 的表单弹窗，
   * 内容高过视口时会出现页面级滚动条、弹窗既不水平也不垂直居中。用户要求「与插件整体风格一致」，
   * 因此现在必须跟其余弹窗一样走 `align-center`。
   * 但内滚仍然只允许出现在「换发套件」这一步——外层再裹一层 `.dialog-body-scroll` 会变成
   * 70vh 套 70vh 的双滚动容器，短窗口下出现两条滚动带、内容被压扁。
   */
  it('改密弹窗：定位跟全站统一，内滚仍只加在换发套件那一步', () => {
    const text = source('components/options/ChangeMasterPasswordDialog.vue');
    expect(text, '改密弹窗宽度是存量呈现，不动').toContain('width="440px"');
    expect(text, '改密弹窗缺少 align-center').toMatch(/^\s*align-center$/m);
    expect(text, '改密弹窗不得整体裹上内滚容器（会与套件步骤那层嵌套成双滚动条）').toMatch(
      /<div\s*\n\s*v-if="modelValue"\s*\n\s*ref="sensitiveRoot"\s*\n\s*>/,
    );
    expect(text, '「换发套件」这一步仍走全局 .dialog-body-scroll 约定').toContain('<div class="dialog-body-scroll">');
    expect(text, '不得自造内滚高度').not.toMatch(/max-height:\s*65vh/);
  });
});
