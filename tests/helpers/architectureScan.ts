/**
 * 架构守卫共用的「读仓库自身源码」抽取能力
 *
 * 架构守卫的工作对象是仓库源码文本与模块依赖图，而不是运行时行为；这类抽取一旦写错
 * （正则失配、别名变更、目录改名），守卫会**静默空跑**并长期全绿——比没有守卫更糟。
 * 因此把两处真正共享的抽取收在这里，只留一份实现来承载「抽取非空」的责任：
 *
 * 1. `computeImportClosure`：从入口出发展开仓库内 import 闭包，供「谁可达某模块」类守卫使用；
 * 2. `listSourceFiles` / `readSource`：按目录递归取源文件，供全文扫描类守卫使用。
 *
 * 解析口径与 `vueFreeMatchKernel.test.ts` 早先的私有实现完全一致（`import type` 判据、
 * `@/` 别名、`.ts`/`.vue`/`index.ts` 候选顺序），只是把路径统一成仓库相对 posix 口径，
 * 让调用方不必各自 `path.relative`。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/** 仓库根目录（本文件位于 `tests/helpers/`，上溯两级） */
export const ROOT = path.resolve(__dirname, '../..');

/** 一条 import/export 说明符及其是否仅存在于类型层 */
export interface Specifier {
  /** 原始说明符，如 `vue`、`@/utils/keywordMatch` */
  spec: string;
  /** 是否 `import type` / `export type`（编译期擦除，不影响产物） */
  typeOnly: boolean;
}

/** 绝对路径 → 仓库相对 posix 路径（null 原样传递） */
function toRel(abs: string | null): string | null {
  return abs === null ? null : path.relative(ROOT, abs).split(path.sep).join('/');
}

/** 按 `kind` 判断绝对路径是否存在且为该类型（不存在时 false，不抛） */
function existsAs(abs: string, kind: 'file' | 'directory'): boolean {
  try {
    const stats = statSync(abs);
    return kind === 'file' ? stats.isFile() : stats.isDirectory();
  } catch {
    return false;
  }
}

/** 读取仓库内源文件文本（入参为仓库相对路径） */
export function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** 依次尝试 `.ts`、`.vue`、`/index.ts`、原路径，返回第一个存在的文件（都不存在则 null） */
function pickExisting(base: string): string | null {
  const hit = [`${base}.ts`, `${base}.vue`, path.join(base, 'index.ts'), base].find(candidate =>
    existsAs(candidate, 'file'),
  );
  return hit ?? null;
}

/** 把 import 说明符解析为仓库相对路径；外部包与无法解析的返回 null */
export function resolveSpecifier(spec: string, fromRel: string): string | null {
  if (spec.startsWith('@/')) return toRel(pickExisting(path.join(ROOT, spec.slice(2))));
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return toRel(pickExisting(path.resolve(path.join(ROOT, path.dirname(fromRel)), spec)));
  }
  return null;
}

/**
 * 提取一个源文件里的全部 import 说明符（静态、`import type`、动态 import）
 *
 * 类型层判定看说明符所在行的前缀：`import type { X } from 'vue'` 编译期即擦除、不进产物，
 * 故包体积与依赖类守卫不把它算作依赖。
 */
export function extractSpecifiers(source: string): Specifier[] {
  const specs: Specifier[] = [];
  const re = /(?:from\s*|import\s+|import\(\s*)(["'])([^"']+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const line = source.slice(lineStart, match.index);
    specs.push({ spec: match[2], typeOnly: /^\s*(?:import|export)\s+type\s/.test(line) });
  }
  return specs;
}

/**
 * 从入口出发递归展开仓库内 import 闭包
 *
 * 入参、出参一律是仓库相对 posix 路径，且正常情况下的入口会出现在出参里（调用方常要
 * 「可达 + 自己」一起判）。文件缺失时既不收录也不跟随，让调用方的「闭包非空」断言
 * 而不是这里的一次 crash 来报告路径漂移。
 * 未解析出的说明符（外部包）作为闭包边界停住，不让整条守卫因为一个噪声项崩掉。
 */
export function computeImportClosure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    if (seen.has(rel) || !existsAs(path.join(ROOT, rel), 'file')) continue;
    seen.add(rel);
    for (const { spec } of extractSpecifiers(readSource(rel))) {
      const resolved = resolveSpecifier(spec, rel);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

/**
 * 递归收集目录下的源文件（仓库相对 posix 路径）
 *
 * 默认收 `.ts` 与 `.vue` 并排除 `.d.ts`：架构守卫扫描的是会被打包或执行的代码，
 * 声明文件没有运行时消费者，计入只会制造噪声匹配。目录不存在时返回空数组，
 * 由调用方的「扫描非空」断言负责暴露漂移。
 */
export function listSourceFiles(dir: string, extensions: string[] = ['.ts', '.vue']): string[] {
  if (!existsAs(path.join(ROOT, dir), 'directory')) return [];

  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listSourceFiles(rel, extensions);
    if (!extensions.some(extension => entry.name.endsWith(extension))) return [];
    return entry.name.endsWith('.d.ts') ? [] : [rel];
  });
}
