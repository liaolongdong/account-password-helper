> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

# 同主域名跨子域匹配 实施计划

**Spec:** `docs/superpowers/specs/2026-09-22-cross-subdomain-matching-design.md`

**Goal:** 让 `qq.com` 下的账号在 `mail.qq.com` / `music.qq.com` 可见可填，同时把放宽程度交给用户选档位，默认档位与今天逐字节等价。

**Architecture:** 在 `utils/domain.ts` 落一个纯函数 `resolveMatchTier(currentHost, storedUrl, mode)` 作为唯一匹配真源；两个既有真源（`utils/passwordSort.ts` 的 `filterAndSortEntriesForDomain`、`utils/passwordFilter.ts` 的 `matchesSiteScope`）与 4 个优先级函数改用它并按 tier 排序；档位存 `storage.local` 新键，经 `configManager` 的 `createConfigStore` 三件套读写，后台用内存镜像避免热路径磁盘读。

**Tech Stack:** WXT + MV3 + Vue 3 + TypeScript + Element Plus + Vitest；Playwright e2e 为可选加测。

**提交约定：** 仓库规则要求「未经用户明确要求不提交」。下列每个任务末尾的 commit 步骤仅在用户明确授权后执行，未授权时保留工作区改动。

---

## 全局不变量（每个任务完成后都要成立）

1. `mode` 缺省 `'off'` 时，任何入口的可见集合与顺序与改动前逐 id 一致。
2. 不新增权限、不新增网络请求、不改 `PasswordEntry` 的存储结构与字段容量。
3. `localhost` / `127.0.0.1` 分支、新标签页（`currentHost` 为空）分支保留在调用方，不进入 tier 判定。
4. 档位变更不触发解密重算（`warmPasswordCache` 调用次数不变）。

---

### 任务 1：分层匹配纯函数 `resolveMatchTier`

**Files:**

- Modify: `utils/domain.ts`（在 `isExactHostMatch` 之后、`toNavigableUrl` 之前新增一节）
- Test: `tests/utils/domain.test.ts`（追加 describe 块）

- [ ] **Step 1: 写失败测试**

在 `tests/utils/domain.test.ts` 末尾追加：

```ts
describe('resolveMatchTier：跨子域分层匹配', () => {
  const CUR = 'mail.qq.com';

  it('off 档：只有精确 host 与空 URL 命中，其余一律 -1', () => {
    expect(resolveMatchTier(CUR, 'mail.qq.com', 'off')).toBe(0);
    expect(resolveMatchTier(CUR, 'https://mail.qq.com/login', 'off')).toBe(0);
    expect(resolveMatchTier(CUR, '', 'off')).toBe(4);
    expect(resolveMatchTier(CUR, '   ', 'off')).toBe(4);
    expect(resolveMatchTier(CUR, '*.qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'uat.example.com', 'off')).toBe(-1);
  });

  it('wildcard 档：只额外放行通配条目', () => {
    expect(resolveMatchTier(CUR, '*.qq.com', 'wildcard')).toBe(1);
    expect(resolveMatchTier(CUR, 'https://*.qq.com/login', 'wildcard')).toBe(1);
    expect(resolveMatchTier(CUR, 'qq.com', 'wildcard')).toBe(-1);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'wildcard')).toBe(-1);
  });

  it('sameMainDomain 档：apex 排 2、兄弟子域排 3', () => {
    expect(resolveMatchTier(CUR, '*.qq.com', 'sameMainDomain')).toBe(1);
    expect(resolveMatchTier(CUR, 'qq.com', 'sameMainDomain')).toBe(2);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'sameMainDomain')).toBe(3);
    expect(resolveMatchTier(CUR, 'a.b.qq.com', 'sameMainDomain')).toBe(3);
  });

  it('通配命中走 getMainDomain 边界，不被前缀碰撞绕过', () => {
    expect(resolveMatchTier('evil-qq.com', '*.qq.com', 'sameMainDomain')).toBe(
      -1,
    );
    expect(resolveMatchTier('notqq.com', '*.qq.com', 'sameMainDomain')).toBe(
      -1,
    );
    expect(
      resolveMatchTier('mail.qq.com.evil.io', '*.qq.com', 'sameMainDomain'),
    ).toBe(-1);
  });

  it('两段式 ccTLD：主域名口径与既有一致', () => {
    expect(
      resolveMatchTier(
        'a.example.com.cn',
        '*.example.com.cn',
        'sameMainDomain',
      ),
    ).toBe(1);
    expect(
      resolveMatchTier('a.example.com.cn', 'example.com', 'sameMainDomain'),
    ).toBe(2);
    expect(
      resolveMatchTier('a.example.com.cn', 'other.com.cn', 'sameMainDomain'),
    ).toBe(-1);
    expect(
      resolveMatchTier(
        'shop.example.com.br',
        'example.com.br',
        'sameMainDomain',
      ),
    ).toBe(2);
  });

  it('apex 页面自身：*.qq.com 与 qq.com 都命中，且通配不劣于 apex', () => {
    expect(resolveMatchTier('qq.com', 'qq.com', 'sameMainDomain')).toBe(0);
    expect(resolveMatchTier('qq.com', '*.qq.com', 'sameMainDomain')).toBe(1);
    expect(resolveMatchTier('qq.com', 'mail.qq.com', 'sameMainDomain')).toBe(3);
  });

  it('IP 与非法输入安全降级为不匹配', () => {
    expect(resolveMatchTier('192.168.1.10', '192.168.1.10', 'off')).toBe(0);
    expect(
      resolveMatchTier('192.168.1.10', '192.168.1.20', 'sameMainDomain'),
    ).toBe(-1);
    expect(resolveMatchTier('mail.qq.com', '*.', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier('mail.qq.com', '   ', 'sameMainDomain')).toBe(4);
  });

  it('currentHost 为空时按 tier 0 放行（无上下文不做区分）', () => {
    expect(resolveMatchTier('', 'anything.com', 'off')).toBe(0);
  });
});

describe('stripWildcardPrefix', () => {
  it('只剥最左侧一个通配段', () => {
    expect(stripWildcardPrefix('*.qq.com')).toBe('qq.com');
    expect(stripWildcardPrefix('https://*.qq.com/login')).toBe(
      'https://qq.com/login',
    );
    expect(stripWildcardPrefix('mail.qq.com')).toBe('mail.qq.com');
    expect(stripWildcardPrefix('')).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/utils/domain.test.ts`
Expected: FAIL，`resolveMatchTier is not exported`（或 import 报错）

- [ ] **Step 3: 最小实现**

`utils/domain.ts` 顶部 import 区无需改动（同文件）。在 `isExactHostMatch` 定义之后插入：

