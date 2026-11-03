/**
 * 落地页悬浮安装入口结构守卫
 *
 * 这枚浮层此前是一个裸 `<a>`：只能跟随滚动出现，不能收起；页脚微信区与安装小节
 * 之外的正文都可能被它压住。现在拆成「链接 + 展开/收起按钮」的容器，并把页脚也
 * 纳入让位信号。结构层面必须同时满足：
 *
 * 1. 收起按钮是独立的 `<button>`，不能嵌在 `<a>` 里（否则键盘与读屏语义都会坏）；
 * 2. 收起态仍保留下载链接与展开按钮，入口不能消失；
 * 3. 状态写进 localStorage，且 aria-expanded / aria-label 跟着状态更新；
 * 4. 安装小节与页脚任一进入视口时，浮层让位。
 *
 * 真正的点击与滚动行为由 `e2e/landing-sticky-cta.spec.ts` 在 Chrome 里验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PAGES = ['index.html', 'en.html'];

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/** 取悬浮入口的整块标记；内部没有嵌套 div，按首个 </div> 截断即可 */
function stickyBlock(html: string, file: string): string {
  const start = html.indexOf('<div\n      class="sticky-cta"');
  expect(start, `${file} 找不到悬浮入口容器`).toBeGreaterThan(-1);
  const end = html.indexOf('</div>', start);
  expect(end, `${file} 的悬浮入口容器没有闭合`).toBeGreaterThan(start);
  return html.slice(start, end + '</div>'.length);
}

describe('悬浮安装入口结构', () => {
  it.each(PAGES)('%s 使用独立的链接与收起按钮', file => {
    const block = stickyBlock(read(file), file);
    expect(block, '容器必须是 div，不能把按钮塞进 a 里').toContain('<div');
    expect(block).toContain('id="stickyCtaLink"');
    expect(block).toContain('id="stickyCtaToggle"');
    expect(block).toContain('type="button"');
    expect(block).toContain('aria-expanded="true"');
    expect(block).toContain('aria-controls="stickyCtaLink"');
    expect(block).toContain('sticky-cta__icon--collapse');
    expect(block).toContain('sticky-cta__icon--expand');
    expect(block).toContain('class="sticky-cta__label"');
    // 链接先闭合，按钮再开始：若按钮被包进 <a>，<button 会出现在 </a> 之前
    const linkEnd = block.indexOf('</a>');
    const buttonStart = block.indexOf('<button');
    expect(linkEnd, '找不到链接闭合标签').toBeGreaterThan(-1);
    expect(buttonStart, '找不到收起按钮').toBeGreaterThan(linkEnd);
  });

  it.each(PAGES)('%s 的收起态样式与状态逻辑齐备', file => {
    const html = read(file);
    expect(html).toContain('.sticky-cta.is-collapsed .sticky-cta__label');
    expect(html).toContain('.sticky-cta.is-collapsed .sticky-cta__icon--expand');
    expect(html).toContain('.sticky-cta__icon--expand');
    expect(html).toContain('STICKY_CTA_COLLAPSED_KEY');
    expect(html).toContain('setStickyCtaCollapsed');
    expect(html).toContain('localStorage.getItem(STICKY_CTA_COLLAPSED_KEY)');
    expect(html).toContain('localStorage.setItem(STICKY_CTA_COLLAPSED_KEY');
    expect(html).toContain("document.querySelector('footer')");
    expect(html).toContain('ctaSuppressed');
    expect(html).toMatch(/['"]aria\.stickyCollapse['"]\s*:/);
    expect(html).toMatch(/['"]aria\.stickyExpand['"]\s*:/);
    expect(html).toContain('收起安装按钮');
    expect(html).toContain('展开安装按钮');
  });
});
