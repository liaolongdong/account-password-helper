/**
 * 读取产品真实文案，供 E2E 做语言无关的定位与断言
 *
 * 界面支持中英双语且语言是用户偏好，测试里硬编码任何一侧文案都会在切换语言时失效；
 * 直接改用正则把两侧文案并成一个匹配，等于「跟着产品文案走」——文案改名时测试与
 * 真实 UI 一起暴露，而不是悄悄失配。项目未使用 data-testid，这是当前最稳的折中。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['zh-CN', 'en'] as const;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(HERE, '..', 'utils', 'i18n', 'locales');

/** locale -> 扁平化的全量 key/value（各 namespace 文件合并，key 自带前缀故不会撞名） */
const messages = new Map<string, Record<string, string>>();

function loadLocale(locale: string): Record<string, string> {
  const cached = messages.get(locale);
  if (cached) return cached;

  const dir = path.join(LOCALES_DIR, locale);
  const merged: Record<string, string> = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as Record<string, string>;
    Object.assign(merged, parsed);
  }
  messages.set(locale, merged);
  return merged;
}

function lookup(key: string): string[] {
  const values = LOCALES.map(locale => {
    const value = loadLocale(locale)[key];
    if (!value) throw new Error(`E2E 文案缺失：${locale} 下没有 key "${key}"（产品文案改名后请同步测试）`);
    return value;
  });
  return [...new Set(values)];
}

/** 带参模板（含 `{days}` 之类占位）不适合整体匹配，只取模板的固定前缀 */
function stripPlaceholders(value: string): string {
  const cut = value.search(/\{[a-zA-Z0-9_]+\}/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** 供 `getByRole({ name })` / `hasText` 使用的中英并集正则 */
export function textOf(key: string): RegExp {
  const alternatives = lookup(key)
    .map(stripPlaceholders)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  return new RegExp(alternatives.join('|'));
}

/**
 * 全词锚定的中英并集正则
 *
 * `textOf` 是非锚定子串匹配，遇到「互为子串」的文案会同时命中两项：
 * 「加密备份」是「不加密备份」的子串，"Encrypted backup" 同样是 "Unencrypted backup"
 * 的子串，用它定位单选按钮会直接触发 strict mode 冲突。需要整串相等时用本函数。
 */
export function anchoredTextOf(key: string): RegExp {
  const alternatives = lookup(key)
    .map(value => value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

/**
 * 数字模板正则：把 `{count}` 一类占位要求成一段数字，多个 key 取并集
 *
 * `textOf` 为了做名字匹配会把模板砍到第一个占位之前，但那正好丢掉了倒计时、
 * 条数这类展示真正有价值的部分（`23小时59分钟` 的档位本身就是被测行为）。
 * 这类断言改用它，仍然只依赖产品文案，不硬编码中英任一侧。
 */
export function numericTemplateOf(...keys: string[]): RegExp {
  const alternatives = keys.flatMap(key =>
    lookup(key).map(template =>
      template
        .split(/\{[a-zA-Z0-9_]+\}/)
        .map(literal => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\d+'),
    ),
  );
  return new RegExp(alternatives.join('|'));
}

/**
 * 具体参数代入后的中英并集正则
 *
 * 「15 秒」「20 条」这类按数值区分的选项，`textOf` 会砍成空前缀（模板以占位符开头），
 * `numericTemplateOf` 又无法把「15 秒」和「30 秒」区分开。需要选中某一个具体选项时用它，
 * 未提供的占位仍降级为数字通配，不会因为漏传参数而匹配到整个下拉面板。
 */
export function templatedOf(key: string, params: Record<string, string | number>): RegExp {
  const alternatives = lookup(key).map(template =>
    template
      .split(/(\{[a-zA-Z0-9_]+\})/)
      .map(part => {
        const match = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
        if (!match) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const value = params[match[1]];
        return value === undefined ? '\\d+' : String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join(''),
  );
  return new RegExp(alternatives.join('|'));
}

/** 供输入框 placeholder 定位使用：同样返回中英并集正则 */
export function placeholderOf(key: string): RegExp {
  return textOf(key);
}

/** 直接取某一侧的完整文案（需要精确断言文本内容时使用） */
export function exactText(key: string, locale: (typeof LOCALES)[number] = 'zh-CN'): string {
  const value = loadLocale(locale)[key];
  if (!value) throw new Error(`E2E 文案缺失：${locale} 下没有 key "${key}"`);
  return value;
}
