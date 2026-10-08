/**
 * sidepanel / popup 首屏产物守卫（两条独立判据）
 *
 * 本文件按产物引用图查两件事，二者口径不同、别混着读：
 *
 * - **归属**（下段）：身份域代码绝不进入这两个入口，递归展开静态 + 动态 import 的完整闭包；
 * - **预算**（`EAGER_ALLOW_LIST` 段）：入口 HTML 直接预加载的那批 chunk 不得变厚，只看 HTML
 *   点名的引用，不看闭包（闭包里的 `HelpDialog-*.js`、`GuideView-*.js` 属懒加载，本就该在外面）。
 *
 * ---
 *
 * 背景：身份信息库刻意做成「只在 Options 页存在」的平行数据域，独立性是首要需求
 * （见 `docs/ARCHITECTURE.md`「27. 身份信息库」的「定位与独立性」）。
 * 但 `utils/storageKeys.ts` 同时被 sidepanel / popup / options 依赖，往 `STORAGE_KEYS`
 * 加 `IDENTITY` 键后，该共享 chunk 的字节必然变化（属内容变化非行为变化）。
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
 * 两段判据自检都不依赖产物，任何时候都跑。
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

/**
 * 展开一个入口 HTML 的首屏产物闭包。
 *
 * 只允许在 `it` 内调用：`describe.skipIf` 不会跳过收集阶段的回调，产物读取一旦写进
 * 回调体，缺产物的环境（CI 的 Unit tests 任务不跑 `pnpm build`）就会在收集期 ENOENT，
 * 整个文件连「跳过」都报不出来。
 */
function analyzeEntry(entry: string): { refs: string[]; closure: Set<string> } {
  const refs = extractChunkRefs(readEntryHtml(entry));
  return { refs, closure: computeClosure(refs.map(chunkFileFromHref)) };
}

describe.skipIf(!hasOutput)('身份库独立性 — 首屏产物闭包不含 identity chunk', () => {
  for (const entry of ENTRIES) {
    describe(entry, () => {
      it('存在入口 script 且闭包非空', () => {
        const { refs, closure } = analyzeEntry(entry);
        expect(refs.length).toBeGreaterThan(0);
        expect(closure.size).toBeGreaterThan(0);
      });

      it('闭包内没有任何身份域 chunk', () => {
        const leaked = [...analyzeEntry(entry).closure]
          .map(file => path.basename(file))
          .filter(name => FORBIDDEN_CHUNK_PREFIX.test(name));
        expect(leaked, `发现身份域 chunk 泄入首屏闭包: ${leaked.join(', ')}`).toEqual([]);
      });

      it('闭包源码不含 .aphid 的代码形态', () => {
        const leaked = [...analyzeEntry(entry).closure]
          .filter(file => FORBIDDEN_CONTENT_RE.test(readFileSync(file, 'utf8')))
          .map(file => path.basename(file));
        expect(leaked, `.aphid 备份容器代码泄入首屏闭包: ${leaked.join(', ')}`).toEqual([]);
      });
    });
  }
});

/**
 * 首屏体积守卫 —— sidepanel / popup 的 eager 预加载集合
 *
 * 与上一段守卫的分工：上面查的是「身份域代码**到不到得了**这两个入口」（递归闭包，含动态
 * import，判据是归属）；这里查的是「首屏**要多下载多少**」——即入口 HTML 里 `<script>` +
 * `<link rel="modulepreload">` 直接点名的那批 chunk（判据是集合与数量）。
 * 侧边栏「秒开」的硬性约束（`agents.md`「侧边栏秒开 SLA」）把这条路径当成预算项：`sidePanel.open()`
 * 之前不会等任何异步 chunk，所以 HTML 里这几个引用就是白屏期唯一在付费的资源。
 *
 * 为什么按「基名 + 出现次数」而不是文件集合相等：
 * - 产物名带 rollup 哈希且哈希字母表含 `-` 与 `_`（`lazyImport-Dmfn-GgX`、`tokens-BG44T6k-`），
 *   没法可靠地把「基名」从字符串里切出来，因此改成拿已知基名做前缀匹配（`base` 或 `base-` 开头）；
 * - `css-*` 是 Element Plus 按需引入产生的匿名 chunk，名字永远是 `css`，光靠名字挡不住
 *   「首屏多引了一个 EP 组件」——所以每个基名还带一个出现次数上限，超限即红；
 * - 用上限（`≤`）而非相等：首屏变小是好事，不该被罚红；变大必须先过一次人工确认。
 *
 * 命中红线的正确处置不是「把新名字加进清单」，而是先确认它为什么变成 eager：
 * 多数情况是 sidepanel 入口链上某个模块被从动态 `import()` 改成了静态 `import`。
 *
 * **2026-10-01 读数（`icon` 上限从 1 放到 2、`total` 同步收到 33/43 的依据）**：
 * 指引页把最后两颗 `el-button` 换成原生 `<button>` 后，EP 组件在跨入口共享 chunk 里的归属变了，
 * rolldown 重切了 vendor 块——`browser-*`（14,035 B）与 `event-*`（745 B）不再被 HTML 点名，
 * 它们的内容并进了两只都以 icon 模块命名的块（42,269 + 19,663 = 61,932 B）。对拍：同一
 * node_modules、同一 HEAD 构建为 sidepanel 34 文件 / 276,658 B、popup 44 文件 / 292,679 B，
 * 工作树构建为 33 文件 / 276,818 B 与 43 文件 / 292,895 B——请求数各少 1，字节各 +0.06%/+0.07%
 * （重切带来的压缩开销），首屏没有变厚。所以红的是**按基名计数的口径**，不是预算本身；
 * `total` 跟着实际读数往下收，新增一个 eager 文件仍然会红，牙没磨钝。
 */
