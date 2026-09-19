/** @vitest-environment jsdom */

/**
 * 站点规则明文 JSON 导入/导出的回归测试
 *
 * 必须钉住的边界：
 * 1. 导入文件是磁盘上的不可信输入——结构、体积、条数、域名形态、选择器语法逐项校验，
 *    非法条目逐条剔除而不是整份接受，否则一条坏选择器就会让内容脚本每轮检测抛错；
 * 2. 合并语义是「按域名覆盖、其余保留」，且必须显式报告新增/更新/被剔除条数，
 *    不得静默改数据，也不得让「10 条只进了 3 条」看起来像全部成功；
 * 3. 域名是内容脚本精确匹配的主键，导入必须走与写入端同一个规范化函数，
 *    否则同一站点会被存成两条互相看不见的规则。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkSetSiteRules, getSiteRules } from '@/utils/storage/siteRules';
import {
  buildSiteRulesExportPayload,
  exportSiteRulesToFile,
  getSiteRulesImportErrorCode,
  importSiteRulesFromText,
  mergeSiteRules,
  parseSiteRulesImportText,
  SITE_RULES_IMPORT_MAX_INPUT_BYTES,
  SITE_RULES_IMPORT_MAX_RULES,
} from '@/utils/siteRulesTransfer';

/** 组一份合法信封文本 */
const envelopeText = (rules: unknown[]): string =>
  JSON.stringify({ kind: 'aphsr', version: 1, exportedAt: 1, count: rules.length, rules });

/** 只关心规则本体的用例用它，避免每条断言都套一层 .rules */
const parseRules = (text: string) => parseSiteRulesImportText(text).rules;

/** 取错误断言里的 code，避免每条断言重复做类型收窄 */
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return getSiteRulesImportErrorCode(error);
  }
  return undefined;
};

describe('buildSiteRulesExportPayload（导出信封）', () => {
  it('带 kind/version/count，规则按域名升序，便于两份导出结果直接比对', () => {
    const payload = buildSiteRulesExportPayload([
      { domain: 'zeta.com' },
      { domain: 'alpha.com', penetrateShadow: false },
    ]);

    expect(payload.kind).toBe('aphsr');
    expect(payload.version).toBe(1);
    expect(payload.count).toBe(2);
    expect(payload.rules.map(r => r.domain)).toEqual(['alpha.com', 'zeta.com']);
  });

  it('不改动传入数组本身（排序在副本上做）', () => {
    const rules = [{ domain: 'zeta.com' }, { domain: 'alpha.com' }];
    buildSiteRulesExportPayload(rules);
    expect(rules[0].domain).toBe('zeta.com');
  });
});

