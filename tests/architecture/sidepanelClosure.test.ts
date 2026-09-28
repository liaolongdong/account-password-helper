/**
 * 身份信息库（Identity Vault）独立性守卫 — sidepanel / popup 首屏产物闭包
 *
 * 背景：身份信息库刻意做成「只在 Options 页存在」的平行数据域，独立性是首要需求
 * （见 `.qoder/plans/身份信息库（Identity Vault）实现方案.md` 的「独立性硬约束」）。
 * 但 `utils/storageKeys.ts` 同时被 sidepanel / popup / options 依赖，往 `STORAGE_KEYS`
 * 加 `IDENTITY` 键后，该共享 chunk 的字节必然变化（风险 R6，属内容变化非行为变化）。
 *
 * 这里把「身份库绝不进入 sidepanel / popup 首屏」固化为断言：递归展开两个入口
 * HTML 的 `modulepreload` 闭包（入口 script + 全部预加载 chunk + 它们静态/动态 import
 * 的 chunk），断言：
 *
 * 1. 闭包内**没有任何身份域 chunk**——按 chunk 文件名前缀（rollup 以首个认领模块的
 *    文件名给 chunk 命名，与既有 `passwordCrud-*.js`、`trashManager-*.js` 同理）排除；
 * 2. 闭包拼接后的源码**不含 `.aphid` 容器的代码形态**——它是 `utils/identity/constants.ts`
 *    的 `APHID_KIND` 与备份模块的运行时字符串，属身份域独有，是最该挡在 sidepanel
 *    之外的安全关键代码（文件 I/O + PBKDF2）。判据只认「作为标识符或字符串值出现」，
 *    不认自然语言裸词，理由与自检见下方 `FORBIDDEN_CONTENT_RE`。
 *
 * 该测试依赖先跑过 `pnpm build`（`.output/chrome-mv3/` 存在），产物缺失时**仅产物断言**跳过；
 * 判据自检不依赖产物，任何时候都跑。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(__dirname, '../../.output/chrome-mv3');
const ENTRIES = ['sidepanel.html', 'popup.html'] as const;

/** 身份域 chunk 的文件名前缀（不含 hash 后缀），命中即视为泄露 */
const FORBIDDEN_CHUNK_PREFIX =
  /^(identity|identityCrud|useIdentityVault|IdentityVaultDialog|IdentityFormDialog|backup)-/;

/**
 * `.aphid` 备份容器标识的**代码形态**：常量名未压缩时的 `APHID_KIND`、作为字符串值出现
 * （`kind:"aphid"`、`'.aphid'`），或被模板/拼接写成的文件名后缀（`` `${name}.aphid` ``）。
 *
 * 刻意不匹配自然语言里的裸词：侧边栏帮助弹窗按产品设计要在首屏闭包内说明**全部**功能，
 * `help.gd.9` 的「导出/导入 .aphid 加密备份」是用户辨认备份文件所必需的文案，
 * 把它算成「身份域代码泄入」既不符合事实，也会诱导人删掉有用的用户可见信息。
 * 因此判据要求标识紧邻字符串边界——真泄露过不了这道边界，纯文案能。
 *
 * 三段判据各挡一种紧邻形态，缺一段就漏一类真实写法：
 * 1. `APHID_KIND`：未压缩时常量名直出；
 * 2. `["'`]\.?aphid`：标识紧跟在引号/反引号之后（`'.aphid'`、`` `.aphid` ``）；
 * 3. `aphid["'`]` 或 `}` / `${` 相邻：标识被夹在两段模板插值之间
 *    （`` `backup${n}.aphid${ts}` `` 既不前邻引号也不后邻引号，是第 2 版的漏网形态）。
 *
 * 方向上偏保守：若将来某条文案恰好以 `.aphid` 紧邻这些边界（例如把备份文件名写成
 * 形如 `backup{n}.aphid` 的模板样例外套进 `{}` 占位符），会误报一次，由人复核即可
 * （漏报的代价远大于一次误报）。仍不覆盖的形态：把 `aphid` 拆成变量拼接的运行时字符串
 * （静态提取本就无法判定，须靠 chunk 前缀那条判据兜底）。
 */
const FORBIDDEN_CONTENT_RE = /APHID_KIND|["'`]\.?aphid|aphid["'`]|\}\.?aphid|aphid\$\{/i;

function readEntryHtml(file: string): string {
  return readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
}

/** 提取入口 HTML 里的入口 script 与全部 modulepreload 引用（相对根路径） */
function extractChunkRefs(html: string): string[] {
  const refs: string[] = [];
  const scriptRe = /<script[^>]+src="([^"]+)"/g;
  const preloadRe = /<link rel="modulepreload"[^>]+href="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) refs.push(match[1]);
  while ((match = preloadRe.exec(html)) !== null) refs.push(match[1]);
  return refs;
}

