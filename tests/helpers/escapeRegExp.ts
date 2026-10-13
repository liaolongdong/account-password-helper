/**
 * 把字面量转义成可安全嵌进 `new RegExp` 的模式片段。
 *
 * 守卫们按字符串拼正则去扫源码与 CSS，插进去的 key、选择器来自数据面。
 * 只转义部分控制字符（例如只处理 `.`）会留下 `+`、`(`、`$` 这类未转义的元字符：
 * 传入的值一旦含元字符，拼出来的正则要么匹配错位、要么直接语法错误。
 * 这里覆盖 JS 正则的全部控制字符，调用方不必再关心传进来的是什么。
 *
 * @module tests/helpers/escapeRegExp
 */

/**
 * 转义字符串中的正则控制字符，供拼接动态模式使用。
 *
 * @param literal 要当作字面量匹配的内容
 * @returns 可安全嵌入 `new RegExp` 的模式片段
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
