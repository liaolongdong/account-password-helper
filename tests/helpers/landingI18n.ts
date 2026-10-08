/**
 * 落地页内嵌 `I18N` 字典的只读解析工具（供 tests/docs 下的守卫复用）。
 *
 * 为什么单独成文件：字典是 `index.html` 里的一段对象字面量，多个守卫都要按 key 取
 * `{ zh, en }`（data-i18n 兜底文本、FAQ 出口卡、生成器演示的文案），各写一遍迟早会漂。
 *
 * 这里走的是**正则**路径，和 `tests/docs/landingFaqDom.test.ts` 里那套 `vm` 求值路径刻意并存：
 * 后者要的是「用另一条独立读法交叉验证字典」，两条路径都收在同一份 helper 上就失去了意义，
 * 所以那一份留在原文件里，不复用此处。
 *
 * @module tests/helpers/landingI18n
 */

/** 字典条目：中英两值 */
export interface I18nEntry {
  zh: string;
  en: string;
}

/**
 * 从页面源码的 `const I18N = {` 起，取出某个 key 的中英两值。
 *
 * 只从字典起点往后找：`'foo.bar'` 这种 key 在别处（脚本、markup 属性）也可能出现，
 * 从全文找会读到无关命中。
 *
 * @param html 页面源码
 * @param key data-i18n 用到的 key
 * @returns 中英两值；字典里没有该 key（或缺任意一档）时返回 null
 */
export function i18nEntry(html: string, key: string): I18nEntry | null {
  const body = html.slice(html.indexOf('const I18N = {'));
  const entry = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\{([\\s\\S]*?)\\}`).exec(body);
  if (!entry) return null;
  const zh = /zh:\s*'((?:[^'\\]|\\.)*)'/.exec(entry[1])?.[1];
  const en = /en:\s*'((?:[^'\\]|\\.)*)'/.exec(entry[1])?.[1];
  return zh === undefined || en === undefined ? null : { zh, en };
}
