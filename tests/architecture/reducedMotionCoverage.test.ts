/**
 * 关键帧动画必须配一份减弱动效兜底
 *
 * `@keyframes` 是纯 CSS，媒体查询对它有效（不像 JS 里的 `behavior: 'smooth'` 需要另一条
 * 守卫，见 `reducedMotionWiring.test.ts`）。但"有效"的前提是有人写了那条 `@media`：
 * 新增一个入场 / 滑出 / 抖动动画而忘了减弱档，系统设置里开了「减弱动态效果」的用户依然会
 * 被 20px 入场和 800px 滑出晃一下，而这件事不报错、不红、也不会有人提。
 *
 * 判据落在文件粒度：声明了 `@keyframes` 的 `.vue` 必须同时出现 `prefers-reduced-motion`。
 * 只要求"有这条媒体查询"，具体关哪条动画由作者判断——1px 的悬浮上浮本就不属于该缓解的
 * 运动量，把每一条 `transition` 都关掉反而会让悬浮反馈消失。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：`<style>` 块里的组件样式，以及内容脚本注入 UI 的影子样式（内联模板字符串） */
const VUE_DIRS = ['components', 'entrypoints'];
const SHADOW_STYLE_DIRS = ['entrypoints/content'];

/** `@keyframes 名字` 声明 */
const KEYFRAMES_RE = /@keyframes\s+([a-zA-Z][\w-]*)/;

/** 减弱动效媒体查询（CSS 的 `@media` 与 JS 的 `matchMedia` 两种写法都算） */
const REDUCED_MOTION_RE = /prefers-reduced-motion/;

/**
 * 有 `@keyframes` 但有意不配减弱档的位置
 *
 * 登记即说明理由，不登记则守卫变红——避免"忘了写"和"故意不写"混成同一种状态。
 */
const MOTION_EXCEPTIONS: Record<string, string> = {
  // 那枚 `spin` 是悬浮按钮 loading 态唯一的反馈：`AnimationController` 只加 `loading` 类，
  // 没有别的文字或图标变化。关掉动画等于把「正在处理」这个状态整个藏起来，
  // 比留着 0.8s 旋转更糟；要减弱它得先补一个非运动的态提示，属独立改动。
  'entrypoints/content/floatingButtons/styles.ts': 'spin 是悬浮按钮唯一的加载反馈，取消动画会丢状态提示',
};

/** 该文件是否「声明了关键帧却缺减弱档」 */
function missingReducedMotionFallback(source: string): boolean {
  return KEYFRAMES_RE.test(source) && !REDUCED_MOTION_RE.test(source);
}

describe('关键帧与减弱动效兜底配对', () => {
  const scannedFiles = [
    ...VUE_DIRS.flatMap(dir => listSourceFiles(dir, ['.vue'])),
    ...SHADOW_STYLE_DIRS.flatMap(dir => listSourceFiles(dir, ['.ts'])),
  ];
  const animated = scannedFiles.filter(file => KEYFRAMES_RE.test(readSource(file)));

  it('扫描到足够规模的组件与注入样式（判据不是空跑）', () => {
    expect(scannedFiles.length).toBeGreaterThan(60);
    expect(animated.length).toBeGreaterThanOrEqual(8);
  });

  it('判据有牙：只写动画会被判缺兜底，两者齐备与只有兜底都不误报', () => {
    expect(missingReducedMotionFallback('.a { animation: row-in 1s; } @keyframes row-in {}')).toBe(true);
    expect(
      missingReducedMotionFallback(
        '@keyframes row-in {}\n@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
      ),
    ).toBe(false);
    expect(missingReducedMotionFallback('.a { transition: all 0.2s; } /* 无关键帧 */')).toBe(false);
  });

  it('白名单里的例外仍在动画该在的文件上（挪了地方就要重新说明）', () => {
    for (const [file, reason] of Object.entries(MOTION_EXCEPTIONS)) {
      expect(reason.trim(), `${file} 的例外没写理由`).not.toBe('');
      expect(KEYFRAMES_RE.test(readSource(file)), `${file} 已不再声明 @keyframes，例外该删`).toBe(true);
    }
  });

  it('每个声明关键帧的文件都带减弱动效兜底（或已登记例外）', () => {
    const violations = animated.filter(
      file => !MOTION_EXCEPTIONS[file] && missingReducedMotionFallback(readSource(file)),
    );
    expect(violations, `以下文件有 @keyframes 却没有 prefers-reduced-motion：\n${violations.join('\n')}`).toEqual([]);
  });
});
