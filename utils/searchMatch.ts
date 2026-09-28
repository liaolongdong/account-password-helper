import { shallowRef } from 'vue';
import * as core from '@/utils/searchMatch/core';
import type { HighlightSegment } from '@/utils/searchMatch/core';

/**
 * 智能搜索匹配（Vue 响应式外壳）
 *
 * 纯逻辑与拼音模块在 `@/utils/searchMatch/core`；本模块只负责两件事：
 * - 把内核的「拼音模块就绪」事件镜像成一个 `shallowRef`，让依赖它的过滤/渲染
 *   computed 在预热完成后自动重算一次，拼音命中结果即时补齐，调用方无需手动刷新；
 * - 对匹配函数保持拆分前的签名（`(text, keyword)`），历史调用方
 *   （侧边栏、options、命令面板、高亮组件）无需感知拆分。
 *
 * 预热入口 `warmPinyinMatcher` 由调用方直接从内核导入：加载动作与响应式无关，
 * 而「预热了但过滤 computed 未依赖外壳 ref」正是这次拆分要避免的错位。
 *
 * 拆分动机：同一份匹配逻辑还要服务 Background（Service Worker），而这里的一行
 * `import { shallowRef } from 'vue'` 会让 Vite 把 Vue 与 vue-i18n（实测约 131KB 的
 * `i18n-*.js` 共享 chunk）拉进 SW 依赖图。故 SW / content script 侧一律直接引用内核，
 * 本模块只在 Vue 侧入口导入。
 *
 * 内核放在 `utils/searchMatch/` 而非 `utils/` 同级：WXT 按导出名扫描 `utils/` 顶层文件
 * 注册全局自动导入，两层同名函数会被 unimport 判为重复并保留其中一个（实测保留的是内核），
 * 于是任何裸调用都会静默丢掉响应式依赖。内核下沉一层后只有本模块的名字进入该命名空间。
 */

/** 拼音匹配模块就绪标志（模块级单例，跟随内核单向推进） */
export const pinyinMatcherReady = shallowRef(core.isPinyinMatcherReady());

// 模块级订阅，生命周期与本模块一致（应用级单例），无需取消订阅
core.onPinyinMatcherReady(() => {
  pinyinMatcherReady.value = true;
});

/**
 * 生成列表行 v-memo 使用的拼音就绪依赖。
 *
 * 空白搜索时不读取 pinyinMatcherReady，使拼音模块空闲预热完成不会令整张列表
 * 无效重渲染；存在有效关键词时继续依赖就绪状态，预热完成后仍会即时补齐拼音命中。
 */
export function getPinyinRenderMemoDependency(keyword: string): boolean {
  if (!keyword.trim()) return false;
  return pinyinMatcherReady.value;
}

/**
 * 查询关键词在目标文本中的命中区间（子串优先，未命中降级拼音）
 *
 * @param text 目标文本（用户名/标签/备注/网址等）
 * @param keyword 搜索关键词
 * @returns [起始, 结束] 闭区间；未命中返回 null
 */
export function findMatchRange(text: string, keyword: string): [number, number] | null {
  // 传入 ref 值即为「在求值期间读取响应式依赖」，预热完成后本 computed 会自动重算
  return core.findMatchRange(text, keyword, pinyinMatcherReady.value);
}

/**
 * 判断任一字段是否命中关键词（过滤用）
 * @param fields 候选字段集（空字段自动跳过）
 * @param keyword 搜索关键词
 * @returns 任一字段命中返回 true
 */
export function matchesKeyword(fields: string[], keyword: string): boolean {
  return core.matchesKeyword(fields, keyword, pinyinMatcherReady.value);
}

/**
 * 将文本按关键词命中区间切分为高亮分段（渲染用）
 *
 * @param text 目标文本（空文本返回空数组）
 * @param keyword 搜索关键词
 * @returns 分段数组（保持原文顺序拼接后等于原文）
 */
export function highlightSegments(text: string, keyword: string): HighlightSegment[] {
  return core.highlightSegments(text, keyword, pinyinMatcherReady.value);
}