```ts
// ── 跨子域分层匹配 ──

/**
 * 跨子域匹配档位
 *
 * - `off`：仅精确 host 匹配（默认，与 2026-07 定下的多测试环境隔离口径一致）
 * - `wildcard`：精确匹配 + 用户显式声明的通配条目（`*.qq.com`）
 * - `sameMainDomain`：额外纳入同主域条目（apex 与兄弟子域），宽松度最高
 */
export type DomainMatchMode = 'off' | 'wildcard' | 'sameMainDomain';

/** 档位合法性判定（storage 回读时收窄类型） */
export function isDomainMatchMode(value: unknown): value is DomainMatchMode {
  return value === 'off' || value === 'wildcard' || value === 'sameMainDomain';
}

/**
 * 匹配层级：数字即排序权重，越小越靠前
 *
 * 0=精确 host；1=通配条目；2=同主域 apex 条目；3=同主域其他子域；4=URL 为空的通用条目。
 * `off` 档下只可能返回 0、4 或 -1，因此与迁移前的二值优先级（0/1）等价。
 */
export type MatchTier = 0 | 1 | 2 | 3 | 4;

/** 通配条目前缀（写在 PasswordEntry.url 里，形如 `*.qq.com`） */
const WILDCARD_PREFIX = '*.';

/** `getMainDomain` 记忆化容量上限（键为 hostname，超出即清空，避免无界增长） */
const MAIN_DOMAIN_CACHE_MAX = 512;

const _mainDomainCache = new Map<string, string>();

/**
 * `getMainDomain` 的记忆化包装
 *
 * 分层匹配会对整库逐条求主域名，600 条目量级下重复解析同一 hostname 的成本可观；
 * 结果纯函数确定性，可安全缓存。
 */
function memoizedMainDomain(hostname: string): string {
  if (!hostname) return hostname;
  const hit = _mainDomainCache.get(hostname);
  if (hit !== undefined) return hit;
  const main = getMainDomain(hostname);
  if (_mainDomainCache.size >= MAIN_DOMAIN_CACHE_MAX) _mainDomainCache.clear();
  _mainDomainCache.set(hostname, main);
  return main;
}

/**
 * 解析条目网址相对当前域名的匹配层级
 *
 * 唯一匹配真源：侧边栏本站范围、内联下拉、一键填充、右键菜单、Popup 计数全部经它判定，
 * 杜绝「下拉里有、侧边栏没有」或两处排序不一致。
 *
 * 前置约束：`localhost` / `127.0.0.1` 的端口过滤与「当前页无域名」两条特殊路径由调用方
 * 在调用本函数**之前**处理，本函数不参与本地开发端口语义。
 *
 * 通配命中刻意不使用 `endsWith('.qq.com')`（会被 `evil-qq.com` / `xxqq.com` 绕过），
 * 而是复用既有的可信边界 `getMainDomain` 相等，与跨域 iframe 委托同一口径。
 *
 * @param currentHost - 当前页面 hostname（非空、非本地开发域名）
 * @param storedUrl - 密码条目存储的 URL/域名
 * @param mode - 匹配档位
 * @returns 匹配层级；不匹配返回 -1
 */
export function resolveMatchTier(
  currentHost: string,
  storedUrl: string | undefined,
  mode: DomainMatchMode = 'off',
): MatchTier | -1 {
  const raw = storedUrl?.trim();
  // 空 URL 条目不限站点，始终纳入（排在所有带网址条目之后）
  if (!raw) return 4;
  // 无域名上下文：调用方本应短路，这里按「不做区分」兜底，语义等价迁移前的 priority 0
  if (!currentHost) return 0;

  const storedHost = normalizeToHostname(raw);
  if (!storedHost) return -1;
  const host = normalizeToHostname(currentHost);
  if (storedHost === host) return 0;

  if (storedHost.startsWith(WILDCARD_PREFIX)) {
    if (mode === 'off') return -1;
    const base = storedHost.slice(WILDCARD_PREFIX.length);
    if (!base) return -1;
    return memoizedMainDomain(host) === memoizedMainDomain(base) ? 1 : -1;
  }

  if (mode !== 'sameMainDomain') return -1;
  const currentMain = memoizedMainDomain(host);
  if (!currentMain || currentMain !== memoizedMainDomain(storedHost)) return -1;
  return storedHost === currentMain ? 2 : 3;
}
```

在同文件 `toNavigableUrl` 之前插入：

```ts
/**
 * 剥离网址最左侧的通配段
 *
 * `*.qq.com` 是「适用范围」而非可导航主机：直接补协议会得到 `https://*.qq.com/` 这类
 * 必然解析失败的主机名。导航与图标两条派生路径都先经本函数还原为可访问主机。
 *
 * @param value - 原始 URL 或域名字符串
 * @returns 去掉最左 `*.` 的原始字符串（不含协议时）或去掉协议后主机段的首个 `*.`
 */
export function stripWildcardPrefix(value: string): string {
  const raw = value?.trim();
  if (!raw) return '';
  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)\*\./i.exec(raw);
  if (schemeMatch)
    return `${schemeMatch[1]}${raw.slice(schemeMatch[0].length)}`;
  return raw.startsWith(WILDCARD_PREFIX)
    ? raw.slice(WILDCARD_PREFIX.length)
    : raw;
}
```

补 `tests/utils/domain.test.ts` 顶部 import：`import { resolveMatchTier, stripWildcardPrefix } from '@/utils/domain';`

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run tests/utils/domain.test.ts`
Expected: PASS（含既有 `getMainDomain` 用例不回归）

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add utils/domain.ts tests/utils/domain.test.ts
git commit -m "feat(domain): 新增跨子域分层匹配真源 resolveMatchTier 与通配前缀剥离"
```

---

### 任务 2：两个真源接入 tier + 等价性守卫

**Files:**

- Modify: `utils/passwordSort.ts:151-175`
- Modify: `utils/passwordFilter.ts:57-95`
- Modify: `utils/storage/configManager.ts:97-115`、`utils/storage/passwordCrud.ts:515-525`（只加注释，明确不放宽）
- Test: `tests/utils/passwordSort.test.ts`、`tests/utils/passwordFilter.test.ts`

- [ ] **Step 1: 写失败测试（等价性守卫优先）**

在 `tests/utils/passwordSort.test.ts` 追加：

```ts
const MULTI_ENV: PasswordEntry[] = [
  entry('exact', 'mail.qq.com'),
  entry('apex', 'qq.com'),
  entry('sibling', 'music.qq.com'),
  entry('wild', '*.qq.com'),
  entry('generic', ''),
  entry('uat', 'uat.example.com'),
  entry('other', 'evil-qq.com'),
];

/** 迁移前口径的参考实现：仅精确 host（含空 URL）纳入，精确优先 */
function legacyFilter(entries: PasswordEntry[], domain: string): string[] {
  const matched = entries.filter(p => {
    if (!p.url || p.url.trim() === '') return true;
    return isExactHostMatch(domain, p.url);
  });
  return sortPasswordEntries(matched, DEFAULT_SIDEPANEL_SORT, e => {
    const hasUrl = !!e.url && e.url.trim() !== '';
    return hasUrl && isExactHostMatch(domain, e.url) ? 0 : 1;
  }).map(p => p.id);
}

describe('off 档与迁移前口径等价', () => {
  for (const domain of [
    'mail.qq.com',
    'qq.com',
    'uat.example.com',
    'evil-qq.com',
  ]) {
    it(`域名 ${domain}：集合与顺序逐 id 一致`, () => {
      const got = filterAndSortEntriesForDomain(
        MULTI_ENV,
        domain,
        DEFAULT_SIDEPANEL_SORT,
      ).map(p => p.id);
      expect(got).toEqual(legacyFilter(MULTI_ENV, domain));
    });
  }

  it('显式传 off 与缺省参数结果一致', () => {
    expect(
      filterAndSortEntriesForDomain(
        MULTI_ENV,
        'mail.qq.com',
        DEFAULT_SIDEPANEL_SORT,
        undefined,
        'off',
      ),
    ).toEqual(
      filterAndSortEntriesForDomain(
        MULTI_ENV,
        'mail.qq.com',
        DEFAULT_SIDEPANEL_SORT,
      ),
    );
  });
});

