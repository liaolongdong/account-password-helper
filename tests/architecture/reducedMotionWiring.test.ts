/**
 * 减弱动效接线守卫（媒体查询够不着的那半边）
 *
 * CSS 里的动画有 `@media (prefers-reduced-motion: reduce)` 兜底，但命令式滚动写在 JS 里，
 * 媒体查询对它无效——只能靠调用点问一次 `matchMedia`。这类判据一旦有个别调用点漏问，
 * 表现是「系统已开启减弱动效，这一处仍然平滑滚动」：不报错、不红、review 也容易滑过去。
 * 本仓实际踩过：六处命令式滚动里只有一处问了，其余五处写死 `behavior: 'smooth'`。
 *
 * 所以钉三条：
 * 1. 全仓运行时代码不得再出现裸的 `behavior: 'smooth'`；
 * 2. 反向保证不是「把滚动删掉充数」——`scrollBehavior()` 的消费者数量必须还在阈值之上；
 * 3. 弹窗内容区那条「等渲染再滚到底」的时序只许有一个实现（`utils/dialogScroll.ts`），
 *    组件里再手搓一遍就会重新带上写死的 smooth。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：会被打包进扩展产物的运行时代码 */
const SCANNED_DIRS = ['composables', 'components', 'entrypoints', 'utils'];

/** JS 里自己写死平滑滚动的形态 */
const RAW_SMOOTH_RE = /behavior:\s*['"]smooth['"]/g;

/** 经统一判据取滚动行为的调用点（无 `g`，避免 lastIndex 在多次调用间串味） */
const WIRED_RE = /behavior:\s*scrollBehavior\(\)/;

/** 弹窗内容区滚到底的手搓形态：自己 querySelector 到 `.dialog-body-scroll` 再 scrollTo */
const HANDROLLED_DIALOG_SCROLL_RE = /dialog-body-scroll['"`]\)?\s*;\s*[\s\S]{0,120}?\.scrollTo\(/;

/**
 * 找出源码里真正写死 smooth 的行号
 *
 * 跳过注释行：解释这条缺陷的注释必然会提到 `behavior: 'smooth'` 这个写法本身
 * （`utils/dialogScroll.ts` 的文件头就是），把它算成违规等于逼文档失忆。
 * 判据只看行首，所以 `{ behavior: 'smooth' } // 平滑滚动` 这种真代码仍会被抓。
 */
function rawSmoothLines(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  for (const match of source.matchAll(RAW_SMOOTH_RE)) {
    const line = source.slice(0, match.index).split('\n').length;
    const text = lines[line - 1]?.trimStart() ?? '';
    if (text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    hits.push(line);
  }
  return hits;
}

describe('命令式滚动的减弱动效接线', () => {
  const files = SCANNED_DIRS.flatMap(dir => listSourceFiles(dir));

  it('扫描到足够规模的运行时代码（目录漂移时变红，而不是静默空跑）', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('判据自身有效：裸 smooth 被抓出，统一口径、瞬时滚动与注释不误报', () => {
    expect(rawSmoothLines("el.scrollTo({ top: 0, behavior: 'smooth' });")).toEqual([1]);
    expect(rawSmoothLines("  // 三处都写死了 behavior: 'smooth'")).toEqual([]);
    expect(rawSmoothLines("  * 而坑在于 behavior: 'smooth' 抄了五遍")).toEqual([]);
    expect(rawSmoothLines("el.scrollIntoView({ block: 'nearest' })")).toEqual([]);
    expect(WIRED_RE.test('el.scrollIntoView({ behavior: scrollBehavior() })')).toBe(true);
  });

  it('全仓运行时代码不再出现写死的 behavior: smooth', () => {
    const violations = files.flatMap(file => rawSmoothLines(readSource(file)).map(line => `${file}:${line}`));
    expect(violations, `以下位置自行写死平滑滚动，「减弱动效」对其无效：\n${violations.join('\n')}`).toEqual([]);
  });

  it('收口方向是接线而非删除：scrollBehavior() 仍有足够多消费者', () => {
    const consumers = files.filter(file => WIRED_RE.test(readSource(file)));
    expect(
      consumers.length,
      `仅 ${consumers.length} 个文件用到 scrollBehavior()，滚动点被删了还是判据又被就地手搓了？`,
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('弹窗内容区滚动时序只有一份实现', () => {
  const dialogFiles = listSourceFiles('components').filter(file => file.endsWith('Dialog.vue'));

  it('扫到弹窗组件，且它们改由 `scrollDialogBodyToBottom` 承担滚动', () => {
    expect(dialogFiles.length).toBeGreaterThan(5);

    const handRolled = dialogFiles.filter(file => HANDROLLED_DIALOG_SCROLL_RE.test(readSource(file)));
    expect(handRolled, `以下弹窗手搓了「等渲染再滚到底」，绕开了统一判据：\n${handRolled.join('\n')}`).toEqual([]);

    // 反向自检：两处滚动确实还在，只是换了实现（防止"删掉滚动"被当成收口）
    const wired = dialogFiles.filter(file => readSource(file).includes('scrollDialogBodyToBottom('));
    expect(wired.sort()).toEqual(['components/options/BackupImportDialog.vue', 'components/options/ImportDialog.vue']);
  });
});
