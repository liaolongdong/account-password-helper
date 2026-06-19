/**
 * 格式化快捷键显示文本
 * 将 Chrome API 返回的快捷键字符串转换为更友好的显示格式
 * @param shortcut - Chrome API 返回的快捷键，如 "Ctrl+Shift+P" 或 "Command+Shift+L"
 * @returns 格式化后的快捷键文本，如 "Ctrl⇧P" 或 "⌘⇧L"
 */
export const formatShortcut = (shortcut: string): string => {
  if (!shortcut) return '';
  return shortcut
    .replace(/Command/gi, '⌘')
    .replace(/Ctrl/gi, 'Ctrl')
    .replace(/Shift/gi, '⇧')
    .replace(/Alt/gi, '⌥')
    .replace(/\+/g, '');
};
