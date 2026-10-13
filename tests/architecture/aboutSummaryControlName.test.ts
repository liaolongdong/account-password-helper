/**
 * 「关于」简介里带引号引用的开关名，必须是偏好设置面板上真实显示的标签
 *
 * 起因：`options.about.summary` 的英文版写的是 `'Auto login trigger'`，而面板里那颗开关的
 * 英文标签一直是 `Auto-submit login`（`settingsPanelView.ts` 的 `PANEL_MESSAGES.en`，
 * `help.json` / `onboarding.json` 的英文条目也用这个名字）。简介是用户读到「这个行为由哪个
 * 开关控制、去哪儿找」的唯一位置，名字对不上就是照着简介找不到设置项；而两处都只是字符串，
 * typecheck 与 lint 都看不见这类漂移。
 *
 * 判据以 `PANEL_MESSAGES` 为真源，测试里不抄期望值：面板改名时守卫会要求简介跟着改，
 * 而不是两处各说一套。中文用直角引号、英文用单引号，按语言各自的引用形态取。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const PANEL_VIEW = 'entrypoints/content/floatingButtons/settingsPanelView.ts';

/** 参与核对的语言，顺序与 `PANEL_MESSAGES` 里的块顺序一致 */
const LOCALES = ['zh-CN', 'en'] as const;

/** 面板双语文案块在源文件里的起始标记（缩进属于对象字面量的一层，写死以便形状变了就红） */
const BLOCK_MARK: Record<(typeof LOCALES)[number], string> = {
  'zh-CN': "\n  'zh-CN': {",
  en: '\n  en: {',
};

/**
 * 语言块的结束边界：缩进两层的 `},`
 *
 * 只认这一层，是因为块内再嵌套的对象都写在更深的缩进上；用它切出来的正好是某一语言的
 * 标签集合。早先按「对象字面量的收尾 `};`」切，en 作为最后一块会一路吃进下面的渲染代码，
 * 把 `'✓ '`、`'fillSidebar'` 之类也当成合法标签——判据就松了。
 */
const BLOCK_CLOSE = '\n  },';

/** 简介里引用界面控件名的引号形态 */
const QUOTED: Record<(typeof LOCALES)[number], RegExp> = {
  'zh-CN': /「([^」]+)」/g,
  en: /'([^']+)'/g,
};

/** `PANEL_MESSAGEKey` 的键数：抽出的标签少于这个数，说明抽取口径失配而不是文案变了 */
const PANEL_LABEL_FLOOR = 14;

/** 取面板某个语言块的原文（起点为该语言的标记，终点为该块的 `},`） */
function panelBlock(source: string, locale: (typeof LOCALES)[number]): string {
  const start = source.indexOf(BLOCK_MARK[locale]);
  expect(start, `PANEL_MESSAGES 里 ${locale} 那一块的形状变了：本条判据需要跟着重新确认`).toBeGreaterThan(-1);

  const end = source.indexOf(BLOCK_CLOSE, start);
  expect(end, `${locale} 那一块的结束边界找不到`).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** 从一个块里抽出全部单引号标签值 */
function panelLabels(block: string): string[] {
  return [...block.matchAll(/:\s*'([^']*)'/g)].map(match => match[1]);
}

/** 读某一语言包 `options.about.summary` 里带引号引用的控件名 */
function quotedControls(locale: (typeof LOCALES)[number]): string[] {
  const messages = JSON.parse(readSource(`utils/i18n/locales/${locale}/options.json`)) as Record<string, string>;
  const summary = messages['options.about.summary'];
  expect(typeof summary, `${locale} 缺少 options.about.summary`).toBe('string');
  return [...summary.matchAll(QUOTED[locale])].map(match => match[1]);
}

describe('「关于」简介引用的开关名与面板标签同源', () => {
  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    const panelView = readSource(PANEL_VIEW);
    expect(panelView).toContain('PANEL_MESSAGES');
    for (const locale of LOCALES) {
      // 正向对照：标签抽取真的拿到一整块，否则下面的「包含」判据会因为集合为空而假绿
      expect(panelLabels(panelBlock(panelView, locale)).length, `${locale} 的标签抽取少于预期`).toBeGreaterThanOrEqual(
        PANEL_LABEL_FLOOR,
      );
      expect(quotedControls(locale).length, `${locale} 的简介里没有带引号引用的控件名：判据已空跑`).toBeGreaterThan(0);
    }
  });

  it('简介里带引号引用的开关名，在对应语言的面板标签里真实存在', () => {
    const panelView = readSource(PANEL_VIEW);
    for (const locale of LOCALES) {
      const labels = new Set(panelLabels(panelBlock(panelView, locale)));
      for (const control of quotedControls(locale)) {
        expect([...labels], `${locale} 的简介引用了面板上不存在的名字「${control}」`).toContain(control);
      }
    }
  });
});
