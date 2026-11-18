/**
 * 最近搜索的展示面守卫
 *
 * 产品决策（2026-11-18）：历史候选只在管理页展示。侧边栏是「快速填充」场景，
 * 内联历史块会把匹配列表挤出首屏，跨站历史词对填充也是噪音；但侧边栏的搜索
 * 仍要**记录**进同一份会话历史，管理页打开时能看到刚才在侧边栏搜过的词。
 *
 * 这里钉的是只有源码能证明、断掉后不会有任何功能测试变红的接线形状：
 * 1. 侧边栏不再 import / 渲染 SearchHistoryPanel，面板状态与内联样式一并清掉；
 * 2. 侧边栏 blur / 回车仍调用 recordCurrentSearch（记录链路不许随展示一起摘掉）；
 * 3. 管理页筛选栏仍渲染 SearchHistoryPanel 并接好选中 / 清除（展示面留在 options）。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const SIDEPANEL = 'components/sidepanel/SidepanelAuthView.vue';
const OPTIONS_FILTER = 'components/options/SearchFilterBar.vue';

describe('侧边栏只记录、不展示', () => {
  it('不再 import 或渲染 SearchHistoryPanel，面板状态与内联样式一并清掉', () => {
    const source = readSource(SIDEPANEL);
    expect(source).not.toContain('SearchHistoryPanel');
    expect(source).not.toContain('search-history-inline');
    expect(source).not.toContain('historyPanelOpen');
    expect(source).not.toContain('openHistoryPanel');
    expect(source).not.toContain('closeHistoryPanel');
    expect(source).not.toContain('selectHistory');
    expect(source).not.toContain('clearSearchHistory');
    expect(source).not.toContain('recentSearches');
  });

  it('blur 与回车仍记录当前关键词（管理页的历史来源不断）', () => {
    const source = readSource(SIDEPANEL);
    expect(source).toContain('recordCurrentSearch');
    expect(source).toContain('@blur="handleSearchBlur"');
    expect(source).toContain('@keydown.enter="recordCurrentSearch"');
  });
});

describe('管理页保留展示面', () => {
  it('筛选栏仍渲染 SearchHistoryPanel 并接好选中 / 清除', () => {
    const source = readSource(OPTIONS_FILTER);
    expect(source).toContain("import SearchHistoryPanel from '@/components/SearchHistoryPanel.vue'");
    expect(source).toContain('<SearchHistoryPanel');
    expect(source).toContain('@select="selectHistory"');
    expect(source).toContain('@clear="clearSearchHistory"');
  });
});