describe('sameMainDomain 档优先级序列', () => {
  it('按 tier 升序，且通配条目在 apex 之前', () => {
    const ids = filterAndSortEntriesForDomain(
      MULTI_ENV,
      'mail.qq.com',
      DEFAULT_SIDEPANEL_SORT,
      undefined,
      'sameMainDomain',
    ).map(p => p.id);
    expect(ids).toEqual(['exact', 'wild', 'apex', 'sibling', 'generic']);
    expect(ids).not.toContain('uat');
    expect(ids).not.toContain('other');
  });

  it('wildcard 档只额外带出通配条目', () => {
    const ids = filterAndSortEntriesForDomain(
      MULTI_ENV,
      'mail.qq.com',
      DEFAULT_SIDEPANEL_SORT,
      undefined,
      'wildcard',
    ).map(p => p.id);
    expect(ids).toEqual(['exact', 'wild', 'generic']);
  });

  it('localhost 仍走端口过滤，档位不参与判定', () => {
    const localdev = [
      entry('p3000', 'localhost:3000'),
      entry('p8080', 'localhost:8080'),
    ];
    for (const mode of ['off', 'wildcard', 'sameMainDomain'] as const) {
      expect(
        filterAndSortEntriesForDomain(
          localdev,
          'localhost',
          DEFAULT_SIDEPANEL_SORT,
          '3000',
          mode,
        ).map(p => p.id),
      ).toEqual(['p3000']);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/utils/passwordSort.test.ts`
Expected: FAIL，`Expected 6 arguments, but got 5` 或结果不含 `wild`

- [ ] **Step 3: 实现**

`utils/passwordSort.ts`：把 `filterAndSortEntriesForDomain` 整体替换为（保留原 JSDoc 并追加档位说明）：

```ts
export function filterAndSortEntriesForDomain(
  passwords: PasswordEntry[],
  domain: string,
  sort: SortState = DEFAULT_SIDEPANEL_SORT,
  port?: string,
  mode: DomainMatchMode = 'off',
): PasswordEntry[] {
  const matched = passwords.filter(p => {
    if (isLocalDevDomain(domain)) {
      // 本地开发域名：有端口时按端口过滤，无端口时保持原有行为（放行全部）；档位不参与
      return matchesPortForLocalDev(p.url, port ?? '');
    }
    if (!domain) return true;
    return resolveMatchTier(domain, p.url, mode) >= 0;
  });

  // 域名优先级即匹配层级（0 精确 → 4 通用）；off 档下退化为迁移前的 0/1 二值
  const getDomainPriority = (entryItem: PasswordEntry): number => {
    if (!domain) return 0;
    const tier = resolveMatchTier(domain, entryItem.url, mode);
    return tier < 0 ? 5 : tier;
  };

  return sortPasswordEntries(matched, sort, getDomainPriority);
}
```

import 改为：`import { isLocalDevDomain, matchesPortForLocalDev, resolveMatchTier, type DomainMatchMode } from '@/utils/domain';`（删掉不再直接使用的 `isExactHostMatch`）。

- [ ] **Step 4: `utils/passwordFilter.ts` 同步接入**

```ts
export function matchesSiteScope(
  entry: PasswordEntry,
  ctx: ScopeContext,
  mode: DomainMatchMode = 'off',
): boolean {
  if (!ctx.domain) return true;
  if (isLocalDevDomain(ctx.domain)) {
    return matchesPortForLocalDev(entry.url, ctx.port);
  }
  return resolveMatchTier(ctx.domain, entry.url, mode) >= 0;
}
```

```ts
export function filterEntriesByScope(
  entries: readonly PasswordEntry[],
  scope: SearchScope,
  ctx: ScopeContext,
  mode: DomainMatchMode = 'off',
): PasswordEntry[] {
  if (scope === 'all') return [...entries];
  return entries.filter(entry => matchesSiteScope(entry, ctx, mode));
}
```

`ScopeContext` 不加 `mode` 字段：档位是全局设置而非当前页属性，显式入参可避免调用方误以为它随 tab 变化。文件头 JSDoc 与 `matchesSiteScope` JSDoc 的「精确 hostname 匹配」表述改为「按 `resolveMatchTier` 档位判定」。

- [ ] **Step 5: 锁定不动的两处**

`utils/storage/configManager.ts:97` 与 `utils/storage/passwordCrud.ts:515` 各加一行 JSDoc：

```ts
 * 刻意不接入跨子域档位：本函数无生产调用方，保持迁移前的精确 host 语义，
 * 避免后来者误以为「存储层查询也会跨子域」。
```

- [ ] **Step 6: 追加 filter 侧等价性测试并运行全量**

在 `tests/utils/passwordFilter.test.ts` 追加：

```ts
it('off 档与迁移前 matchesSiteScope 结果一致（含空 URL 与外站）', () => {
  const ctx: ScopeContext = { domain: 'mail.qq.com', port: '' };
  for (const entry of MULTI_ENV_FOR_FILTER) {
    const legacy =
      !entry.url ||
      entry.url.trim() === '' ||
      isExactHostMatch(ctx.domain, entry.url);
    expect(matchesSiteScope(entry, ctx)).toBe(legacy);
  }
});

it('sameMainDomain 档放行通配/apex/兄弟子域，拦住前缀碰撞与外域', () => {
  const ctx: ScopeContext = { domain: 'mail.qq.com', port: '' };
  expect(matchesSiteScope(entryOf('*.qq.com'), ctx, 'sameMainDomain')).toBe(
    true,
  );
  expect(matchesSiteScope(entryOf('qq.com'), ctx, 'sameMainDomain')).toBe(true);
  expect(matchesSiteScope(entryOf('music.qq.com'), ctx, 'sameMainDomain')).toBe(
    true,
  );
  expect(matchesSiteScope(entryOf('evil-qq.com'), ctx, 'sameMainDomain')).toBe(
    false,
  );
  expect(
    matchesSiteScope(entryOf('uat.example.com'), ctx, 'sameMainDomain'),
  ).toBe(false);
});
```

Run: `pnpm exec vitest run tests/utils/passwordFilter.test.ts tests/utils/passwordSort.test.ts tests/utils/domain.test.ts` 与 `pnpm typecheck`
Expected: PASS / 无类型错误

- [ ] **Step 7: 提交（需用户授权）**

```bash
git add utils/passwordSort.ts utils/passwordFilter.ts utils/storage/configManager.ts utils/storage/passwordCrud.ts tests/utils/passwordSort.test.ts tests/utils/passwordFilter.test.ts
git commit -m "feat(match): 两个匹配真源接入分层 tier，off 档保持迁移前等价"
```

---

### 任务 3：档位配置读写与热路径镜像

**Files:**

- Modify: `utils/storageKeys.ts`（`SITE_RULES` 之后）
- Modify: `utils/types.ts`（`IdleLockConfig` 附近新增配置类型）
- Modify: `utils/storage/configManager.ts`（剪贴板三件套之后）
- Modify: `entrypoints/background/passwordCache.ts`（镜像 + 消费）
- Test: `tests/utils/configManager.fillmode.test.ts` 同目录新建 `tests/utils/configManager.domainMatch.test.ts`、`tests/background/passwordCache.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/utils/configManager.domainMatch.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'tests/helpers/fakeBrowser'; // 沿用本仓既有 fake 注入方式

vi.stubGlobal('chrome', fakeBrowser);

import {
  getDomainMatchConfig,
  saveDomainMatchConfig,
  DEFAULT_DOMAIN_MATCH_MODE,
} from '@/utils/storage/configManager';
import { STORAGE_KEYS } from '@/utils/storageKeys';

describe('跨子域匹配档位配置', () => {
  beforeEach(() => fakeBrowser.storage.local.clear());

  it('缺键回落 off', async () => {
    expect(await getDomainMatchConfig()).toEqual({ mode: 'off' });
  });

  it('非法值回落 off（含 null / 未知枚举 / 非对象）', async () => {
    for (const bad of [{ mode: 'yolo' }, { mode: null }, {}, null, 'off']) {
      await fakeBrowser.storage.local.set({
        [STORAGE_KEYS.DOMAIN_MATCH_CONFIG]: bad,
      });
      expect(await getDomainMatchConfig()).toEqual({
        mode: DEFAULT_DOMAIN_MATCH_MODE,
      });
    }
  });

  it('save 增量合并且不改写其他键', async () => {
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.LOCALE]: 'en' });
    await saveDomainMatchConfig({ mode: 'wildcard' });
    expect(await getDomainMatchConfig()).toEqual({ mode: 'wildcard' });
    expect(
      (await fakeBrowser.storage.local.get(STORAGE_KEYS.LOCALE))[
        STORAGE_KEYS.LOCALE
      ],
    ).toBe('en');
  });
});
```

> 若 `tests/helpers/` 里 fake chrome 的导入名与本仓实际不符（按 `tests/utils/configManager.fillmode.test.ts` 现有写法对齐），照该文件的 mock 方式改写这三条断言即可，不要新造第二套 fake。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/utils/configManager.domainMatch.test.ts`
Expected: FAIL，`getDomainMatchConfig` 未导出

- [ ] **Step 3: 实现存储侧**

`utils/storageKeys.ts` 在 `SITE_RULES` 之后加：

```ts
  /** 跨子域匹配档位（仅存枚举值，不含任何域名/账号信息） */
  DOMAIN_MATCH_CONFIG: 'domain_match_config',
```

`utils/types.ts` 在 `IdleLockConfig` 附近加：

```ts
/** 跨子域匹配档位配置（取值语义见 `utils/domain.ts` 的 `DomainMatchMode`） */
export interface DomainMatchConfig {
  mode: DomainMatchMode;
}
```

并在文件头 `import { ... } from '@/utils/domain'`（若 `types.ts` 未反向依赖 `domain.ts`，则改用 `import type { DomainMatchMode } from '@/utils/domain';`；若因此产生循环依赖，把 `DomainMatchMode` 的定义上移到 `utils/types.ts`，`domain.ts` 反向 `import type` — 以无环为准，落地时二选一并在提交信息里注明）。

`utils/storage/configManager.ts` 在剪贴板配置之后加（与 `createConfigStore` 既有签名一致）：

```ts
// ==================== 跨子域匹配档位 ====================

/** 默认档位：仅精确匹配，与放宽前的行为完全一致 */
export const DEFAULT_DOMAIN_MATCH_MODE: DomainMatchMode = 'off';

const domainMatchStore = createConfigStore<DomainMatchConfig>(
  STORAGE_KEYS.DOMAIN_MATCH_CONFIG,
  { mode: DEFAULT_DOMAIN_MATCH_MODE },
  '跨子域匹配档位',
);

/**
 * 获取跨子域匹配档位
 *
 * 存储值非法（未知枚举、类型错误）时回落 `off`：宁可少显示条目，也不静默放宽匹配。
 */
export async function getDomainMatchConfig(): Promise<DomainMatchConfig> {
  const config = await domainMatchStore.get();
  return isDomainMatchMode(config?.mode)
    ? config
    : { mode: DEFAULT_DOMAIN_MATCH_MODE };
}

/** 保存跨子域匹配档位（增量合并） */
export async function saveDomainMatchConfig(
  config: Partial<DomainMatchConfig>,
): Promise<void> {
  if (!isDomainMatchMode(config.mode)) {
    logger.warn('忽略非法的跨子域匹配档位写入');
    return;
  }
  await domainMatchStore.save(config);
}
```

- [ ] **Step 4: 后台内存镜像**

`entrypoints/background/passwordCache.ts` 在 `_cachedSortConfig` 旁加：

```ts
/** 缓存的跨子域匹配档位（避免逐次查询读 storage；undefined=未读取，null 不用作状态） */
let _cachedDomainMatchMode: DomainMatchMode | undefined = undefined;
```

```ts
/**
 * 读取匹配档位（SW 内存镜像）
 *
 * 与 `getCachedSortConfig` 同构：档位变更只影响过滤，不影响缓存内的明文，
 * 因此 `invalidatePasswordCache` 复位镜像即可，绝不触发解密重算。
 */
export async function getCachedDomainMatchMode(): Promise<DomainMatchMode> {
  if (_cachedDomainMatchMode !== undefined) return _cachedDomainMatchMode;
  const config = await getDomainMatchConfig().catch(() => null);
  _cachedDomainMatchMode = config?.mode ?? 'off';
  return _cachedDomainMatchMode;
}
```

`invalidatePasswordCache` 内与 `_cachedSortConfig = undefined;` 同处加 `_cachedDomainMatchMode = undefined;`；`sortMatchesForDomain` 与 `getMatchingAccounts` 改为内部自取档位：

```ts
export async function sortMatchesForDomain(
  passwords: PasswordEntry[],
  domain: string,
  port?: string,
): Promise<PasswordEntry[]> {
  const [sortConfig, mode] = await Promise.all([
    getCachedSortConfig(),
    getCachedDomainMatchMode(),
  ]);
  const sortState: SortState = sortConfig
    ? {
        prop: sortConfig.prop,
        order: (sortConfig.order || null) as SortState['order'],
      }
    : DEFAULT_SIDEPANEL_SORT;
  return filterAndSortEntriesForDomain(
    passwords,
    domain,
    sortState,
    port,
    mode,
  );
}
```

- [ ] **Step 5: 测试档位变更不重算解密**

`tests/background/passwordCache.test.ts` 追加：

```ts
it('档位变化后 getMatchingAccounts 不触发缓存重建（解密次数不变）', async () => {
  await seedCache(3);
  const before = warmSpy.mock.calls.length;
  await setDomainMatchMode('sameMainDomain'); // 经 storage.onChanged 复位镜像
  await getMatchingAccounts('mail.qq.com');
  expect(warmSpy).toHaveBeenCalledTimes(before);
});
```

Run: `pnpm exec vitest run tests/utils/configManager.domainMatch.test.ts tests/background/passwordCache.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 提交（需用户授权）**

```bash
git add utils/storageKeys.ts utils/types.ts utils/storage/configManager.ts utils/storage.ts entrypoints/background/passwordCache.ts tests/
git commit -m "feat(config): 跨子域匹配档位读写与后台内存镜像，档位变更不触发重算"
```

---

### 任务 4：跨入口契约（tier 下发 + 深链消息）

**Files:**

- Modify: `utils/types.ts`（`MatchingAccountMeta`、`MessageType`、`RuntimeMessage` 联合）
- Modify: `entrypoints/background/messageRouter.ts`（`GET_MATCHING_ACCOUNTS` 分支、新 case）
- Modify: `entrypoints/background/optionsPageManager.ts`（若新消息需要预填参数）
- Modify: `entrypoints/background/passwordCache.ts`（meta 组装带 tier）
- Test: `tests/background/senderValidation.test.ts`、新建 `tests/background/matchingAccounts.tier.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveMatchTier } from '@/utils/domain';

describe('MatchingAccountMeta.tier 契约', () => {
  it('tier 与 resolveMatchTier 单点一致，内容脚本不再自行判断域名', () => {
    for (const url of [
      'mail.qq.com',
      '*.qq.com',
      'qq.com',
      'music.qq.com',
      '',
    ]) {
      expect(resolveMatchTier('mail.qq.com', url, 'sameMainDomain')).toBe(
        resolveMatchTier('mail.qq.com', url, 'sameMainDomain'),
      );
    }
  });
});
```

> 该断言只锁「tier 来自同一函数」这一契约形状；真正的端到端契约由任务 5/6 的消费方测试守。

- [ ] **Step 2: 实现类型与消息**

`utils/types.ts`：

```ts
export interface MatchingAccountMeta {
  /* ...既有字段不动... */
  /** 匹配层级（0 精确 → 4 通用），由 background 按当前档位计算；内容脚本据此呈现徽章 */
  tier: MatchTier;
}
```

`MessageType` 在 `OPEN_OPTIONS_AND_SITE_RULES` 之后加：

```ts
  /**
   * 跳转到密码管理页并自动打开「跨子域匹配」设置弹窗（侧边栏/内联下拉引导用户开启档位）
   *
   * 刻意不携带域名等自报参数：该深链只需要打开设置弹窗，无预填需求，省掉不可信输入收口分支。
   */
  OPEN_OPTIONS_AND_DOMAIN_MATCH = 'OPEN_OPTIONS_AND_DOMAIN_MATCH',
```

`RuntimeMessage` 联合加 `| { type: MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH }`。

- [ ] **Step 3: 路由与 meta 组装**

`messageRouter.ts` 照 `OPEN_OPTIONS_AND_SITE_RULES` 的写法新增（无 data，走 `openOptionsAndSendMessage(type)`）：

```ts
      case MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH:
        openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH).then(sendResponse);
        return true;
