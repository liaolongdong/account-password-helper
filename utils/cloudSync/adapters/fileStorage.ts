/**
 * 文件存储适配器抽象（WebDAV 规格 §4.1）
 *
 * 与 `TableAdapter` **并列**而非继承：文件协议没有 recordId、字段与单元格上限，
 * 硬套表格语义会扭曲抽象。上层 `webdavSync.ts` 只面向本接口编程，
 * 未来新增其他文件协议（若需要）只需实现本接口。
 */

/** 远程文件元信息（由 PROPFIND 解析） */
export interface RemoteFile {
  /** 文件名（已从 href 取 basename 并 decodeURIComponent） */
  name: string;
  /** 可直接用于 GET/DELETE 的绝对 URL（由适配器重建，不信任服务器 href） */
  url: string;
  /** 字节数；服务器未返回时为 0 */
  size: number;
}

/**
 * 文件存储适配器
 *
 * 实现方负责：鉴权、URL 归一化、协议细节与错误归一化。
 * 所有方法失败时抛 `CloudSyncError`（领域错误），上层不感知协议细节。
 */
export interface FileStorageAdapter {
  readonly provider: 'webdav';
  /** 探活 + 鉴权校验（不修改服务器状态） */
  testConnection(): Promise<void>;
  /**
   * 确保备份子目录存在（幂等：已存在视为成功）
   *
   * @returns 目录是否为本次新建（MKCOL 201 → true；已存在 405 → false）
   */
  ensureDirectory(): Promise<boolean>;
  /** 列出备份目录下的快照文件（仅本扩展命名的文件） */
  listFiles(): Promise<RemoteFile[]>;
  /** 上传文件（整体覆盖） */
  putFile(name: string, content: string): Promise<void>;
  /** 下载文件内容（带响应体大小上限，云端文件是不可信输入） */
  getFile(url: string, expectedSize?: number): Promise<string>;
  /** 删除文件（不存在视为业务成功） */
  deleteFile(url: string): Promise<void>;
}
