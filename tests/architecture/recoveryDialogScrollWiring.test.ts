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
   * 改密弹窗是存量界面：非恢复用户看到的宽度、关闭按钮与滚动行为必须与改造前一致，
   * 内滚只允许出现在「换发套件」这一步（恢复启用后才存在的新状态）。
   */
  it('改密弹窗保持既有呈现，只为换发套件这一步引入统一滚动', () => {
    const text = source('components/options/ChangeMasterPasswordDialog.vue');
    expect(text).toContain('width="440px"');
    expect(text, '改密弹窗不得改成 align-center（会动到既有定位）').not.toMatch(/^\s*align-center$/m);
    expect(text, '改密弹窗不得整体裹上内滚容器').not.toMatch(/max-height:\s*65vh/);
    expect(text).toContain('<div class="dialog-body-scroll">');
  });
});
