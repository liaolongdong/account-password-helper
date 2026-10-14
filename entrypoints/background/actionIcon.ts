/**
 * 工具栏图标的会话状态可视化
 *
 * 解锁态沿用 `public/icon/` 的既有钥匙图标（manifest 图标与商店截图都不变），锁定态换成
 * `public/icon/locked/` 的闭合挂锁，两者由 background 按会话材料切换。零新权限、零新数据：
 * 读的是既有会话键，写的是浏览器自带的工具栏外观。
 *
 * 图标与徽标刻意分道，互不覆写：
 * - **徽标（badge）**＝「刚刚发生了什么」的一次性回执（`quickFillHandler` 的 ✓ / !、更新提醒的 new）；
 * - **图标**＝「现在能不能用」的持续状态（钥匙 / 挂锁）。
 *
 * 状态唯一来源是 `isSessionValid`（会话材料 + 到期时间），因此本模块不新增任何判定分支：
 * 手动锁定、倒计时到期、浏览器重启重锁、闲置锁定、设置 / 验证主密码、换钥全部沿用
 * `storage.onChanged` 上已有的会话键分支（见 backgroundServices）。
 *
 * @module entrypoints/background/actionIcon
 */
import { logger } from '@/utils/logger';
import { isSessionValid } from '@/utils/sessionManager-storage';

/** 图标档位，与 `public/icon` 下的产物目录一一对应（`unlocked` 即 manifest 默认图标） */
export type ActionIconState = 'unlocked' | 'locked';

/**
 * 各档位的多尺寸图标路径（相对扩展根目录）
 *
 * 只给 16 / 32 / 48 / 128 四档：工具栏按设备像素比最多取到 16 的 2 倍，96 档没有消费方，
 * 多传一个键只会让 Chrome 多做一次无用的尺寸挑选。
 */
const ICON_PATHS: Record<ActionIconState, Record<string, string>> = {
  unlocked: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' },
  locked: {
    '16': 'icon/locked/16.png',
    '32': 'icon/locked/32.png',
    '48': 'icon/locked/48.png',
    '128': 'icon/locked/128.png',
  },
};

/**
 * 上一次已应用的档位
 *
 * 仅作去重，避免同一档位被反复 `setIcon`（storage 变更事件可能成批到达）。它不是事实来源：
 * SW 重启后归零，下一次 `refreshActionIcon` 必然重新应用一次，因此不存在「内存镜像与工具栏
 * 长期不一致」的窗口。
 */
let _appliedState: ActionIconState | null = null;

/**
 * 应用档位图标
 *
 * 失败只记日志、不抛出：工具栏外观属于「锦上添花」，绝不能让一次 `setIcon` 失败
 * （如扩展刚被重载、上下文失效）冒泡成锁定 / 解锁链路上的异常。
 */
async function applyState(state: ActionIconState): Promise<void> {
  if (_appliedState === state) return;
  try {
    await chrome.action.setIcon({ path: ICON_PATHS[state] });
    _appliedState = state;
  } catch (error) {
    logger.warn('Background: 工具栏图标状态更新失败:', error);
  }
}

/**
 * 按已知档位立即切换
 *
 * 供已经知道会话材料是出现还是被清除的调用方使用（如 `storage.onChanged` 的会话分支），
 * 省掉一次存储读取。
 */
export function setActionIconState(state: ActionIconState): void {
  void applyState(state);
}

/**
 * 以会话材料为准刷新图标
 *
 * SW 每次启动都调用一次（含被事件唤醒的冷启动），把工具栏外观收敛回真实会话状态；
 * `skipConsistencyCheck` 避免顺带触发 at-rest 密文化检查——那是密码数据的职责，
 * 与图标无关。
 */
export async function refreshActionIcon(): Promise<void> {
  const valid = await isSessionValid({ skipConsistencyCheck: true });
  await applyState(valid ? 'unlocked' : 'locked');
}
