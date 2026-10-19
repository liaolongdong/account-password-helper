/**
 * 更新提示 / 一次性评价引导接线守卫
 *
 * 这两张卡片只在 Options 主内容区出现，且共享「先更新、后评价」的优先级。
 * 最容易被后续重构静默破坏的是：
 * 1. 组件只读展示，展示条件与持久化必须留在页面层；
 * 2. 更新卡片出现时起步清单要让位，评价引导延后到下一次打开；
 * 3. 评价 CTA 与关闭都必须落盘，不能只隐藏 UI。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const APP = readFileSync(path.join(ROOT, 'entrypoints/options/App.vue'), 'utf8');
const PROMPT = readFileSync(path.join(ROOT, 'components/options/GrowthPrompt.vue'), 'utf8');

describe('GrowthPrompt 接线', () => {
  it('组件是纯展示层，不直接读写存储或打开外链', () => {
    expect(PROMPT).toContain("mode: 'whats-new' | 'review'");
    expect(PROMPT).toContain("$emit('cta')");
    expect(PROMPT).toContain("$emit('dismiss')");
    expect(PROMPT).not.toContain('chrome.storage');
    expect(PROMPT).not.toContain('chrome.tabs');
  });

  it('Options 在主内容区接入更新/评价卡片，并让起步清单让位', () => {
    expect(APP).toContain('GrowthPrompt');
    expect(APP).toContain('initGrowthPrompts');
    expect(APP).toContain('shouldShowWhatsNew');
    expect(APP).toContain('shouldShowReviewPrompt');
    expect(APP).toContain('markWhatsNewSeen');
    expect(APP).toContain('dismissReviewPrompt');
    expect(APP).toContain('REVIEW_PROMPT_URL');
    expect(APP).toContain('!whatsNewVisible.value');
    expect(APP).toContain('!whatsNewShownThisSession.value');
    expect(APP).toContain('activationDoneCount.value >= ACTIVATION_TOTAL_STEPS');
  });

  it('两条 CTA 都会先打开外链，再记录已读/已关闭', () => {
    const cta = APP.slice(APP.indexOf('const handleGrowthCta'), APP.indexOf('const handleGrowthDismiss'));
    expect(cta.indexOf('chrome.tabs.create')).toBeGreaterThan(-1);
    expect(cta.indexOf('GITHUB_RELEASES_PAGE_URL')).toBeGreaterThan(-1);
    expect(cta.indexOf('REVIEW_PROMPT_URL')).toBeGreaterThan(-1);
    expect(cta.indexOf('dismissWhatsNew()')).toBeGreaterThan(-1);
    expect(cta.indexOf('dismissReview()')).toBeGreaterThan(-1);
  });
});
