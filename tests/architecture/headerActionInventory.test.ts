/**
 * 管理页头部的「入口 ↔ 接线」双向清单守卫
 *
 * HeaderBar 的三个下拉把 23 条动作分派给 `entrypoints/options/App.vue` 的两条 switch
 * 与本组件的 `handleHelpCommand`。这层契约是**字符串对字符串**：把 `command="clipboard"`
 * 改名、或把 `case 'clipboard':` 删掉，两边都不报错——ESLint 看不出、`tsc --noEmit` 看不见
 * 模板里的字面量、单测不点按钮，用户得到的是一颗点了没反应的按钮。2026-10-22 头部信息架构
 * 调整（「快捷键」移入「帮助」、「个人信息库」升为一级按钮、两个下拉重新分组）正是这种
 * 改动的集中发作期，故在此钉死四件事：
 *
 * 1. **正向无漏接**：菜单里出现的每个 command，都必须在对应的 handler 里恰好有一个 case；
 * 2. **反向无死分支**：handler 里的每个 case，都必须在菜单里真有对应项
 *    （漏了这一半，重排时会留下「点不到的 case」，它看着像还有用）；
 * 3. **帮助下拉三段齐**：命令 → 本组件 emit → App.vue 的 kebab-case 监听，缺一整条链就断；
 * 4. **不跨菜单重复**：同一个 command 只属于一个下拉，否则两条 switch 分支会互相遮蔽。
 * 5. **命令面板是头部的镜像**：`data` / `security` / `help` 三个分组必须与对应下拉
 *    **同序同集**（`security` 首位额外前置头部第一行的「立即锁定」）。面板是头部的可搜索副本，
 *    出现第二套分类时，用户按头部顺序记住的位置在面板里全都对不上。
 * 6. **图标同源**：面板每条命令的 `icon` 必须等于头部同名项那颗（按可见标签键连接）。
 *    图标是认路用的形状，头部认下的形状在面板里指向别处，比没有图标更糟；而分叉是静默的——
 *    少配一条会被 `CommandAction['icon']` 必填挡成编译错误，配错一条则只有这条判据读得出。
 *
 * 判据全部带变异自证：每根判据都构造一次「故意改坏」的源码并要求被读出来，
 * 免得写成恒真断言（数字写死、正则错但恰好匹配）而静默失效。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const HEADER_BAR = 'components/options/HeaderBar.vue';
const APP = 'entrypoints/options/App.vue';

/** 一个下拉：模板里的定位锚 + 它在 App.vue 里对应的 handler 函数名 */
interface MenuSpec {
  name: string;
  /** 该下拉 `@command` 绑定的表达式片段，用来框定取数范围 */
  anchor: string;
  /** App.vue 中承接其 command 的函数名 */
  handler: string;
}

const MENUS: MenuSpec[] = [
  { name: '数据管理', anchor: "$emit('dataCommand', cmd)", handler: 'handleDataCommand' },
  { name: '安全设置', anchor: "$emit('settingsCommand', cmd)", handler: 'handleSettingsCommand' },
];

/** 取某个下拉的源码片段：从它的 `@command` 绑定到最近的 `</el-dropdown-menu>` */
function menuBlock(header: string, menu: MenuSpec): string {
  const start = header.indexOf(menu.anchor);
  if (start === -1) throw new Error(`${menu.name}：找不到 @command 锚点 \`${menu.anchor}\``);
  const end = header.indexOf('</el-dropdown-menu>', start);
  if (end === -1) throw new Error(`${menu.name}：锚点之后没有 \`</el-dropdown-menu>\``);
  return header.slice(start, end);
}

/** 下拉里的 command 字面量集合（顺序即菜单顺序）
 *
 * 必须用负向后视排掉 `@command="handleHelpCommand"` 那颗绑定本身：它长得和菜单项的
 * `command="x"` 一模一样，混进集合会让「菜单项 ↔ 分派表」的比对凭空多出一项。
 */
function menuCommands(header: string, menu: MenuSpec): string[] {
  return [...menuBlock(header, menu).matchAll(/(?<!@)command="([A-Za-z][A-Za-z0-9]*)"/g)].map(m => m[1]!);
}

