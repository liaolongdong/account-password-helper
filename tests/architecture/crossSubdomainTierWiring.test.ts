/**
 * 跨子域档位的接线守卫
 *
 * 档位是「一次判定、多处消费」的口径，接线漏一处就是一个只在非默认档下暴露的静默缺陷。
 * 已发生过的真实形态：侧边栏整行点击走档位感知的 `offSiteIds`，键盘回车却调了
 * `matchesSiteScope(entry, ctx)` 并吃了形参默认值 `off`——跨子域条目「点得到、回车打不开」。
 * 形参默认值让漏传在类型检查和 ESLint 下完全静默，故此处做机械扫描。
 *
 * 同时守住另一条相反的边界：档位变更**不得**进入缓存失效键列表。它只影响过滤结果，
 * 一旦落进 `relevantKeys` 就会删掉 storage.session 快照并触发全量解密回温，
 * 让「切档后侧边栏仍秒开」这条 SLA 失效（历史缺陷类别，见 AGENTS.md 性能约束）。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SIDEPANEL_SRC = readFileSync(path.join(ROOT, 'entrypoints/sidepanel/App.vue'), 'utf8');
const BACKGROUND_SRC = readFileSync(path.join(ROOT, 'entrypoints/background/backgroundServices.ts'), 'utf8');

/** 需要显式传档位的站点范围谓词：签名末位是 `mode` 且带默认值 */
const MODE_BEARING_FN = 'matchesSiteScope|filterEntriesByScope';

/**
 * 抓出源码里对 `matchesSiteScope` / `filterEntriesByScope` 的每一次调用及其参数串
 *
 * 只匹配「一个括号层级」的实参（如 `ctx(domain, port)` 这类嵌套调用），足以覆盖被测文件
 * 的实际写法；抽取结果为空时由「扫描非空」用例兜住，防止正则失配让守卫空跑。
 */
function collectCallArgs(src: string): Array<{ fn: string; args: string }> {
  const re = new RegExp(`\\b(${MODE_BEARING_FN})\\(((?:[^()]|\\([^()]*\\))*)\\)`, 'g');
  return [...src.matchAll(re)].map(m => ({ fn: m[1], args: m[2] }));
}

/** 顶层逗号数（即实参个数 - 1）：忽略括号内的逗号 */
function topLevelCommas(args: string): number {
  let depth = 0;
  let commas = 0;
  for (const ch of args) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) commas += 1;
  }
  return commas;
}

