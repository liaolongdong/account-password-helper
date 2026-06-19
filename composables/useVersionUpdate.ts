import { shallowRef, ref } from 'vue';
import type { UpdateInfo } from '@/utils/types';
import { getCachedUpdateInfo } from '@/utils/updateChecker';

/**
 * GitHub Release 版本下载页面（兜底地址）
 * 当缓存的更新信息中无 downloadUrl 时，跳转至此页面
 */
const GITHUB_RELEASES_PAGE = 'https://github.com/liaolongdong/account-password-helper/releases/latest';

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
   * 跳转到 GitHub Release 页面，同时关闭当前窗口
   */
  const openUpdatePage = () => {
    if (updateInfo.value?.downloadUrl) {
      chrome.tabs.create({ url: updateInfo.value.downloadUrl });
    } else {
      chrome.tabs.create({ url: GITHUB_RELEASES_PAGE });
    }
    window.close();
  };

  return {
    currentVersion,
    updateInfo,
    initUpdateCheck,
    openUpdatePage,
  };
}
