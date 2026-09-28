/**
 * 档位持久化的接线守卫（管理页密码表 / 回收站弹窗两处）
 *
 * 档位是**一个偏好、两个视图**：密码表与回收站弹窗各自持有一份分页状态
 * （`useVaultListPagination` 是 per-instance 的），但 `vault_page_size` 这个键对整页只有一个含义。
 * 这类「共用一份、各自一份状态」的结构最容易在后续改动里悄悄退化成两种故障形状——
 * 只测语义测不出来，故按本仓既有惯例（见 `crossSubdomainTierWiring.test.ts`）做源码扫描：
 *
 * - 读写规则被抄回调用方 → 两处早晚在错误处理与回落口径上分叉（弹窗把非法值写进去、
 *   列表却回落默认，用户下次打开管理页看到的又是另一个档位）；
 * - 弹窗的恢复动作漂到 `loadTrash()` 之后或独立 watcher 里 → 打开弹窗先按旧档位渲染一遍
 *   再整表重排，正好是这条路径想省掉的开销，同时给组件多加一个监听器；
 * - `App.vue` 关闭时的同步被删 → 「在回收站选了 200，回到列表还是 100，刷新才一致」；
 * - 存储层重新 import 页码算法 → 只有 Options 消费的算法被拽进 sidepanel 首屏
 *   `modulepreload` 闭包（实测同一 chunk 由 7847 字节涨到 8183 字节，故当初拆文件）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const MANAGER_SRC = read('composables/usePasswordManagement.ts');
const TRASH_SRC = read('components/options/TrashDialog.vue');
const APP_SRC = read('entrypoints/options/App.vue');
const CONFIG_SRC = read('utils/storage/configManager.ts');

/** 读写档位的唯一入口所在文件（其余运行时代码不得直接触碰存储层的这两个方法） */
const HOOK_SRC = read('composables/useVaultPageSize.ts');

describe('档位持久化接线', () => {
  it('两个分页视图都经 useVaultPageSize，而不是各自实现一遍', () => {
    expect(MANAGER_SRC, '密码表的档位持久化不再走 composable').toMatch(/useVaultPageSize\(\s*pageSize\s*\)/);
    expect(TRASH_SRC, '回收站弹窗的档位持久化不再走 composable').toMatch(/useVaultPageSize\(\s*pageSize\s*\)/);
  });

  it('读写规则只住在一处：调用方不直接触碰存储层的档位方法', () => {
    const DIRECT_CALL = /getVaultPageSize\s*\(|saveVaultPageSize\s*\(/;
    expect(HOOK_SRC, '接线本身必须真的调用存储层，否则下面的"别处不许调用"是空断言').toMatch(DIRECT_CALL);

    const offenders = [
      ['composables/usePasswordManagement.ts', MANAGER_SRC],
      ['components/options/TrashDialog.vue', TRASH_SRC],
      ['entrypoints/options/App.vue', APP_SRC],
    ].filter(([, src]) => DIRECT_CALL.test(src));

    expect(
      offenders.map(([file]) => file),
      '以下位置绕过 useVaultPageSize 直接读写档位，回落与错误处理口径会分叉',
    ).toEqual([]);
  });

  it('回收站弹窗的恢复动作与取数共用同一个「打开」watcher，且恢复在前', () => {
    // `computed(() => props.modelValue)` 是分页复位信号，不是监听器；这里只数 `watch` 源
    const watchers = TRASH_SRC.match(/watch\(\s*\(\)\s*=>\s*props\.modelValue/g) ?? [];
    expect(watchers, '弹窗出现第二个 modelValue 监听器：恢复时机不再受控，且组件多挂了一个 listener').toHaveLength(1);

    const openBranch = TRASH_SRC.match(/visible\s*=>\s*\{\s*if \(visible\) \{([\s\S]*?)\n\s*\}/);
    expect(openBranch, '未找到弹窗打开分支').toBeTruthy();
    // 注释里会复述这两个调用名，逐行剔掉注释再定位语句，否则顺序断言读的是散文
    const statements = openBranch![1]
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    const restoreAt = statements.indexOf('restorePageSize()');
    const loadAt = statements.indexOf('loadTrash()');
    expect(restoreAt, '弹窗打开时不再按落盘档位对齐').toBeGreaterThanOrEqual(0);
    expect(loadAt, '弹窗打开时不再加载数据').toBeGreaterThanOrEqual(0);
    expect(restoreAt, '档位必须在数据落地之前对齐，否则先按旧档位渲染再整表重排').toBeLessThan(loadAt);
  });

  it('关闭回收站时把弹窗里改过的档位带回主表', () => {
    const sync = APP_SRC.match(/watch\(showTrashDialog, \(visible, wasVisible\) => \{([\s\S]*?)\n\}\)/);
    expect(sync, '未找到「弹窗关闭 → 主表跟上档位」的接线').toBeTruthy();
    // 只在 true → false 的那一次同步：打开时弹窗自己会恢复，关闭以外的时机都不该动主表
    expect(sync![0]).toMatch(/if \(!visible && wasVisible\)/);
    expect(sync![0]).toContain('restorePageSizeConfig()');
  });

  it('首屏恢复仍排在 checkAuth 之前（档位决定首帧喂给表格多少行）', () => {
    const mounted = APP_SRC.match(/onMounted\(async \(\) => \{([\s\S]*?)\n\}\)/);
    expect(mounted, '未找到 onMounted 块').toBeTruthy();
    const restoreAt = mounted![1].indexOf('await restorePageSizeConfig()');
    const authAt = mounted![1].indexOf('await checkAuth()');
    expect(restoreAt, '首屏不再恢复档位').toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(restoreAt, '档位必须早于 checkAuth 落定，否则换档要把整表重排付两遍').toBeLessThan(authAt);
  });
});

describe('档位常量的产物闭包边界', () => {
  it('档位常量与白名单来自 vaultPageSize，不是页码算法所在文件', () => {
    expect(CONFIG_SRC).toMatch(/from '@\/utils\/vaultPageSize'/);
    expect(CONFIG_SRC, 'import 页码算法会把它拽进 sidepanel 首屏闭包').not.toMatch(/from '@\/utils\/vaultPagination'/);
  });

  it('档位数字只有一个定义处，消费方一律从 vaultPageSize 取', () => {
    // 组件要的是可选项列表，存储层要的是默认值与白名单判据——两边都不许自己抄一份数字，
    // 否则「弹窗能选到 500、白名单不认」这类分叉会在某次加档位时静默出现。
    expect(read('components/options/VaultPagination.vue')).toMatch(
      /import\s*\{[^}]*PAGE_SIZE_OPTIONS[^}]*\}\s*from\s*'@\/utils\/vaultPageSize'/,
    );
    expect(CONFIG_SRC).toMatch(
      /import\s*\{[^}]*DEFAULT_PAGE_SIZE[^;]*isVaultPageSize[^}]*\}\s*from\s*'@\/utils\/vaultPageSize'/,
    );
    // 50/100/200 散落到别处就会与白名单分叉（白名单在 vaultPageSize.ts 内定义）
    const hardcoded = read('composables/useVaultListPagination.ts').match(/\b(?:50|100|200)\b/g) ?? [];
    expect(hardcoded.length, '分页状态里出现裸档位数字，应与 PAGE_SIZE_OPTIONS / DEFAULT_PAGE_SIZE 对齐').toBe(0);
  });
});
