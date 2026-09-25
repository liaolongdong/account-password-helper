/**
 * 「以明文为键」的派生记忆缓存：写入者所在的上下文必须接上会话边界清理
 *
 * 背景（issue #89 大列表改造的安全收口）：为削减检索与渲染成本，仓库里出现了三把
 * 模块级记忆缓存，其**键直接取自解密后的条目字段**——拼音命中区间
 * （`utils/searchMatch/core.ts`，键含条目字段明文）、标签呈现记录
 * （`utils/tagUtils.ts`，键为条目原始 tag）与图标 dataURL
 * （`utils/favicon.ts`，键为条目 url 归一化后的明文派生值，键集合本身即泄露账号站点清单）。
 * 三者把清理器登记给 `utils/plaintextCacheCleanup.ts`，由会话边界统一销毁。
 *
 * 真正的风险不在缓存本身，而在**谁持有它**：登记式清理只在「加载过该模块的上下文」里生效，
 * 于是每个写入者都要各自接上一条会话失效路径。管理页可整日常驻，漏接的表现不是崩溃而是
 * 静默残留——列表已清空、验证页已显示，那批明文字段仍可在内存里被寻址。本仓库实际踩过一次：
 * 侧边栏两条路径都补了，管理页当时只剩 `passwords.value = []`。
 *
 * 守卫口径分两层：
 * 1. 对每个入口上下文求其**静态**依赖闭包，闭包内有文件调用写缓存的导出（`WRITE_TRIGGERS`）
 *    即为写入者，写入者清单钉死成 `EXPECTED_WRITERS`，新增写入上下文会让守卫变红；
 * 2. 每个写入者各自钉死**本上下文的会话失效触发文件**（`WIRING_POINTS`）里必须有清理调用点。
 * 判据之所以是「本上下文的触发文件」而不是「闭包内某处调过清理」：跨上下文锁定时管理页只翻
 * `isAuthenticated`，`clearSession()` 早在别的上下文跑完，借别人闭包里的调用点作证据等于没证据
 * （删掉管理页 watcher 做探针，只看闭包的版本仍然全绿）。
 * 判据也不看「import 了缓存模块」：三把缓存都住在同时导出纯函数的模块里（`tagUtils` 的
 * `getTagColor` / `parseTags` 无缓存，`favicon.ts` 的 `getFaviconUrl` 只拼端点地址不写缓存），
 * content 只为取颜色而 import `tagUtils`、组件只为图标 URL 而 import `favicon`，那两把 Map
 * 在其上下文恒空——按 import 判定会把「不必接线」误报成缺陷，逼人给空缓存加清理点。
 *
 * 只走静态 import：动态可达属「按需才写」，若将来内联下拉改为渲染标签记录，
 * 需连同 content 侧的清理触发点（锁定消息）一并评估，届时该判断由人工负责。
 */
import { describe, it, expect } from 'vitest';
import { computeImportClosure, listSourceFiles, readSource } from '@/tests/helpers/architectureScan';

/** 三把明文键缓存的宿主模块 */
const CACHE_MODULES = ['utils/searchMatch/core.ts', 'utils/tagUtils.ts', 'utils/favicon.ts'];

/** 注册表自身：它声明 `clearPlaintextKeyedCaches`，不算「接上了清理」 */
const REGISTRY_MODULE = 'utils/plaintextCacheCleanup.ts';

/**
 * 会写入明文键缓存的导出
 *
 * `findMatchRange` / `matchesKeyword` / `highlightSegments` 命中拼音区间缓存，
 * `buildTagPresentationRecords` 命中标签呈现缓存。`utils/searchMatch.ts`（响应式外壳）
 * 转调内核，因此同样算写入面。`fetchFaviconDataUrl` 命中 favicon dataURL 缓存——
 * 组件侧只经 `getFaviconUrl` 取端点地址、不写缓存，因此写入面仍只有 Background。
 */
const WRITE_TRIGGERS = [
  'findMatchRange',
  'matchesKeyword',
  'highlightSegments',
  'buildTagPresentationRecords',
  'fetchFaviconDataUrl',
];
const WRITE_TRIGGER_RE = new RegExp(`\\b(?:${WRITE_TRIGGERS.join('|')})\\s*\\(`);
/** 清理调用点（空实参，排除注册表自身的声明行由下面的模块排除完成） */
const CLEANUP_CALL_RE = /clearPlaintextKeyedCaches\(\)/;

/** 受检入口上下文（仓库相对路径） */
const ENTRY_CONTEXTS = [
  'entrypoints/background.ts',
  'entrypoints/content.ts',
  'entrypoints/options/App.vue',
  'entrypoints/popup/App.vue',
  'entrypoints/sidepanel/App.vue',
];

/** 当前确有写入行为的上下文 */
const EXPECTED_WRITERS = ['entrypoints/background.ts', 'entrypoints/options/App.vue', 'entrypoints/sidepanel/App.vue'];

/**
 * 每个写入上下文的会话边界接线点
 *
 * 判据必须是「这个上下文自己的清理触发点」，而不是「闭包里某个文件调过清理」：
 * 管理页的闭包同样含 `utils/sessionManager-storage.ts`（里面有清理调用），但跨上下文锁定时
 * Options 只会把 `isAuthenticated` 翻成 false，`clearSession()` 早在别的上下文跑完了——
 * 借用别人的调用点作证据，正是这个缺口当初能长期静默存活的原因（探针实测：删掉管理页的
 * watcher 后，只看闭包的判定仍然全绿）。因此这里逐个上下文钉死真正的触发文件。
 */
