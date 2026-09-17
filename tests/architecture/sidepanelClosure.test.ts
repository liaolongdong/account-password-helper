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
 * 2. 闭包拼接后的源码**不含 `.aphid` 容器标识**——它是 `utils/identity/constants.ts`
 *    的 `APHID_KIND` 与备份模块的运行时字符串，属身份域独有，是最该挡在 sidepanel
 *    之外的安全关键代码（文件 I/O + PBKDF2）。
 *
 * 该测试依赖先跑过 `pnpm build`（`.output/chrome-mv3/` 存在），产物缺失时整文件跳过。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(__dirname, '../../.output/chrome-mv3');
const ENTRIES = ['sidepanel.html', 'popup.html'] as const;

/** 身份域 chunk 的文件名前缀（不含 hash 后缀），命中即视为泄露 */
const FORBIDDEN_CHUNK_PREFIX =
  /^(identity|identityCrud|useIdentityVault|IdentityVaultDialog|IdentityFormDialog|backup)-/;

/** `.aphid` 备份容器标识——身份域独有的运行时字符串 */
const FORBIDDEN_CONTENT = 'aphid';

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

      it('闭包源码不含 .aphid 容器标识', () => {
        const content = [...closure].map(file => readFileSync(file, 'utf8')).join('\n');
        expect(content, '.aphid 备份容器代码泄入首屏闭包').not.toContain(FORBIDDEN_CONTENT);
      });
    });
  }
});
