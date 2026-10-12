/**
 * 「关于」抽屉里的开源许可说明必须与仓库真实许可同源
 *
 * 起因：`AboutDrawer.vue` 上线时那句许可说明写的是 MIT，而仓库的 `LICENSE` 与
 * `package.json` 的 `license` 字段都是 `GPL-3.0-only`（README「📄 许可证」一节还专门记了
 * 「历史版本按 MIT 存续、切换后的新版本起 GPL-3.0」）。密码管理器的「关于」页把许可证
 * 说错，用户据此以为衍生分发可以闭源，代价落在作者身上。
 *
 * 判据取 `package.json` 的 SPDX 标识为真源，而不是在本测试里再抄一份期望值：
 * 许可一旦再变更，本守卫会要求界面文案跟着改，而不是两个方向各说一套。
 * 界面文案只写 `GPL-3.0`（SPDX 去掉 `-only` 后缀），因为「仅 v3、不含或更高版本」
 * 这半句在 UI 里由 `options.about.license` 自己表述，不由 SPDX 拼出来。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** 仓库真实许可（SPDX），例如 `GPL-3.0-only` */
const PKG_LICENSE: string = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).license;

/** 界面文案里应出现的那一段（去掉 `-only` / `-or-later` 这类后缀） */
const UI_LICENSE_ID = PKG_LICENSE.split(/-(only|or-later)$/)[0];

/** 常见许可证标识，用于反向判定：文案里出现了「另一个」许可证就是漂移 */
const KNOWN_LICENSE_IDS = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0', 'LGPL-3.0', 'MPL-2.0'];

/** 读某一语言包里的 `options.about.license` */
const licenseLine = (locale: string): string => {
  const messages = JSON.parse(readFileSync(path.join(ROOT, 'utils/i18n/locales', locale, 'options.json'), 'utf-8'));
  const value: unknown = messages['options.about.license'];
  expect(typeof value, `${locale} 缺少 options.about.license`).toBe('string');
  return value as string;
};

describe('「关于」抽屉的开源许可说明', () => {
  it('中英文都写明真实许可证，且与 package.json 同源', () => {
    for (const locale of ['zh-CN', 'en']) {
      const line = licenseLine(locale);
      expect(line, `${locale} 的许可说明没写明 ${UI_LICENSE_ID}`).toContain(UI_LICENSE_ID);
    }
  });

  it('中英文都没有把许可证说成别的', () => {
    for (const locale of ['zh-CN', 'en']) {
      const line = licenseLine(locale);
      const wrong = KNOWN_LICENSE_IDS.filter(
        id => id !== UI_LICENSE_ID && !UI_LICENSE_ID.startsWith(id) && line.includes(id),
      );
      expect(wrong, `${locale} 的许可说明混进了 ${wrong.join(' / ')}`).toEqual([]);
    }
  });

  it('许可全文有可达出口（GPL 要求被分发方能方便读到条款）', () => {
    const drawer = readFileSync(path.join(ROOT, 'components/options/AboutDrawer.vue'), 'utf-8');
    // 必须是「链接项里真的用了它」，而不是文件里出现过这个标识符：只在 import 里出现
    // 也算通过，那种抽屉用户照样点不到全文（变异法实测：删掉那一行时旧判据仍绿）。
    expect(drawer, '抽屉的链接清单里没有指向 REPO_LICENSE_URL 的那一项').toMatch(/\{\s*href:\s*REPO_LICENSE_URL\b/);
    const urls = readFileSync(path.join(ROOT, 'utils/urls.ts'), 'utf-8');
    expect(urls).toMatch(/export const REPO_LICENSE_URL = `\$\{REPO_GITHUB_URL\}\/blob\/main\/LICENSE`;/);
    for (const locale of ['zh-CN', 'en']) {
      const messages = JSON.parse(
        readFileSync(path.join(ROOT, 'utils/i18n/locales', locale, 'options.json'), 'utf-8'),
      ) as Record<string, string>;
      expect(messages['options.about.linkLicense'], `${locale} 缺少许可证那一行的文案`).toBeTruthy();
    }
  });
});
