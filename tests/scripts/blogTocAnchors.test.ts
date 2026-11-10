/**
 * 博客正文锚点的唯一性守卫。
 *
 * 缺陷本体：`scripts/build-blog-pages.mjs` 的 `withToc()` 按 **base slug** 计数追加序号
 * （`seen.get(base)`），而不是按**最终 id** 判重。于是「Setup / Setup / Setup 2」这组标题
 * 产出 `setup`、`setup-2`、`setup-2`：页面出现两个同 id 的 `<h2>`，目录里两条锚文本不同却
 * 指向同一个 `#setup-2`，第三节永远跳不过去。同 id 还会让 `getElementById` / 无障碍大纲
 * 只认第一节，`tests/docs/blogMeta.test.ts` 的锚点唯一性断言又只扫真实文章——现有文章恰好
 * 没有这种碰撞形状，缺陷因此一直是绿的。
 *
 * 判据落在**产物字节**上：拿合成文章跑真生成器，`<h2 id>` 必须两两不同，目录锚点必须与
 * 这些 id 一一对应。牙齿就是夹具里的「Setup 2」——按 base 计数时它必然撞上前面追加的序号。
 *
 * 起子进程而非 import：`scripts/**` 不在 tsconfig 的 include 里，import 会让 `pnpm typecheck` 挂；
 * 同 `tests/scripts/enPageGenerators.test.ts` 的既有口径。`marked` 靠软链仓库 node_modules 解析。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SLUG = '01-toc-fixture';

let sandbox: string;

/** 往沙箱写文件，顺带建目录 */
function write(relative: string, content: string): void {
  const target = path.join(sandbox, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** 合成一篇文章（中英同 slug，生成器要求一一对应），正文由调用方给定 */
function seedArticle(zhBody: string, enBody = zhBody): void {
  const frontmatter = ['title: 锚点夹具', 'description: 合成文章，仅用于锚点判据', 'date: 2026-11-10'].join('\n');
  // 开头必须留一段散文：`stripLeadingHeading()` 会吃掉正文首块的 ATX 标题（不分级别）
  const lead = '这是一段开场散文，用来占住正文首块。';
  write(`docs/blog/zh/${SLUG}.md`, `---\n${frontmatter}\n---\n\n${lead}\n\n${zhBody}\n`);
  write(`docs/blog/en/${SLUG}.md`, `---\n${frontmatter}\n---\n\n${lead}\n\n${enBody}\n`);
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), 'aph-blog-toc-'));
  mkdirSync(path.join(sandbox, 'scripts/lib'), { recursive: true });
  copyFileSync(path.join(ROOT, 'scripts/build-blog-pages.mjs'), path.join(sandbox, 'scripts/build-blog-pages.mjs'));
  for (const file of readdirSync(path.join(ROOT, 'scripts/lib'))) {
    copyFileSync(path.join(ROOT, 'scripts/lib', file), path.join(sandbox, 'scripts/lib', file));
  }
  // ESM 不认 NODE_PATH，只能让沙箱自己有一层 node_modules 供 marked 解析
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'dir');
  // 无封面也要读默认分享卡的 PNG 头拿宽高，缺文件生成器直接抛
  for (const image of ['og-1200x630.png', 'og-en-1200x630.png']) {
    const relative = `assets/cws-store/${image}`;
    mkdirSync(path.join(sandbox, 'assets/cws-store'), { recursive: true });
    copyFileSync(path.join(ROOT, relative), path.join(sandbox, relative));
  }
  write('llms.txt', '# 账号密码管理助手\n');
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

/** 跑真生成器，返回中文文章页的 HTML */
function generateArticlePage(): string {
  const result = spawnSync(process.execPath, [path.join(sandbox, 'scripts/build-blog-pages.mjs')], {
    cwd: sandbox,
    encoding: 'utf8',
  });
  expect(result.stderr, '博客生成器不应报错').toBe('');
  expect(result.status, '博客生成器应正常退出').toBe(0);
  return readFileSync(path.join(sandbox, `blog/${SLUG}.html`), 'utf8');
}

/** 正文里 withToc 写下的全部 h2 锚点 id（按出现顺序） */
function headingIdsOf(html: string): string[] {
  return [...html.matchAll(/<h2 id="([^"]+)">/g)].map(match => match[1]);
}

/** 目录导航里的锚目标（按出现顺序，去掉 `#`） */
function tocTargetsOf(html: string): string[] {
  const nav = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  return [...nav.matchAll(/<a href="#([^"]+)">/g)].map(match => match[1]);
}

describe('博客正文的 h2 锚点', () => {
  it('标题 slug 与「已追加序号」的 id 撞车时仍两两不同，目录每节都能跳到', () => {
    seedArticle(['## Setup', '', '第一节', '', '## Setup', '', '第二节', '', '## Setup 2', '', '第三节'].join('\n'));
    const html = generateArticlePage();

    const ids = headingIdsOf(html);
    // 反空转：夹具的三个标题必须都进了正文，少了任何一个这条判据就什么都没说
    expect(ids, '夹具的三个 h2 没有全部落进产物').toHaveLength(3);
    expect(new Set(ids).size, `h2 锚点 id 重复：${ids.join(', ')}——同 id 会让后一节永远跳不到`).toBe(ids.length);

    const targets = tocTargetsOf(html);
    expect(targets, '目录没有收全三节').toHaveLength(3);
    expect(new Set(targets).size, `目录锚点重复：${targets.join(', ')}——两条目录项指向同一节`).toBe(targets.length);
    expect(targets, '目录锚点与正文 h2 的 id 不是一一对应').toEqual(ids);
  });

  it('slug 规则本身不变：剥内联标签、解实体、留 CJK，纯标点标题落到 section', () => {
    seedArticle(
      [
        '## 使用 `<code>` 的步骤',
        '',
        '正文',
        '',
        "## Who it's for",
        '',
        '正文',
        '',
        '## 中文小节',
        '',
        '正文',
        '',
        '## !!!',
        '',
        '正文',
      ].join('\n'),
    );
    const ids = headingIdsOf(generateArticlePage());
    expect(ids).toEqual(['使用-code-的步骤', 'who-it-s-for', '中文小节', 'section']);
  });
});
