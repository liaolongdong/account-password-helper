import { type Ref, ref, nextTick } from 'vue';
import type { FloatingButtonConfig } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import {
  getSettingsPanelHTML,
  bindSettingsPanelView,
  settingsPanelViewStyles,
  type SettingsPanelViewHandle,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';

/**
 * SidePanel 设置弹窗管理 Composable
 *
 * 职责：
 * - 悬浮按钮设置弹窗的打开/关闭
 * - 悬浮按钮配置的读取/更新/持久化
 * - 设置弹窗样式注入
 *
 * @param settingsPanelEl 设置面板 DOM 元素引用（由调用方提供，确保模板引用可被 vue-tsc 追踪）
 * @param settingsOverlayEl 设置遮罩层 DOM 元素引用
 * @returns 设置弹窗状态与操作方法
 */
export function useSidepanelSettings(
  settingsPanelEl: Ref<HTMLElement | null>,
  settingsOverlayEl: Ref<HTMLElement | null>,
) {
  // ==================== 状态 ====================

  const showSettingsDialog = ref(false);
  const floatingConfig = ref<FloatingButtonConfig>(StorageUtils.getDefaultFloatingButtonConfig());

  /** 共用视图句柄（模块内部，不暴露） */
  let settingsViewHandle: SettingsPanelViewHandle | null = null;

  // ==================== 方法 ====================

  /**
   * 关闭设置弹窗
   */
  const closeSettingsDialog = () => {
    settingsViewHandle?.destroy();
    settingsViewHandle = null;
    showSettingsDialog.value = false;
  };

  /**
   * 更新悬浮按钮配置
   * content 会通过 chrome.storage.onChanged 自动同步
   */
  const updateFloatingConfig = async (patch: Partial<FloatingButtonConfig>) => {
    Object.assign(floatingConfig.value, patch);
    try {
      await StorageUtils.saveFloatingButtonConfig(patch);
    } catch (error) {
      logger.error('SidePanel: 保存悬浮按钮配置失败:', error);
      ElMessage.error('保存设置失败');
    }
  };

  /**
   * 打开设置弹窗
   * 先从存储加载最新配置，再通过共用视图模块渲染与绑定事件
   */
  const openSettingsDialog = async () => {
    try {
      floatingConfig.value = await StorageUtils.getFloatingButtonConfig();
    } catch (error) {
      logger.error('SidePanel: 加载悬浮按钮配置失败:', error);
    }
    showSettingsDialog.value = true;

    await nextTick();
    if (!settingsPanelEl.value) return;

    settingsPanelEl.value.innerHTML = getSettingsPanelHTML(floatingConfig.value);
    settingsViewHandle = bindSettingsPanelView(settingsPanelEl.value, settingsOverlayEl.value, floatingConfig.value, {
      onConfigChange: patch => {
        void updateFloatingConfig(patch);
      },
      onClose: closeSettingsDialog,
    });
  };

  /**
   * 将共用设置弹窗样式注入到 sidepanel 页面（仅注入一次）
   */
  const injectSettingsViewStyles = () => {
    const STYLE_ID = 'floating-settings-view-styles';
    if (document.getElementById(STYLE_ID)) return;
    const styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = settingsPanelViewStyles;
    document.head.appendChild(styleEl);
  };

  return {
    // 状态
    showSettingsDialog,
    floatingConfig,
    // 方法
    openSettingsDialog,
    closeSettingsDialog,
    injectSettingsViewStyles,
  };
}
