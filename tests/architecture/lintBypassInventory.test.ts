/**
 * 静态绕过项清单守卫（eslint-disable / @ts-ignore）
 *
 * `AGENTS.md`「禁止使用宽泛的 eslint-disable、@ts-ignore；确需例外时限制到最小行范围，
 * 并说明原因」是硬约束，但它在日常开发里最容易悄悄长大：多一行 `eslint-disable` 不会
 * 让任何门禁变红。本守卫把它变成一份**逐条登记的清单**——新增绕过、删掉绕过、
 * 把行内豁免扩成块级、块级豁免漏配 `eslint-enable`（等价于整文件豁免）都让测试变红，
 * 而每条登记都带着它存在的理由，评审时一眼能判断该不该留。
 *
 * 与同类守卫一样的两条纪律：扫描规模要有下限断言（目录漂移时不能静默空跑），
 * 且判据本身要有「能咬人」的自检用例（用合成源码验证，不往仓库里塞假违规）。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：会被打包或运行的仓库源码，不含 `tests/`（夹具里的字符串不是运行时绕过） */
const SCANNED_DIRS = ['components', 'entrypoints', 'composables', 'utils', 'e2e'];

/** 一条已登记的绕过 */
interface BypassEntry {
  /** 文件（仓库相对路径） */
  file: string;
  /** 被绕过的规则名 */
  rule: string;
  /** 豁免粒度：`line` 为 `eslint-disable-next-line`，`block` 为成对的 disable/enable */
  form: 'line' | 'block';
  /** 出现次数 */
  count: number;
  /** 为什么必须留 */
  reason: string;
}

/**
 * 现状清单（2026-10 收敛后）
 *
 * - `logger.ts`：`no-console` 的唯一合法宿主就是这层封装本身；
 * - `ValiditySettingDialog.vue`：表单对象由父级持有并按引用双向绑定，
 *   改成 emit 需连带调整父级的表单所有权；
 * - `e2e/harness.ts`：解构出空对象以满足 Playwright 参数占位，属测试脚手架噪声。
 *
 * `HelpDialog.vue` 曾有 8 组 `vue/no-v-html` 块级豁免，本波改由 `components/RichText.vue`
 * 结构化渲染（白名单 `<b>` / `<code>`，其余按字面文本），豁免随实现一并归零——
 * 这条清单从此只减不增的口径由下方「块级豁免为空」的用例强制。
 */
const ALLOWED: BypassEntry[] = [
  { file: 'utils/logger.ts', rule: 'no-console', form: 'line', count: 4, reason: 'logger 是 console 的唯一封装层' },
  {
    file: 'components/options/ValiditySettingDialog.vue',
    rule: 'vue/no-mutating-props',
    form: 'line',
    count: 1,
    reason: '表单对象由父级持有、按引用双向绑定',
  },
  { file: 'e2e/harness.ts', rule: 'no-empty-pattern', form: 'line', count: 1, reason: 'Playwright 参数占位' },
];

/** 源码里抓到的一处绕过（`eslint-disable` 与 `@ts-ignore` 系列统一成同一形状） */
interface FoundBypass {
  file: string;
  rule: string;
  form: 'line' | 'block' | 'ts';
}

/**
 * `eslint-disable[-next-line] rule-a rule-b`（后面可能跟 ` - 说明`）
 *
 * 分隔符只允许水平空白：`\s` 会吃掉换行，规则名候选集里又含 `/` 与 `-`
 * （`vue/no-v-html` 需要），跨行匹配会把下一条注释里的 `//` 当成规则名，
 * 把两处豁免算成一处、并篡改它们的粒度。
 */
const ESLINT_DISABLE_RE = /eslint-(disable|enable)(-next-line)?[ \t]+([A-Za-z0-9@/_-]+(?:[ \t]+[A-Za-z0-9@/_-]+)*)/g;

/** `@ts-ignore` / `@ts-expect-error`，后面必须跟说明 */
const TS_SUPPRESS_RE = /@(ts-ignore|ts-expect-error|ts-nocheck)\b/g;

/**
 * 取出指令后面的规则名，遇到第一个不像规则名的 token 就停
 *
 * 规则名一律以字母或 `@` 开头（`no-console`、`vue/no-v-html`、`@typescript-eslint/...`）；
 * 后面的 `- 原因说明` 这类中文/符号尾巴必须被丢掉，否则一条豁免会被登记成好几条。
 */
function ruleNames(raw: string): string[] {
  const names: string[] = [];
  for (const token of raw.split(/[ \t]+/)) {
    if (!/^[A-Za-z@][A-Za-z0-9@/_-]*$/.test(token)) break;
    names.push(token);
  }
  return names;
}

/**
 * 抽取一个文件里的全部绕过项
 *
 * 块级豁免只登记 `disable`（`enable` 由配对检查单独负责），
 * 这样"把行内豁免改成块级"会改变 `form`，清单立刻对不上。
 */
