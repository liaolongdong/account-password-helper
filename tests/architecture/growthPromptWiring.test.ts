/**
 * 更新弹窗 / 一次性评价引导接线守卫
 *
 * 更新提示与评价引导都是弹窗。两者共享「本次更新优先」的规则，
 * 且都必须只在 Options 页面决定展示与持久化：
 * 1. 弹窗/卡片组件不直接读写存储或打开外链；
 * 2. 更新弹窗出现时起步清单与评价引导都要让位；
 * 3. 评价引导只在「密码多于 1 条 + 成功填充过 + 首次填充满 7 天」后出现，延后与永久关闭都落盘；
 * 4. 首次填充锚点只在所有填充路径的汇聚点（元数据批量落盘）记一次，页面侧只读。
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
const CRUD = readFileSync(path.join(ROOT, 'utils/storage/passwordCrud.ts'), 'utf8');

describe('更新弹窗与评价引导接线', () => {
  it('弹窗组件都是纯展示层，不直接读写存储或打开外链', () => {
    for (const source of [DIALOG, REVIEW]) {
      expect(source).not.toContain('chrome.storage');
      expect(source).not.toContain('chrome.tabs');
    }
    // 两者统一为 el-dialog 形态：靠 model-value 显隐、关闭经 update:modelValue 上抛
    for (const source of [DIALOG, REVIEW]) {
      expect(source).toContain('el-dialog');
      expect(source).toContain("$emit('update:modelValue', $event)");
    }
    expect(DIALOG).toContain("$emit('cta')");
    expect(REVIEW).toContain("$emit('cta')");
    expect(REVIEW).toContain("$emit('snooze')");
    expect(REVIEW).toContain("$emit('dismiss')");
  });

  it('评价弹窗被 ESC / 遮罩关闭时按「稍后再说」延后，而非永久关闭', () => {
    expect(APP).toContain('@update:model-value="handleReviewVisibility"');
    const visibility = APP.slice(APP.indexOf('const handleReviewVisibility'), APP.indexOf('const handleReviewCta'));
    // 延后只在父层状态还没落定时成立：三个动作按钮各自写回后 `showReviewPrompt` 已是 false，
    // 而 el-dialog 的 `afterLeave` 还会无条件补抛一次 false。少了这层判据，「不再提醒」会在
    // 永久关闭之后紧跟一条 30 天静默期，把两个互斥状态同时写进存储（e2e 第 3 段实测到的正是它）。
    expect(visibility).toContain('if (!visible && showReviewPrompt.value) handleReviewSnooze()');
    expect(visibility).not.toContain('if (!visible) handleReviewSnooze()');
    expect(visibility).not.toContain('dismissReviewPrompt');
  });

  it('Options 在主内容区接入更新弹窗与评价弹窗，并让起步清单让位', () => {
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

  it('评价引导要求密码多于 1 条且首次填充满 7 天，并支持延后与永久关闭', () => {
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_MIN_PASSWORDS = 2');
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000');
    expect(REVIEW_STATE).toContain('REVIEW_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000');
    expect(REVIEW_STATE).toContain('firstFillAt: number | null');
    expect(REVIEW_STATE).toContain('export async function markFirstQuickFill');
    // 年龄锚点不能再退回条目派生：lastUsedAt 每次填充都刷新，收藏更不是使用
    expect(REVIEW_STATE).not.toContain('deriveReviewUsage');
    expect(REVIEW_STATE).not.toContain('oldestCreateTime');

    expect(APP).not.toContain('positiveMoment');
    expect(APP).not.toContain('deriveReviewUsage');
    expect(APP).toContain('passwordCount: passwords.value.length');
    expect(APP).toContain('firstFillAt: reviewFirstFillAt.value');
    expect(APP).toContain('reviewFirstFillAt.value = reviewState.firstFillAt');
    expect(APP).toContain('snoozedUntil: reviewSnoozedUntil.value');
    expect(APP).toContain('snoozeReviewPrompt');
    expect(APP).toContain('@snooze="handleReviewSnooze"');
  });

  it('首次填充锚点只在元数据批量落盘处记一次，且只在批次含 lastUsedAt 时', () => {
    expect(CRUD).toMatch(/import \{ markFirstQuickFill \} from '\.\/reviewPrompt'/);
    expect(CRUD).toMatch(/updates\.lastUsedAt !== undefined/);

    // 记账点必须排在 PASSWORDS 写成功之后：填充没落盘就不该记「用过一次」。
    // 切片边界先各自断言存在，否则 indexOf 返回 -1 会让 slice 右界截空、顺序断言空转通过。
    const flushStart = CRUD.indexOf('async function flushMetadataUpdates');
    const flushEnd = CRUD.indexOf('export function updatePasswordInSession');
    expect(flushStart, '找不到元数据批量落盘函数').toBeGreaterThan(-1);
    expect(flushEnd, '找不到防抖写入入口').toBeGreaterThan(flushStart);

    const flush = CRUD.slice(flushStart, flushEnd);
    const writePasswords = flush.search(
      /await chrome\.storage\.local\.set\(\{ \[STORAGE_KEYS\.PASSWORDS\]: passwords \}\)/,
    );
    expect(writePasswords, '密码数组落盘点不见了，顺序断言失去意义').toBeGreaterThan(-1);
    expect(
      flush.slice(writePasswords).search(/hasFillUpdate[\s\S]{0,60}void markFirstQuickFill\(\)/),
      '锚点记账点不见了，或未排在密码落盘成功之后',
    ).toBeGreaterThan(-1);
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