describe('跨子域档位接线', () => {
  const calls = collectCallArgs(SIDEPANEL_SRC);

  it('侧边栏确有站点范围判定（防止正则失配导致守卫空跑）', () => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('侧边栏每次站点范围判定都显式传档位，不吃 `off` 形参默认值', () => {
    // matchesSiteScope(entry, ctx, mode) → 2 个顶层逗号；filterEntriesByScope(entries, scope, ctx, mode) → 3
    const required = { matchesSiteScope: 2, filterEntriesByScope: 3 } as const;
    const missing = calls
      .filter(({ fn, args }) => topLevelCommas(args) < required[fn as keyof typeof required])
      .map(({ fn, args }) => `${fn}(${args})`);

    expect(
      missing,
      `以下调用依赖 off 形参默认值，非默认档下会与整行点击/展示口径分叉：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('档位变更只复位 SW 档位镜像，绝不进缓存失效键列表', () => {
    const resetBranch = /STORAGE_KEYS\.DOMAIN_MATCH_CONFIG in changes[\s\S]{0,200}?resetDomainMatchModeMirror\(\)/;
    expect(resetBranch.test(BACKGROUND_SRC), '后台 storage 监听未复位档位镜像，切档后镜像会长期陈旧').toBe(true);

    const relevantKeys = /const relevantKeys = \[([\s\S]*?)\];/.exec(BACKGROUND_SRC)?.[1] ?? '';
    expect(relevantKeys).not.toBe('');
    expect(relevantKeys, '档位进入缓存失效键会触发全量解密回温，破坏侧边栏秒开 SLA').not.toContain(
      'DOMAIN_MATCH_CONFIG',
    );
  });
});

/**
 * 「跨子域命中」区间的单点定义守卫
 *
 * 侧边栏徽章、内联下拉来源 chip、空态引导计数与自动保存去向提示四处共用 tier 1~3 这一区间，
 * 各处手写 `tier >= 1 && tier <= 3` 时，只要有一处漏改就会出现「同一条目一边标来源、一边不标」
 * 的自相矛盾呈现——而这种分叉在单档测试里看不出来。区间判定已收进 `isCrossSubdomainTier`，
 * 此处机械禁止运行时代码再手写区间，把「四处同口径」从人的自觉变成门禁。
 */
describe('跨子域层级区间的单点定义', () => {
  /**
   * `benchmarks` 也在扫描范围内：那里的徽章扫描逐字复刻侧边栏那段循环，
   * 手写区间同样会与运行时口径分叉（本波评审期间就真的出现过一次）。
   */
  const RUNTIME_DIRS = ['utils', 'entrypoints', 'composables', 'components', 'benchmarks'];

  const collectSourceFiles = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(relative);
      return /\.(ts|vue)$/.test(entry.name) ? [relative] : [];
    });

  /** 形如 `tier >= 1` / `widened > 3` 的手写区间判定（含 `acc.tier >= 1` 这类属性写法） */
  const HANDWRITTEN_RANGE = /\b(?:tier|widened)\s*(?:>=?|<=?)\s*[13]\b/g;

  /** 剥掉 `isCrossSubdomainTier` 函数体：它是区间的唯一定义处，不参与违规统计 */
  const stripCanonicalDefinition = (src: string): string =>
    src.replace(/export function isCrossSubdomainTier[\s\S]*?\n}/, '');

  const DOMAIN_SRC = readFileSync(path.join(ROOT, 'utils/domain.ts'), 'utf8');
  const scannedFiles = RUNTIME_DIRS.flatMap(collectSourceFiles);
  const offenders: string[] = [];
  for (const file of scannedFiles) {
    const hits = stripCanonicalDefinition(readFileSync(path.join(ROOT, file), 'utf8')).match(HANDWRITTEN_RANGE);
    if (hits) offenders.push(`${file}: ${hits.join(', ')}`);
  }

  it('扫描确有覆盖到运行时代码（防止目录清单失效导致守卫空跑）', () => {
    expect(scannedFiles.length).toBeGreaterThan(150);
  });

  it('守卫确有抽到区间定义（防止抽取正则失配导致空跑）', () => {
    // 区间在 `isCrossSubdomainTier` 体内出现两次，剥掉后应当一处不剩——
    // 抽取正则一旦失配，下面的违规扫描就会变成永真断言
    expect(DOMAIN_SRC.match(HANDWRITTEN_RANGE)).toHaveLength(2);
    expect(stripCanonicalDefinition(DOMAIN_SRC).match(HANDWRITTEN_RANGE)).toBeNull();
  });

  it('除 isCrossSubdomainTier 内部，运行时代码不手写跨子域层级区间', () => {
    expect(offenders, `以下位置手写了 tier 区间，会与其余三处呈现口径分叉：\n${offenders.join('\n')}`).toEqual([]);
  });

  /**
   * 反向接线：四个呈现面确实调用了单点判据
   *
   * 只禁手写区间是不够的——改成 `tier === 1`、`tier > 0 && tier < 4` 这类形态同样能绕过扫描，
   * 却让「四处同口径」的前提失效。故再钉一层：这四处源码都必须出现 `isCrossSubdomainTier(`。
   */
  it('侧边栏徽章、内联下拉 chip、去向提示与空态计数四处都经单点判据', () => {
    const consumers = {
      'entrypoints/sidepanel/App.vue': '侧边栏来源徽章',
      'entrypoints/content/inlineDropdown/InlineFillDropdown.ts': '内联下拉来源 chip',
      'utils/storage/autoSaveManager.ts': '自动保存去向提示',
      'utils/domain.ts': '空态引导计数',
    };
    const missing = Object.entries(consumers)
      .filter(([file]) => !readFileSync(path.join(ROOT, file), 'utf8').includes('isCrossSubdomainTier('))
      .map(([file, role]) => `${role}（${file}）`);

    expect(missing, `以下呈现面不再调用 isCrossSubdomainTier，呈现口径会分叉：\n${missing.join('\n')}`).toEqual([]);
  });
});
