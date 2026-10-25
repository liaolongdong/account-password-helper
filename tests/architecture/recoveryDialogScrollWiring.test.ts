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
import { listSourceFiles } from '../helpers/architectureScan';

const source = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8');

/** 已知在各自样式块里复制了 `.dialog-body-scroll` 的八个弹窗（长出第九个即变红） */
const LOCAL_SCROLL_DUPLICATES = [
  'components/options/ClipboardSettingDialog.vue',
  'components/options/DomainMatchSettingDialog.vue',
  'components/options/FavoriteLimitSetting.vue',
  'components/options/IdentityVaultAccessSetting.vue',
  'components/options/IdleLockSetting.vue',
  'components/options/PasswordHistorySettingDialog.vue',
  'components/options/ShortcutSettingDialog.vue',
  'components/sidepanel/QuickAddDialog.vue',
];

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

  /**
   * 已知重复，冻住不许再长：八个弹窗在各自的样式块里逐字复制了一份
   * `.dialog-body-scroll`，只有 `max-height` 与全局那份不同（本地 60vh / 全局 70vh）。
   * scoped 规则编译后带 `[data-v-*]`，特异性高于全局那条，所以这八个弹窗实际吃的是 60vh——
   * `entrypoints/options/App.vue` 注释里「一套机制」的说法在实践上已经裂成两档高度。
   *
   * 删掉副本、统一回 70vh 会让这八个弹窗的内容区高出 10vh，属**视觉变化**；
   * 2026-10-26 用户已就「擅自改视觉」回退过一轮，因此这里不改色不改高度，只做两件事：
   * 集合等式锁住「就这八个」（长出第九份即变红），并锁住副本除 `max-height` 外
   * 不与全局漂移（免得出现第三种高度）。真要统一，先问用户。
   */
  it('.dialog-body-scroll 的本地副本冻结在已知八个，且只允许 max-height 与全局不同', () => {
    const globalBlock = source('entrypoints/options/App.vue').match(/\.dialog-body-scroll\s*\{([^}]*)\}/)?.[1];
    expect(globalBlock, '全局 .dialog-body-scroll 定义找不到').toBeTruthy();
    const globalProps = new Set(
      globalBlock!
        .split(';')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(':')[0].trim()),
    );

    const duplications = new Map<string, string>();
    for (const rel of [...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])]) {
      if (rel === 'entrypoints/options/App.vue') continue;
      const block = source(rel).match(/\.dialog-body-scroll\s*\{([^}]*)\}/)?.[1];
      if (block) duplications.set(rel, block);
    }
    expect([...duplications.keys()].sort()).toEqual(LOCAL_SCROLL_DUPLICATES);

    for (const [rel, block] of duplications) {
      const props = block
        .split(';')
        .map(line => line.trim())
        .filter(Boolean);
      for (const declaration of props) {
        const property = declaration.split(':')[0].trim();
        expect(globalProps.has(property), `${rel} 的副本多出属性 ${property}`).toBe(true);
      }
      const heights = props.filter(line => line.startsWith('max-height')).map(line => line.split(':')[1].trim());
      expect(heights, `${rel} 的副本应且只应声明一个 max-height`).toHaveLength(1);
      expect(['60vh', '70vh'], `${rel} 的 max-height 是第三种值`).toContain(heights[0]);
    }
  });
});
