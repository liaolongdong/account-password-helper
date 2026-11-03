/**
 * 管理页认证接线的标识符与选项契约守卫
 *
 * 2026-11-01 的白屏事故：`entrypoints/options/App.vue` 把 `onSessionExpired` 接成了
 * `clearPasswordState`，但该名字从未从 `usePasswordManagement()` 的返回解构出来。
 * setup 阶段抛 `ReferenceError: clearPasswordState is not defined`，`<App>` 整体不渲染，
 * 页面只剩骨架屏脚本撤掉容器后的空白（`#app` 里仅 `<!---->`）——连头部标题都不存在。
 *
 * 三道门禁全都看不见它：`pnpm typecheck` 只跑 `tsc`，不解析 `.vue` 的 `<script setup>`
 * （本仓无 vue-tsc，且 vue-tsc 3.3.x 需要 `typescript/lib/tsc`，TS 6 已移除该导出）；
 * `pnpm lint` 的 `no-undef` 一开就是 4681 处环境全局与自动导入报错，无法局部启用；
 * 全量单测不挂载入口组件。唯一抓到它的是 e2e（13 条用例一起红）。
 *
 * 因此这里补两条**使用位**判据，钉住同一个漂移方向：
 * 1. 传给 `useAuthFlow({...})` 的每个裸标识符实参，必须在本文件里真的被声明过；
 * 2. 传入的选项名必须是 `useAuthFlow` 形参类型里真实存在的键（防「接了个没人读的配置」）。
 * 另附扫描面非空与 `clearPasswordState` 的两端对照，避免守卫静默空跑。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const APP = 'entrypoints/options/App.vue';
const AUTH_FLOW = 'composables/useAuthFlow.ts';
const PASSWORD_MANAGEMENT = 'composables/usePasswordManagement.ts';

/** 去掉块注释与行注释，避免注释里的标识符混进判据（与 `savePromptChannel` 同口径） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/**
 * 取 `} = useAuthFlow({` 到其闭合 `});` 之间的选项实参文本
 *
 * 定位失败时必须让断言红，而不是返回空串把守卫变成空跑。
 */
function authFlowOptions(source: string): string {
  const marker = '} = useAuthFlow({';
  const start = source.indexOf(marker);
  expect(start, `${APP} 里找不到 "} = useAuthFlow({"：调用形状变了，本条守卫需要跟着调整`).toBeGreaterThan(-1);
  const bodyStart = start + marker.length;
  const end = source.indexOf('\n});', bodyStart);
  expect(end, `${APP} 的 useAuthFlow 调用没有顶格 }); 结尾：提取口径失配`).toBeGreaterThan(bodyStart);
  return stripComments(source.slice(bodyStart, end));
}

/** 取 `export function useAuthFlow(options: {` 到闭合 `})` 之间的形参类型文本 */
function authFlowOptionKeys(source: string): string[] {
  const marker = 'export function useAuthFlow(options: {';
  const start = source.indexOf(marker);
  expect(start, `${AUTH_FLOW} 里找不到 "export function useAuthFlow(options: {"：签名形状变了`).toBeGreaterThan(-1);
  const bodyStart = start + marker.length;
  const end = source.indexOf('\n})', bodyStart);
  expect(end, `${AUTH_FLOW} 的 options 类型没有顶格 }) 结尾：提取口径失配`).toBeGreaterThan(bodyStart);
  const body = stripComments(source.slice(bodyStart, end));
  return [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\??\s*:/gm)].map(match => match[1]);
}

/** 选项实参里出现的裸标识符实参（`foo,` 简写与 `key: foo` 两种写法） */
function bareIdentifierArgs(optionsText: string): string[] {
  const names: string[] = [];
  for (const line of optionsText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const shorthand = /^([A-Za-z_$][\w$]*),?$/.exec(trimmed);
    if (shorthand) {
      names.push(shorthand[1]);
      continue;
    }
    const assigned = /^[A-Za-z_$][\w$]*:\s*([A-Za-z_$][\w$]*),?$/.exec(trimmed);
    // 箭头函数、字符串、布尔值等字面量不是标识符，交给第 2 条判据管键名
    if (assigned) names.push(assigned[1]);
  }
  return names;
}

/**
 * 该标识符是否在本文件里真的被声明为绑定（解构成员 / import / 顶层声明）
 *
 * 入参必须已经剔掉选项实参块：`onSessionExpired: clearPasswordState` 与解构里的
 * `password: pwd` 在语法上同形，不剔除的话「被使用」会被误判成「被声明」，守卫失去牙齿。
 */
function isDeclared(source: string, name: string): boolean {
  const patterns = [
    // `const { ... } = useXxx()` 的解构成员（含 `origin: alias` 形式的别名）
    new RegExp(`^\\s+(?:[A-Za-z_$][\\w$]*:\\s+)?${name}\\s*,?\\s*$`, 'm'),
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`),
    // import 的本地绑定名：`import { a, b as c } from ...` 里取 `c`
    new RegExp(`import\\s+[^;]*\\b(?:as\\s+)?${name}\\b[^;]*from`, 's'),
    new RegExp(`import\\s+${name}\\s+from`),
  ];
  return patterns.some(pattern => pattern.test(source));
}

describe('管理页认证接线的标识符与选项契约', () => {
  it('扫描面读到了三个被测源文件（守卫不得静默空跑）', () => {
    for (const file of [APP, AUTH_FLOW, PASSWORD_MANAGEMENT]) {
      expect(readSource(file).length, `${file} 读出来是空`).toBeGreaterThan(0);
    }
  });

  it('传给 useAuthFlow 的每个标识符实参都在 App.vue 里声明过', () => {
    const appSource = stripComments(readSource(APP));
    const optionsText = authFlowOptions(appSource);
    const args = bareIdentifierArgs(optionsText);
    // 正向对照：这条判据至少真的看过三个实参，否则是提取失配而不是「接线正确」
    expect(args.length).toBeGreaterThanOrEqual(3);
    // 声明面 = 全文去掉选项实参块，避免「用在哪」被算成「在哪声明」
    const declarationSource = appSource.replace(optionsText, '\n');
    for (const name of args) {
      expect(isDeclared(declarationSource, name), `App.vue 把 ${name} 当值传给 useAuthFlow，但本文件没有声明它`).toBe(
        true,
      );
    }
  });

  it('传入的选项名都是 useAuthFlow 形参里真实存在的键', () => {
    const keys = [...authFlowOptions(stripComments(readSource(APP))).matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map(
      match => match[1],
    );
    const declared = authFlowOptionKeys(readSource(AUTH_FLOW));
    expect(declared.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(declared, `useAuthFlow 的形参类型里没有 ${key}：传进去也没人读`).toContain(key);
    }
  });

  it('onSessionExpired 接的是 clearPasswordState，且它真由 usePasswordManagement 导出', () => {
    const optionsText = authFlowOptions(stripComments(readSource(APP)));
    expect(optionsText).toMatch(/onSessionExpired:\s*clearPasswordState\s*,/);
    const composable = stripComments(readSource(PASSWORD_MANAGEMENT));
    expect(composable, 'usePasswordManagement.ts 没有把 clearPasswordState 放进返回对象：App.vue 解构不到它').toMatch(
      /^\s{4}clearPasswordState,?$/m,
    );
  });
});
