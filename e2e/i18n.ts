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
