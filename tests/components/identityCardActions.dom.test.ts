/** @vitest-environment jsdom */

/**
 * 身份卡片动作行的「恒为 5 槽」守卫
 *
 * 缺陷本体：眼睛按钮当初写的是 `v-if="cardHasSecret(entry) && !isCollapsed(entry.id)"`，卡片一折叠它就
 * 整个卸载。`.identity-card__actions` 是右对齐、`gap: 4px` 的 flex 行，槽位数一变，复制 / 编辑 / 删除
 * 三个按钮就整体横移；含机密与不含机密的卡之间同样错开。改法是**常驻渲染 + `.is-void` 占位**。
 *
 * 为什么不直接挂载真实 SFC：`vitest.config.ts` 只注册 `WxtVitest()`，而它返回的插件列表来自
 * `wxt/dist/testing/wxt-vitest-plugin.mjs`，不含 `@wxt-dev/module-vue` 的 SFC 插件——测试里
 * `import '*.vue'` 会直接报「Install @vitejs/plugin-vue」；`@vitejs/plugin-vue` 又只是 wxt 的传递依赖，
 * 补上它要同时改 `vitest.config.ts` 与 `package.json` 两个共享文件。于是把「所有卡型恒 5 槽」这一外部
 * 承诺拆成三段各自可验证、且任一被改动都会红的事实：
 *
 * 1. **模板结构**（真实 SFC 的模板 AST）：动作行恰好 5 个 `el-button`、身份与顺序锁死，且 5 个都不带
 *    `v-if` / `v-show`——槽位数因此与卡型正交，这正是原缺陷的反命题；
 * 2. **占位判定**：把模板里那段 `:class` 表达式**原样求值**（不重写逻辑，免得测试与组件漂移），四种卡型
 *    （有机密 / 无机密 × 展开 / 折叠）的 truth table 只让该挂的挂上 `is-void`；
 * 3. **占位机制**：jsdom 里用真实 `ElButton` + 组件自己 `<style>` 里的规则渲染，断言 `is-void` 的眼睛
 *    计算样式是 `visibility: hidden`、且仍占住第 2 槽（右对齐行的横坐标因此不变）。
 *
 * 抓握把手（`manual` 档）一并钉住位置：在 `el-checkbox` 之前、**不在**动作行里，免得它被算成第 6 槽。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import { parse } from 'vue/compiler-sfc';
import { ElButton } from 'element-plus';
import { readFileSync } from 'fs';
import path from 'path';
import { hasSecretFields } from '@/utils/identity/fields';
import type { IdentityEntry } from '@/utils/identity/types';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = readFileSync(path.join(ROOT, 'components/options/IdentityVaultDialog.vue'), 'utf8');

/**
 * `parse()` 产出的是**未 transform** 的模板 AST：`v-if` / `v-for` 仍是节点上的指令，没被拆成 IF / FOR
 * 包装节点，正好是我们要读的形态。
 *
 * 节点类型常量取自 Vue 的 `NodeTypes`（ELEMENT=1 / ATTRIBUTE=6 / DIRECTIVE=7），只声明本文件用到的字段：
 * AST 节点类型只从 `@vue/compiler-core` 导出，而它不是本项目的直接依赖，为不让测试引入幽灵依赖，这里用
 * 本地结构化类型接手，并在 `templateRoot()` 这一个边界处做一次窄转换。
 */
const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 6;
const NODE_DIRECTIVE = 7;

interface AstNode {
  type: number;
  tag?: string;
  /** 指令名（`if` / `show` / `bind` / `on`）或静态属性名（`class` / `role` …） */
  name?: string;
  /** 指令的参数节点（`:class` 的 `class`、`@click` 的 `click`） */
  arg?: { content?: string } | null;
  /** 静态属性的字面量 */
  value?: { content?: string } | null;
  /** 指令表达式的原文 */
  exp?: { content?: string } | null;
  props?: AstNode[];
  children?: AstNode[];
}

function templateRoot(): AstNode {
  const { descriptor, errors } = parse(SOURCE, { filename: 'IdentityVaultDialog.vue' });
  expect(errors).toEqual([]);
  const root = descriptor.template?.ast as unknown as AstNode | undefined;
  if (!root) {
    throw new Error('模板 AST 缺失：<template> 块不存在或语法不合法，动作行无从核对');
  }
  return root;
}

/** 静态 `class="a b"` 的类名列表（不含 `:class` 动态绑定） */
function staticClass(node: AstNode): string[] {
  const attr = (node.props ?? []).find(p => p.type === NODE_ATTRIBUTE && p.name === 'class');
  return (attr?.value?.content ?? '').split(/\s+/).filter(Boolean);
}

function staticAttr(node: AstNode, name: string): string | undefined {
  const attr = (node.props ?? []).find(p => p.type === NODE_ATTRIBUTE && p.name === name);
  return attr?.value?.content;
}