const EAGER_ALLOW_LIST: Record<(typeof ENTRIES)[number], { total: number; bases: Readonly<Record<string, number>> }> = {
  'sidepanel.html': {
    total: 33,
    bases: {
      sidepanel: 1,
      'rolldown-runtime': 1,
      logger: 1,
      storageKeys: 1,
      i18n: 1,
      icon: 2,
      lazyImport: 1,
      'preload-helper': 1,
      '_plugin-vue_export-helper': 1,
      tokens: 1,
      'use-global-config': 1,
      'use-form-item': 1,
      css: 3,
      dist: 1,
      typescript: 1,
      message: 1,
      types: 1,
      plaintextCacheCleanup: 1,
      browserStartupRelock: 1,
      domain: 1,
      configManager: 1,
      a11y: 1,
      'crypto-light': 1,
      tagUtils: 1,
      searchMatch: 1,
      useKeywordDebounce: 1,
      useLocalOperationGuard: 1,
      totp: 1,
      preWarmSw: 1,
      shareCard: 1,
    },
  },
  'popup.html': {
    total: 43,
    bases: {
      popup: 1,
      'rolldown-runtime': 1,
      logger: 1,
      storageKeys: 1,
      i18n: 1,
      icon: 2,
      lazyImport: 1,
      'preload-helper': 1,
      '_plugin-vue_export-helper': 1,
      tokens: 1,
      'use-global-config': 1,
      'use-form-item': 1,
      css: 4,
      dist: 1,
      typescript: 1,
      message: 1,
      tag: 1,
      types: 1,
      domain: 1,
      configManager: 1,
      generateId: 1,
      'crypto-light': 1,
      plaintextCacheCleanup: 1,
      browserStartupRelock: 1,
      'sessionManager-storage': 1,
      facades: 1,
      masterPassword: 1,
      concurrency: 1,
      passwordHistory: 1,
      constants: 1,
      reminderManager: 1,
      passwordCrud: 1,
      passwordStrengthCore: 1,
      autoSaveManager: 1,
      storage: 1,
      urls: 1,
      verify: 1,
      preWarmSw: 1,
      useShortcuts: 1,
    },
  },
};

/**
 * 拿已知基名对产物名做前缀匹配，返回命中的基名；未登记返回 `undefined`。
 *
 * 分隔符 `-` 是判据的一部分，不是可省的宽松：`tag` 已登记时 `tagUtils-*.js` 必须落榜，
 * 否则「任何以某个已登记基名开头的模块」都会被顺手放行。
 */
function matchAllowedBase(fileName: string, allowedBases: readonly string[]): string | undefined {
  const name = fileName.replace(/\.js$/, '');
  return allowedBases.find(base => name === base || name.startsWith(`${base}-`));
}

/** eager 引用 = 入口 script + 全部 modulepreload（相对 `assets/` 之外的 chunks 路径） */
function eagerFiles(entry: string): string[] {
  return extractChunkRefs(readEntryHtml(entry)).map(chunkFileFromHref);
}

