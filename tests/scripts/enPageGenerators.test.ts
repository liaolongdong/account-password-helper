/**
 * 英文兄弟页生成链的可复现性与语言分流守卫。
 *
 * 背景：`pricing.en.html` / `privacy.en.html` 是产物且被 `.prettierignore` 排除，所以它们的
 * 换行形态由生成器决定、不由格式门禁决定。但**语言相关的取值**必须跟着目标语言走，这一条
 * 此前没人守：`build-pricing-en-page.mjs` 只替换 head meta 与链接，从不碰 JSON-LD，产出的英文页
 * 带着中文主名，跑一次 `pnpm gen:pricing-en` 必然让 `tests/docs/structuredData.test.ts` 判红——
 * 生成链因此不可复现，11-05 那轮只能手改一行 href 绕过。
 *
 * 判据：在临时目录里拿**仓库真实的中文源页**重跑生成器，产物必须与已提交产物**逐字节相同**。
 * 生成器是确定性的，所以字节相等是可达的；只挑几个 meta 比对会漏掉「手改了一行 href」这类
 * 真实发生过的漂移。`.prettierignore` 排除这些产物，说的是**格式门禁**不管它们的换行，
 * 不是**可复现性门禁**不该管它们的内容——两件事别混。
 *
 * 牙齿：把源页的 JSON-LD 品牌顺序改成英文优先（模拟生成器漏替换），生成器会抛错判红。
 *
 * 起子进程而非 import：`scripts/**` 不在 tsconfig 的 include 里，import 会让 `pnpm typecheck` 挂；
 * 同 `tests/scripts/buildWebAssets.test.ts` 的既有口径。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const ZH_BRAND = '账号密码管理助手';
const EN_BRAND = 'Account Password Helper';

/** 英文分享卡的绝对地址，与 scripts/lib/share-image.mjs 各写一份，避免守卫跟着实现一起错 */
const OG_IMAGE_EN = 'https://liaolongdong.github.io/account-password-helper/assets/cws-store/og-en-1200x630.png';

interface Generator {
  script: string;
  source: string;
  output: string;
}

const GENERATORS: Generator[] = [
  { script: 'build-pricing-en-page.mjs', source: 'pricing.html', output: 'pricing.en.html' },
  { script: 'build-privacy-en-page.mjs', source: 'privacy.html', output: 'privacy.en.html' },
];

let sandbox: string;

/** 把脚本与它依赖的 lib 整目录搬进沙箱，源页用仓库真实内容 */
function seed(generator: Generator, sourceOverride?: string): void {
  mkdirSync(path.join(sandbox, 'scripts/lib'), { recursive: true });
  copyFileSync(path.join(ROOT, 'scripts', generator.script), path.join(sandbox, 'scripts', generator.script));
  for (const file of readdirSync(path.join(ROOT, 'scripts/lib'))) {
    copyFileSync(path.join(ROOT, 'scripts/lib', file), path.join(sandbox, 'scripts/lib', file));
  }
  writeFileSync(
    path.join(sandbox, generator.source),
    sourceOverride ?? readFileSync(path.join(ROOT, generator.source), 'utf8'),
    'utf8',
  );
}

function generate(generator: Generator): string {
  const result = spawnSync(process.execPath, [path.join(sandbox, 'scripts', generator.script)], {
    cwd: sandbox,
    encoding: 'utf8',
  });
  expect(result.stderr, `${generator.script} 不应报错`).toBe('');
  expect(result.status, `${generator.script} 应正常退出`).toBe(0);
  return readFileSync(path.join(sandbox, generator.output), 'utf8');
}

/** 取 HTML 开标签里的 lang，属性可能折行 */
function langOf(html: string): string {
  const tag = /<html\b([^>]*)>/i.exec(html)?.[1] ?? '';
  return /\blang\s*=\s*["']([^"']+)["']/.exec(tag)?.[1] ?? '';
}

