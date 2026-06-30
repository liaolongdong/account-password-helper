/**
 * StorageUtils Facade
 *
 * 将原 1043 行的 StorageUtils 类拆分为 5 个领域模块，
 * 通过对象展开重组为同名导出，保持调用方零改动。
 *
 * 模块结构：
 * - facades.ts         — 加密委托 + 会话委托 + 调试工具
 * - masterPassword.ts  — 主密码管理（设置/验证/重置/清空）
 * - passwordCrud.ts    — 密码 CRUD（保存/更新/删除/查询）
 * - configManager.ts   — 配置管理（排序/悬浮按钮/邮箱备份/剪贴板/收藏上限）
 * - autoSaveManager.ts — 自动保存配置与执行 + LRU 收藏淘汰
 */

import * as facades from './storage/facades';
import * as masterPassword from './storage/masterPassword';
import * as passwordCrud from './storage/passwordCrud';
import * as configManager from './storage/configManager';
import * as autoSaveManager from './storage/autoSaveManager';

export const StorageUtils = {
  // 加密委托 + 会话委托 + 调试
  ...facades,

  // 主密码管理
  ...masterPassword,

  // 密码 CRUD
  ...passwordCrud,

  // 配置管理
  ...configManager,

  // 自动保存 + LRU 淘汰
  ...autoSaveManager,

  // 常量
  DEFAULT_FAVORITE_LIMIT: configManager.DEFAULT_FAVORITE_LIMIT,
};