describe('parseSiteRulesImportText（结构与条目校验）', () => {
  it('接受本扩展的信封形态，并顺手规范化域名与选择器空白', () => {
    const rules = parseRules(
      envelopeText([
        {
          domain: ' Example.COM ',
          customSelectors: { username: '  #user  ', password: 'input[type="password"]' },
        },
      ]),
    );

    expect(rules).toEqual([
      { domain: 'example.com', customSelectors: { username: '#user', password: 'input[type="password"]' } },
    ]);
  });

  it('接受裸的 Record<domain, SiteRule>（chrome.storage 原样形态，便于手工编辑）', () => {
    const rules = parseRules(
      JSON.stringify({
        'foo.com': { domain: 'ignored.com', penetrateShadow: false },
      }),
    );

    expect(rules).toEqual([{ domain: 'foo.com', penetrateShadow: false }]);
  });

  it('只写域名的规则不产出任何条目：它既不指定选择器也不关闭穿透，落库只会变成噪声', () => {
    expect(codeOf(() => parseSiteRulesImportText(envelopeText([{ domain: 'foo.com' }])))).toBe('NO_VALID_RULES');
  });

  it('剔除非法域名与非法选择器，保留同一文件里的合法规则', () => {
    const rules = parseRules(
      envelopeText([
        { domain: 'https://bad.com', customSelectors: { username: '#u', password: '#p' } },
        { domain: 'bad-selector.com', customSelectors: { username: '##', password: '#p' } },
        { domain: 'half.com', customSelectors: { username: '#u' } },
        { domain: 'good.com', customSelectors: { username: '#u', password: '#p' } },
      ]),
    );

    expect(rules).toEqual([{ domain: 'good.com', customSelectors: { username: '#u', password: '#p' } }]);
  });

  it('被剔除的条数与规则一起回报，重复域名也计入，避免静默丢数据', () => {
    const { dropped } = parseSiteRulesImportText(
      envelopeText([
        { domain: 'https://bad.com', customSelectors: { username: '#u', password: '#p' } },
        { domain: 'dup.com', customSelectors: { username: '#first', password: '#p' } },
        { domain: 'DUP.com', customSelectors: { username: '#second', password: '#p' } },
        { domain: 'good.com', customSelectors: { username: '#u', password: '#p' } },
      ]),
    );

    expect(dropped).toBe(2);
  });

  it('全部合法时 dropped 为 0，导入提示不必追加忽略条数', () => {
    expect(parseSiteRulesImportText(envelopeText([{ domain: 'a.com', penetrateShadow: false }])).dropped).toBe(0);
  });

  it('同域名重复出现只取第一条，不互相覆盖', () => {
    const rules = parseRules(
      envelopeText([
        { domain: 'dup.com', customSelectors: { username: '#first', password: '#p' } },
        { domain: 'DUP.com', customSelectors: { username: '#second', password: '#p' } },
      ]),
    );

    expect(rules).toHaveLength(1);
    expect(rules[0].customSelectors?.username).toBe('#first');
  });

  it('非 JSON / 空文本归为 INVALID_JSON', () => {
    expect(codeOf(() => parseSiteRulesImportText('not json'))).toBe('INVALID_JSON');
    expect(codeOf(() => parseSiteRulesImportText('   '))).toBe('INVALID_JSON');
  });

  it('数组根、错 kind、错 version、count 与 rules 不一致都归为 UNSUPPORTED_FILE', () => {
    expect(codeOf(() => parseSiteRulesImportText('[1,2]'))).toBe('UNSUPPORTED_FILE');
    expect(codeOf(() => parseSiteRulesImportText(JSON.stringify({ kind: 'aphid', version: 1, rules: [] })))).toBe(
      'UNSUPPORTED_FILE',
    );
    expect(codeOf(() => parseSiteRulesImportText(JSON.stringify({ kind: 'aphsr', version: 99, rules: [] })))).toBe(
      'UNSUPPORTED_FILE',
    );
    expect(
      codeOf(() => parseSiteRulesImportText(JSON.stringify({ kind: 'aphsr', version: 1, count: 3, rules: [] }))),
    ).toBe('UNSUPPORTED_FILE');
  });

  it('条数与体积上限先于解析生效，避免异常文件拖住主线程', () => {
    const tooMany = Array.from({ length: SITE_RULES_IMPORT_MAX_RULES + 1 }, (_, i) => ({
      domain: `s${i}.com`,
      penetrateShadow: false,
    }));
    expect(codeOf(() => parseSiteRulesImportText(envelopeText(tooMany)))).toBe('TOO_MANY_RULES');
    expect(codeOf(() => parseSiteRulesImportText('x'.repeat(SITE_RULES_IMPORT_MAX_INPUT_BYTES + 1)))).toBe(
      'FILE_TOO_LARGE',
    );
  });
});

