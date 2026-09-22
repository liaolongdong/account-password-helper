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
import { readFileSync } from 'fs';
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