describe.skipIf(!hasOutput)('首屏体积 — eager 预加载不得超出允许清单', () => {
  for (const entry of ENTRIES) {
    describe(entry, () => {
      it('每个 eager chunk 的基名都在清单内且数量不超限', () => {
        const allow = EAGER_ALLOW_LIST[entry];
        const files = eagerFiles(entry);
        const allowedBases = Object.keys(allow.bases);

        const unlisted = files
          .map(file => path.basename(file))
          .filter(name => matchAllowedBase(name, allowedBases) === undefined);
        expect(unlisted, `首屏新增未登记的 chunk: ${unlisted.join(', ')}`).toEqual([]);

        const seen = new Map<string, number>();
        for (const file of files) {
          const base = matchAllowedBase(path.basename(file), allowedBases) as string;
          seen.set(base, (seen.get(base) ?? 0) + 1);
        }
        const over = [...seen]
          .filter(([base, count]) => count > allow.bases[base])
          .map(([base, count]) => `${base} ×${count}（上限 ${allow.bases[base]}）`);
        expect(over, `首屏 chunk 数量超预算: ${over.join(', ')}`).toEqual([]);
      });

      it('eager 引用总数不超过预算', () => {
        expect(eagerFiles(entry).length).toBeLessThanOrEqual(EAGER_ALLOW_LIST[entry].total);
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

/**
 * 判据自检 —— eager 允许清单的匹配规则（同样不依赖产物）
 *
 * 「按基名前缀匹配」比「按文件集合相等」宽松，宽松必须自证仍有牙：登记的基名要能吃完整个
 * hash 变体族，相近但不能同源的模块名（`tag` vs `tagUtils`）必须落榜，本轮刻意留在懒加载里的
 * 文档 / 富文本 / 身份域模块名也必须落榜。清单本身另有一条内部一致性断言，防止「加了名字
 * 忘了改总数」这类只改一半的维护错误——CI 不跑 `pnpm build`，那条路径只有这里能查。
 */
describe('判据自检 — eager 允许清单按基名判、相近前缀不误放', () => {
  const sidepanelBases = Object.keys(EAGER_ALLOW_LIST['sidepanel.html'].bases);
  const popupBases = Object.keys(EAGER_ALLOW_LIST['popup.html'].bases);

  it('已登记基名能吃掉带 hash 的产物名（含 hash 里带 - 与结尾 - 的形态）', () => {
    const cases: Array<[string, string[]]> = [
      ['sidepanel-CNwRZQIf.js', sidepanelBases],
      ['tokens-BG44T6k-.js', sidepanelBases],
      ['css-BY9-3EH3.js', sidepanelBases],
      ['_plugin-vue_export-helper-K9rsuiWd.js', sidepanelBases],
      ['tag-DqrBDkJd.js', popupBases],
      ['sessionManager-storage-CVsLgPTc.js', popupBases],
    ];
    for (const [file, allowed] of cases) {
      expect(matchAllowedBase(file, allowed), `应命中已登记基名: ${file}`).toBeDefined();
    }
  });

  it('前缀相近但不同源的模块名不误放', () => {
    // `tag` 在 popup 清单里、`tagUtils` 只在 sidepanel 清单里：拿 popup 清单验 tagUtils，
    // 若匹配规则省掉 `-` 边界就会误判成同源。
    expect(matchAllowedBase('tagUtils-CK58tGK-.js', popupBases)).toBeUndefined();
    expect(matchAllowedBase('tag-DqrBDkJd.js', sidepanelBases)).toBeUndefined();
  });

  it('本轮新增的文档 / 富文本 / 引导 / 身份域模块都不在 eager 清单内', () => {
    // 它们只允许经懒加载进入（见 `HelpGroupIcon-*.js`、`GuideView-*.js` 的实际产物形态）；
    // 这条断言把「不许把首屏变厚」写成清单数据的属性，而不是只写在注释里。
    const mustStayLazy = /^(identity|backup|GuideView|OnboardingTour|RichText|HelpGroupIcon|ShortcutKeyCap)/;
    for (const [entry, bases] of Object.entries(EAGER_ALLOW_LIST)) {
      const hit = Object.keys(bases).filter(name => mustStayLazy.test(name));
      expect(hit, `${entry} 允许清单混入了必须懒加载的模块: ${hit.join(', ')}`).toEqual([]);
    }
  });

  it('清单内部一致：各基名上限之和等于总数预算', () => {
    for (const [entry, allow] of Object.entries(EAGER_ALLOW_LIST)) {
      const sum = Object.values(allow.bases).reduce((a, b) => a + b, 0);
      expect(sum, `${entry} 的 bases 上限之和应等于 total（两处只改了一处）`).toBe(allow.total);
    }
  });
});
