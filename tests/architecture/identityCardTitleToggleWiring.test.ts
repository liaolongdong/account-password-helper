/**
 * 个人信息库卡片标题区切换折叠的接线守卫
 *
 * 这一层只钉「谁触发、谁不触发」：标题区整行可点，但复选框、拖拽把手和动作行
 * 必须保持原事件语义；标题内拖选文字的守卫必须走可单测的纯函数，不能被内联改写
 * 成一段难以覆盖的分支。真实浏览器里的收起/展开由 e2e 那条用例负责。
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';
import { readSource } from '../helpers/architectureScan';

const FILE = 'components/options/IdentityVaultDialog.vue';
const HELPER = 'utils/identity/titleToggle.ts';
const SOURCE = readSource(FILE);

const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 6;
const NODE_DIRECTIVE = 7;

interface AstNode {
  type: number;
  tag?: string;
  name?: string;
  arg?: { content?: string } | null;
  value?: { content?: string } | null;
  exp?: { content?: string } | null;
  props?: AstNode[];
  children?: AstNode[];
}

function templateRoot(): AstNode {
  const { descriptor, errors } = parse(SOURCE, { filename: FILE });
  expect(errors).toEqual([]);
  const root = descriptor.template?.ast as unknown as AstNode | undefined;
  if (!root) throw new Error('模板 AST 缺失：标题区折叠接线无从核对');
  return root;
}

function staticClass(node: AstNode): string[] {
  const attr = (node.props ?? []).find(item => item.type === NODE_ATTRIBUTE && item.name === 'class');
  return (attr?.value?.content ?? '').split(/\s+/).filter(Boolean);
}

function staticAttr(node: AstNode, name: string): string | undefined {
  return (node.props ?? []).find(item => item.type === NODE_ATTRIBUTE && item.name === name)?.value?.content;
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function findByClass(cls: string): AstNode {
  let hit: AstNode | undefined;
  walk(templateRoot(), node => {
    if (!hit && node.type === NODE_ELEMENT && staticClass(node).includes(cls)) hit = node;
  });
  if (!hit) throw new Error(`模板里找不到 .${cls}：这一层结构被改名或删除了`);
  return hit;
}

function directiveExpr(node: AstNode, name: string, arg?: string): string | undefined {
  return (node.props ?? []).find(
    item => item.type === NODE_DIRECTIVE && item.name === name && (arg === undefined || item.arg?.content === arg),
  )?.exp?.content;
}

function hasDirective(node: AstNode, name: string, arg?: string): boolean {
  return (node.props ?? []).some(
    item => item.type === NODE_DIRECTIVE && item.name === name && (arg === undefined || item.arg?.content === arg),
  );
}

describe('卡片标题区切换折叠的接线', () => {
  it('只有标题区挂 click，header / 复选框 / 动作行都不接管点击', () => {
    const title = findByClass('identity-card__title');
    expect(directiveExpr(title, 'on', 'click')).toBe('handleTitleToggle(entry, $event)');
    // 标题只做指针增强；可聚焦角色会让 Tab 序出现第二个同义控件
    expect(staticAttr(title, 'role')).toBeUndefined();
    expect(staticAttr(title, 'tabindex')).toBeUndefined();

    expect(hasDirective(findByClass('identity-card__header'), 'on', 'click')).toBe(false);
    expect(hasDirective(findByClass('identity-card__check'), 'on', 'click')).toBe(false);
    expect(hasDirective(findByClass('identity-card__actions'), 'on', 'click')).toBe(false);
  });

  it('拖选守卫走纯函数，折叠调用只在标题处理器里', () => {
    expect(SOURCE).toContain("from '@/utils/identity/titleToggle'");
    // 只扫整份源码会被 chevron 那处 `toggleCollapse(entry.id)` 满足；必须收进函数体
    const body = SOURCE.match(/const handleTitleToggle =[\s\S]*?\n\};/)?.[0];
    if (!body) throw new Error('handleTitleToggle 的定义形态变了，守卫落点已失效');
    expect(body).toContain('shouldToggleCollapseFromTitleClick(event.detail, window.getSelection(), title)');
    expect(body.match(/toggleCollapse\(entry\.id\)/g)).toHaveLength(1);

    const helper = readSource(HELPER);
    expect(helper).toContain('const selectionInsideTitle =');
    expect(helper).toContain('title.contains(selection.anchorNode)');
    expect(helper).toContain('return !selectionInsideTitle || detail === 0 || detail === 2;');
  });

  it('折叠按钮把展开态暴露给读屏', () => {
    const slots = (findByClass('identity-card__actions').children ?? []).filter(node => node.type === NODE_ELEMENT);
    expect(slots).toHaveLength(5);
    expect(directiveExpr(slots[0], 'bind', 'aria-expanded')).toBe('!isCollapsed(entry.id)');
  });

  it('标题提供指针暗示，且扫描本身真的取到了节点', () => {
    const style = SOURCE.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).toMatch(/\.identity-card__title\s*\{[^}]*cursor:\s*pointer/);
    expect(findByClass('identity-card__title')).toBeTruthy();
  });
});
