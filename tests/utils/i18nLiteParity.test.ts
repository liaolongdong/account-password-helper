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
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { LITE_MESSAGES } from '@/utils/i18n-lite';

const ROOT = path.resolve(__dirname, '../..');

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

/**
 * 标题位文案不许承诺结局
 *
 * 背景：自动保存的标题曾写成「账号密码已保存」（`bg.autoSave.savedTitle`，现已更名为不承诺
 * 结局的 `bg.autoSave.title`），而它服务三种 `success: true`，
 * 其中「该账号已存有密码，本次未改动」一条字节都没写（`utils/storage/autoSaveManager.ts:352-354`），
 * 于是标题对正文反悔。其余标题（提醒 / 更新 / 备份 / 一键填充 / 右键菜单项）都是事件或功能名，
 * 本来就不承担结局语义——这条判据把「标题只标事件，结局交给正文」钉成可判定的口径。
 *
 * 判据自己找钥匙：key 清单从生产源码里扫 `title: tl('...')` / `title ?? tl('...')` 得到
 * （桌面通知与右键菜单共用这一形状），不硬编码条数。新增一个标题位若写了结局文案，直接落进这一关。
 */
describe('i18n-lite 标题位文案的口径', () => {
  /** 递归收集待扫源码文件（轻量 i18n 只服务 content / background 两侧） */
  const sourceFiles = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(relative);
      return entry.name.endsWith('.ts') ? [relative] : [];
    });

  /** 生产源码里落在标题位（通知标题 / 菜单项标签）上的 key（去重、按出现顺序） */
  const titleKeys = (): string[] => {
    const files = [...sourceFiles('entrypoints'), ...sourceFiles('utils')];
    expect(files.length, '待扫源码目录为空，本用例的判据已失去意义').toBeGreaterThan(0);
    const found = files.flatMap(file =>
      [...readFileSync(path.join(ROOT, file), 'utf-8').matchAll(/title\s*(?::|\?\?)\s*tl\('([^']+)'\)/g)].map(
        match => match[1],
      ),
    );
    return [...new Set(found)];
  };

  /** 结局断言词：出现在标题里就等于标题替正文做了它没做的事 */
  const OUTCOME_ZH = /已保存|已更新|未改动|未保存/;
  const OUTCOME_EN = /saved|updated|unchanged|not saved/i;

  it('每个标题位文案都确实在语言包里，且中英文都不写结局', () => {
    const keys = titleKeys();
    // 反空转：本次收口的那一条必须在扫描结果里，扫不到就说明正则或源码形状变了
    expect(keys, '没有从源码里扫到自动保存的标题位调用点').toContain('bg.autoSave.title');

    const missing = keys.filter(key => !(key in LITE_MESSAGES['zh-CN']) || !(key in LITE_MESSAGES.en));
    const claiming = keys.filter(
      key => OUTCOME_ZH.test(LITE_MESSAGES['zh-CN'][key] ?? '') || OUTCOME_EN.test(LITE_MESSAGES.en[key] ?? ''),
    );
    expect(missing, '标题 key 在源码里被引用，语言包却没有').toEqual([]);
    expect(
      claiming,
      `标题承诺了结局，而正文才是唯一说实话的地方：${claiming.map(key => `${key}「${LITE_MESSAGES['zh-CN'][key]}」`).join('、')}`,
    ).toEqual([]);
  });
});
