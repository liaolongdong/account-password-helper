#!/usr/bin/env node
/**
 * 组装对外静态站点目录（默认 `site-dist/`），供 Cloudflare Workers 的静态资源部署使用。
 *
 * 为什么需要这一步：wrangler 的 `assets` 段没有排除语法（4.99 的 `config-schema.json`
 * 里只有 `directory` / `binding` / `html_handling` / `not_found_handling` /
 * `run_worker_first`），而 `assets.directory: "."` 等于把整棵仓库当静态资源上传——
 * `docs/**`、`.qoder/**`、`benchmarks/**` 与全部源码都会跟着进一个公开域名。
 * 本脚本把「该公开的那一套」挑进独立目录，让上传面等于站点本身。
 *
 * 口径：一个文件进 `site-dist/`，必须满足下面任一条，且都不命中 INTERNAL 拒绝表。
 * 1. 种子：`sitemap.xml` 里那批 URL 对应的 HTML，加上 `robots.txt` / `llms.txt` /
 *    `pricing.md`（这三份是被爬虫与 `llms.txt` 按路径直接取的对外文件）；
 * 2. 引用闭包：种子里按本地路径引用到的文件，逐层跟进（图片、CSS、JS、被链接的兄弟页）。
 *    指向 GitHub Pages 的绝对 URL 一并折算成本地路径，否则 og 图与结构化数据里的
 *    截图只会在 workers.dev 上继续依赖 Pages，部署就不是自足的；
 * 3. 运行期拼出来的引用：图库是 `./assets/cws-store/${shotFile(s.file)}`，
 *    模板串抓不到文件名字面量，所以按 `file: 'xxx.png'` 列表补，且按 `shotFile`
 *    的规则同时补中英文两版。
 *
 * 拒绝而不是跳过：命中 INTERNAL 前缀的引用会让构建判失败。哪天页面里手滑链到一份
 * 内部文档，宁可构建红，也不要把它顺手发到公开域名上。
 *
 * 商店上传素材（`assets/cws-store/upload/**`、`marquee*`、`small-promo*`、旧的
 * `0*.png` 演示图）与 `docs/**` 运营文档都不需要在这里点名排除——没有任何对外页面
 * 引用它们，它们本来就进不了闭包。表里保留 `assets/cws-store/upload/` 一条，
 * 是为了让「有人把上传图链到页面上」这种情况变成一次明确的构建失败。
 *
 * 用法：`node scripts/build-web-assets.mjs [--out <dir>] [--dry-run] [--json]`，
 * 默认输出 `site-dist/`（`dist/` 已被 `pnpm analyze` 的 `stats.html` 占用，两者不共用目录）。
 * 退出码：0 组装成功；1 输入不合法、引用断链或引用越界到内部路径。
 *
 * Cloudflare 侧需要把该 Worker 的 Build command 配成 `pnpm run web:build`（或等价的
 * `npm run web:build`），上传目录与 `wrangler.jsonc` 的 `assets.directory` 保持一致。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（本脚本位于 `scripts/` 下）。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 站点在 GitHub Pages 上的源，绝对 URL 折算本地路径时剥掉它。 */
const PAGES_ORIGIN = 'https://liaolongdong.github.io/account-password-helper';

/** 种子：`sitemap.xml` 之外的对外入口，按仓库相对路径书写。 */
const SEED_FILES = ['llms.txt', 'pricing.md', 'robots.txt'];

/**
 * 拒绝表：命中即判构建失败。放的是「内部物料」和「构建产物」，
 * 不是「不想公开的页面」——后者靠没人引用它来保证。
 */