/** 取全部 JSON-LD 节点里的 SoftwareApplication 主名与别名 */
function brandNamesOf(html: string): { name: unknown; alternateName: unknown }[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]) as Record<string, unknown>)
    .filter(node => node['@type'] === 'SoftwareApplication')
    .map(node => ({ name: node.name, alternateName: node.alternateName }));
}

function metaOf(html: string, key: string): string {
  const pattern = new RegExp(`(?:name|property)="${key}"\\s+content="([^"]*)"`);
  return pattern.exec(html)?.[1] ?? '';
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), 'aph-en-page-gen-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('英文兄弟页生成链', () => {
  for (const generator of GENERATORS) {
    describe(generator.script, () => {
      it('从真实中文源页重跑，产物与已提交产物逐字节相同', () => {
        seed(generator);
        const produced = generate(generator);
        const committed = readFileSync(path.join(ROOT, generator.output), 'utf8');
        // 比字节而不是挑几个取值：历史事故正是「手改了一行 href」，只比 meta 会让那类漂移溜过去。
        // 生成器是确定性的，`.prettierignore` 排除的是格式门禁，不是可复现性门禁。
        expect(
          produced,
          `${generator.output} 与生成器输出不一致，跑 pnpm gen:${generator.output.split('.')[0]}-en 重新生成`,
        ).toBe(committed);
      });

      it('产物的语言标注确实翻成了英文（防止源页与产物一起错）', () => {
        seed(generator);
        const produced = generate(generator);
        expect(langOf(produced), '产物的 <html lang> 应为 en').toBe('en');
        expect(metaOf(produced, 'og:locale'), '英文页 og:locale 应为 en_US').toBe('en_US');
        expect(metaOf(produced, 'og:image'), '英文页必须用英文分享卡').toBe(OG_IMAGE_EN);
        expect(metaOf(produced, 'twitter:image'), 'twitter 卡也要跟着语言走').toBe(OG_IMAGE_EN);
        const canonical = /rel="canonical"\s+href="([^"]*)"/.exec(produced)?.[1] ?? '';
        expect(canonical, 'canonical 应自指英文页').toBe(
          `https://liaolongdong.github.io/account-password-helper/${generator.output}`,
        );
      });
    });
  }

  it('pricing 的 JSON-LD 品牌名跟着目标语言走（漏替换会让英文页带中文主名）', () => {
    const generator = GENERATORS[0];
    seed(generator);
    const produced = generate(generator);
    const apps = brandNamesOf(produced);
    expect(apps.length, 'pricing 页应有 SoftwareApplication 结构化数据').toBeGreaterThan(0);
    for (const app of apps) {
      expect(app.name, '英文页的 JSON-LD 主名必须是英文名').toBe(EN_BRAND);
      expect(app.alternateName, '中文名应退到 alternateName').toBe(ZH_BRAND);
    }
    // 与已提交产物比对，确认这条取值不是守卫自己编的
    expect(apps).toEqual(brandNamesOf(readFileSync(path.join(ROOT, generator.output), 'utf8')));
  });

  it('牙齿：源页品牌顺序已是英文优先时，漏替换的生成器会判红', () => {
    const generator = GENERATORS[0];
    const source = readFileSync(path.join(ROOT, generator.source), 'utf8');
    // 模拟「生成器没有做品牌分流」的产物形态：主名英文、别名中文，但脚本仍按中文优先匹配
    const mutated = source.replace(
      `        "name": "${ZH_BRAND}",\n        "alternateName": "${EN_BRAND}",`,
      `        "name": "${EN_BRAND}",\n        "alternateName": "${ZH_BRAND}",`,
    );
    expect(mutated, '夹具注入必须真的改到源页').not.toBe(source);
    seed(generator, mutated);
    const result = spawnSync(process.execPath, [path.join(sandbox, 'scripts', generator.script)], {
      cwd: sandbox,
      encoding: 'utf8',
    });
    // 脚本用 replaceOnce，匹配不到就抛错退出——这正是「源页形态变了要立刻炸」的设计
    expect(result.status, '源页品牌形态变化时生成器应失败而非静默产出错语言').not.toBe(0);
    expect(result.stderr).toContain('未匹配到替换目标');
  });
});