const WIRING_POINTS: Record<string, string> = {
  'entrypoints/background.ts': 'utils/sessionManager-storage.ts',
  'entrypoints/options/App.vue': 'entrypoints/options/App.vue',
  'entrypoints/sidepanel/App.vue': 'composables/useSidepanelData.ts',
};

/** 一个入口上下文的写入 / 接线画像 */
interface ContextProfile {
  /** 入口路径 */
  root: string;
  /** 静态依赖闭包 */
  closure: Set<string>;
  /** 闭包内调用了写缓存导出的文件（写入点） */
  writeSites: string[];
  /** 闭包内调用了 `clearPlaintextKeyedCaches()` 的文件（接线点） */
  cleanSites: string[];
}

function profile(root: string): ContextProfile {
  const closure = computeImportClosure([root]);
  const scanned = [...closure].filter(rel => rel !== REGISTRY_MODULE);
  return {
    root,
    closure,
    writeSites: scanned.filter(rel => WRITE_TRIGGER_RE.test(readSource(rel))),
    cleanSites: scanned.filter(rel => CLEANUP_CALL_RE.test(readSource(rel))),
  };
}

describe('明文键派生缓存的会话边界接线守卫', () => {
  const profiles = ENTRY_CONTEXTS.map(profile);

  it('缓存模块清单未漂移：登记清理器的模块就是这三个', () => {
    const registrants = listSourceFiles('utils')
      .filter(rel => rel !== REGISTRY_MODULE)
      .filter(rel => /registerPlaintextCacheCleaner\(/.test(readSource(rel)));
    expect(registrants.slice().sort()).toEqual([...CACHE_MODULES].sort());
  });

  it('入口清单未漂移：entrypoints 下的上下文都在受检范围内', () => {
    expect(new Set(ENTRY_CONTEXTS).size).toBe(ENTRY_CONTEXTS.length);

    const roots = listSourceFiles('entrypoints').filter(
      rel => /^entrypoints\/[^/]+\.ts$/.test(rel) || /^entrypoints\/[^/]+\/App\.vue$/.test(rel),
    );
    // 抽取必须非空：为空说明入口形态变了，本条守卫会静默空跑
    expect(roots.length, '未抽到任何入口文件，listSourceFiles 口径已变').toBeGreaterThan(0);
    for (const root of roots) expect(ENTRY_CONTEXTS, `新增入口 ${root} 未纳入本守卫`).toContain(root);
  });

  it('判据确有牙齿：写缓存的导出与清理调用点都抽得到', () => {
    // 写入面：至少侧边栏行组件与管理页表格两处；抽取一旦失配（改名、换成具名导入对象），
    // 下面的「写入者必接线」会退化成永真断言，故先自证抽到东西。
    const writers = profiles.filter(p => p.writeSites.length > 0);
    expect(writers.length, '没有任何上下文被判定为明文键缓存写入者，写判据已失效').toBeGreaterThan(0);
    expect(
      writers.some(p => p.writeSites.some(rel => rel.startsWith('components/'))),
      '未抽到组件层的标签/高亮写入点，WRITE_TRIGGERS 已漂移',
    ).toBe(true);

    // 接线面：会话模块里的清理调用点必须仍被抽到
    expect(
      profiles.some(p => p.cleanSites.includes('utils/sessionManager-storage.ts')),
      'utils/sessionManager-storage.ts 不再调用 clearPlaintextKeyedCaches()，或 CLEANUP_CALL_RE 已失效',
    ).toBe(true);
  });

  it('每个写入上下文都在自己的会话失效路径上接了清理', () => {
    const writers = profiles.filter(p => p.writeSites.length > 0).map(p => p.root);

    // 写入者清单双向钉死：少了＝判据失效，多了＝新上下文开始写缓存，必须同步登记它的接线点。
    expect(writers.slice().sort(), '写入者清单变化：新增写入上下文须在 WIRING_POINTS 登记接线点').toEqual(
      [...EXPECTED_WRITERS].sort(),
    );
    expect(Object.keys(WIRING_POINTS).sort(), 'WIRING_POINTS 与写入者清单不一致').toEqual([...EXPECTED_WRITERS].sort());

    for (const root of writers) {
      const wiringPoint = WIRING_POINTS[root];
      expect(
        profiles.find(p => p.root === root)!.closure.has(wiringPoint),
        `${root} 的依赖闭包不再包含接线点 ${wiringPoint}`,
      ).toBe(true);
      expect(
        CLEANUP_CALL_RE.test(readSource(wiringPoint)),
        `${root} 的接线点 ${wiringPoint} 里找不到 clearPlaintextKeyedCaches() 调用：该上下文的明文键缓存会在锁屏后残留`,
      ).toBe(true);
    }
  });

  it('管理页的接线挂在状态边界且同步落地', () => {
    const source = readSource('entrypoints/options/App.vue');
    // 三段必须在同一个 watch 调用里：挂错触发源（只补 onSessionExpired）会漏掉 checkAuth 自检路径，
    // 少了 flush: 'sync' 则留下「已切到验证页、明文键仍可寻址」的微任务窗口。
    const block =
      /watch\(\s*isAuthenticated,[\s\S]{0,400}?clearPlaintextKeyedCaches\(\);[\s\S]{0,120}?flush:\s*'sync'/.exec(
        source,
      );
    expect(
      block,
      '管理页清理点应挂在 isAuthenticated 落 false 上并同步 flush（覆盖广播过期与 checkAuth 自检两条路径）',
    ).toBeTruthy();
  });
});