/** 取 App.vue 里某个 handler 的函数体（到与之配对的收尾 `};` 为止） */
function handlerBody(app: string, handler: string): string {
  const start = app.indexOf(`const ${handler} = (command: string) => {`);
  if (start === -1) throw new Error(`找不到 ${handler} 的声明`);
  const end = app.indexOf('\n};', start);
  if (end === -1) throw new Error(`${handler} 的函数体没有收尾`);
  return app.slice(start, end);
}

/** handler 里的 case 标签（重复出现即被数出来，供「恰好一个」判定） */
function handlerCases(app: string, handler: string): string[] {
  return [...handlerBody(app, handler).matchAll(/case '([A-Za-z][A-Za-z0-9]*)':/g)].map(m => m[1]!);
}

/** 取 App.vue 命令面板清单里的 `{ id, group }` 序对（顺序即面板内的展示顺序） */
function palettePairs(app: string): { id: string; group: string }[] {
  const start = app.indexOf('const buildPaletteActions = (');
  if (start === -1) throw new Error('找不到 buildPaletteActions');
  const slice = app.slice(start, app.indexOf('\n];', start));
  return [...slice.matchAll(/id:\s*'([A-Za-z]\w*)',\s*\n\s*group:\s*'(\w+)'/g)].map(m => ({
    id: m[1]!,
    group: m[2]!,
  }));
}

/** 取某个分组在面板里的 id 顺序 */
function paletteGroup(app: string, group: string): string[] {
  return palettePairs(app)
    .filter(pair => pair.group === group)
    .map(pair => pair.id);
}

/**
 * 头部里「可见标签键 → 图标名」
 *
 * 一颗图标属于哪个标签，按「`:icon="X"` 之后最近的那句 `{{ t('KEY') }}`」判定：头部两种载体
 * （一级 `el-button` 与下拉里的 `el-dropdown-item`）都是这个形状，用标签键做连接键就能一次
 * 覆盖两边，不必为 5 颗一级按钮另写一张对照表——那张表会成为第三份真源。
 */
function headerIconByLabel(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of header.matchAll(/:icon="([A-Za-z]\w*)"[\s\S]{0,220}?\{\{\s*t\('([^']+)'\)\s*\}\}/g)) {
    if (!map.has(m[2]!)) map.set(m[2]!, m[1]!);
  }
  return map;
}

/** 面板清单里的「id → 标签键 + 图标名」，形状与清单逐行绑定，漂了就取不到数 */
function paletteIconRows(app: string): { id: string; labelKey: string; icon: string }[] {
  const start = app.indexOf('const buildPaletteActions = (');
  if (start === -1) throw new Error('找不到 buildPaletteActions 的带类型声明');
  const slice = app.slice(start, app.indexOf('\n];', start));
  return [
    ...slice.matchAll(
      /id:\s*'([A-Za-z]\w*)',\s*\n\s*group:\s*'\w+',\s*\n\s*label:\s*t\('([^']+)'\),\s*\n\s*icon:\s*([A-Za-z]\w*),/g,
    ),
  ].map(m => ({ id: m[1]!, labelKey: m[2]!, icon: m[3]! }));
}

/** 「帮助」下拉的分派表：命令 → 本组件透出的事件名 */
function helpDispatch(header: string): Map<string, string> {
  const start = header.indexOf('const handleHelpCommand = (command: string): void => {');
  if (start === -1) throw new Error('找不到 handleHelpCommand');
  const end = header.indexOf('\n};', start);
  const body = header.slice(start, end);
  const map = new Map<string, string>();
  for (const match of body.matchAll(/case '([A-Za-z][A-Za-z0-9]*)':\s*emit\('([A-Za-z][A-Za-z0-9]*)'\)/g)) {
    map.set(match[1]!, match[2]!);
  }
  return map;
}

