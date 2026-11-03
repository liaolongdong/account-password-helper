/**
 * 跨上下文的回复串不得自带语言，也不得被消费侧原样弹给用户
 *
 * 背景（评审缺陷 D-6）：`messageRouter` 曾把 15 条回复文案写成硬编码中文，而侧边栏
 * `useSidepanelFill` 又把 content script 回传的 `FillResult.message` 直接塞进 `ElMessage`。
 * 两条路的共同根因是「谁回复谁措辞」：`message` 由回复方的 `tl()` 产出，而
 * `utils/i18n-lite.ts:330` 的 `currentLiteLocale` 初值是 `zh-CN`、要等 `initLiteI18n()` 的
 * fire-and-forget `getStoredLocale()` 才切档——于是英文界面会收到中文串。
 *
 * 两条判据分别钉住根因的两端：
 * 1. **回复侧**：`entrypoints/background/*.ts` 里 `message:` 字段不得出现中文字面量。
 *    只钉 `message:` 不钉 `error:`，因为 `error:` 全仓只进日志（唯一读者是
 *    `entrypoints/popup/App.vue:453` 的 `logger.error`），不是用户可见文案。
 * 2. **消费侧**：`composables/useSidepanelFill.ts` 的 `ElMessage.*` 不得读取 `.message`，
 *    填充结果一律由 `FillResult.reason` / `FillResult.outcome` 这两个结构化字段本地化。
 *
 * 判据 1 的已知宽松处：只认与 `message:` 同行的引号字面量，跨行拼接的赋值不在此列
 * （全仓当前没有这种形状）。判据 2 只覆盖被修的那条路径，其它消费点不在本文件职责内。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** CJK 文字（用于识别「这条串自带语言」） */
const CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff]';

/** `message: '<含中文的字面量>'` —— 单引号、双引号、反引号三种写法都算 */
const CJK_MESSAGE_RE = new RegExp(`message: *["'\`][^"'\`]*${CJK}`, 'g');

/** `ElMessage.<kind>(... .message ...)` —— 消费侧原样透传回复串 */
const MESSAGE_ECHO_RE = /ElMessage\.(?:success|warning|error|info)\([^)]*\.message/;

/** 判据 2 的扫描面：被修的填充 composable */
const FILL_COMPOSABLE = 'composables/useSidepanelFill.ts';

describe('跨上下文回复串的语言中立性', () => {
  it('后台回复的 message 字段不得内联中文（须走 tl() 由本上下文措辞）', () => {
    const offenders = listSourceFiles('entrypoints/background', ['.ts'])
      .filter(rel => !rel.endsWith('.test.ts'))
      .map(rel => ({ rel, hits: readSource(rel).match(CJK_MESSAGE_RE) ?? [] }))
      .filter(entry => entry.hits.length > 0);

    expect(offenders).toEqual([]);
  });

  it('侧边栏填充提示不得读取回复方的 message 字符串', () => {
    const source = readSource(FILL_COMPOSABLE);
    const offender = source.split('\n').find(line => MESSAGE_ECHO_RE.test(line));

    expect(offender).toBeUndefined();
  });

  /**
   * 正向对照：两条判据必须能咬住修之前的那两种形状，否则上面两个 `it` 只是空转。
   * 用夹具串而不是去改源码，保证本用例在任何环境下都不产生副作用。
   */
  it('判据对修复前的形状仍然有牙', () => {
    expect(CJK_MESSAGE_RE.test("return { success: false, message: '无法获取标签ID' };")).toBe(true);
    CJK_MESSAGE_RE.lastIndex = 0;
    expect(CJK_MESSAGE_RE.test('sendResponse({ success: false, message: "填充失败" });')).toBe(true);
    CJK_MESSAGE_RE.lastIndex = 0;
    // 反向：本地化后的写法不得被误判
    expect(CJK_MESSAGE_RE.test("sendResponse({ success: false, message: tl('bg.router.noTabId') });")).toBe(false);
    CJK_MESSAGE_RE.lastIndex = 0;

    expect(MESSAGE_ECHO_RE.test("ElMessage.success(response.message || t('fill.fillSuccess'));")).toBe(true);
    expect(MESSAGE_ECHO_RE.test('ElMessage.warning(t(FILL_FAILURE_KEYS[reason]));')).toBe(false);
  });
});
