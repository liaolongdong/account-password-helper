/**
 * 格式化文件字节数为可读字符串
 *
 * 从 `ImportDialog` / `BackupImportDialog` 的组件内私有实现上移为单一事实来源：
 * 除了两处文件信息展示，导入字节闸门（`MAX_PASSWORD_IMPORT_INPUT_BYTES`）的
 * 拒绝文案也要在**非 Vue 的 util 层**渲染同一个上限值，不能各自拼一份数字。
 *
 * 采用 1024 进制并固定保留一位小数，与浏览器/系统文件管理器的显示口径一致。
 *
 * @param bytes 文件字节数
 * @returns 格式化后的文件大小字符串，如 `512 B`、`3.2 KB`、`32.0 MB`
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};
