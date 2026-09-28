/**
 * Shadow DOM 主题令牌闭环守卫（注入 UI 的换肤可达性）
 *
 * 内容脚本的注入 UI 全在 closed shadow 根里，`all: initial` 又切断了来自宿主页面的
 * 继承，因此**只有被内联写进宿主的自定义属性**才可能在影子树里解析。这带来一类静默缺陷：
 * 影子样式里写 `var(--aph-x, fallback)`，而 `--aph-x` 从没被镜像进 `utils/theme.ts` ——
 * 类型检查、构建、单测全绿，页面也不报错，只是那一处的颜色永远停在 fallback、
 * 换肤时纹丝不动。本仓已实测踩过一次（内联下拉的来源芯片引用了 `:root` 才定义、
 * 未进镜像表的 `--aph-border-light` / `--aph-text-muted`）。
 *
 * 本守卫把这条链钉成四件事：
 * 1. `entrypoints/content/**` 里出现的每个 `var(--aph-*)` 都能在「品牌表 ∪ 中性表」取到值；
 * 2. 六个主题的品牌表键集完全一致（少一个键 = 该主题下这处变死链）；
 * 3. 镜像表的取值逐字能在 `assets/theme/tokens.css` 找到（防「改了一处忘了另一处」）；
 * 4. 写入函数确实把两张表一起落到宿主（防只改表不改写入路径）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  SHADOW_NEUTRAL_TOKENS,
  THEME_NAMES,
  THEME_SHADOW_TOKENS,
  applyThemeTokensToHost,
} from '@/utils/theme';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 注入 UI 的全部源码位置（影子样式以内联模板字符串存在于这些文件里） */
const CONTENT_DIR = 'entrypoints/content';

