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
 * 上一次已成功应用的档位
 *
 * 仅作去重下限，避免同一档位被反复 `setIcon`（storage 变更事件可能成批到达）。它不是事实来源：
 * SW 重启后归零，下一次 `refreshActionIcon` 必然重新应用一次，因此不存在「内存镜像与工具栏
 * 长期不一致」的窗口。
 */
let _appliedState: ActionIconState | null = null;

/** 最新一次请求的目标档位（可能在途），完成当前 `setIcon` 后以此为准收敛 */
let _desiredState: ActionIconState | null = null;

/** 是否有一次收敛循环正在跑，避免并发 `drain` 交错导致旧档位覆盖新档位 */
let _draining = false;

/**
 * 把工具栏收敛到最新期望档位
 *
 * 用「最新期望状态 + 单飞循环」取代「读一次即写」：`setIcon` 在途时若又来了新的档位请求，
 * 只更新 `_desiredState`，当前这次写完成后循环会再比对一次并补写，确保最终停在**最后一次**
 * 请求的档位上，而不是被在途操作的完成顺序带回旧状态（快速锁定 / 解锁交错时的错相根因）。
 *
 * 失败只记日志、不抛出、且中断本轮循环：工具栏外观属于「锦上添花」，绝不能让一次 `setIcon`
 * 失败（如扩展刚被重载、上下文失效）冒泡成锁定 / 解锁链路上的异常；`_appliedState` 只在成功时
 * 置位，下一次刷新会自然重试。
 */
async function drainActionIcon(): Promise<void> {
  if (_draining) return;
  _draining = true;
  try {
    while (_desiredState !== null && _desiredState !== _appliedState) {
      const next = _desiredState;
      try {
        await chrome.action.setIcon({ path: ICON_PATHS[next] });
        _appliedState = next;
      } catch (error) {
        logger.warn('Background: 工具栏图标状态更新失败:', error);
        break;
      }
    }
  } finally {
    _draining = false;
  }
}

/**
 * 按已知档位立即切换
 *
 * 供已经知道会话材料是出现还是被清除的调用方使用（如 `storage.onChanged` 的会话分支），
 * 省掉一次存储读取。
 */
export function setActionIconState(state: ActionIconState): void {
  _desiredState = state;
  void drainActionIcon();
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
  _desiredState = valid ? 'unlocked' : 'locked';
  await drainActionIcon();
}
