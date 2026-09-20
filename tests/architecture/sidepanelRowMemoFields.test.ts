/**
 * 侧边栏列表行 v-memo 依赖守卫
 *
 * `SidepanelAuthView.vue` 的行组件用 `v-for + v-memo` 跳过重渲染，Vue 编译出的判定是
 * `_cached.key === p.id && 依赖数组逐项全等`——即**同一 id 的旧 vnode 会被复用**，
 * 模板里读到的字段若不在依赖数组中、又没随依赖一起变化，行内容就会停在旧值。
 *
 * 危险点不在「编辑条目」（那条路径一律 bump `updateTime`，而 `updateTime` 在依赖里），
 * 而在「只改元数据且刻意保留原 updateTime」的写入：批量编辑标签保留 updateTime
 * （标签是元数据，不该挤掉「最近更新」排序），收藏/取消收藏同样保留 updateTime。
 * 这类字段一旦出现在行组件里却没进依赖数组，就是一个静默的界面不更新缺陷
 * （历史缺陷：批量改标签后列表仍显示旧标签）。
 *
 * 本守卫做两件事：
 * 1. 从行组件源码里机械抓出所有被读取的条目字段，要求每个字段要么「写入必然 bump
 *    updateTime」，要么已显式出现在 `v-memo` 依赖数组中；
 * 2. 钉住抽取本身非空（避免正则失配让守卫空跑——该文件的前一版测试正是这样失效的）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const VIEW_SRC = readFileSync(path.join(ROOT, 'components/sidepanel/SidepanelAuthView.vue'), 'utf8');
const ROW_SRC = readFileSync(path.join(ROOT, 'components/sidepanel/PasswordListItem.vue'), 'utf8');

/**
 * 写入路径必然同时推高 `updateTime` 的字段
 *
 * 依据：条目编辑与自动保存都走 `passwordCrud.updatePassword` 的敏感字段分支，
 * 该分支固定 `updateTime: updates.updateTime ?? Date.now()`，且前台编辑场景从不回传旧值；
 * 填充路径写 `lastUsedAt` 时同样不传 `updateTime`（默认取当前时间）。
 * 新增「可单独改写而保留 updateTime」的字段时，不要往这里加，而应加进行组件的 memo 依赖。
 */
const ALWAYS_RETIMED_FIELDS = [
  'username',
  'password',
  'url',
  'remark',
  'totp',
  'createTime',
  'updateTime',
  'lastUsedAt',
];

/** 取出列表行 `v-memo` 依赖数组里引用的条目字段 */
const memoFields = (viewSrc: string): string[] => {
  const rowBlock = viewSrc.match(/<PasswordListItem[\s\S]*?\/>/);
  expect(rowBlock, '未找到列表行的 v-for 块（模板结构变化需同步更新本守卫）').toBeTruthy();
  const memo = rowBlock![0].match(/v-memo="\[([\s\S]*?)\]"/);
  expect(memo, '列表行已不再使用 v-memo（若为有意移除，请同步移除本守卫）').toBeTruthy();
  return [...memo![1].matchAll(/password\.([A-Za-z]\w*)/g)].map(m => m[1]);
};

/** 行组件读取的条目字段（模板与脚本一并扫描：脚本里的 computed 同样决定渲染结果） */
const renderedFields = (rowSrc: string): Set<string> =>
  new Set([...rowSrc.matchAll(/password\.([A-Za-z]\w*)/g)].map(m => m[1]));

describe('侧边栏列表行 v-memo 依赖', () => {
  const deps = memoFields(VIEW_SRC);
  const readFields = renderedFields(ROW_SRC);

  it('抽取到非空的依赖数组与字段读取集（防止守卫空跑）', () => {
    expect(deps.length).toBeGreaterThanOrEqual(3);
    expect(readFields.size).toBeGreaterThanOrEqual(5);
  });

  it('每个被读取的字段要么写入必推高 updateTime，要么已进依赖数组', () => {
    const uncovered = [...readFields].filter(field => !ALWAYS_RETIMED_FIELDS.includes(field) && !deps.includes(field));
    expect(uncovered).toEqual([]);
  });

  it('元数据类字段（标签 / 收藏）显式在依赖中', () => {
    // 这两处是「保留 updateTime」的刻意写入，历史上标签漏依赖导致列表停在旧标签
    expect(deps).toContain('tag');
    expect(deps).toContain('favorite');
  });
});
