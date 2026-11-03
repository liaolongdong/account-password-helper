/** @vitest-environment jsdom */

/**
 * 偏好设置面板的行序契约
 *
 * 面板九行共用一份 HTML（`getSettingsPanelHTML` 被 Options、悬浮按钮、侧边栏三处消费），
 * 所以「哪一行在上面」是一次改动、三处生效的对外承诺，而不是内部排版。排序口径按使用频率：
 * 环境与视觉项（主题、语言）之后，先是每次填充都会碰到的行为项（显示悬浮按钮、快速填充方式），
 * 再是「字段上会发生什么」的两颗开关（个人信息字段提示、自动触发登录、密码显示切换），
 * 最后才是低频的技术与外观项（Shadow DOM 穿透、按钮透明度）。
 * 「个人信息字段提示」此前沉在 Shadow 之后——新功能在面板里越靠后，用户越找不到。
 *
 * 三条判据：
 * 1. `[data-setting]` 的整体序列（挪一行而忘记另一行的历史事故就红在这里）；
 * 2. 带提示语的开关，其提示语必须紧跟自己那一行（搬行时把 tip 落在别处会红）；
 * 3. 帮助文案列举这两项时的相对顺序与面板一致，且不得整条漏掉个人信息字段提示。
 *
 * 刻意不钉的：行的视觉高度与滚动位置（jsdom 不排版），以及帮助文案的其余措辞——
 * 第 3 条只按两项的相对位置判定，改写成同义词仍算通过，避免守卫把文案钉死。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { getSettingsPanelHTML } from '@/entrypoints/content/floatingButtons/settingsPanelView';
import type { FloatingButtonConfig } from '@/utils/types';

const ROOT = path.resolve(__dirname, '../..');

const makeConfig = (): FloatingButtonConfig => ({
  visible: true,
  position: 'right',
  offsetY: 0,
  opacity: 0.9,
  autoShowSidepanel: true,
  autoTriggerLogin: false,
  passwordVisibilityToggle: false,
  fillMode: 'sidepanel',
  theme: 'sky',
});

const mount = () => {
  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.innerHTML = getSettingsPanelHTML(makeConfig());
  document.body.appendChild(root);
  return root;
};

/** 面板里「行 → 自己的提示语」的配对关系：只有这四项带 tip */
const TIP_OF_SWITCH: Record<string, string> = {
  autoTriggerLogin: 'autoTriggerTip',
  passwordVisibilityToggle: 'passwordVisibilityTip',
  penetrateShadow: 'penetrateShadowTip',
  identityHintEnabled: 'identityHintTip',
};

/** 帮助面板里枚举偏好设置条目的两条（概念篇与常见问题篇），中英文各一份；词条键名带 `help.` 前缀 */
const HELP_ENTRIES = [
  ['zh-CN', 'help.gc.2'],
  ['zh-CN', 'help.fc.5'],
  ['en', 'help.gc.2'],
  ['en', 'help.fc.5'],
] as const;

/** 两项在帮助文案里的既有写法：只用来定位，不做措辞约束 */
const MENTION: Record<'zh-CN' | 'en', { identity: RegExp; shadow: RegExp }> = {
  'zh-CN': { identity: /个人信息字段提示/, shadow: /Shadow DOM 穿透/ },
  en: { identity: /personal-field hints/i, shadow: /Shadow DOM penetration/i },
};

const helpText = (locale: 'zh-CN' | 'en', key: string): string =>
  JSON.parse(readFileSync(path.join(ROOT, 'utils/i18n/locales', locale, 'help.json'), 'utf-8'))[key];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('偏好设置面板行序', () => {
  it('九行按使用频率排定：个人信息字段提示紧跟快速填充方式、排在 Shadow DOM 穿透之前', () => {
    const root = mount();

    const order = [...root.querySelectorAll<HTMLElement>('[data-setting]')].map(el => el.dataset.setting);

    expect(order).toEqual([
      'theme',
      'locale',
      'visible',
      'fillEntry',
      'identityHintEnabled',
      'autoTriggerLogin',
      'passwordVisibilityToggle',
      'penetrateShadow',
      'opacity',
    ]);
  });

  it('每颗开关的提示语紧跟自己那一行，行与 tip 不会被拆到两处', () => {
    const root = mount();
    const children = [...root.querySelector('.settings-content')!.children];

    Object.entries(TIP_OF_SWITCH).forEach(([setting, tipKey]) => {
      const row = children.findIndex(
        el => el.classList.contains('setting-item') && el.querySelector(`[data-setting="${setting}"]`),
      );
      expect(row, `${setting} 那一行没找到`).toBeGreaterThan(-1);
      const tip = children[row + 1];
      expect(tip?.classList.contains('setting-tip'), `${setting} 的下一格不是提示语`).toBe(true);
      expect(tip?.getAttribute('data-i18n'), `${setting} 的提示语配错`).toBe(tipKey);
    });
  });

  it('帮助文案里「个人信息字段提示」既不漏写，也排在 Shadow DOM 穿透之前', () => {
    HELP_ENTRIES.forEach(([locale, key]) => {
      const text = helpText(locale, key);
      const identity = text.search(MENTION[locale].identity);
      const shadow = text.search(MENTION[locale].shadow);

      expect(identity, `${locale} ${key} 漏了个人信息字段提示`).toBeGreaterThan(-1);
      expect(shadow, `${locale} ${key} 漏了 Shadow DOM 穿透`).toBeGreaterThan(-1);
      expect(identity, `${locale} ${key} 的列举顺序与面板不一致`).toBeLessThan(shadow);
    });
  });
});