function collectBypasses(file: string, source: string): FoundBypass[] {
  const found: FoundBypass[] = [];

  for (const match of source.matchAll(ESLINT_DISABLE_RE)) {
    const isEnable = match[1] === 'enable';
    if (isEnable) continue;
    const form = match[2] ? 'line' : 'block';
    for (const rule of ruleNames(match[3] ?? '')) found.push({ file, rule, form });
  }
  for (const match of source.matchAll(TS_SUPPRESS_RE)) {
    found.push({ file, rule: `@${match[1]}`, form: 'ts' });
  }
  return found;
}

/** 折叠成 `file|rule|form -> count` 的可比较形状 */
function tally(bypasses: FoundBypass[]): string[] {
  const counts = new Map<string, number>();
  for (const { file, rule, form } of bypasses) {
    const key = `${file}|${rule}|${form}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => `${key}=${count}`).sort();
}

/** 清单展开成与 `tally` 同一形状（按 `count` 逐次展开），避免两处手写格式漂移 */
function allowedTally(): string[] {
  return tally(
    ALLOWED.flatMap(entry =>
      Array.from({ length: entry.count }, () => ({ file: entry.file, rule: entry.rule, form: entry.form })),
    ),
  ).sort();
}

/** 块级 `disable` 与 `enable` 是否逐规则配对（漏配 = 整文件豁免） */
function unpairedBlocks(file: string, source: string): string[] {
  const diffs: string[] = [];
  const counts = new Map<string, { disable: number; enable: number }>();
  for (const match of source.matchAll(ESLINT_DISABLE_RE)) {
    if (match[2]) continue; // 行内豁免无需配对
    const key = ruleNames(match[3] ?? '').join(' ') || '(未指定规则)';
    const bucket = counts.get(key) ?? { disable: 0, enable: 0 };
    bucket[match[1] === 'enable' ? 'enable' : 'disable'] += 1;
    counts.set(key, bucket);
  }
  for (const [rule, { disable, enable }] of counts) {
    if (disable !== enable) diffs.push(`${file} 规则「${rule}」disable=${disable} / enable=${enable}`);
  }
  return diffs;
}

const files = SCANNED_DIRS.flatMap(dir => listSourceFiles(dir));
const found = files.flatMap(file => collectBypasses(file, readSource(file)));

describe('静态绕过项清单', () => {
  it('扫描到足够规模的源码（目录漂移时变红，而不是静默空跑）', () => {
    expect(files.length).toBeGreaterThan(150);
    // 清单非空即说明至少抓到过东西；真正的"正则失配"由下一条用例的合成自检负责
    expect(ALLOWED.reduce((sum, entry) => sum + entry.count, 0)).toBeGreaterThan(0);
  });

  it('绕过项与登记清单逐条一致（新增需登记理由，删除需同步清单）', () => {
    expect(
      tally(found),
      `绕过项清单与实际源码不符。实际:\n${tally(found).join('\n')}\n登记: ${allowedTally().join('\n')}`,
    ).toEqual(allowedTally());
  });

  it('每条登记都写明理由，且理由不是占位空话', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length, `${entry.file} 的 ${entry.rule} 缺理由`).toBeGreaterThan(8);
      expect(entry.count, `${entry.file} 的 ${entry.rule} 次数必须为正`).toBeGreaterThan(0);
    }
  });

  it('块级豁免一律成对出现（漏配 enable 等于整文件豁免）', () => {
    const unpaired = files.flatMap(file => unpairedBlocks(file, readSource(file)));
    expect(unpaired, `以下文件的块级豁免没有配对:\n${unpaired.join('\n')}`).toEqual([]);
  });

  it('判据有牙：合成源码里的未登记绕过、扩成块级、漏配 enable 都被抓出', () => {
    const source = `
      // eslint-disable-next-line no-console - 封装层自身
      // eslint-disable vue/no-v-html
      <li v-html="x"></li>
      // @ts-expect-error 随手压个错
    `;
    const synthetic = collectBypasses('synthetic.ts', source);

    expect(tally(synthetic)).toEqual(
      [
        'synthetic.ts|@ts-expect-error|ts=1',
        'synthetic.ts|no-console|line=1',
        'synthetic.ts|vue/no-v-html|block=1',
      ].sort(),
    );
    // 漏配 enable：块级豁免被单独点名
    expect(unpairedBlocks('synthetic.ts', source)).toEqual(['synthetic.ts 规则「vue/no-v-html」disable=1 / enable=0']);
    // 与真实源码对照：清单里登记的每一条确实能在源码中命中，判据不是只对新样本生效
    for (const entry of ALLOWED) {
      const hits = collectBypasses(entry.file, readSource(entry.file)).filter(
        bypass => bypass.rule === entry.rule && bypass.form === entry.form,
      );
      expect(hits.length, `${entry.file} 的 ${entry.form} 级 ${entry.rule} 数量已变`).toBe(entry.count);
    }
  });

  it('块级豁免已归零：出现任何不带 `-next-line` 的 `eslint-disable` 都必须先登记理由', () => {
    const blockSites = [...new Set(found.filter(bypass => bypass.form === 'block').map(bypass => bypass.file))];
    expect(blockSites, `以下文件出现了块级豁免，但未登记进清单: ${blockSites.join(', ')}`).toEqual([]);
  });
});