const INTERNAL_PREFIXES = [
  '.github/',
  '.husky/',
  '.output/',
  '.qoder/',
  '.vscode/',
  '.wxt/',
  'assets/cws-store/upload/',
  'assets/icons_backup/',
  'assets/screenshots/',
  'assets/theme/',
  'benchmarks/',
  'components/',
  'composables/',
  'coverage/',
  'dist/',
  'docs/',
  'e2e/',
  'entrypoints/',
  'imgs/blog-covers/',
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

/** 模板串标记：出现它的那个页面，其 `file: '...'` 列表要按中英文两版补进闭包。 */
const SHOT_TEMPLATE_MARKER = './assets/cws-store/${shotFile(s.file)}';

/** 从页面里抓本地引用的属性形态（src / href / content，content 覆盖 og 与 JSON-LD 图片）。 */
const REFERENCE_PATTERN = /(?:src|href|content|poster)\s*=\s*(["'])\s*([^"'\s]+)\s*\1/gi;

/** CSS `url(...)` 形态的引用。 */
const CSS_URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

/** 模板里写死的截图名（`file: 'screen-1-one-click-login.png'`）。 */
const SHOT_FILE_PATTERN = /file:\s*'([^']+\.png)'/g;

/** 认得的静态资源后缀；不在表内的引用串一律不当文件处理。 */
const ASSET_EXTENSIONS = new Set([
  '.css',
  '.gif',
  '.htm',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.md',
  '.png',
  '.svg',
  '.txt',
  '.webp',
  '.woff',
  '.woff2',
  '.xml',
]);

/**
 * 把 URL 或路径归一成仓库相对路径。
 *
 * 只认「像一个本地文件」的串：带后缀的相对路径、以 `.`/`/` 开头的路径、
 * 指向本站 Pages 前缀的绝对 URL，以及以 `/` 结尾的目录链接（补 `index.html`）。
 * meta 标签里的 `content="website"`、模板串 `${shotFile(...)}` 这些都会被判不是文件而忽略。
 *
 * @param {string} raw 原始引用串
 * @param {string} fromPath 出现该引用的页面，仓库相对路径
 * @returns {string|null} 仓库相对路径；外部链接、锚点、伪协议、非文件串返回 null
 */
function toRepoPath(raw, fromPath) {
  const value = raw.trim();
  if (!value || value.includes('${') || value.startsWith('#')) return null;
  if (/^(data:|mailto:|tel:|javascript:|blob:)/i.test(value)) return null;

  let relative;
  let pageRelative = false;
  if (/^https?:\/\//i.test(value)) {
    if (!value.startsWith(PAGES_ORIGIN)) return null;
    relative = value.slice(PAGES_ORIGIN.length).replace(/^\//, '') || 'index.html';
  } else if (value.startsWith('/')) {
    // 站内绝对路径：Pages 的站点根带仓库名前缀，Workers 的站点根不带，两种形态都剥到根。
    relative = value.replace(/^\/account-password-helper\//, '/').replace(/^\//, '') || 'index.html';
  } else {
    relative = value;
    pageRelative = true;
  }

  relative = relative.split('?')[0].split('#')[0];
  if (!relative) return null;
  if (pageRelative) {
    relative = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), relative));
    // 越出仓库根的引用（`../../etc/passwd` 这类）不是本地文件，直接忽略。
    if (relative === '..' || relative.startsWith('../')) return null;
  }

  // 目录链接（`./blog/`、站点根）落到的其实是 index.html。
  if (relative === '.' || relative === './') return 'index.html';
  if (relative.endsWith('/')) return path.posix.normalize(`${relative}index.html`);

  const extension = path.posix.extname(relative).toLowerCase();
  return ASSET_EXTENSIONS.has(extension) ? relative : null;
}

/**
 * 判断仓库相对路径是否命中拒绝表。
 *
 * @param {string} repoPath 仓库相对路径
 * @returns {string|null} 命中的前缀，未命中返回 null
 */
function matchedInternal(repoPath) {
  return (
    INTERNAL_PREFIXES.find(prefix => repoPath === prefix.replace(/\/$/, '') || repoPath.startsWith(prefix)) ?? null
  );
}

/**
 * 把一个站点 URL 折算成仓库相对文件路径（`/` 与 `/blog/` 这类目录形态补 `index.html`）。
 *
 * @param {string} url sitemap 里的 `<loc>`
 * @returns {string} 仓库相对路径
 */
function pageFromSitemapUrl(url) {
  if (!url.startsWith(PAGES_ORIGIN)) {
    throw new Error(`sitemap.xml 出现非本站 URL：${url}`);
  }
  const relative = url.slice(PAGES_ORIGIN.length).replace(/^\//, '');
  if (!relative) return 'index.html';
  if (relative.endsWith('/')) return `${relative}index.html`;
  return relative;
}

/**
 * 读出一个页面或样式表里的全部本地引用。
 *
 * @param {string} repoPath 文件的仓库相对路径
 * @returns {Set<string>} 引用到的仓库相对路径
 */
function collectReferences(repoPath) {
  const source = readFileSync(path.join(REPO_ROOT, repoPath), 'utf8');
  const found = new Set();
  const patterns = repoPath.endsWith('.css') ? [CSS_URL_PATTERN] : [REFERENCE_PATTERN, CSS_URL_PATTERN];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = toRepoPath(match[2] ?? match[1], repoPath);
      if (candidate) found.add(candidate);
    }
  }
  return found;
}

/**
 * 补上运行期拼名的截图引用：中英文两版都要，缺一个就判失败。
 *
 * 页面运行期已经切到 WebP 伴生图（`shotFile()` 把 .png 映射成 .webp），
 * 但 `file: 'screen-*.png'` 仍是唯一真源；这里按同一条规则推导出 28 张 WebP，
 * 避免部署包只带 JSON-LD 引用到的 6 张 PNG、轮播第 2–14 屏 404。
 *
 * @param {string} repoPath 页面仓库相对路径
 * @param {Set<string>} queue 闭包集合（就地追加）
 * @param {string[]} errors 错误收集器
 */
