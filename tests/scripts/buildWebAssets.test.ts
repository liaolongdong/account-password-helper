/**
 * 对外站点资源组装脚本（`scripts/build-web-assets.mjs`）的守卫。
 *
 * 为什么起子进程而不 import：`scripts/**` 不在 tsconfig 的 include 里，import 会让
 * `pnpm typecheck` 直接挂；同时仓库既有口径是「守卫不依赖被守卫的模块」（见
 * `tests/scripts/cwsPublishCli.test.ts` 顶部批注）。本文件因此自带一套独立的引用解析
 * 与清单比对，用来交叉验证脚本挑出来的公开面，而不是复述它的实现。
 *
 * 两类用例的分工：
 * 1. 真仓库那一组钉「公开面等于站点」——sitemap 的每条 URL 都要在、内部物料一件都不在、
 *    产物与源码逐字节相同、页面里每条本地引用在产物内都能落地；
 * 2. 夹具那一组钉「守卫有牙」——链到 `docs/`、引用断链、`--out` 指向仓库根、模板截图缺
 *    英文版这四件事都必须判红。这些形状在真仓库里一个都不出现，只能靠临时夹具注入。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/build-web-assets.mjs');
/** 站点在 GitHub Pages 上的源，与脚本里的常量各写一份，避免守卫跟着实现一起错。 */
const PAGES_ORIGIN = 'https://liaolongdong.github.io/account-password-helper';

/** 绝不该出现在部署包里的前缀：内部物料 + 构建产物 + 仓库自身。 */
const NEVER_IN_BUNDLE = [
  '.github/',
  '.qoder/',
  'assets/cws-store/upload/',
  'assets/screenshots/',
  'benchmarks/',
  'build/',
  'components/',
  'composables/',
  'coverage/',
  'dist/',
  'docs/',
  'e2e/',
  'entrypoints/',
  'imgs/prompts/',
  'imgs/store-creatives/',
  'node_modules/',
  'playwright-report/',
  'public/_locales/',
  'scripts/',
  'site-dist/',
  'test-results/',
  'tests/',
  'types/',
  'utils/',
];

/** 站点页面上会出现的本地文件后缀；独立于脚本的同名集合，用来发现脚本漏认的类型。 */
const LOCAL_SUFFIXES = [
  '.css',
  '.gif',
  '.htm',
  '.html',
  '.ico',
  '.jpg',
  '.js',
  '.json',
  '.md',
  '.png',
  '.svg',
  '.txt',
  '.webp',
  '.xml',
];

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface BuildReport {
  out: string;
  files: string[];
  bytes: number;
}

/**
 * 以子进程跑组装脚本。
 *
 * @param cwd 脚本认定的仓库根（夹具用例靠它切换）
 * @param script 脚本路径
 * @param args 命令行参数
 * @returns 退出码与两路输出
 */
function runScript(cwd: string, script: string, args: string[]): RunResult {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * 递归列出目录里的全部文件（仓库相对路径，`/` 分隔）。
 *
 * @param dir 目录绝对路径
 * @param prefix 相对路径前缀
 */
function walk(dir: string, prefix = ''): string[] {
  const listing: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listing.push(...walk(path.join(dir, entry.name), relative));
    else listing.push(relative);
  }
  return listing.sort((a, b) => a.localeCompare(b));
}

/**
 * 独立解析页面里的本地引用：只认相对路径、`#` 锚点之外的 Pages 绝对 URL，
 * 目录链接补 `index.html`。与脚本实现无关，因此能发现「脚本没认出来的引用」。
 *
 * @param pagePath 页面绝对路径
 * @param outDir 产物根目录
 * @returns 页面上每条本地引用对应的产物内相对路径
 */
function localRefsOf(pagePath: string, outDir: string): string[] {
  const source = readFileSync(pagePath, 'utf8');
  const pattern = /(?:src|href|content|poster)\s*=\s*["']([^"'\s]+)["']/gi;
  const from = `/${path.relative(outDir, pagePath)}`;
  const refs: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (!value || value.startsWith('#') || value.includes('${')) continue;

    let relative: string;
    if (/^https?:\/\//i.test(value)) {
      if (!value.startsWith(PAGES_ORIGIN)) continue;
      relative = value.slice(PAGES_ORIGIN.length);
    } else if (value.startsWith('//') || value.startsWith('/')) {
      // 无协议外链或以 `/` 开头的站外根路径：Workers 域名下会指向别处，不算本地引用。
      continue;
    } else if (/^(data:|mailto:|tel:|javascript:|blob:)/i.test(value)) {
      continue;
    } else {
      relative = path.posix.join(path.posix.dirname(from), value);
    }
    relative = relative.replace(/^\//, '').split('?')[0].split('#')[0];
    if (!relative) continue;
    if (relative.endsWith('/')) {
      refs.push(`${relative}index.html`);
      continue;
    }
    const extension = path.posix.extname(relative).toLowerCase();
    if (LOCAL_SUFFIXES.includes(extension)) refs.push(path.posix.normalize(relative));
  }
  return [...new Set(refs)];
}

