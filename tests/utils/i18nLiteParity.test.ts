/**
 * 轻量 i18n（i18n-lite）中英文 key 集对齐测试
 *
 * 背景：项目规则要求「新增、删除或重命名 i18n key 时保持中英文 key 集一致」，
 * Vue 侧语言包已由 tests/utils/i18nBundles.test.ts 强制对齐，但 content/background
 * 使用的 LITE_MESSAGES 一直没有守卫。该表一旦单边缺 key，`tl()` 会静默回退成
 * 直接显示 key（如右键菜单通知里出现 `bg.quickFill.sessionExpiredUnlock`），
 * 且只在切换到对应语言时才暴露，极易漏测。
 *
 * 本测试锁定两件事：
 * 1. zh-CN 与 en 的 key 集合完全一致（缺失方与多余方都单独报出，便于定位）；
 * 2. 两侧的值都不是空串、也不是「值等于 key」的漏翻译形态。
 */
import { describe, expect, it } from 'vitest';
import { LITE_MESSAGES } from '@/utils/i18n-lite';

const ZH_KEYS = Object.keys(LITE_MESSAGES['zh-CN']);
const EN_KEYS = Object.keys(LITE_MESSAGES.en);

describe('i18n-lite 中英文 key 集对齐', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    const missingInEn = ZH_KEYS.filter(key => !EN_KEYS.includes(key));
    const missingInZh = EN_KEYS.filter(key => !ZH_KEYS.includes(key));
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] });
  });

  it('每个 key 在两侧都有非空、且不等于 key 本身的译文', () => {
    const emptyZh = ZH_KEYS.filter(key => !LITE_MESSAGES['zh-CN'][key].trim());
    const emptyEn = EN_KEYS.filter(key => !LITE_MESSAGES.en[key].trim());
    // 漏翻译最常见的形态就是「值抄成 key」，一并拦下
    const copiedKeys = EN_KEYS.filter(key => LITE_MESSAGES.en[key] === key);
    expect({ emptyZh, emptyEn, copiedKeys }).toEqual({ emptyZh: [], emptyEn: [], copiedKeys: [] });
  });
});
