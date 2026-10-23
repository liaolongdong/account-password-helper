/**
 * 身份库「检索首个命中滚进视野」的接线守卫
 *
 * 行为本体由 `tests/utils/identitySearchReveal.test.ts` 覆盖（落点判据是纯函数）。这里钉的是
 * **组件有没有把它接上、以及接的那条时序对不对**——这类缺陷的表现不是报错，而是「深链进来
 * 仍然停在旧偏移」和「每次改词视野都被迟到的上一轮拽走」，只在慢盘 / 手快时偶发，
 * 真机也很难稳定复现，因此用源码判据钉成可断言的事实。
 *
 * 沿用本仓既有做法（`dialogAsyncLandingWiring`、`identityCardTitleToggleWiring`）：
 * 每条判据都配负向对照——删掉守卫那一行后同一正则必须不再命中，否则判据会写得过宽而
 * 静默变成永真断言，那比没有守卫更糟。
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';
import { readSource } from '../helpers/architectureScan';

const FILE = 'components/options/IdentityVaultDialog.vue';
const SOURCE = readSource(FILE);

/**
 * 断言判据「仍有牙齿」：源文本命中，删掉守卫那一行后不再命中
 *
 * @param label 判据名（失败时定位用）
 * @param pattern 判据正则
 * @param removeLine 被删除的守卫行（须为该源中的唯一子串）
 */
function expectGuard(label: string, pattern: RegExp, removeLine: string): void {
  expect(pattern.test(SOURCE), `${label}：判据未命中，接线已漂移或写法变了`).toBe(true);
  expect(SOURCE.includes(removeLine), `${label}：负向对照找不到守卫行，判据可能已是永真`).toBe(true);
  const mutated = SOURCE.replace(removeLine, '');
  expect(mutated.includes(removeLine), `${label}：守卫行不唯一，负向对照失真`).toBe(false);
  expect(pattern.test(mutated), `${label}：删掉守卫后仍然命中，判据没有牙齿`).toBe(false);
}

interface AstNode {
  type: number;
  tag?: string;
  name?: string;
  arg?: { content?: string } | null;
  value?: { content?: string } | null;
  props?: AstNode[];
  children?: AstNode[];
}

const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 6;

function templateRoot(): AstNode {
  const { descriptor, errors } = parse(SOURCE, { filename: FILE });
  expect(errors).toEqual([]);
  const root = descriptor.template?.ast as unknown as AstNode | undefined;
  if (!root) throw new Error('模板 AST 缺失：滚动容器的 ref 接线无从核对');
  return root;
}

function staticClass(node: AstNode): string[] {
  const attr = (node.props ?? []).find(item => item.type === NODE_ATTRIBUTE && item.name === 'class');
  return (attr?.value?.content ?? '').split(/\s+/).filter(Boolean);
}

function staticAttr(node: AstNode, name: string): string | undefined {
  return (node.props ?? []).find(item => item.type === NODE_ATTRIBUTE && item.name === name)?.value?.content;
}

/** 深度优先取第一个带指定静态类名的元素 */
function findByClass(cls: string): AstNode {
  let hit: AstNode | undefined;
  const walk = (node: AstNode): void => {
    if (!hit && node.type === NODE_ELEMENT && staticClass(node).includes(cls)) hit = node;
    for (const child of node.children ?? []) walk(child);
  };
  walk(templateRoot());
  if (!hit) throw new Error(`模板里找不到 .${cls}：这一层结构被改名或删除了`);
  return hit;
}

describe('滚动容器与落点来源', () => {
  it('`.identity-list` 挂了 ref，逐帧重试才有可判定的作用域', () => {
    expect(staticAttr(findByClass('identity-list'), 'ref')).toBe('listRef');
  });

  it('落点取自 `searchReveal`，不在组件里就地手搓选择器', () => {
    expectGuard(
      '落点走共享判据',
      /findSearchRevealTarget\(listRef\.value\)/,
      'const target = findSearchRevealTarget(listRef.value);',
    );
    expect(SOURCE).toContain("from '@/utils/identity/searchReveal'");
  });
});

describe('触发时机与门禁', () => {
  it('检索词一变就定位（深链预填与手打共用同一条 watcher）', () => {
    expectGuard('关键词接线', /watch\(keyword, revealFirstMatch\);/, 'watch(keyword, revealFirstMatch);');
  });

  it('弹窗未开 / 空词 / 零命中一律不动视野', () => {
    expectGuard(
      '三扇门前置',
      /if \(!props\.modelValue \|\| keyword\.value\.trim\(\) === '' \|\| filteredRows\.value\.length === 0\) return;/,
      "if (!props.modelValue || keyword.value.trim() === '' || filteredRows.value.length === 0) return;",
    );
  });

  it('深链打开时等条目与排序档位都落定再定位', () => {
    expectGuard(
      '打开路径等落定',
      /Promise\.all\(\[load\(\), restoreSortMode\(\)\]\)\.then\(revealFirstMatch\)/,
      'void Promise.all([load(), restoreSortMode()]).then(revealFirstMatch);',
    );
  });
});

describe('时序与减弱动效', () => {
  it('两次定位之间用代际断开旧的逐帧链', () => {
    expectGuard(
      '代际作废',
      /if \(generation !== revealGeneration\) return;/,
      'if (generation !== revealGeneration) return;',
    );
  });

  it('滚动行为经统一判据取，不写死 smooth', () => {
    expectGuard(
      '减弱动效接线',
      /scrollIntoView\(\{ behavior: scrollBehavior\(\), block: 'center' \}\)/,
      "target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });",
    );
    expect(SOURCE).not.toMatch(/behavior:\s*['"]smooth['"]/);
  });

  it('逐帧上限存在且写死延时的老写法没有回来', () => {
    expectGuard(
      '逐帧上限',
      /if \(\+\+frame < MAX_FRAMES\) requestAnimationFrame\(locate\);/,
      'if (++frame < MAX_FRAMES) requestAnimationFrame(locate);',
    );
    expect(SOURCE).not.toMatch(/setTimeout\([\s\S]{0,40}scrollIntoView/);
  });
});