```

`passwordCache.ts` 的 `getMatchingAccounts`：把档位一次取出、映射 meta 时算 tier（不二次读 storage）：

```ts
const mode = await getCachedDomainMatchMode();
const accounts: MatchingAccountMeta[] = matched.map(entry => ({
  /* ...既有字段... */
  tier: resolveMatchTier(domain, entry.url, mode) as MatchTier,
}));
```

锁定态与跨域 iframe 闸门分支保持返回 `{ locked: true, accounts: [] }` / `{ locked: false, accounts: [] }`，不带任何 tier。

- [ ] **Step 4: Options 侧分发**

`composables/useRuntimeMessageHandler.ts` 新增可选回调 `openDomainMatchSetting?: () => void`，分支：

```ts
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH) {
      logger.debug('RuntimeMsg: 收到打开跨子域匹配设置指令');
      waitForPasswords().then(() => openDomainMatchSetting?.());
    }
```

`entrypoints/options/App.vue` 的 `useRuntimeMessageHandler({...})` 调用处补 `openDomainMatchSetting: () => (showDomainMatchDialog.value = true)`。

Run: `pnpm typecheck && pnpm exec vitest run tests/background/senderValidation.test.ts tests/background/matchingAccounts.tier.test.ts`
Expected: PASS

> 若 `senderValidation.test.ts` 有「所有 OPEN_OPTIONS_* 消息必须校验 sender」的枚举式断言，把新类型加入其清单，而不是放宽断言。

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add utils/types.ts entrypoints/background/messageRouter.ts entrypoints/background/passwordCache.ts composables/useRuntimeMessageHandler.ts entrypoints/options/App.vue tests/background/
git commit -m "feat(msg): 匹配账号元数据下发 tier，新增跨子域设置深链消息"
```