/** 驼峰事件名 → 模板里的 kebab-case 监听属性 */
const toKebab = (name: string): string => `@${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;

const headerSource = readSource(HEADER_BAR);
const appSource = readSource(APP);

describe('管理页头部的入口与接线清单', () => {
  it('取数本身有效：两个下拉各有一批 command，两条 handler 各有一批 case', () => {
    for (const menu of MENUS) {
      const commands = menuCommands(headerSource, menu);
      const cases = handlerCases(appSource, menu.handler);
      // 空跑防护：锚点或函数名一旦被改名，上面的取数会抛；这里再确认取到的是成批的真实项
      expect(commands.length, `${menu.name}：菜单项取数为 0，判据会静默空跑`).toBeGreaterThanOrEqual(8);
      expect(cases.length, `${menu.handler}：case 取数为 0，判据会静默空跑`).toBeGreaterThanOrEqual(8);
      expect(new Set(commands).size, `${menu.name}：菜单内出现重复 command`).toBe(commands.length);
    }
  });

  it.each(MENUS.map(menu => [`${menu.name} → ${menu.handler}`, menu] as const))(
    '%s 双向一致：每个 command 恰好一个 case，每个 case 都真有菜单项',
    (_label, menu) => {
      const commands = menuCommands(headerSource, menu);
      const cases = handlerCases(appSource, menu.handler);
      for (const command of commands) {
        const hits = cases.filter(item => item === command);
        expect(hits, `菜单项 \`${command}\` 在 ${menu.handler} 里接不住（点了没反应）`).toHaveLength(1);
      }
      for (const item of cases) {
        expect(commands, `${menu.handler} 里的 \`${item}\` 已成死分支（菜单里没有这一项）`).toContain(item);
      }
      expect(new Set(cases).size, `${menu.handler}：同一个 command 写了两个 case`).toBe(cases.length);
    },
  );

  it('command 不跨菜单重复，也不与「帮助」里的命令撞名', () => {
    const all = MENUS.flatMap(menu => menuCommands(headerSource, menu));
    const help = [...helpDispatch(headerSource).keys()];
    for (const command of help) {
      expect(all, `\`${command}\` 同时挂在两个地方，分派会互相遮蔽`).not.toContain(command);
    }
    expect(new Set(all).size, '两个下拉之间存在重复 command').toBe(all.length);
  });

  it('「帮助」四项三段齐全：菜单项 → emit → App.vue 监听', () => {
    const dispatch = helpDispatch(headerSource);
    const commands = menuCommands(headerSource, {
      name: '帮助',
      anchor: '@command="handleHelpCommand"',
      handler: '',
    });
    expect(commands.sort(), '帮助下拉的菜单项数与分派表不一致').toEqual([...dispatch.keys()].sort());

    for (const [command, event] of dispatch) {
      // 事件必须在 defineEmits 里有一位，否则模板点得动但事件不透出
      expect(headerSource, `emits 未声明 \`${event}\``).toMatch(new RegExp(`${event}:\\s*\\[\\s*\\]`));
      expect(appSource, `App.vue 没接 \`${event}\`，点「${command}」不会有任何反应`).toContain(toKebab(event));
    }
  });

  it('命令面板的三个分组与对应下拉同序同集（面板是头部的镜像，不是第二套分类）', () => {
    const helpMenu = { name: '帮助', anchor: '@command="handleHelpCommand"', handler: '' };

    expect(paletteGroup(appSource, 'data'), 'data 组必须逐字跟着「数据管理」下拉的顺序').toEqual(
      menuCommands(headerSource, MENUS[0]!),
    );
    expect(paletteGroup(appSource, 'help'), 'help 组必须逐字跟着「帮助」下拉的顺序').toEqual(
      menuCommands(headerSource, helpMenu),
    );
    // 安全设置下拉没有「立即锁定」（它在头部第一行），面板把它放在该组首位
    expect(paletteGroup(appSource, 'security'), 'security 组顺序与「安全设置」下拉不一致').toEqual([
      'lockNow',
      ...menuCommands(headerSource, MENUS[1]!),
    ]);
    // 个人信息库已升为一级按钮，因此它属于 entry 组，不该再留在 data 组里
    expect(paletteGroup(appSource, 'entry')).toContain('identityVault');
    expect(paletteGroup(appSource, 'data')).not.toContain('identityVault');

    // 牙齿：把「数据管理」下拉里相邻两项真的调换顺序，镜像判据必须立刻读出来
    const dataBlock = menuBlock(headerSource, MENUS[0]!);
    const literals = [...dataBlock.matchAll(/(?<!@)command="([A-Za-z0-9]+)"/g)].map(m => m[0]);
    const swappedBlock = dataBlock
      .replace(literals[0]!, '@@A@@')
      .replace(literals[1]!, literals[0]!)
      .replace('@@A@@', literals[1]!);
    const swappedHeader = headerSource.replace(dataBlock, swappedBlock);
    const swappedCommands = menuCommands(swappedHeader, MENUS[0]!);
    expect(swappedCommands[0], '变异没生效，这条自证是空的').not.toBe(menuCommands(headerSource, MENUS[0]!)[0]);
    expect(swappedCommands, '下拉顺序变了而面板没跟着变，判据却仍然绿 —— 说明它比的是集合不是顺序').not.toEqual(
      paletteGroup(appSource, 'data'),
    );
  });

  it('面板每条图标都取自头部同名项（图标同源，不构成第二套视觉语言）', () => {
    const rows = paletteIconRows(appSource);
    const icons = headerIconByLabel(headerSource);

    // 空跑防护：图标行取数必须与清单条数一一对上，否则「每条都比了」是句假话
    expect(rows.length, '图标取数与清单条数不一致，判据会静默空跑').toBe(palettePairs(appSource).length);
    expect(icons.size, '头部图标取数为 0，比对会整体静默放行').toBeGreaterThanOrEqual(rows.length);

    for (const row of rows) {
      const headerIcon = icons.get(row.labelKey);
      expect(headerIcon, `头部里没找到标签键 \`${row.labelKey}\` 的图标，${row.id} 无从比对`).toBeTruthy();
      expect(row.icon, `${row.id} 的图标与头部同名项不一致`).toBe(headerIcon);
    }

    // 牙齿：把「添加密码」的图标改成另一颗真实存在的图标，比对必须读出来
    const mutated = appSource.replace('    icon: Plus,', '    icon: Delete,');
    const mutatedRow = paletteIconRows(mutated).find(row => row.id === 'add');
    expect(mutatedRow?.icon, '变异没生效（清单里找不到「icon: Plus,」这一行）').toBe('Delete');
    expect(icons.get('options.header.addPassword'), '头部「添加密码」本身不是 Plus，比对基准就错了').toBe('Plus');
    expect(mutatedRow!.icon, '面板图标被改成 Delete 之后判据却读不出来 —— 说明它没在比图标').not.toBe(
      icons.get('options.header.addPassword'),
    );
  });

  it('变异自证：删掉一个 case 与多写一个菜单项都必须被读出来', () => {
    // 变异 1：摘掉 handleSettingsCommand 里 clipboard 那一条 case → 正向必须判红
    const droppedCase = appSource.replace(/case 'clipboard':[\s\S]*?break;/, '');
    expect(droppedCase).not.toContain(`case 'clipboard':`);
    expect(
      handlerCases(droppedCase, 'handleSettingsCommand'),
      '删掉 clipboard 的 case 之后正向判据仍然通过',
    ).not.toContain('clipboard');

    // 变异 2：给数据管理菜单凭空加一项 → 反向（无对应 case）必须判红
    const addedCommand = headerSource.replace('command="trash"', 'command="ghostItem"');
    const commands = menuCommands(addedCommand, MENUS[0]!);
    expect(commands, '菜单里多出的 ghostItem 没有被取到').toContain('ghostItem');
    expect(
      handlerCases(appSource, 'handleDataCommand'),
      '菜单里的 ghostItem 在 handler 里没有 case，却没有被识别为漏接',
    ).not.toContain('ghostItem');

    // 变异 3：删掉分派表里 about 那一支 → 「帮助」三段链的判据必须数到 3 项
    const droppedHelp = headerSource.replace(/case 'about':\s*emit\('openAbout'\);/, '');
    expect(helpDispatch(droppedHelp).size, '分派表少一项却没有被读出来').toBe(3);
  });
});
