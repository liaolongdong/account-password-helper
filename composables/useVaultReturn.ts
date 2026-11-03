import { computed, ref } from 'vue';
import { logger } from '@/utils/logger';
import { normalizeToHostname } from '@/utils/domain';
import { normalizeSourceTabId, isNavigableSourceUrl } from '@/utils/sourceTab';

/**
 * 身份库「回到原网页」的来源标签页状态
 *
 * 页面侧身份提示把用户送到管理页取一个 PII 值，取完他必须自己找回刚才那个标签页、
 * 再点回那一格——这段跨窗口往返才是「存得下、填不出」真正 costs 的地方。本 composable
 * 只负责回程这一跳：记住来源、解析出可展示的主机名、切回去、并在任何结束时机忘掉它。
 *
 * 刻意**不碰**任何库内数据：值仍由用户在弹窗里逐字段/整卡自行复制走既有剪贴板通道，
 * 这里不读明文、也不改变复验门槛，因此不构成新的身份库入口（守卫见
 * `tests/architecture/identityReturnWiring.test.ts`）。
 *
 * 生命周期收敛在两处：来源弹窗关闭、会话失效（它必然连带关窗）。此外回程时若发现来源页已经
 * 不在，也当场清掉——那已经是同一个结束条件，只是晚一步发生。
 * 意图不落盘、不进 `chrome.storage`——它是这一副弹窗生命周期内的导航意图，写进存储就变成
 * 跨会话事实来源。
 */
export function useVaultReturn() {
  /** 来源标签页 ID；`undefined` 表示这一轮深链没有可回程的来源 */
  const sourceTabId = ref<number | undefined>(undefined);

  /** 来源站点的主机名，用于把「点这个按钮会去哪里」讲清楚；解析不出来时为空串 */
  const siteLabel = ref('');

  /** 回程出口是否可用（驱动提示条的显隐） */
  const available = computed(() => sourceTabId.value !== undefined);

  /** 忘掉来源（幂等） */
  const forget = (): void => {
    sourceTabId.value = undefined;
    siteLabel.value = '';
  };

  /**
   * 记录来源标签页
   *
   * 二次收窄 + 一次实读：后台传来的数字已经在 `sender.tab` 上收过口，这里按「外部输入一律
   * 不可校验上游」再收一次；随后用 `chrome.tabs.get` 复核这个标签页**此刻还在**，并取它的
   * URL 主机名作为展示标签。读不到（已关闭、拿不到 URL）就不启用出口——宁可不给这个按钮，
   * 也不给一个点下去什么都不发生、或者把用户带去陌生页面的按钮。
   *
   * @param rawTabId 消息里的 `sourceTabId`（不可信）
   */
  const remember = async (rawTabId: unknown): Promise<void> => {
    const tabId = normalizeSourceTabId(rawTabId);
    if (tabId === undefined) {
      forget();
      return;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || tab.pendingUrl;
      if (typeof url !== 'string' || !url || !isNavigableSourceUrl(url)) {
        forget();
        return;
      }
      sourceTabId.value = tabId;
      // 只取浏览器盖章的 URL 主机名，不用 tab.title：标题由页面自写，
      // 把它印在一枚会切换标签页的按钮旁边，等于允许站点给这个按钮配文案。
      siteLabel.value = normalizeToHostname(url);
    } catch (error) {
      // 标签页已关闭 / 扩展上下文已失效：没有可切回的页面，出口就不该出现
      logger.debug('Options: 记录身份库回程来源失败:', error);
      forget();
    }
  };

  /**
   * 切回来源标签页（并聚焦它所在窗口）
   *
   * 形态照抄 `SiteRulesDialog.vue` 的 `activateOptionsTab`——那是仓库里同一诉求（"用户不必
   * 再手动找回来"）的反方向实现。**成功不清意图**：库弹窗切走后仍然开着，用户很可能回头再取
   * 一个字段，这枚按钮要能反复用；而它每次做的都是同一件幂等的事——激活那一个标签页。
   * 失败才清：来源页已经关了，留着就是一个点下去什么都不发生的坏按钮。
   *
   * 切之前先复核「这一格还在不在原来那个站点」：`remember` 只在开库那一刻读过一次 URL，
   * 而提示条上写着的那串主机名是那时候的。来源页在用户取值的这几秒里可能被 SPA 路由换到别的
   * 站点，此时按钮说「回到 example.com」却把人切去陌生页面，落点恰是「刚复制完证件号」、
   * 注意力最放松的那一刻——比不给出口更危险。协议与主机名任一不符就当场作废意图、拒绝切换。
   *
   * @returns 是否确实切回去了
   */
  const returnToSource = async (): Promise<boolean> => {
    const tabId = sourceTabId.value;
    if (tabId === undefined) return false;
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || tab.pendingUrl;
      if (typeof url !== 'string' || !isNavigableSourceUrl(url) || normalizeToHostname(url) !== siteLabel.value) {
        forget();
        return false;
      }
      await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    } catch (error) {
      logger.debug('Options: 切回身份库来源标签页失败:', error);
      forget();
      return false;
    }
  };

  return { available, siteLabel, remember, forget, returnToSource };
}