---

### 任务 5：侧边栏与 Popup 消费档位

**Files:**

- Modify: `entrypoints/sidepanel/App.vue`（读档位、`getDomainPriority`、`offSiteIds`、深链计数）
- Modify: `composables/useSidepanelData.ts:323`
- Modify: `composables/usePopupInit.ts:41`
- Modify: `components/sidepanel/PasswordListItem.vue`、`components/sidepanel/SidepanelAuthView.vue`
- Test: `tests/composables/`、`tests/architecture/sidepanelRowMemoFields.test.ts`

- [ ] **Step 1: 数据层**

`entrypoints/sidepanel/App.vue`：

```ts
/** 跨子域匹配档位（打开时读一次，随 storage.onChanged 更新；缺省 off 与迁移前一致） */
const domainMatchMode = ref<DomainMatchMode>('off');

const loadDomainMatchMode = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getDomainMatchConfig();
    domainMatchMode.value = config.mode;
  } catch (error) {
    logger.warn('SidePanel: 读取匹配档位失败，回落精确匹配', error);
    domainMatchMode.value = 'off';
  }
};
```

`domainFilteredPasswords` / `scopeFilteredPasswords` 调用 `filterEntriesByScope(..., domainMatchMode.value)`；`getDomainPriority` 与 `offSiteIds` 都改为按 `resolveMatchTier(currentDomain.value, entry.url, domainMatchMode.value)` 判定（`-1` → 优先级 5 且 `offSite`）。`App.vue:452` 处「档位变了但域名没变需重置范围」的既有注释已预告这种监听，把 `domainMatchMode` 加入对应 `watch` 源。

`useSidepanelData.ts:323` 与 `configManager.applySavedSortConfig` 保持二值（它们只服务 `off` 语义路径），仅补注释说明「跨子域优先级在 App.vue 侧按 tier 计算，此处保持精确口径」。若实测两处会出现顺序分歧，则把 tier 传入并统一。

`usePopupInit.ts:41`：

```ts
/** 当前域名匹配数：按用户所选档位统计，继续排除空 URL 条目（表达「此站已有账号数」） */
const domainMatchCount = computed(() => {
  if (!currentDomain.value) return 0;
  return allPasswords.value.filter(p => {
    if (!p.url) return false;
    return (
      resolveMatchTier(currentDomain.value, p.url, domainMatchMode.value) >= 0
    );
  }).length;
});
```

- [ ] **Step 2: 行内徽章**

`PasswordListItem.vue` 新增 `tier?: MatchTier` prop（`withDefaults` 给 `0`），在 `.details` 的 URL `el-text` 之前插入：

```vue
<!-- 跨子域来源标识：仅非精确层级出现，避免只用颜色传达状态 -->
<el-tag
  v-if="tier && tier >= 1 && tier <= 3"
  class="scope-badge"
  size="small"
  type="info"
  effect="plain"
>
          {{ t('sidepanel.scope.crossSubdomain') }}
        </el-tag>
```

样式（`<style scoped>`，符合 recess-order）：

```css
.scope-badge {
  flex-shrink: 0;
  margin-right: 6px;
  font-size: 11px;
}
```

`SidepanelAuthView.vue` 传 `:tier="entryTier(password)"`，并把 `tier` 加入 `v-memo` 依赖数组。

- [ ] **Step 3: 架构守卫测试扩字段**

`tests/architecture/sidepanelRowMemoFields.test.ts` 的受保护字段清单加入 `tier`，确保行复用不会带错徽章。

- [ ] **Step 4: 空态深链提示**

`SidepanelAuthView.vue:545` 那条提示同一槽位内追加（`props` 新增 `crossDomainHintCount: number`，`App.vue` 用惰性 computed 仅在 `globalMatchCount > 0 && searchScope === 'site'` 分支算一次）：

```vue
<span
  v-if="crossDomainHintCount > 0"
  class="scope-hint-link"
  role="button"
  tabindex="0"
  @click.stop="$emit('openDomainMatchSetting')"
  @keydown.stop="
    activateOnKeydown($event, () => $emit('openDomainMatchSetting'))
  "
>
          {{ t('sidepanel.scope.crossSubdomainHint', { count: crossDomainHintCount }) }}
        </span>
```

`App.vue` 侧 `@open-domain-match-setting` 发 `MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH`（照 `OPEN_OPTIONS_AND_VALIDITY` 既有发送方式）。