/** 深度优先找第一个带指定静态类名的元素；找不到就抛，避免断言在「节点已消失」时空跑 */
function findByClass(node: AstNode, cls: string): AstNode {
  const hit = searchClass(node, cls);
  if (!hit) {
    throw new Error(`模板里找不到 .${cls}：这一层结构被改名或删除了`);
  }
  return hit;
}

function searchClass(node: AstNode, cls: string): AstNode | undefined {
  if (node.type === NODE_ELEMENT && staticClass(node).includes(cls)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = searchClass(child, cls);
    if (found) return found;
  }
  return undefined;
}

/** 元素子节点（过滤文本与注释：注释在 AST 里是独立节点，用正则数按钮会被它骗过） */
function elementChildren(node: AstNode): AstNode[] {
  return (node.children ?? []).filter(child => child.type === NODE_ELEMENT);
}

function directiveNames(node: AstNode): string[] {
  return (node.props ?? []).filter(p => p.type === NODE_DIRECTIVE).map(p => p.name ?? '');
}

function directiveExpr(node: AstNode, name: string, arg?: string): string | undefined {
  const found = (node.props ?? []).find(
    p => p.type === NODE_DIRECTIVE && p.name === name && (arg === undefined || p.arg?.content === arg),
  );
  return found?.exp?.content;
}

/** 动作行的槽位节点列表 */
function actionSlots(): AstNode[] {
  return elementChildren(findByClass(templateRoot(), 'identity-card__actions'));
}

/** 眼睛按钮（第 2 槽）；结构一旦被调换，后续断言全部指向错节点，所以单独取 */
function eyeButton(): AstNode {
  const eye = actionSlots()[1];
  if (!eye) {
    throw new Error('动作行没有第 2 个槽位');
  }
  return eye;
}

function entry(id: string, payload: IdentityEntry['payload']): IdentityEntry {
  return { id, encryptedPayload: 'ciphertext', createTime: 1, updateTime: 1, payload };
}

/** 四种卡型：机密 × 折叠态的正交组合（`idNumber` / `cardNo` 是内置机密字段，`name` / `address` 不是） */
const SHAPES = [
  {
    label: '有机密 + 展开',
    entry: entry('secret-open', { pv: 1, category: 'person', name: '张三', idNumber: 'X' }),
    collapsed: false,
  },
  { label: '无机密 + 展开', entry: entry('plain-open', { pv: 1, category: 'person', name: '李四' }), collapsed: false },
  {
    label: '有机密 + 折叠',
    entry: entry('secret-collapsed', { pv: 1, category: 'bank_card', cardNo: 'Y' }),
    collapsed: true,
  },
  {
    label: '无机密 + 折叠',
    entry: entry('plain-collapsed', { pv: 1, category: 'address', address: '某地' }),
    collapsed: true,
  },
];

/**
 * 用模板里 `:class` 表达式的**原文**求值，注入的三个名字就是组件里对应的三个 binding：
 * `cardHasSecret`（组件内是 `hasSecretFields(entry.payload)` 的薄封装）、`isCollapsed`、`entry`。
 * 表达式被改动（比如 `||` 写回 `&&`）这里立刻红，不用肉眼比对 CSS。
 */
function evaluateClass(expr: string, target: IdentityEntry, collapsed: boolean): Record<string, boolean> {
  const compute = new Function('cardHasSecret', 'isCollapsed', 'entry', `return (${expr});`) as (
    cardHasSecret: (value: IdentityEntry) => boolean,
    isCollapsed: (id: string) => boolean,
    entry: IdentityEntry,
  ) => Record<string, boolean>;
  return compute(
    value => hasSecretFields(value.payload),
    id => collapsed && id === target.id,
    target,
  );
}

/** 眼睛的 `:class` 表达式原文 */
function eyeClassExpr(): string {
  const expr = directiveExpr(eyeButton(), 'bind', 'class');
  if (!expr) {
    throw new Error('眼睛按钮不再有 :class 绑定：占位机制被改回了卸载');
  }
  return expr;
}

/** 从组件 `<style>` 块里抠出某条规则的声明体（占位机制测试用的是组件真正发布的那条） */
function styleBody(selector: string): string {
  const block = parse(SOURCE, { filename: 'IdentityVaultDialog.vue' }).descriptor.styles[0]?.content ?? '';
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = block.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  if (!body) {
    throw new Error(`样式里找不到 ${selector} 规则`);
  }
  return body;
}

const apps: App[] = [];

afterEach(() => {
  apps.splice(0).forEach(instance => instance.unmount());
  document.body.innerHTML = '';
});

