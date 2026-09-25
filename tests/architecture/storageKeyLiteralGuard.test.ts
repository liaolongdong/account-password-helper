/**
 * Storage 键名单一真源守卫（E1 分片改造的前置锁）
 *
 * `utils/storageKeys.ts` 把 storage.local / storage.session 的键名集中成常量，是刻意
 * 与加密链解耦的轻模块（该文件无任何 import）。在业务代码里再写一遍键名字符串，等于
 * 制造第二事实来源：键名一旦改动（改名、迁移、**按条目分片**），常量消费点会跟着走，
 * 字面量消费点则静默失联——最坏形态是 `storage.onChanged` 从此收不到密码数据变更，
 * 侧边栏与管理页不再刷新，而类型检查、构建与测试全都仍然通过。
 *
 * 这条锁之所以现在钉：E1（把 `account_passwords` 拆成多键）会把键名从「一个常量」变成
 * 「一组前缀键」，届时任何残留字面量都是必然失效的死分支。设计文档把它列为 B0 前置项。
 *
 * 会话键（`SESSION_STORAGE_KEYS`）不在禁用清单里，因为把它们收进常量需要静态 import
 * `utils/sessionManager-storage.ts`，而侧边栏首屏刻意只经 `lazyImport` 碰那个模块
 * （见 `useSidepanelData.ts` 顶部说明）——为消灭字面量而击穿一条有文档、有产物守卫的
 * 懒加载约束，是拿首屏换一致性。所以这里改为**逐字钉住**这批例外：出现位置只能是白名单
 * 里的那一个文件，且每个字面量必须仍与会话模块里的定义相同。漂移同样让守卫变红。
 */
import { describe, it, expect } from 'vitest';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 需要单一真源的键名集合（值即字面量，在运行时代码出现即为违规） */
const FORBIDDEN_LITERALS = [...Object.values(STORAGE_KEYS), ...Object.values(SESSION_MEMORY_KEYS)];

/** 扫描范围：会被打包进扩展产物的运行时代码 */
const SCANNED_DIRS = ['composables', 'components', 'entrypoints', 'utils'];

/** 定义处本身当然允许出现这些字符串，不参与扫描 */
const DEFINITION_FILES = new Set(['utils/storageKeys.ts', 'utils/sessionManager-storage.ts']);

/** 会话键名的定义处（只读源码取值，避免把会话/加密链导入测试运行时） */
const SESSION_MODULE = 'utils/sessionManager-storage.ts';

/** 被允许以字面量形态存在的会话键：文件 → 键名集合 */
const TOLERATED_SESSION_LITERALS: Record<string, string[]> = {
  'composables/useSidepanelData.ts': ['session_wrapped_data_key', 'session_password_expiry', 'session_validity_hours'],
};

/**
 * 找出源码里以引号包裹形式出现的指定键名
 *
 * 只认单/双引号：文档与注释里的键名一律写作 `` `account_passwords` ``（反引号），
 * 那是自然语言指称而非代码，把它算成违规会逼着人改写注释而不是修掉真实耦合。
 *
 * @param source 源文件文本
 * @param keys 需要探测的键名值
 * @returns 命中位置（从 1 开始的行号 + 键名）
 */
function findKeyLiterals(source: string, keys: readonly string[]): { line: number; key: string }[] {
  const hits: { line: number; key: string }[] = [];
  for (const key of keys) {
    // 键名一旦含 `.` `+` `:` 之类的字符，直接拼进正则会让判据静默走形
    const re = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      hits.push({ line: source.slice(0, match.index).split('\n').length, key });
    }
  }
  return hits;
}

/** 从会话模块源码里取出 `SESSION_STORAGE_KEYS` 的键名值集合 */
function sessionKeyValues(): Set<string> {
  const block = readSource(SESSION_MODULE).match(/(SESSION_STORAGE_KEYS\s*=\s*\{[\s\S]*?\n\};)/);
  expect(block, '未取到 SESSION_STORAGE_KEYS 定义块（文件结构变化需同步更新本守卫）').toBeTruthy();
  const values = [...block![1].matchAll(/^\s*[A-Z_]+:\s*'([^']+)'/gm)].map(match => match[1]);
  expect(values.length).toBeGreaterThanOrEqual(6);
  return new Set(values);
}

describe('storage 键名字面量的单一真源', () => {
  const files = SCANNED_DIRS.flatMap(dir => listSourceFiles(dir)).filter(file => !DEFINITION_FILES.has(file));

  it('扫描到足够规模的运行时源码（目录漂移时让守卫变红，而不是静默空跑）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(FORBIDDEN_LITERALS.length).toBeGreaterThan(30);
  });

  it('判据自身有效：注入一处键名字面量能被抓出', () => {
    const detected = findKeyLiterals(`const k = '${STORAGE_KEYS.PASSWORDS}';\nget(changes['x']);`, FORBIDDEN_LITERALS);
    expect(detected).toEqual([{ line: 1, key: STORAGE_KEYS.PASSWORDS }]);
    // 注释/文档里的反引号写法不算违规
    expect(findKeyLiterals('// 收到 `account_passwords` 变更时刷新', FORBIDDEN_LITERALS)).toEqual([]);
  });

  it('除定义处外，运行时代码不再重复 storageKeys 里的键名字面量', () => {
    const violations = files.flatMap(file =>
      findKeyLiterals(readSource(file), FORBIDDEN_LITERALS).map(hit => `${file}:${hit.line} '${hit.key}'`),
    );
    expect(violations, `以下位置重复了 storageKeys 常量，键名迁移时会静默失联：\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('会话键字面量的白名单与逐字一致性', () => {
  const toleratedValues = new Set(Object.values(TOLERATED_SESSION_LITERALS).flat());

  it('白名单里的每个字面量仍与会话模块的定义逐字相同', () => {
    const defined = sessionKeyValues();
    for (const key of toleratedValues) {
      expect(defined, `会话模块已不再定义 '${key}'，但白名单仍放行了它（侧栏监听会静默失联）`).toContain(key);
    }
  });

  it('会话键字面量只出现在白名单文件里', () => {
    const found = SCANNED_DIRS.flatMap(dir => listSourceFiles(dir))
      .filter(file => !DEFINITION_FILES.has(file))
      .flatMap(file =>
        findKeyLiterals(readSource(file), [...toleratedValues])
          .map(hit => hit.key)
          .filter(key => !(TOLERATED_SESSION_LITERALS[file] ?? []).includes(key)),
      );
    expect(
      found,
      `以下文件新增了会话键字面量（要么收进常量，要么显式登记白名单并说明理由）：\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