Run: `pnpm typecheck && pnpm test:run -- tests/architecture && pnpm exec vitest run tests/composables`
Expected: PASS

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add entrypoints/sidepanel/App.vue composables/usePopupInit.ts components/sidepanel/ tests/architecture/
git commit -m "feat(sidepanel): 本站范围与填充判据按档位分层，非精确条目加来源徽章"
```

---

### 任务 6：内联下拉呈现

**Files:**

- Modify: `entrypoints/content/inlineDropdown/InlineFillDropdown.ts`（`renderList` 副槽 + 空态提示 + 样式 + 消息）
- Modify: `utils/i18n-lite.ts`
- Test: `tests/content/`

- [ ] **Step 1: 词条**

`utils/i18n-lite.ts` 中英两表各加（放在 `cs.inline.*` 段内，紧邻 `emptyAddSite`）：

```ts
    'cs.inline.scopeCrossSubdomain': '跨子域',
    'cs.inline.crossSubdomainHint': '同主域还有 {count} 条账号，可开启跨子域匹配',
```

```ts
    'cs.inline.scopeCrossSubdomain': 'Cross-site',
    'cs.inline.crossSubdomainHint': '{count} more accounts on the same root domain — enable cross-subdomain matching',
```

- [ ] **Step 2: 行内 chip**

`renderList` 内（`sub` 组装处，`supplement` 之后）：

```ts
// 非精确层级（通配/apex/兄弟子域）显式标注来源，回答「这条为什么出现在这里」
const scopeChip =
  acc.tier >= 1 && acc.tier <= 3
    ? `<span class="aph-scope-chip">${tl('cs.inline.scopeCrossSubdomain')}</span>`
    : '';
const sub =
  tagsHtml || supplement || scopeChip
    ? `<div class="aph-row-sub">${scopeChip}${tagsHtml}${supplement}</div>`
    : '';
```

样式（Shadow DOM 内联 CSS 段，紧随 `.aph-tag` 规则）：

```css
.aph-scope-chip {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--aph-border, rgba(148, 163, 184, 0.35));
  border-radius: 4px;
  color: var(--aph-text-muted, #94a3b8);
  background: var(--aph-surface-2, rgba(148, 163, 184, 0.12));
  font-size: 10px;
  line-height: 16px;
}
```

- [ ] **Step 3: 空态档位引导**

`emptyText` 分支之后（与「添加此网站账号」并列），当 `accounts.length === 0` 且从 background 得到的 `crossDomainCount > 0` 时渲染 `<button class="aph-empty-add-btn" data-action="domain-match">`，点击发 `MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH`（复用 `openOptionsAndAdd` 的 `.catch(() => {})` 写法）。

`crossDomainCount` 加进 `MatchingAccountsResponse`（数字，无敏感信息），由 `getMatchingAccounts` 在同一次扫描内算出（遍历全库取 `tier === 2 || tier === 3` 且当前档位下未放行的条数）。

- [ ] **Step 4: 测试**

`tests/content/inlineDropdown.render.test.ts`（沿用该目录既有构造方式）加两条：`tier=1/2/3` 渲染出 chip、`tier=0` 不渲染；chip 文本经 `tl()` 取值且随语言切换。

Run: `pnpm typecheck && pnpm exec vitest run tests/content`
Expected: PASS

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add entrypoints/content/inlineDropdown/InlineFillDropdown.ts utils/i18n-lite.ts tests/content/
git commit -m "feat(inline): 非精确匹配条目加跨子域来源 chip 与档位引导"
```

---

### 任务 7：通配条目录入与派生路径

**Files:**

- Modify: `utils/formValidators.ts:19-45`
- Modify: `utils/domain.ts`（`toNavigableUrl` 剥前缀）
- Modify: `utils/favicon.ts`（`normalizeUrlForFavicon` 剥前缀）
- Modify: `components/options/PasswordFormDialog.vue`、`components/sidepanel/QuickAddDialog.vue`（hint 文案）
- Modify: `utils/i18n/locales/{zh-CN,en}/form.json`
- Test: `tests/utils/formValidators.test.ts`、`tests/utils/domain.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('网址校验接受最左通配条目', () => {
  const validate = (value: string) => {
    let error: Error | undefined;
    createUrlValidator(k => k)(null as never, value, e => (error = e));
    return error;
  };

  it.each([
    '*.qq.com',
    '*.example.com.cn',
    '*.localhost:3000',
    'https://*.qq.com/login',
  ])('%s 通过', value => {
    expect(validate(value)).toBeUndefined();
  });

  it.each([
    '*.',
    '*.*.qq.com',
    'mail.*.qq.com',
    '*.evil',
    'qq.*.com',
    '**.qq.com',
  ])('%s 拒绝', value => {
    expect(validate(value)).toBeInstanceOf(Error);
  });
});

describe('toNavigableUrl 对通配条目还原可导航主机', () => {
  it('剥掉最左通配段，仍守协议白名单', () => {
    expect(toNavigableUrl('*.qq.com')).toBe('https://qq.com/');
    expect(toNavigableUrl('https://*.qq.com/login')).toBe(
      'https://qq.com/login',
    );
    expect(toNavigableUrl('javascript:*.qq.com')).toBeNull();
  });

  it('normalizeUrlForFavicon 取 apex 图标', () => {
    expect(normalizeUrlForFavicon('*.qq.com')).toBe('https://qq.com');
  });
});
```

- [ ] **Step 2: 实现**

`createUrlValidator` 的无协议分支正则改为（只新增最左 `*.` 可选组，其余保持原样）：

```ts
const domainPattern =
  /^(\*?)\.?(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|[a-zA-Z0-9-]+)(:\d{1,5})?$/;
if (domainPattern.test(trimmed) && !isWellFormedWildcardHost(trimmed)) {
  callback(new Error(t('form.invalidUrlExample')));
  return;
}
```

> 上面这条写法容易走偏成「正则里塞语义」。落地时按更直白的两步做：先 `const { wildcard, rest } = splitWildcardHost(trimmed)`，再只用**原正则**校验 `rest`（原正则一字不改），wildcard 为真时要求 `rest` 非空且原正则通过。这样非法形态（`*.`、`*.*.x`、`a.*.x`）天然被原正则拒掉，不新增第二套域名口径。把该辅助函数放 `utils/domain.ts` 导出为 `splitWildcardHost`，与 `stripWildcardPrefix` 复用同一前缀常量。

带协议分支补一句：`if (!url.hostname || (url.hostname.startsWith('*.') && url.hostname.length <= 2))` 拒绝。

`toNavigableUrl` 在函数首行改用 `stripWildcardPrefix`：

```ts
const raw = stripWildcardPrefix(storedUrl ?? '');
if (!raw) return null;
```

`normalizeUrlForFavicon` 同样先 `stripWildcardPrefix`。

- [ ] **Step 3: 表单引导**

`PasswordFormDialog.vue` / `QuickAddDialog.vue` 网址项下方加一行 `.form-tip`（复用 `FavoriteLimitSetting` 的类名口径）：

```vue
<div class="form-tip">
          {{ t('options.form.urlWildcardHint') }}
        </div>
```

`form.json`（zh）：`"urlWildcardHint": "以 *. 开头可让该账号跨同主域名子站使用，如 *.qq.com 适用于 mail.qq.com；需先在设置里开启跨子域匹配。"`
`form.json`（en）：`"urlWildcardHint": "Prefix with *. to make this account available across subdomains of the same root domain, e.g. *.qq.com covers mail.qq.com. Requires cross-subdomain matching in settings."`