/** 主题令牌的引用形态：`var(--aph-xxx` 或 `var( --aph-xxx `；注释里的 `var(--aph-*)` 不算 */
const TOKEN_REFERENCE_RE = /var\(\s*(--aph-[a-z0-9-]+)/g;

/** tokens.css 里的变量定义：`:root`（默认主题）与 5 个 `[data-theme=…]` 覆盖块 */
const TOKEN_DEFINITION_RE = /^\s*(--aph-[a-z0-9-]+)\s*:\s*([^;]+);/gm;

/** 从源码文本里取出去重后的令牌引用集合 */
function referencedTokens(source: string): string[] {
  return [...new Set([...source.matchAll(TOKEN_REFERENCE_RE)].map(match => match[1]))];
}

/**
 * 解析 tokens.css，得到「令牌名 → 主题 → 该主题下的声明值」映射
 *
 * 默认主题「晴空蓝」没有自己的块，它的取值就写在裸 `:root` 里，故把 `:root` 归到
 * `DEFAULT_THEME` 名下。中性令牌同样只在 `:root` 声明一次、全主题共用，因此某令牌
 * 在几个主题块里有值，本身就是「这张表能不能按主题镜像」的事实来源。
 */
function declaredTokenValuesByTheme(): Map<string, Map<string, string[]>> {
  const css = readSource('assets/theme/tokens.css');
  const blocks = [...css.matchAll(/:root(?:\[data-theme='([^']+)'\])?\s*\{([\s\S]*?)\n\}/g)];
  expect(blocks.length, '未从 tokens.css 取到 `:root` 与 5 个主题块（文件结构变化需同步更新本守卫）').toBe(6);

  const byName = new Map<string, Map<string, string[]>>();
  for (const [, themeAttr, body] of blocks) {
    // `:root` 无主题属性，其取值即默认主题
    const theme = themeAttr || DEFAULT_THEME;
    for (const [, name, rawValue] of body.matchAll(TOKEN_DEFINITION_RE)) {
      const value = rawValue.trim();
      const perTheme = byName.get(name) ?? new Map<string, string[]>();
      const values = perTheme.get(theme) ?? [];
      if (!values.includes(value)) values.push(value);
      perTheme.set(theme, values);
      byName.set(name, perTheme);
    }
  }
  return byName;
}

/** 某主题下可解析的令牌全集 */
const resolvableFor = (theme: string): Set<string> =>
  new Set([
    ...Object.keys(THEME_SHADOW_TOKENS[theme as keyof typeof THEME_SHADOW_TOKENS]),
    ...Object.keys(SHADOW_NEUTRAL_TOKENS),
  ]);

describe('扫描与判据自身的有效性', () => {
  const files = listSourceFiles(CONTENT_DIR);

  it('扫描到足够规模的注入源码（目录漂移时变红，而不是静默空跑）', () => {
    expect(files.length).toBeGreaterThan(15);
    const allTokens = files.flatMap(file => referencedTokens(readSource(file)));
    expect(new Set(allTokens).size, '一条 `var(--aph-*)` 都没抓到说明正则已失配').toBeGreaterThanOrEqual(5);
  });

  it('未镜像的令牌会被抓出，注释形态与合法令牌不误报', () => {
    expect(referencedTokens('color: var(--aph-not-mirrored);')).toEqual(['--aph-not-mirrored']);
    expect(referencedTokens('/* 供影子树 var(--aph-*) 解析 */')).toEqual([]);
    expect(referencedTokens('border: var( --aph-primary , #409eff);')).toEqual(['--aph-primary']);
  });
});

describe('引用侧：影子样式里的每个令牌都被镜像', () => {
  const files = listSourceFiles(CONTENT_DIR);

  it('六套主题下都不存在「引用了却没写入」的死链', () => {
    const violations = files.flatMap(file => {
      const tokens = referencedTokens(readSource(file));
      return THEME_NAMES.flatMap(theme =>
        tokens
          .filter(token => !resolvableFor(theme).has(token))
          .map(token => `${file} 引用 ${token}，但 ${theme} 主题未镜像（换肤时该处恒走 fallback）`),
      );
    });
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('镜像侧：两张表自身必须闭合', () => {
  it('六个主题镜像的令牌键集完全一致', () => {
    const baseline = Object.keys(THEME_SHADOW_TOKENS[DEFAULT_THEME]).sort();
    expect(baseline.length).toBeGreaterThanOrEqual(10);

    for (const theme of THEME_NAMES) {
      expect(Object.keys(THEME_SHADOW_TOKENS[theme]).sort(), `${theme} 的令牌键集与默认主题不一致`).toEqual(baseline);
    }
  });

  it('中性表不与品牌表重名（重名会被写入顺序悄悄覆盖）', () => {
    const brandKeys = new Set(THEME_NAMES.flatMap(theme => Object.keys(THEME_SHADOW_TOKENS[theme])));
    const duplicated = Object.keys(SHADOW_NEUTRAL_TOKENS).filter(key => brandKeys.has(key));
    expect(duplicated).toEqual([]);
  });
});

describe('取值侧：镜像表逐字来自 tokens.css', () => {
  const declared = declaredTokenValuesByTheme();

  /** 某令牌在某主题块里的声明值（该主题没声明它时为 undefined） */
  const valuesOf = (name: string, theme: string): string[] | undefined => declared.get(name)?.get(theme);

  /** 把 tokens.css 里的实际取值说成人话，供失败信息定位 */
  const actualOf = (name: string, theme: string): string => {
    const values = valuesOf(name, theme);
    return values ? values.join(' / ') : '（该主题块未声明）';
  };

  it('品牌令牌在对应主题块里有同值声明', () => {
    const drift = THEME_NAMES.flatMap(theme =>
      Object.entries(THEME_SHADOW_TOKENS[theme])
        .filter(([name, value]) => !(valuesOf(name, theme) ?? []).includes(value))
        .map(([name, value]) => `${theme} 的 ${name}：镜像表 '${value}' ≠ tokens.css '${actualOf(name, theme)}'`),
    );
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('中性令牌确实与主题无关：只在 `:root` 声明一次且取值逐字相同', () => {
    const drift = Object.entries(SHADOW_NEUTRAL_TOKENS).flatMap(([name, value]) => {
      const themes = [...(declared.get(name)?.keys() ?? [])];
      // 中性令牌一旦被某主题重新覆盖，「一张表供六套主题」的镜像方式当场失效。
      // 那时该改的是镜像结构（把这项挪进品牌表并补六份取值），不是放宽这条断言。
      if (themes.length !== 1 || themes[0] !== DEFAULT_THEME) {
        return [`${name} 在 ${themes.join(' / ') || '（无处）'} 块里被声明，不能再当作主题无关的中性令牌镜像`];
      }
      return valuesOf(name, DEFAULT_THEME)?.includes(value)
        ? []
        : [`${name}：镜像表 '${value}' ≠ tokens.css '${actualOf(name, DEFAULT_THEME)}'`];
    });
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('判据有牙：品牌表与中性表各注入一处漂移都能被抓出', () => {
    const brandName = Object.keys(THEME_SHADOW_TOKENS[DEFAULT_THEME])[0];
    const brandDrift = Object.entries({ ...THEME_SHADOW_TOKENS[DEFAULT_THEME], [brandName]: '#000000' }).filter(
      ([name, value]) => !(valuesOf(name, DEFAULT_THEME) ?? []).includes(value),
    );
    expect(brandDrift.map(([name]) => name)).toEqual([brandName]);

    const neutralName = Object.keys(SHADOW_NEUTRAL_TOKENS)[0];
    const neutralDrift = Object.entries({ ...SHADOW_NEUTRAL_TOKENS, [neutralName]: '#000000' }).filter(
      ([name, value]) => !(valuesOf(name, DEFAULT_THEME) ?? []).includes(value),
    );
    expect(neutralDrift.map(([name]) => name)).toEqual([neutralName]);
  });
});

describe('写入侧：两张表都真的落到宿主', () => {
  it('applyThemeTokensToHost 同时写入品牌令牌与中性令牌', () => {
    const setProperty = vi.fn();
    const host = { style: { setProperty } } as unknown as HTMLElement;

    applyThemeTokensToHost(host, 'green');

    const written = setProperty.mock.calls.map(call => call[0] as string);
    for (const key of [...Object.keys(THEME_SHADOW_TOKENS.green), ...Object.keys(SHADOW_NEUTRAL_TOKENS)]) {
      expect(written, `${key} 未被写入宿主，影子树里的 var() 取不到值`).toContain(key);
    }
    // 值也必须是 green 的取值（写入路径拿错主题表同样是死链）
    expect(setProperty).toHaveBeenCalledWith('--aph-primary', THEME_SHADOW_TOKENS.green['--aph-primary']);
    expect(setProperty).toHaveBeenCalledWith('--aph-text-muted', SHADOW_NEUTRAL_TOKENS['--aph-text-muted']);
  });

  it('未知主题名回落默认主题，而不是整批不写', () => {
    const setProperty = vi.fn();
    const host = { style: { setProperty } } as unknown as HTMLElement;

    applyThemeTokensToHost(host, 'not-a-theme' as never);

    expect(setProperty).toHaveBeenCalledTimes(
      Object.keys(THEME_SHADOW_TOKENS[DEFAULT_THEME]).length + Object.keys(SHADOW_NEUTRAL_TOKENS).length,
    );
    expect(setProperty).toHaveBeenCalledWith('--aph-primary', THEME_SHADOW_TOKENS[DEFAULT_THEME]['--aph-primary']);
  });
});
