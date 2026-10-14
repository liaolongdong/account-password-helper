/**
 * 动效时长令牌的接线守卫
 *
 * `assets/theme/tokens.css` 的 `--aph-duration-*` 三档把仓库里最密集的三簇字面时长
 * （0.15s / 0.2s / 0.3s）收成名字。**令牌层唯一会静默失效的方式**是名字写错：CSS 自定义属性
 * 在引用处解析不到时，整条 `transition` / `animation` 简式当场作废，浏览器既不报错也不降级，
 * 只是那处动效永远不播——类型检查、构建、单测、`pnpm lint` 全都不会红，肉眼只在对比时才发现。
 * 影子树那一侧已有 `shadowTokenCoverage.test.ts` 守着，扩展页这一侧（`.vue` 的 `<style>` 与被
 * `@import` 吸收的裸 `.css`）此前无人守，而本轮新增的令牌恰好只服务这一侧。
 *
 * 四条判据：
 * 1. 三档时长令牌存在，且**只在 `:root` 声明一次**——一旦某个主题块覆盖它，"时长与配色无关"
 *    这个前提就断了，`utils/theme.ts` 的镜像表也得跟着改，那是另一件事；
 * 2. 扩展页里每个 `var(--aph-*)` 都能在 tokens.css 取到值，除非那一处 `var()` 自带兜底值；
 * 3. 令牌必须真的有消费者（无人引用的令牌只是注释，不是层）；
 * 4. 判据自身有牙（错名 + 无兜底必须被抓到，带兜底与已声明不误报）。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 三档时长令牌名 */
const DURATION_TOKENS = ['--aph-duration-fast', '--aph-duration-mid', '--aph-duration-slow'] as const;

/** 扫描范围：只算扩展页那一侧的样式落点，影子树由 `shadowTokenCoverage.test.ts` 负责 */
const EXTENSION_STYLE_DIRS = ['components', 'entrypoints'];

/** `var(--aph-xxx)` / `var(--aph-xxx, 兜底)` 引用形态 */
const TOKEN_REFERENCE_RE = /var\(\s*(--aph-[a-z0-9-]+)\s*(,)?/g;

/** tokens.css 里的 `--aph-xxx: 值;` 声明 */
const TOKEN_DEFINITION_RE = /^\s*(--aph-[a-z0-9-]+)\s*:\s*([^;]+);/gm;

/** 一次 `var()` 引用：令牌名 + 是否带兜底值 */
interface TokenReference {
  name: string;
  hasFallback: boolean;
}

/** 取出一段样式文本里全部 `var(--aph-*)` 引用（去重，保留兜底信息） */
function tokenReferences(source: string): TokenReference[] {
  const seen = new Map<string, TokenReference>();
  for (const [, name, fallbackComma] of source.matchAll(TOKEN_REFERENCE_RE)) {
    const entry = { name, hasFallback: fallbackComma !== undefined };
    // 同名两处、一处带兜底一处不带时，以「不带兜底」的严格形态为准
    const previous = seen.get(name);
    if (!previous || previous.hasFallback) seen.set(name, entry);
  }
  return [...seen.values()];
}

/** 解析 tokens.css，得到「令牌名 → 声明它的花括号块」映射 */
function declaredTokens(): Map<string, string[]> {
  const css = readSource('assets/theme/tokens.css');
  const byName = new Map<string, string[]>();
  for (const [, themeAttr, body] of css.matchAll(/:root(?:\[data-theme='([^']+)'\])?\s*\{([\s\S]*?)\n\}/g)) {
    const theme = themeAttr || 'root';
    for (const [, name] of body.matchAll(TOKEN_DEFINITION_RE)) {
      byName.set(name, [...(byName.get(name) ?? []), theme]);
    }
  }
  return byName;
}

/** 扩展页样式落点的文件清单（`.vue` 与 `.css` 两类，影子树由另一个守卫负责） */
function extensionStyleFiles(): string[] {
  return EXTENSION_STYLE_DIRS.flatMap(dir => listSourceFiles(dir, ['.vue', '.css']));
}

/** 取一个样式文件的判定文本：`.vue` 只取 `<style>` 块，`.css` 整文件 */
function styleTextOf(file: string): string {
  const source = readSource(file);
  return file.endsWith('.vue') ? (source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n') : source;
}

/** 扩展页样式落点里的全部 `var(--aph-*)` 引用清单 */
function extensionPageReferences(): { file: string; ref: TokenReference }[] {
  return extensionStyleFiles().flatMap(file => tokenReferences(styleTextOf(file)).map(ref => ({ file, ref })));
}

const declared = declaredTokens();

describe('时长令牌的存在性与归属', () => {
  it('三档都在，且只由 :root 声明（不与六个主题块纠缠）', () => {
    for (const token of DURATION_TOKENS) {
      const blocks = declared.get(token);
      expect(blocks, `${token} 未在 tokens.css 声明`).toBeDefined();
      expect(blocks, `${token} 被主题块覆盖过：时长不该跟随换肤`).toEqual(['root']);
    }
  });

  it('三档取值各不相等，且都是可解析的时长', () => {
    const css = readSource('assets/theme/tokens.css');
    const durations = DURATION_TOKENS.map(token => new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1]?.trim());
    expect(new Set(durations).size, `三档取值出现重复：${durations.join(' / ')}`).toBe(3);
    for (const duration of durations) {
      expect(duration, '时长档位必须是秒或毫秒').toMatch(/^[\d.]+m?s$/);
    }
  });

  it('令牌真的有消费者，不是写在 :root 里的说明书', () => {
    const css = extensionStyleFiles().map(styleTextOf).join('\n');
    for (const token of DURATION_TOKENS) {
      const uses = (css.match(new RegExp(`var\\(\\s*${token}\\s*[,)]`, 'g')) ?? []).length;
      expect(uses, `${token} 没有任何消费点，该删或该用`).toBeGreaterThan(0);
    }
  });
});

describe('引用侧：扩展页里不存在取不到值的令牌', () => {
  const refs = extensionPageReferences();

  it('扫描到足够规模的引用（判据不是空跑）', () => {
    expect(refs.length).toBeGreaterThan(20);
    expect(new Set(refs.map(item => item.ref.name)).size).toBeGreaterThanOrEqual(8);
  });

  it('每个 var(--aph-*) 要么在 tokens.css 有声明，要么自带兜底', () => {
    const violations = refs
      .filter(({ ref }) => !ref.hasFallback && !declared.has(ref.name))
      .map(({ file, ref }) => `${file} 引用 ${ref.name}，tokens.css 未声明且无兜底（整条声明会静默作废）`);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('判据有牙：错名无兜底被抓到，带兜底与已声明都不误报', () => {
    expect(tokenReferences('transition: color var(--aph-duration-typo) ease;')).toEqual([
      { name: '--aph-duration-typo', hasFallback: false },
    ]);
    expect(tokenReferences('font-family: var(--aph-font-mono, ui-monospace, monospace);')).toEqual([
      { name: '--aph-font-mono', hasFallback: true },
    ]);
    expect(tokenReferences('color: var(--aph-primary);')).toEqual([{ name: '--aph-primary', hasFallback: false }]);
    // 同名两种写法混在一处时，以严格的那一条为准（否则一处兜底就赦免了另一处的错名）
    expect(tokenReferences('a { color: var(--aph-x, red); } b { color: var(--aph-x); }')).toEqual([
      { name: '--aph-x', hasFallback: false },
    ]);
    expect(declared.has('--aph-duration-mid')).toBe(true);
    expect(declared.has('--aph-duration-none-such')).toBe(false);
  });
});