describe('site-dist 组装：真仓库的公开面', () => {
  let outDir = '';
  let report: BuildReport = { out: '', files: [], bytes: 0 };

  beforeAll(() => {
    // 临时目录在 beforeAll 里建：收集阶段就 mkdtemp 会让「本文件被过滤掉」也留下空目录。
    outDir = path.join(mkdtempSync(path.join(os.tmpdir(), 'aph-web-assets-')), 'site-dist');
    const result = runScript(ROOT, SCRIPT, ['--out', outDir, '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    report = JSON.parse(result.stdout) as BuildReport;
  }, 120_000);

  afterAll(() => {
    // 只删本轮自己建的临时目录：`path.dirname('')` 会返回 `.`，那等于 rm -rf 当前工作目录。
    const parent = outDir ? path.dirname(outDir) : '';
    if (parent.includes(`aph-web-assets-`)) rmSync(parent, { recursive: true, force: true });
  });

  it('sitemap 的每条 URL 与三份按路径直取的对外文件都在产物里', () => {
    const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => {
      expect(match[1].startsWith(PAGES_ORIGIN)).toBe(true);
      const relative = match[1].slice(PAGES_ORIGIN.length).replace(/^\//, '');
      return !relative ? 'index.html' : relative.endsWith('/') ? `${relative}index.html` : relative;
    });
    expect(pages.length).toBeGreaterThan(0);
    const missing = pages.filter(page => !report.files.includes(page));
    expect(missing).toEqual([]);
    for (const seed of ['llms.txt', 'pricing.md', 'robots.txt']) {
      expect(report.files).toContain(seed);
    }
  });

  it('内部物料一件不进：商店上传素材、运营文档与全部源码都零命中', () => {
    const hits = report.files.filter(file => NEVER_IN_BUNDLE.some(prefix => file.startsWith(prefix)));
    expect(hits).toEqual([]);
    // 正向对照：闭包确实收进了商店同源演示图与博客图，否则「零命中」可能只是啥都没跑。
    expect(report.files.filter(file => file.startsWith('assets/cws-store/')).length).toBeGreaterThan(0);
    expect(report.files.filter(file => file.startsWith('blog/')).length).toBeGreaterThan(0);
  });

  it('产物目录与清单逐字节一致，脚本不改写任何文件', () => {
    const listed = [...report.files].sort((a, b) => a.localeCompare(b));
    expect(walk(outDir)).toEqual(listed);
    const hash = (buffer: Buffer) => createHash('md5').update(buffer).digest('hex');
    const rewritten = listed.filter(
      file => hash(readFileSync(path.join(ROOT, file))) !== hash(readFileSync(path.join(outDir, file))),
    );
    expect(rewritten).toEqual([]);
  });

  it('运行期轮播的 32 张 WebP 与博客 3 张信息图全部进部署包', () => {
    const page = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const shots = [...page.matchAll(/file:\s*'(screen-[^']+\.png)'/g)].map(match => match[1]);
    expect(shots.length, 'index.html 的 SLIDES 截图数量变了，请同步本守卫').toBe(16);
    const expected = shots.flatMap(file => [
      `assets/cws-store/${file.replace(/\.png$/, '.webp')}`,
      `assets/cws-store/${file.replace(/\.png$/, '-en.webp')}`,
    ]);
    for (const infographic of [
      'imgs/01-infographic-core-value.webp',
      'imgs/02-flowchart-security-pipeline.webp',
      'imgs/03-infographic-dev-features.webp',
    ]) {
      expected.push(infographic);
    }
    expect(expected.filter(file => !report.files.includes(file))).toEqual([]);
  });

  it('页面上每条本地引用都能在产物里落地（部署包自足）', () => {
    const broken: string[] = [];
    for (const file of report.files.filter(name => name.endsWith('.html'))) {
      const pagePath = path.join(outDir, file);
      for (const ref of localRefsOf(pagePath, outDir)) {
        if (!existsSync(path.join(outDir, ref)) || !statSync(path.join(outDir, ref)).isFile()) {
          broken.push(`${file} -> ${ref}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('夹具仓库：拒绝表与断链必须判红', () => {
  let repo = '';
  let script = '';

  /** 往夹具仓库里写一个文件，顺带建目录。 */
  function write(relative: string, content: string): void {
    const target = path.join(repo, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'aph-web-fixture-'));
    script = path.join(repo, 'scripts/build-web-assets.mjs');
    mkdirSync(path.dirname(script), { recursive: true });
    copyFileSync(SCRIPT, script);
    write(
      'sitemap.xml',
      `<urlset><url><loc>${PAGES_ORIGIN}/</loc></url><url><loc>${PAGES_ORIGIN}/blog/</loc></url></urlset>`,
    );
    write('index.html', '<a href="./blog/">博客</a><img src="./imgs/hero.png">');
    // `../` 形态：仓库内的相对上跳必须跟得住（否则页面会静默少一张图）。
    write('blog/index.html', '<a href="../index.html">首页</a><img src="../assets/only-via-dotdot.png">');
    write('imgs/hero.png', 'not-really-a-png');
    write('assets/only-via-dotdot.png', 'reached only through ../');
    write('robots.txt', 'User-agent: *');
    write('llms.txt', '# docs');
    write('pricing.md', '# pricing');
    // 内部物料：无人引用（不该进），以及一条故意链上去的（该判红）。
    write('docs/internal-runbook.md', '运营文档');
    write('assets/cws-store/upload/marquee-1400x560.png', 'store-only');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('基线闭包：引用链到的都进，没被引用的内部文件不进', () => {
    const result = runScript(repo, script, ['--out', 'site-dist', '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as BuildReport;
    expect(report.files).toEqual([
      'assets/only-via-dotdot.png',
      'blog/index.html',
      'imgs/hero.png',
      'index.html',
      'llms.txt',
      'pricing.md',
      'robots.txt',
    ]);
  });

  it('页面链到 docs/ 时判红，且不留半截产物目录', () => {
    write('index.html', '<a href="./docs/internal-runbook.md">手滑</a><img src="./imgs/hero.png">');
    const result = runScript(repo, script, ['--out', 'site-dist']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('引用越界到内部路径 docs/internal-runbook.md');
    expect(result.stderr).toContain('拒绝组装');
    expect(existsSync(path.join(repo, 'site-dist'))).toBe(false);
  });

  it('引用断链时判红', () => {
    write('index.html', '<img src="./imgs/hero.png"><img src="./imgs/gone.png">');
    const result = runScript(repo, script, ['--out', 'site-dist']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('闭包里的文件不存在：imgs/gone.png');
  });

  it('越出仓库根的引用只被忽略，不当成断链', () => {
    write('index.html', '<img src="./imgs/hero.png"><img src="../../outside/leak.png">');
    const result = runScript(repo, script, ['--out', 'site-dist', '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as BuildReport;
    expect(report.files.some(file => file.startsWith('outside/'))).toBe(false);
  });

  it('--out 等于仓库根时拒绝执行，绝不 rm -rf 整棵树', () => {
    const result = runScript(repo, script, ['--out', '.']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('仓库根目录');
    expect(existsSync(path.join(repo, 'index.html'))).toBe(true);
    expect(existsSync(path.join(repo, 'sitemap.xml'))).toBe(true);
  });

  it('运行期拼名的图库缺英文版时判红，补齐后中英两版一起进', () => {
    // 页面里的模板串必须逐字对齐 `index.html` 的写法，否则这一组只是在测「没命中模板」的分支。
    const marker = ['./assets/cws-store/', '$', '{shotFile(s.file)}'].join('');
    const page = [
      '<img src="./imgs/hero.png">',
      "<script>const shots = [{ file: 'screen-1-one-click-login.png' }];",
      `const src = '${marker}';</script>`,
    ].join('\n');
    expect(page).toContain(marker);
    write('index.html', page);
    write('assets/cws-store/screen-1-one-click-login.webp', 'zh');

    const missingEn = runScript(repo, script, ['--out', 'site-dist']);
    expect(missingEn.status).toBe(1);
    expect(missingEn.stderr).toContain('assets/cws-store/screen-1-one-click-login-en.webp');
    expect(existsSync(path.join(repo, 'site-dist'))).toBe(false);

    write('assets/cws-store/screen-1-one-click-login-en.webp', 'en');
    const result = runScript(repo, script, ['--out', 'site-dist', '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as BuildReport;
    expect(report.files).toContain('assets/cws-store/screen-1-one-click-login.webp');
    expect(report.files).toContain('assets/cws-store/screen-1-one-click-login-en.webp');
  });
});