function chunkFileFromHref(href: string): string {
  return path.join(OUTPUT_DIR, href.replace(/^\//, ''));
}

/** 提取一个 chunk 源码里的静态 `import ... from "./x"` 与动态 `import("./x")` 相对引用 */
function extractImportRefs(source: string): string[] {
  const refs: string[] = [];
  const importRe = /(?:from\s*["']|import\(\s*["'])(\.{1,2}\/[^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) refs.push(match[1]);
  return refs;
}

/** 从入口 chunk 集合出发，递归展开完整闭包（返回绝对路径集合） */
function computeClosure(entryFiles: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // 引用了不存在的 chunk：视为不在闭包内
    }
    for (const ref of extractImportRefs(source)) {
      queue.push(path.resolve(path.dirname(file), ref));
    }
  }
  return seen;
}

const hasOutput = existsSync(path.join(OUTPUT_DIR, 'sidepanel.html'));

describe.skipIf(!hasOutput)('身份库独立性 — 首屏产物闭包不含 identity chunk', () => {
  for (const entry of ENTRIES) {
    describe(entry, () => {
      const html = readEntryHtml(entry);
      const refs = extractChunkRefs(html);
      const closure = computeClosure(refs.map(chunkFileFromHref));

      it('存在入口 script 且闭包非空', () => {
        expect(refs.length).toBeGreaterThan(0);
        expect(closure.size).toBeGreaterThan(0);
      });

      it('闭包内没有任何身份域 chunk', () => {
        const leaked = [...closure].map(file => path.basename(file)).filter(name => FORBIDDEN_CHUNK_PREFIX.test(name));
        expect(leaked, `发现身份域 chunk 泄入首屏闭包: ${leaked.join(', ')}`).toEqual([]);
      });

      it('闭包源码不含 .aphid 的代码形态', () => {
        const leaked = [...closure]
          .filter(file => FORBIDDEN_CONTENT_RE.test(readFileSync(file, 'utf8')))
          .map(file => path.basename(file));
        expect(leaked, `.aphid 备份容器代码泄入首屏闭包: ${leaked.join(', ')}`).toEqual([]);
      });
    });
  }
});

/**
 * 判据自检 —— 不依赖 `pnpm build` 产物，任何时候都跑
 *
 * 把裸子串收窄到「代码形态」的前提是它仍拦得住真泄露，因此把判据的两侧都钉成断言：
 * 代码形态必须命中，而首屏闭包里真实存在的中英帮助文案必须不命中。
 * 缺了这一段，收窄就只是一次无人复核的放松。
 */
describe('判据自检 — .aphid 仅按代码形态命中', () => {
  it('命中作为标识符、字符串值或模板片段出现的容器标识', () => {
    const codeShapes = [
      '{kind:"aphid"}',
      "extension = '.aphid'",
      'const f = `${name}.aphid`;',
      'APHID_KIND',
      // 标识被夹在两段插值之间：不前邻引号、不后邻引号，只靠引号边界判据必然放过（备份文件名真实写法）
      'const f = `backup${n}.aphid${ts}`;',
      // 后缀紧跟插值、前缀紧跟插值两种半包围形态
      'const f = `${dir}/x.aphid${ts}`;',
      'const f = `${dir}aphid`;',
    ];
    for (const code of codeShapes) {
      expect(FORBIDDEN_CONTENT_RE.test(code), `应命中代码形态: ${code}`).toBe(true);
    }
  });

  it('不命中把 .aphid 当作扩展名书写的自然语言文案', () => {
    // 与 locale 内容无关的判据边界：文案里的 `.aphid` 两侧是空格/中文括号/句号，不贴任何字符串边界
    const prose = ['可导出/导入 .aphid 加密备份', '（.aphid 文件）', 'choose a .aphid backup file.', '备份为 .aphid。'];
    for (const copy of prose) {
      expect(FORBIDDEN_CONTENT_RE.test(copy), `不应命中自然语言文案: ${copy}`).toBe(false);
    }
  });

  it('不命中首屏闭包内真实存在的中英用户文案', () => {
    // 帮助词条（`help.gd.*`）按产品设计必须在侧边栏首屏讲清全部功能，备份/身份域的提醒
    // 与导入报错同样会带出扩展名。判据放松后要把这些**真实**文件一起复验，只测一个文件
    // 等于给「再放宽一格」留下无人复核的空间。
    const copyFiles = ['help.json', 'identity.json'] as const;
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const file of copyFiles) {
        const raw = readFileSync(path.resolve(__dirname, `../../utils/i18n/locales/${locale}/${file}`), 'utf8');
        // 只复验取值、不复验键名：`identity.import.notAphid` 这类键以 `Aphid` 紧邻引号收尾，
        // 是代码形态子串却不是用户可见内容（且该命名空间只进 Options 产物，本就不在闭包内）。
        const values = Object.values(JSON.parse(raw) as Record<string, unknown>).filter(
          (value): value is string => typeof value === 'string',
        );
        for (const copy of values) {
          expect(FORBIDDEN_CONTENT_RE.test(copy), `${locale}/${file} 文案被误判成代码形态: ${copy.slice(0, 40)}`).toBe(
            false,
          );
        }
      }
    }
  });
});
