import { type Ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

/**
 * 每页条数档位的持久化接线（响应式副作用层）
 *
 * 存在的理由是把「哪一档是用户选的」这一处偏好的读写规则收在单一位置：管理页密码表与
 * 回收站弹窗各自持有一份分页状态（`useVaultListPagination`），但档位对整页只有一个含义，
 * 两处各写一遍 watch + try/catch 早晚会在错误处理上分叉。
 * 状态所有权仍在调用方——本文件不创建 ref，只负责把一个 `pageSize` ref 与存储对齐。
 *
 * 记档位的理由与排序、主题、语言同一套：用户选 50 还是 200 取决于屏高、行宽和库大小，
 * 这个判断不随会话变化，每轮重开管理页就回到 100 是纯粹的重复劳动。
 * 反过来**页码刻意不落盘**：它是派生值而非设置——「第 7 页」的含义取决于当前命中集合，
 * 而关键词、标签、收藏筛选这些口径本来就不落盘；单独恢复页码只会把用户留在一个他没见过的
 * 页面上，还要和保存后定位用的 `revealIndex` 抢同一个状态。
 */
export function useVaultPageSize(pageSize: Ref<number>) {
  /**
   * 最近一次已落盘的档位
   *
   * 写入与恢复都以它为基准：构造时它等于 `DEFAULT_PAGE_SIZE`（分页状态的初值），
   * 恢复流程先记它再改 `pageSize`，下面的 watcher 据此认出「这次变化来自恢复」而不回写。
   * 真正拦住回写的是那个等值比较（watcher 是 pre flush，回写晚一拍同样会被它挡掉），
   * 所以**别把它当冗余删掉**——删掉后每次打开管理页都白做一次 `storage.local` 写入。
   */
  let persisted: number = pageSize.value;

  watch(pageSize, async size => {
    if (size === persisted) return;
    try {
      await StorageUtils.saveVaultPageSize(size);
      persisted = size;
    } catch (error) {
      // 失败时不更新 `persisted`：下一次换档仍会把新值写回去，不让存储停在半旧状态
      logger.error('保存每页条数失败:', error);
    }
  });

  /**
   * 从存储恢复档位
   *
   * 密码表那边必须在列表首次渲染前 `await` 完成（见 `entrypoints/options/App.vue` 的
   * `onMounted`）：档位决定首帧喂给 `el-table` 的行数，渲染后再换档等于把整表重排付两遍。
   * 回收站弹窗在每次打开时对齐一次即可——它挂在弹窗里，不在这条首屏路径上。
   * 页码不需要处理：它恒从第 1 页起，换档后若越界由 `useVaultListPagination` 的钳位收回。
   */
  const restorePageSize = async () => {
    try {
      const size = await StorageUtils.getVaultPageSize();
      persisted = size;
      pageSize.value = size;
    } catch (error) {
      // 读不到就用当前档位继续：视图偏好缺失不该弹错误打扰用户，也不该顺手写回默认值
      logger.debug('恢复每页条数失败:', error);
    }
  };

  return { restorePageSize };
}