describe('动作行的模板结构（真实 SFC 模板 AST）', () => {
  it('恒为 5 个按钮，顺序就是 折叠 / 显隐 / 整卡复制 / 编辑 / 删除', () => {
    const slots = actionSlots();
    expect(slots.map(slot => slot.tag)).toEqual(['el-button', 'el-button', 'el-button', 'el-button', 'el-button']);
    // 光数个数不够：把每个槽位的点击目标钉死，防止「删掉一个再补个不相干的」把条数凑回 5
    expect(slots.map(slot => directiveExpr(slot, 'on', 'click'))).toEqual([
      'toggleCollapse(entry.id)',
      'toggleReveal(entry.id)',
      'handleCopyCard(entry)',
      "$emit('edit', entry)",
      'handleDelete(entry)',
    ]);
  });

  it('五个槽位一个都不带条件渲染，槽位数因此与卡型无关', () => {
    // 原缺陷的反命题：眼睛曾是 v-if，折叠即卸载 → 右对齐行整体横移
    expect(actionSlots().map(slot => directiveNames(slot).filter(name => name === 'if' || name === 'show'))).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
  });

  it('把手排在复选框之前、不在动作行里，且只在 manual 档出现', () => {
    const children = elementChildren(findByClass(templateRoot(), 'identity-card__header'));
    const grip = children[0];
    if (!grip) {
      throw new Error('标题行第一个子节点不存在');
    }
    expect(staticClass(grip)).toContain('identity-card__grip');
    expect(children[1]?.tag).toBe('el-checkbox');
    expect(directiveNames(grip)).toContain('if');
    expect(directiveExpr(grip, 'if')).toBe("sortMode === 'manual'");
    // 拖拽 + 无障碍三件套：可聚焦、有角色、有 aria-label，且 draggable 只挂把手不挂整卡
    expect(staticAttr(grip, 'draggable')).toBe('true');
    expect(staticAttr(grip, 'role')).toBe('button');
    expect(staticAttr(grip, 'tabindex')).toBe('0');
    expect(directiveExpr(grip, 'bind', 'aria-label')).toContain('identity.sort.dragHandle');
    expect(() => findByClass(findByClass(templateRoot(), 'identity-card__actions'), 'identity-card__grip')).toThrow();
  });
});

describe('is-void 的四种卡型 truth table', () => {
  it('只有「折叠」或「本卡无机密字段」的眼睛挂 is-void', () => {
    const expr = eyeClassExpr();
    expect(expr).toContain('is-void');
    // 顺序对应 SHAPES：有机密+展开 / 无机密+展开 / 有机密+折叠 / 无机密+折叠
    expect(SHAPES.map(shape => evaluateClass(expr, shape.entry, shape.collapsed)['is-void'] ?? false)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('眼睛的 :class 只产出 is-void 这一个类，不掺其它动态类名', () => {
    expect(Object.keys(evaluateClass(eyeClassExpr(), SHAPES[0].entry, false))).toEqual(['is-void']);
  });
});

describe('占位机制：真实 ElButton + 组件自己的 CSS', () => {
  it('四种卡型都渲染 5 个槽位，is-void 的眼睛 hidden 但仍占第 2 槽', () => {
    const style = document.createElement('style');
    // 只注入组件 `<style>` 里真正存在的两条规则，测的是线上样式而不是测试自带的副本
    style.textContent = [
      `.identity-card__actions {${styleBody('.identity-card__actions')}}`,
      `.identity-card__actions .is-void {${styleBody('.identity-card__actions .is-void')}}`,
    ].join('\n');
    document.head.appendChild(style);
    const expr = eyeClassExpr();

    for (const shape of SHAPES) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const voidEye = evaluateClass(expr, shape.entry, shape.collapsed)['is-void'] === true;
      const instance = createApp({
        render: () =>
          h('div', { class: 'identity-card__actions' }, [
            h(ElButton, { link: true }),
            h(ElButton, { link: true, class: voidEye ? 'is-void' : undefined }),
            h(ElButton, { link: true }),
            h(ElButton, { link: true }),
            h(ElButton, { link: true }),
          ]),
      });
      apps.push(instance);
      instance.mount(host);

      const slots = [...host.querySelectorAll('.identity-card__actions > *')];
      expect(slots, `${shape.label} 卡的动作行槽位数`).toHaveLength(5);
      const eye = slots[1];
      if (!eye) {
        throw new Error(`${shape.label} 卡的眼睛不在第 2 槽`);
      }
      expect(eye.classList.contains('is-void')).toBe(voidEye);
      // 挂 is-void 的卡：计算样式 hidden，但节点仍在原位（右对齐行的横坐标不变）
      expect(getComputedStyle(eye).visibility).toBe(voidEye ? 'hidden' : 'visible');
      expect(eye.parentElement?.children[1]).toBe(eye);
      // 没挂的卡必须真的可见，否则「占位」退化成了「全隐藏」
      if (!voidEye) {
        expect(slots.filter(node => node.classList.contains('is-void'))).toHaveLength(0);
      }
    }

    const body = styleBody('.identity-card__actions .is-void');
    expect(body).toContain('visibility: hidden');
    // 排除掉三种「移出布局」的写法：它们都会让槽位数随卡型变化
    expect(body).not.toMatch(/display|opacity|position/);
  });
});