function collectTemplatedShots(repoPath, queue, errors) {
  const source = readFileSync(path.join(REPO_ROOT, repoPath), 'utf8');
  if (!source.includes(SHOT_TEMPLATE_MARKER)) return;
  for (const match of source.matchAll(SHOT_FILE_PATTERN)) {
    const webp = match[1].replace(/\.png$/, '.webp');
    for (const variant of [webp, webp.replace(/\.webp$/, '-en.webp')]) {
      const candidate = `assets/cws-store/${variant}`;
      if (!existsSync(path.join(REPO_ROOT, candidate))) {
        errors.push(`${repoPath} 的图库拼不出 ${candidate}（缺文件）`);
        continue;
      }
      queue.add(candidate);
    }
  }
}

/**
 * 计算公开面：种子 + 引用闭包 + 模板引用，并逐个校验存在性与拒绝表。
 *
 * @returns {{ files: string[], errors: string[] }} 排序后的文件清单与错误列表
 */
export function resolvePublicAssets() {
  const errors = [];
  const queue = new Set();
  const sitemapPath = path.join(REPO_ROOT, 'sitemap.xml');
  if (!existsSync(sitemapPath)) {
    return { files: [], errors: ['缺少 sitemap.xml，无法确定对外页面集合'] };
  }
  const sitemap = readFileSync(sitemapPath, 'utf8');
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => pageFromSitemapUrl(match[1]));
  if (!pages.length) {
    return { files: [], errors: ['sitemap.xml 里没有 <loc>，拒绝把空集合当公开面'] };
  }
  for (const seed of [...pages, ...SEED_FILES]) queue.add(seed);

  // BFS：引用可能再引引用（博客首页 → 文章 → 文章里的图），所以要迭代到不动点。
  const visited = new Set();
  while (queue.size > visited.size) {
    for (const repoPath of [...queue]) {
      if (visited.has(repoPath)) continue;
      visited.add(repoPath);
      if (/\.(html|css)$/.test(repoPath)) {
        if (!existsSync(path.join(REPO_ROOT, repoPath))) {
          errors.push(`sitemap/引用指向的文件不存在：${repoPath}`);
          continue;
        }
        if (repoPath.endsWith('.html')) collectTemplatedShots(repoPath, queue, errors);
        for (const ref of collectReferences(repoPath)) {
          if (!queue.has(ref)) queue.add(ref);
        }
      }
    }
  }

  const files = [];
  for (const repoPath of [...queue]) {
    const internal = matchedInternal(repoPath);
    if (internal) {
      errors.push(`引用越界到内部路径 ${repoPath}（命中拒绝表 ${internal}）`);
      continue;
    }
    if (!existsSync(path.join(REPO_ROOT, repoPath)) || !statSync(path.join(REPO_ROOT, repoPath)).isFile()) {
      errors.push(`闭包里的文件不存在：${repoPath}`);
      continue;
    }
    files.push(repoPath);
  }
  return { files: files.sort((a, b) => a.localeCompare(b)), errors: [...new Set(errors)] };
}

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv 参数列表
 * @returns {{ out: string, dryRun: boolean, json: boolean }}
 */
export function parseArgs(argv) {
  const parsed = { out: 'site-dist', dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--out 需要跟一个目录名');
      parsed.out = value;
      i += 1;
    } else throw new Error(`未知参数：${arg}`);
  }
  return parsed;
}

/**
 * 把公开面拷进目标目录，保持相对路径不变。
 *
 * @param {{ files: string[], errors: string[] }} resolved 公开面
 * @param {{ out: string, dryRun: boolean, json: boolean }} options 构建选项
 * @returns {number} 退出码
 */
export function build(resolved, options) {
  for (const error of resolved.errors) console.error(`[web:build] ${error}`);
  if (resolved.errors.length) {
    console.error(`[web:build] 拒绝组装：${resolved.errors.length} 处问题`);
    return 1;
  }

  const target = path.resolve(REPO_ROOT, options.out);
  const bytes = resolved.files.reduce((sum, file) => sum + statSync(path.join(REPO_ROOT, file)).size, 0);

  if (options.json) {
    console.log(JSON.stringify({ out: options.out, files: resolved.files, bytes }, null, 2));
    if (options.dryRun) return 0;
  }

  if (!options.dryRun) {
    if (target === REPO_ROOT) throw new Error(`--out 解析成了仓库根目录（${options.out}），拒绝在此 rm -rf`);
    if (!target.startsWith(REPO_ROOT + path.sep) && !path.isAbsolute(options.out)) {
      throw new Error(`--out ${options.out} 落在仓库之外，请显式传绝对路径`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const file of resolved.files) {
      const destination = path.join(target, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(REPO_ROOT, file), destination);
    }
  }
  if (!options.json) {
    console.log(
      `[web:build] ${options.dryRun ? '预检' : '已组装'} ${options.out}/：${resolved.files.length} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MiB`,
    );
  }
  return 0;
}

/*
 * 仅在直接执行时跑构建，方便测试当子进程调用并按参数注入。
 * 两侧都取 realpath：macOS 的 `/var` 与 `/tmp` 是 `/private/…` 的软链，按字面比较
 * 会让入口判定静默落空，表现为「脚本退出了、但什么都没做」。
 */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = build(resolvePublicAssets(), parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[web:build] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