describe('mergeSiteRules（按域名合并）', () => {
  it('同域名计为更新且以文件内容为准，新域名计为新增，未命中的本机规则原样保留', () => {
    const { added, updated, rules } = mergeSiteRules(
      [
        { domain: 'a.com', customSelectors: { username: '#old', password: '#p' } },
        { domain: 'keep.com', penetrateShadow: false },
      ],
      [{ domain: 'a.com', customSelectors: { username: '#new', password: '#p' } }],
    );

    expect({ added, updated }).toEqual({ added: 0, updated: 1 });
    expect(rules).toEqual([
      { domain: 'a.com', customSelectors: { username: '#new', password: '#p' } },
      { domain: 'keep.com', penetrateShadow: false },
    ]);
  });

  it('命中历史遗留的大小写 key 时收敛成规范化后的单条，而不是并出两条同站规则', () => {
    const { added, updated, rules } = mergeSiteRules(
      [{ domain: 'Example.com', customSelectors: { username: '#old', password: '#p' } }],
      [{ domain: 'example.com', customSelectors: { username: '#new', password: '#p' } }],
    );

    expect({ added, updated }).toEqual({ added: 0, updated: 1 });
    expect(rules).toEqual([{ domain: 'example.com', customSelectors: { username: '#new', password: '#p' } }]);
  });

  it('本机同一站点已存着大小写变体时，保留内容脚本命得到的那条（与存储返回顺序无关）', () => {
    // 落盘是整份覆盖，两条都留下会互相看不见；选错那条等于把可用规则换成死规则
    const dead = { domain: 'Example.com', customSelectors: { username: '#dead', password: '#p' } };
    const live = { domain: 'example.com', customSelectors: { username: '#live', password: '#p' } };
    const incoming = [{ domain: 'other.com', penetrateShadow: false }];

    for (const current of [
      [dead, live],
      [live, dead],
    ]) {
      const { added, updated, rules } = mergeSiteRules(current, incoming);

      expect({ added, updated }).toEqual({ added: 1, updated: 0 });
      expect(rules.map(r => r.domain).sort()).toEqual(['example.com', 'other.com']);
      expect(rules.find(r => r.domain === 'example.com')).toEqual(live);
    }
  });
});

describe('importSiteRulesFromText（落盘）', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('合并写回：同域名覆盖、新域名追加、未涉及的本机规则不丢', async () => {
    await bulkSetSiteRules([
      { domain: 'a.com', customSelectors: { username: '#old-u', password: '#old-p' } },
      { domain: 'untouched.com', penetrateShadow: false },
    ]);

    const result = await importSiteRulesFromText(
      envelopeText([
        { domain: 'a.com', customSelectors: { username: '#new-u', password: '#new-p' } },
        { domain: 'b.com', customSelectors: { username: '#u', password: '#p' } },
      ]),
    );

    expect(result).toEqual({ added: 1, updated: 1, dropped: 0 });
    const stored = await getSiteRules();
    expect(Object.keys(stored).sort()).toEqual(['a.com', 'b.com', 'untouched.com']);
    expect(stored['a.com'].customSelectors?.username).toBe('#new-u');
    expect(stored['untouched.com'].penetrateShadow).toBe(false);
  });

  it('部分条目被剔除时照常落盘合法部分，并把剔除数回给调用方', async () => {
    const result = await importSiteRulesFromText(
      envelopeText([
        { domain: 'bad.com', customSelectors: { username: '##', password: '#p' } },
        { domain: 'ok.com', customSelectors: { username: '#u', password: '#p' } },
      ]),
    );

    expect(result).toEqual({ added: 1, updated: 0, dropped: 1 });
    expect(Object.keys(await getSiteRules())).toEqual(['ok.com']);
  });

  it('导入失败时不触碰存储', async () => {
    await bulkSetSiteRules([{ domain: 'a.com', customSelectors: { username: '#u', password: '#p' } }]);

    await expect(importSiteRulesFromText('{"kind":"aphsr","version":1,"rules":[]}')).rejects.toThrow();

    expect(Object.keys(await getSiteRules())).toEqual(['a.com']);
  });
});

describe('exportSiteRulesToFile（下载）', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('按 storage 当前内容下载文件并回报条数', async () => {
    await bulkSetSiteRules([
      { domain: 'a.com', customSelectors: { username: '#u', password: '#p' } },
      { domain: 'b.com', penetrateShadow: false },
    ]);

    const createObjectURL = vi.fn(() => 'blob:site-rules');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    try {
      await expect(exportSiteRulesToFile()).resolves.toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:site-rules');
  });
});