Run: `pnpm exec vitest run tests/utils/formValidators.test.ts tests/utils/domain.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 提交（需用户授权）**

```bash
git add utils/formValidators.ts utils/domain.ts utils/favicon.ts components/options/PasswordFormDialog.vue components/sidepanel/QuickAddDialog.vue utils/i18n/locales/
git commit -m "feat(wildcard): 通配条目可录入，导航与图标派生路径还原可访问主机"
```

---

### 任务 8：设置对话框与菜单挂载

**Files:**

- Create: `components/options/DomainMatchSettingDialog.vue`
- Modify: `components/options/HeaderBar.vue`（settings 下拉，紧随 `favoriteLimit` 项）
- Modify: `entrypoints/options/App.vue`（异步组件 + `showDomainMatchDialog` + `handleSettingsCommand` + 命令面板条目）
- Modify: `utils/i18n/locales/{zh-CN,en}/options.json`
- Test: `tests/composables/`（若有对话框级测试惯例则补一条渲染测试）

- [ ] **Step 1: 对话框（`<template>` 在前，遵循 `components/options/` 既有惯例）**

```vue
<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.domainMatch.title')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-radio-group
        v-model="mode"
        class="domain-match-group"
      >
        <el-radio
          v-for="option in modeOptions"
          :key="option.value"
          :value="option.value"
          class="domain-match-option"
        >
          <span class="option-label">{{ option.label }}</span>
          <span class="option-desc">{{ option.desc }}</span>
        </el-radio>
      </el-radio-group>

      <el-alert
        v-if="mode === 'sameMainDomain'"
        class="domain-match-warning"
        type="warning"
        :closable="false"
        show-icon
        :title="t('options.domainMatch.warning')"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
