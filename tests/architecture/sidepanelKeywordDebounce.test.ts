/**
 * 侧边栏关键词防抖链路守卫
 *
 * 侧边栏的检索链是「整表筛选 + 排序 + 每张已渲染行 × 4 格高亮」，与管理页密码表同形状，
 * 因此同样需要「输入即时回显、过滤延后落地」（`composables/useKeywordDebounce`）。
 * 这条链路一旦回退，症状是「打字时面板掉帧、列表跟不住光标」——只在 2000 条量级的大库
 * 与低端机上出现，测试环境（无 DOM、不渲染行）永远量不到，也不会有任何报错。
 * 故在此把三处接线钉住：
 *
 * 1. 驱动过滤的关键词必须取防抖副本，不能图省事直接吃输入框的即时值；
 * 2. 键盘导航/回车填充前必须先 `flush`，否则会出现「字打完了、回车填的还是上一个列表」；
 * 3. 行内高亮与空态文案必须与列表同源（取已落地的那一份），否则防抖窗口内
 *    「列表按上一个关键词过滤、行内按刚打的字高亮」，刚输入的前缀在这批行上无命中，
 *    整列高亮会闪没。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const APP = 'entrypoints/sidepanel/App.vue';
const AUTH_VIEW = 'components/sidepanel/SidepanelAuthView.vue';

/**
 * 取 `startMarker` 之后、`endMarker` 之前的一段源码
 *
 * 两个标记都必须能找到：定位失败即断言失败，而不是拿到空串让后续的 `toContain`
 * 全部空跑（守卫静默空跑比没有守卫更糟）。
 */
const sliceBetween = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  expect(start, `未找到起始标记（实现改名需同步本守卫）: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  expect(end, `未找到结束标记: ${endMarker}`).toBeGreaterThan(0);
  return rest.slice(0, end);
};

describe('侧边栏过滤链取防抖后的关键词', () => {
  it('listFilterOptions 的关键词来自防抖副本，而非输入框即时值', () => {
    const body = sliceBetween(readSource(APP), 'const listFilterOptions = computed<ListFilterOptions>(() => ({', '}))');

    expect(body, '过滤关键词必须来自防抖副本').toContain('keyword: activeSearchKeyword.value');
    expect(body, '直接吃即时值即回退为每键重排整表').not.toContain('keyword: searchKeyword.value');
  });

  it('防抖来自 composable，不在入口内联重写计时器', () => {
    const source = readSource(APP);
    expect(source).toContain("import { useKeywordDebounce } from '@/composables/useKeywordDebounce';");
    expect(source, '未挂载防抖副本').toContain('useKeywordDebounce(searchKeyword)');
    // 内联一份 setTimeout 计时器 = 三处实现重新分叉，「手感是否跟手」的口径又会漂移
    expect(source).not.toMatch(/[Dd]ebounce\w*Timer\s*(?::|=)/);
  });
});

describe('侧边栏键盘入口先落地未生效的关键词', () => {
  it('handleKeydown 在读取列表之前 flush，且合成态放行仍在最前', () => {
    const body = sliceBetween(readSource(APP), 'const handleKeydown = (e: KeyboardEvent) => {', '\n};');

    const composing = body.indexOf('if (e.isComposing) return;');
    const flush = body.indexOf('flushSearchKeyword()');
    const listRead = body.indexOf('filteredPasswords.value');

    expect(composing, '缺少 IME 合成态早退').toBeGreaterThanOrEqual(0);
    expect(flush, '缺少 flushSearchKeyword()').toBeGreaterThanOrEqual(0);
    expect(listRead, '列表读取定位失败').toBeGreaterThan(flush);
    // 顺序必须是 IME 早退 → flush → 取列表：flush 跑到 IME 之前会让中文输入的
    // 每一次候选翻页都提前落地半截关键词，等于把防抖拆给输入法
    expect(composing).toBeLessThan(flush);
  });
});

describe('认证视图的高亮与空态与列表同源', () => {
  it('props 声明了 activeKeyword，行内高亮与 v-memo 都取它', () => {
    const source = readSource(AUTH_VIEW);

    expect(source, 'props 需声明 activeKeyword').toContain('activeKeyword: string;');
    expect(source, '行内高亮必须与过滤同一份关键词').toContain(':search-keyword="activeKeyword"');
    expect(source, '高亮吃即时值会让列表与高亮分属两个关键词').not.toContain(':search-keyword="searchKeyword"');

    const memoStart = source.indexOf('v-memo="[');
    expect(memoStart, 'v-memo 定位失败').toBeGreaterThanOrEqual(0);
    const memo = source.slice(memoStart, source.indexOf(']"', memoStart));
    expect(memo, 'v-memo 依赖需覆盖已落地关键词').toContain('activeKeyword,');
    expect(memo, '即时值入依赖会让每次击键都作废整张列表的 memo').not.toContain('searchKeyword,');
  });

  it('空态文案与拼音就绪依赖同样取 activeKeyword', () => {
    const source = readSource(AUTH_VIEW);

    const emptyHint = sliceBetween(source, 'const emptyHint = computed(() =>', '\n);');
    expect(emptyHint).toContain('props.activeKeyword.trim()');
    expect(emptyHint, '空态提示读即时值会先于列表变空').not.toContain('searchKeyword.value.trim()');

    const memoDep = sliceBetween(source, 'const pinyinRenderMemoDependency = computed(() =>', '\n');
    expect(memoDep).toContain('getPinyinRenderMemoDependency(props.activeKeyword)');
  });

  it('输入框仍绑即时值：回显不许跟着防抖变慢', () => {
    const source = readSource(AUTH_VIEW);
    expect(source, '搜索框的即时值通道被切断').toContain("defineModel<string>('searchKeyword'");
    expect(source, '搜索框失去即时回显，打字会明显跟不住光标').toContain('v-model="searchKeyword"');
  });
});
