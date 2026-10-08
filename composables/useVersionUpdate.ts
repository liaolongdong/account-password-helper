import { shallowRef, ref } from 'vue';
import type { UpdateInfo } from '@/utils/types';
import { getCachedUpdateInfo } from '@/utils/updateChecker';
import { toNavigableUrl } from '@/utils/domain';
import { GITHUB_RELEASES_PAGE_URL } from '@/utils/urls';

/**
 * 版本更新管理 Composable
 * 管理插件版本号、缓存的更新信息读取、徽标清除、更新页跳转。
 * 可在 Popup、Sidepanel、Options 等多处复用。
 */
export function useVersionUpdate() {
  /** 当前插件版本号，取自 manifest.json */
  const currentVersion = shallowRef(chrome.runtime.getManifest().version);

  /** 版本更新信息（缓存读取，null 表示无新版本） */
  const updateInfo = ref<UpdateInfo | null>(null);

  /**
   * 初始化版本更新检测
   * 1. 从 chrome.storage.local 读取缓存的更新信息
   * 2. 若存在新版本，清除 Popup 图标红点（用户已知晓更新提示）
   */
  const initUpdateCheck = async () => {
    const cachedUpdate = await getCachedUpdateInfo();
    updateInfo.value = cachedUpdate;

    // Popup 已打开并展示更新提示卡片，清除图标红点（用户已知晓）
    if (cachedUpdate) {
      try {
        await chrome.action.setBadgeText({ text: '' });
      } catch {
        // 清除徽标失败不影响主流程
      }
    }
  };

  /**
   * 打开版本更新下载页面
   *
   * 跳转地址取自 storage 里的缓存值，而写入方（`updateChecker`）是网络响应：
   * 这里再判一次协议，覆盖「修复前已缓存的旧值」这条路径——非法或缺失一律退回仓库 Releases 页。
   */
  const openUpdatePage = () => {
    const target = toNavigableUrl(updateInfo.value?.downloadUrl) ?? GITHUB_RELEASES_PAGE_URL;
    chrome.tabs.create({ url: target });
    window.close();
  };

  return {
    currentVersion,
    updateInfo,
    initUpdateCheck,
    openUpdatePage,
  };
}
