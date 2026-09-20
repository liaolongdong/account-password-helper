/**
 * `public/_locales` 文案预算与引用完整性静态守卫
 *
 * 背景：manifest 的 `name` / `description` / 命令描述全部走 `__MSG_x__` 占位符，
 * 真实文案在 `public/_locales/{zh_CN,en}/messages.json`。这条链路有三个只有运行时
 * （商店上传 / 浏览器 UI）才暴露的失败模式，且都在本仓吃过亏：
 *
 * 1. **引用悬空**：`wxt.config.ts` 写了 `__MSG_foo__` 而语言包没有 `foo`，
 *    打包不报错，商店页面直接显示裸占位符；
 * 2. **预算溢出**：`description` 超 132 字符会导致商店 zip 上传失败；`extensionName`
 *    超 45 字符在「管理扩展」页与商店标题处被截断（3.8.0 因堆关键词被拒时，
 *    英文名称 42 字符只剩 3 个字符余量，属一改就爆的紧约束）；
 * 3. **中英单边**：只在一侧加键，另一侧回退成英文/占位符，商店文案语言错配。
 *
 * 这些都是「构建绿、上线炸」的类型，故在源码层钉死；同时钉住扫描命中数，
 * 防止 `wxt.config.ts` 改向后守卫空跑。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** manifest 引用的 locale 文件（目录名用 Chrome 的 `zh_CN` 下划线写法） */
const LOCALE_FILES = ['public/_locales/zh_CN/messages.json', 'public/_locales/en/messages.json'] as const;

/** `extensionName` 预算：45 字符（「管理扩展」页与商店标题的可用宽度） */
const NAME_BUDGET = 45;

/** `extensionDescription` 硬上限：132 字符，超出则商店 zip 上传失败 */
const DESCRIPTION_BUDGET = 132;

interface LocaleEntry {
  message: string;
  description?: string;
}

function readMessages(file: string): Record<string, LocaleEntry> {
  return JSON.parse(readFileSync(path.join(ROOT, file), 'utf-8')) as Record<string, LocaleEntry>;
}

const messagesByLocale = LOCALE_FILES.map(file => ({ file, messages: readMessages(file) }));

/** `wxt.config.ts` 里实际引用的 `__MSG_x__` 键 */
const referencedKeys = [
  ...new Set([...readFileSync(path.join(ROOT, 'wxt.config.ts'), 'utf-8').matchAll(/__MSG_(\w+)__/g)].map(m => m[1])),
];

const messageOf = (messages: Record<string, LocaleEntry>, key: string): string => messages[key]?.message ?? '';

describe('_locales 文案预算与引用完整性', () => {
  it('从 wxt.config.ts 扫描到 __MSG_ 引用（防止配置改向后守卫空跑）', () => {
    // 实测 6 处：name / description / 4 条命令描述
    expect(referencedKeys.length).toBeGreaterThanOrEqual(6);
  });

  it('每个被引用的 key 在中英文语言包中都存在且 message 非空', () => {
    for (const key of referencedKeys) {
      for (const { file, messages } of messagesByLocale) {
        expect(
          messageOf(messages, key).trim().length,
          `${file} 缺少非空的「${key}」，manifest 会渲染出裸 __MSG_ 占位符`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('中英文语言包 key 集合完全对齐', () => {
    const [zhKeys, enKeys] = messagesByLocale.map(({ messages }) => Object.keys(messages).sort());
    expect(zhKeys, 'zh_CN 与 en 的 _locales key 不对齐').toEqual(enKeys);
  });

  it('扩展名称守住 45 字符预算', () => {
    for (const { file, messages } of messagesByLocale) {
      expect(
        messageOf(messages, 'extensionName').length,
        `${file} 的 extensionName 超预算，商店标题/浏览器 UI 会截断`,
      ).toBeLessThanOrEqual(NAME_BUDGET);
    }
  });

  it('扩展描述守住 132 字符硬上限', () => {
    for (const { file, messages } of messagesByLocale) {
      expect(
        messageOf(messages, 'extensionDescription').length,
        `${file} 的 extensionDescription 超 132 字符，商店 zip 上传会被拒绝`,
      ).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
    }
  });
});
