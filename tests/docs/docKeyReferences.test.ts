/**
 * 文档里引用的 i18n key 必须真实存在，且文档不得逐字抄产品文案
 *
 * 两条判据来自同一次真实漂移：2026-10-26 那轮把改密弹窗的恢复套件提示改成
 * 「原来的那份恢复套件改完即失效，需要重新保存新生成的恢复套件」之后，
 * `docs/ARCHITECTURE.md` 里那句被引号框住的原话（「手上这份旧套件即将作废」）
 * 和英文版那句（"the kit you hold is about to die"）双双变成**产品里已经不存在的死引用**，
 * 而没有任何测试会发现——文档不参与编译，改文案的人也不会想到要去搜引号。
 *
 * 所以这里做两件事：
 * 1. 文档改成引用**稳定的标识**（i18n key）。本文件校验这些 key 在中英文语言包里都在，
 *    否则等于把死引用从文案换成另一处死引用。
 * 2. 把那句被抄进文档的产品原话钉成禁止复现的字面量：谁再把它抄回来，这里变红。
 *
 * 抽取口径有两处坑，都是实测踩到的：
 * - 反引号里的点分标识不全是 key，`options.json` / `sidepanel.html` 是文件名，
 *   而 `sidepanel` 又正好是个命名空间——只看首段会把文件名当成 key。因此按扩展名排除。
 * - 只认「首段命中某个真实命名空间」的引用，`chrome.storage.local` 这类不会误报。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const LOCALE_DIR = path.join(ROOT, 'utils', 'i18n', 'locales');

/** 文档侧要一起守的对外表面（帮助弹窗的文案本体在 locale 里，不在此列） */
const DOC_FILES = [
  'docs/ARCHITECTURE.md',
  'docs/ARCHITECTURE.en.md',
  'README.md',
  'README.en.md',
  'docs/store/CWS_FILL_CONTENT.md',
  'docs/store/CWS_PUBLISHING_GUIDE.md',
].filter(file => existsSync(path.join(ROOT, file)));

function flatLocale(locale: string): Record<string, string> {
  const dir = path.join(LOCALE_DIR, locale);
  const merged: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    Object.assign(merged, JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<string, string>);
  }
  return merged;
}

const ZH = flatLocale('zh-CN');
const NAMESPACES = new Set(Object.keys(ZH).map(key => key.split('.')[0]));
const FILE_EXTENSIONS = /\.(json|ts|tsx|js|mjs|cjs|vue|md|css|scss|html|png|svg|zip|aph|aphid|csv)$/i;

/** 文档里以反引号标出的、看起来像 i18n key 的引用 */
function referencedKeys(): { key: string; files: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const file of DOC_FILES) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(/`([a-z][\w-]*(?:\.[\w-]+)+)`/g)) {
      const key = match[1];
      if (!NAMESPACES.has(key.split('.')[0]) || FILE_EXTENSIONS.test(key)) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), file]);
    }
  }
  return [...byKey.entries()].map(([key, files]) => ({ key, files }));
}

const RETIRED_COPY_QUOTES: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  {
    file: 'docs/ARCHITECTURE.md',
    text: '「手上这份旧套件即将作废」',
    reason: '该句已改写为点明「原来那份失效 / 保存新生成的那份」，文档请引 key 而不是抄原话',
  },
  {
    file: 'docs/ARCHITECTURE.en.md',
    text: 'the kit you hold is about to die',
    reason: '同上；英文文档也不该内嵌产品文案的字面翻译',
  },
];

describe('文档与 i18n 的引用关系', () => {
  const refs = referencedKeys();

  it('确实扫到文档引用了 i18n key（否则本文件是空跑）', () => {
    expect(DOC_FILES.length).toBeGreaterThanOrEqual(4);
    expect(refs.length).toBeGreaterThanOrEqual(8);
  });

  it('每个被引用的 key 在中英文语言包中都存在且非空', () => {
    const en = flatLocale('en');
    const missing = refs.flatMap(ref =>
      [
        [!ZH[ref.key]?.trim() && 'zh-CN', !en[ref.key]?.trim() && 'en']
          .filter(Boolean)
          .map(locale => `${ref.key}（${locale} 缺失或为空）← ${ref.files.join(', ')}`),
      ].flat(),
    );
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('文档不再逐字抄产品文案：已作废的两句原话不许回来', () => {
    const violations = RETIRED_COPY_QUOTES.filter(quote =>
      readFileSync(path.join(ROOT, quote.file), 'utf8').includes(quote.text),
    ).map(quote => `${quote.file} 又出现了「${quote.text}」— ${quote.reason}`);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('改密弹窗那条披露的 key 在中英两侧都点明了「旧的那份失效」与「保存新生成的那份」', () => {
    const key = 'options.changePwd.alertDescRecovery';
    const zh = ZH[key];
    const en = flatLocale('en')[key];
    expect(zh, `文档引用了 ${key}，它必须存在`).toBeTruthy();
    // 这条直接钉住用户 2026-10-26 点名的歧义：光说「需要重新保存」不知道保存哪一份
    expect(zh).toContain('原来的那份恢复套件');
    expect(zh).toContain('新生成的恢复套件');
    expect(en).toMatch(/kit you already hold/i);
    expect(en).toMatch(/newly generated kit/i);
  });
});
