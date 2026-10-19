/**
 * 更新弹窗 / 一次性评价引导接线守卫
 *
 * 更新提示改为弹窗，评价引导仍是主内容区的卡片。两者共享「本次更新优先」的规则，
 * 且都必须只在 Options 页面决定展示与持久化：
 * 1. 弹窗/卡片组件不直接读写存储或打开外链；
 * 2. 更新弹窗出现时起步清单与评价引导都要让位；
 * 3. 评价引导只在密码库存在满 7 天且用过一次后出现，延后 / 永久关闭都必须落盘。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const APP = readFileSync(path.join(ROOT, 'entrypoints/options/App.vue'), 'utf8');
const DIALOG = readFileSync(path.join(ROOT, 'components/options/WhatsNewDialog.vue'), 'utf8');
const REVIEW = readFileSync(path.join(ROOT, 'components/options/ReviewPrompt.vue'), 'utf8');
const ABOUT = readFileSync(path.join(ROOT, 'components/options/AboutDrawer.vue'), 'utf8');
const REVIEW_STATE = readFileSync(path.join(ROOT, 'utils/storage/reviewPrompt.ts'), 'utf8');

describe('更新弹窗与评价引导接线', () => {
  it('弹窗与卡片都是纯展示层，不直接读写存储或打开外链', () => {
    for (const source of [DIALOG, REVIEW]) {
      expect(source).not.toContain('chrome.storage');
      expect(source).not.toContain('chrome.tabs');
    }
    expect(DIALOG).toContain('el-dialog');
    expect(DIALOG).toContain("$emit('update:modelValue', $event)");
    expect(DIALOG).toContain("$emit('cta')");
    expect(REVIEW).toContain("$emit('cta')");
    expect(REVIEW).toContain("$emit('snooze')");
    expect(REVIEW).toContain("$emit('dismiss')");
  });

  it('Options 在主内容区接入弹窗与评价卡片，并让起步清单让位', () => {
    expect(APP).toContain('WhatsNewDialog');
    expect(APP).toContain('ReviewPrompt');
    expect(APP).toContain('initGrowthPrompts');
    expect(APP).toContain('shouldShowWhatsNew');
    expect(APP).toContain('shouldShowReviewPrompt');
    expect(APP).toContain('markWhatsNewSeen');
    expect(APP).toContain('dismissReviewPrompt');
    expect(APP).toContain('REVIEW_PROMPT_URL');
    expect(APP).toContain('!whatsNewVisible.value');
    expect(APP).toContain('!whatsNewShownThisSession.value');
  });

  it('评价引导要求密码库存在满 7 天且用过一次，并支持延后与永久关闭', () => {
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_MIN_PASSWORDS = 1');
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000');
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000');
    expect(REVIEW_STATE).toContain('deriveReviewUsage');
    expect(APP).not.toContain('positiveMoment');
    expect(APP).toContain('deriveReviewUsage(passwords.value)');
    expect(APP).toContain('passwordCount: passwords.value.length');
    expect(APP).toContain('hasUsed: reviewUsage.value.hasUsed');
    expect(APP).toContain('oldestCreateTime: reviewUsage.value.oldestCreateTime');
    expect(APP).toContain('snoozedUntil: reviewSnoozedUntil.value');
    expect(APP).toContain('snoozeReviewPrompt');
    expect(APP).toContain('@snooze="handleReviewSnooze"');
  });

  it('更新弹窗关闭与 CTA 都会记录已读版本', () => {
    const visibility = APP.slice(APP.indexOf('const handleWhatsNewVisibility'), APP.indexOf('const dismissReview'));
    expect(visibility).toContain('markWhatsNewSeen(currentVersion.value)');
    expect(visibility).toContain('GITHUB_RELEASES_PAGE_URL');
    expect(visibility).toContain('chrome.tabs.create');
  });

  it('About 抽屉在分享左侧提供常驻评价入口，并复用同一关闭逻辑', () => {
    expect(ABOUT).toContain('review: []');
    expect(ABOUT).toContain("$emit('review')");
    expect(ABOUT).toContain('options.about.review');
    expect(ABOUT).toContain('.about-footer :deep(.el-button + .el-button)');
    expect(ABOUT).toContain('margin-left: 0');
    expect(APP).toContain('@review="handleReviewCta"');
  });

  it('Firefox 构建不展示评价入口，也不弹自动评价引导', () => {
    expect(ABOUT).toContain('v-if="!isFirefox"');
    expect(APP).toContain('!isFirefox');
  });
});