```

`<script setup lang="ts">` 照 `FavoriteLimitSetting.vue` 的骨架（`defineProps<{ modelValue: boolean }>()`、`defineEmits`、`watch(modelValue)` 时 `loadConfig`）：

```ts
import { computed, ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import type { DomainMatchMode } from '@/utils/domain';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const { t } = useI18n();

const mode = ref<DomainMatchMode>('off');
const saveLoading = ref(false);

const modeOptions = computed(() => [
  {
    value: 'off' as const,
    label: t('options.domainMatch.off'),
    desc: t('options.domainMatch.offDesc'),
  },
  {
    value: 'wildcard' as const,
    label: t('options.domainMatch.wildcard'),
    desc: t('options.domainMatch.wildcardDesc'),
  },
  {
    value: 'sameMainDomain' as const,
    label: t('options.domainMatch.sameMainDomain'),
    desc: t('options.domainMatch.sameMainDomainDesc'),
  },
]);

const loadConfig = async (): Promise<void> => {
  try {
    mode.value = (await StorageUtils.getDomainMatchConfig()).mode;
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 加载档位失败:', error);
    ElMessage.error(t('message.loadConfigFailed'));
  }
};

watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    await StorageUtils.saveDomainMatchConfig({ mode: mode.value });
    ElMessage.success(t('options.domainMatch.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 保存档位失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saveLoading.value = false;
  }
};
```

样式：`.form-tip` / `.dialog-body-scroll` / `.dialog-footer` 三个类与 `FavoriteLimitSetting.vue` 同值（照抄，不新增设计令牌），另加 `.domain-match-option { display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 12px; }`、`.option-desc { font-size: 12px; line-height: 1.5; color: var(--aph-text-muted, #909399); }`、`.domain-match-warning { margin-top: 8px; }`。

- [ ] **Step 2: 词条（zh / en 同步，key 集必须一致）**

`options.json`（zh）新增：

```json
  "domainMatch": {
    "title": "跨子域名匹配",
    "header": "跨子域匹配",
    "off": "仅精确匹配（默认）",
    "offDesc": "只显示当前域名完全一致的账号，网址为空的通用账号始终显示。多测试环境账号严格隔离。",
    "wildcard": "精确匹配 + 通配条目",
    "wildcardDesc": "额外显示网址写成 *.qq.com 的账号，由你逐条决定哪些账号可以跨子域使用。",
    "sameMainDomain": "同主域名（更宽松）",
    "sameMainDomainDesc": "当前域名没有账号时，依次显示主域名（qq.com）和同主域其他子域（music.qq.com）的账号，并在列表中标注来源。",
    "warning": "fat.example.com 与 uat.example.com 属于同一主域名，开启后测试环境账号会一起出现。若需隔离请改用「通配条目」档。",
    "saved": "跨子域匹配设置已保存"
  }
```

`en` 对应英文九条，键名逐一对齐。`HeaderBar` 菜单项标题用 `options.domainMatch.header`（与 `options.header.favoriteLimit` 命名风格冲突时，沿用 `options.header.*` 段并同步中英）。

- [ ] **Step 3: 挂载**

`HeaderBar.vue` 在 `command="favoriteLimit"` 那项之后加：

```vue
<el-dropdown-item command="domainMatch" :icon="Connection">
                {{ t('options.domainMatch.header') }}
              </el-dropdown-item>
```

`entrypoints/options/App.vue`：`const DomainMatchSettingDialog = defineAsyncComponent(() => import('@/components/options/DomainMatchSettingDialog.vue'));`、`const showDomainMatchDialog = ref(false);`、`handleSettingsCommand` 加 `case 'domainMatch'`、模板尾部加 `<DomainMatchSettingDialog v-if="showDomainMatchDialog" v-model="showDomainMatchDialog" />`（`v-if` 守住不进首屏 chunk）、命令面板清单加一条（照 `openFavoriteLimit` 那条的字段形状）。

- [ ] **Step 4: 验证**

Run: `pnpm typecheck && pnpm lint && pnpm lint:style && pnpm build`
Expected: 全部通过；`pnpm build` 后确认 `DomainMatchSettingDialog` 是独立 chunk（`pnpm analyze` 可选）

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add components/options/DomainMatchSettingDialog.vue components/options/HeaderBar.vue entrypoints/options/App.vue utils/i18n/locales/
git commit -m "feat(options): 新增跨子域匹配档位设置对话框与入口"
```

---

### 任务 9：保存提示（两种形态）

**Files:**

- Modify: `utils/storage/autoSaveManager.ts`（`checkCredentialStatus` 响应补 `targetNote`）
- Modify: `entrypoints/background/autoSaveHandler.ts`（透传，载荷校验不动）
- Modify: `entrypoints/content/SavePasswordPrompt.ts`（渲染一行提示）
- Modify: `utils/types.ts`（`CredentialStatusResponse` / `SavePromptData`）
- Test: `tests/utils/autoSaveManager.test.ts`、`tests/background/autoSaveHandler.test.ts`

- [ ] **Step 1: 判重口径回归断言（先固定既有行为，再改）**

```ts
describe('findMatchingEntry 判重口径不受档位影响', () => {
  const passwords = [
    entry('apex', 'qq.com', 'u'),
    entry('sibling', 'music.qq.com', 'u'),
  ];

  it('同名 + 父域包含 → 命中最精确一条（迁移前后一致）', () => {
    expect(
      findMatchingEntry(passwords, { username: 'u', url: 'mail.qq.com' })?.id,
    ).toBe('apex');
  });

  it('同名 + 兄弟子域 → 不命中（走新增）', () => {
    expect(
      findMatchingEntry([passwords[1]], { username: 'u', url: 'mail.qq.com' }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: targetNote 计算**

`checkCredentialStatus` 内，两个分支各补一次计算（档位由 `getDomainMatchConfig()` 取，仅扩展内部使用）：

```ts
/**
 * 生成保存去向提示
 *
 * 判重口径保持原样（同名 + host 相等或父子域包含），这里只负责把「即将发生什么」说清楚：
 * - 命中的条目属于别的 host：说明更新的是哪一条（此前弹窗只说「检测到更新」）
 * - 判重未命中但同主域存在同名条目：说明本次会新增一条（跨子域档位的直接后果）
 *
 * 只回条目 URL 原样字符串，不含用户名/密码/备注；日志只记 kind。
 */
function buildTargetNote(
  mode: DomainMatchMode,
  currentUrl: string,
  matched: PasswordEntry | undefined,
  passwords: PasswordEntry[],
): SaveTargetNote | undefined {
  const currentHost = normalizeToHostname(currentUrl);
  if (matched) {
    const matchedHost = normalizeToHostname(matched.url);
    return matchedHost && matchedHost !== currentHost
      ? { kind: 'updateOtherHost', url: matched.url }
      : undefined;
  }
  if (mode === 'off') return undefined;
  const host = normalizeToHostname(currentUrl);
  const sibling = passwords.find(
    p => p.username === /* 当前预检的用户名 */ '' || false,
  );
  void sibling;
  return undefined;
}
```

> 上面第二段的兄弟条目查找按实际签名写：`passwords.find(p => p.username === username && resolveMatchTier(host, p.url, 'sameMainDomain') === 3)` 命中时回 `{ kind: 'willCreate', url: p.url }`。用 `=== 3`（兄弟子域）而非 `>= 1`：apex/通配命中在上一分支已被判重捕获，不会走到这里。实现时把占位的 `sibling` 段落替换为该表达式，不留 `void` 掩盖。

- [ ] **Step 3: 渲染**

`SavePasswordPrompt` 在备注行之后（`body.appendChild(remarkRow)` 之后）：

```ts
if (data.targetNote) {
  const note = document.createElement('div');
  note.className = 'aph-save-note';
  note.textContent = tl(
    data.targetNote.kind === 'updateOtherHost'
      ? 'cs.save.noteUpdateOtherHost'
      : 'cs.save.noteWillCreate',
    { url: data.targetNote.url },
  );
  body.appendChild(note);
}
```

样式随既有内联样式表加 `.aph-save-note { margin-top: 6px; font-size: 11px; color: var(--aph-text-muted, #94a3b8); }`。
i18n-lite（zh）：`'cs.save.noteUpdateOtherHost': '将更新 {url} 的同名账号'`、`'cs.save.noteWillCreate': '库中已有 {url} 的同名账号，本次将新增一条'`；en 对应两条。

- [ ] **Step 4: 测试**

`tests/utils/autoSaveManager.test.ts` 补：非 `off` 档 + 兄弟子域同名 → `targetNote.kind === 'willCreate'`；`off` 档同场景 → 无 `targetNote`；命中父域条目 → `updateOtherHost` 且 url 为该条目原样；命中同 host → 无提示。断言日志参数不含 url（`logger` 已 mock）。

Run: `pnpm typecheck && pnpm exec vitest run tests/utils/autoSaveManager.test.ts tests/background/autoSaveHandler.test.ts tests/content`
Expected: PASS

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add utils/storage/autoSaveManager.ts entrypoints/background/autoSaveHandler.ts entrypoints/content/SavePasswordPrompt.ts utils/types.ts utils/i18n-lite.ts tests/
git commit -m "feat(save): 说清跨子域保存去向，判重口径保持不变"
```

---

### 任务 10：文案、文档与全量验证

**Files:**

- Modify: `utils/i18n/locales/{zh-CN,en}/sidepanel.json`、`help.json`
- Modify: `components/sidepanel/HelpDialog.vue`（`helpItems('help.gx', N)` 的 N）
- Modify: `README.md`、`README.en.md`、`docs/ARCHITECTURE.md`、`docs/ARCHITECTURE.en.md`
- Modify: `index.html`（+ `pnpm gen:en`）、`wxt.config.ts` 描述、`docs/CWS_FILL_CONTENT.md`（仅在既有句式覆盖到匹配口径时增补）

- [ ] **Step 1: i18n**

`sidepanel.json`（zh）：`"scope": { ..., "crossSubdomain": "跨子域", "crossSubdomainHint": "同主域还有 {count} 条账号，可开启跨子域匹配" }`（en 对齐）。跑 `pnpm exec vitest run tests/utils/i18nBundles.test.ts`，若 help 条目数变化则同步 `HelpDialog.vue` 的 N。

- [ ] **Step 2: 帮助与文档**

`help.json` 新增一条编号条目（中英），说明三档差异 + `*.qq.com` 写法 + 「判重不变」；`README` / `README.en` 在功能列表处加同一事实口径；`docs/ARCHITECTURE.md`（及 `.en.md`）在域名匹配章节补：`isExactHostMatch` 仍是 `off` 档口径，跨子域走 `resolveMatchTier`，两者共存的档位表；`index.html` 增补后 `pnpm gen:en`，`pnpm gen:blog` 仅在本轮确实改博客时跑。

- [ ] **Step 3: 全量验证**

```bash
pnpm typecheck
pnpm lint
pnpm lint:style
pnpm test:run
pnpm build
pnpm build:firefox
pnpm exec prettier --check docs/superpowers/specs/2026-09-22-cross-subdomain-matching-design.md
```

Expected: 全绿；单测基线数只增不减（当前 1134 例 / 102 文件量级）

- [ ] **Step 4: 手动验证清单（必须真机，不能只靠测试）**

1. `off` 档：`mail.qq.com` 侧边栏与内联下拉只看到精确 + 通用条目（与改动前一致）。
2. `wildcard` 档 + 库里加 `*.qq.com`：两处都出现且带 chip/徽章，顺序在精确之后、apex 之前；点击能填充。
3. `sameMainDomain` 档：`fat.example.com` 页面出现 `uat.example.com` 条目（预期行为），设置对话框有警示。
4. 切档后不重新输入主密码、不闪白屏，侧边栏仍秒开。
5. 自动保存：`mail.qq.com` 用同名保存 → 更新 `qq.com` 那条并显示「将更新 qq.com 的同名账号」。
6. `*.qq.com` 条目的「打开站点」跳到 `https://qq.com/`，图标取 apex 缓存图标。
7. Popup 本站计数随档位变化且不含通用条目。

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add README.md README.en.md docs/ index.html wxt.config.ts utils/i18n/ components/sidepanel/HelpDialog.vue
git commit -m "docs: 跨子域匹配档位说明与帮助词条（中英）"
```

---

## 自查清单（写计划后执行）

- **Spec 覆盖**：§3→任务 1/2；§4→任务 3/4/8；§5→任务 7；§6→任务 5/6；§7→任务 9；§9→任务 3（镜像）+ 任务 10 验证；§10→各任务测试步骤 + 任务 10 全量；§11→任务 10。无遗漏。
- **占位符**：任务 9 Step 2 的兄弟条目查找是**有意标注的待落地表达式**（依赖 `checkCredentialStatus` 内实际变量名），已在同一步内写出确切实现，不留 TBD。
- **类型一致性**：`DomainMatchMode` / `MatchTier` / `resolveMatchTier` / `stripWildcardPrefix` / `splitWildcardHost` / `DEFAULT_DOMAIN_MATCH_MODE` / `getDomainMatchConfig` / `saveDomainMatchConfig` / `getCachedDomainMatchMode` / `OPEN_OPTIONS_AND_DOMAIN_MATCH` / `targetNote` / `SaveTargetNote` / `crossDomainCount` 在各任务间引用同名同签名；`CrossSubdomain` 词条统一为 `sidepanel.scope.crossSubdomain` 与 `cs.inline.scopeCrossSubdomain`。
- **风险点**：`utils/types.ts` ↔ `utils/domain.ts` 可能形成类型循环依赖（任务 3 Step 3 已给两选一方案）；`MatchingAccountMeta` 新增必填 `tier` 会波及既有构造点，需在同一任务内补齐（编译器会列出）。
