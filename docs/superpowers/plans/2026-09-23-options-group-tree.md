# Options 管理页树形分组 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Options 管理页左侧新增树形分组导航，条目一对一归属分组，搜索与分组联动（组内 AND 过滤），分组数据贯穿 `.aph`/JSON/Excel/云同步全通道。

**架构：** 邻接表独立存储（`password_groups` 扁平数组，根 `parentCode = '-1'`）+ 虚拟「未分组」叶子。纯函数层 `utils/groupTree.ts` 负责建树/路径/子孙聚合/树搜索/路径建组；存储层 `utils/storage/groupManager.ts` 负责 CRUD；`usePasswordManagement` 在过滤链最前置插入分组过滤并为每行注入 `groupPath`；UI 由 `GroupTreePanel.vue` + 左右分栏承载。`groupId` 归入非敏感元数据，归组不触发解密重加密。

**技术栈：** WXT + Vue 3 `<script setup>` + TypeScript strict + Element Plus（`el-tree` / `el-tree-select`，按需引入）+ Vitest + chrome.storage.local。

**规格：** `docs/superpowers/specs/2026-09-23-options-group-tree-design.md`

**验证命令速查：** `pnpm typecheck` / `pnpm lint` / `pnpm lint:style` / `pnpm test:run -- <file>` / `pnpm build`

---

## 文件结构

**新建：**

| 文件                                                    | 职责                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `utils/groupTree.ts`                                    | 分组树纯函数（建树/路径/子孙/树搜索/路径建组/计数/名称校验），无 IO 无 Vue |
| `utils/storage/groupManager.ts`                         | 分组 CRUD 存储层（读-改-写 `password_groups`）                             |
| `components/options/GroupTreePanel.vue`                 | 左侧分组树面板（树搜索 + 新建 + hover 操作 + 拖拽 + 条目放置目标）         |
| `components/options/GroupDeleteDialog.vue`              | 删除分组确认对话框（仅删分组 / 删分组和数据 / 取消）                       |
| `components/options/BatchGroupDialog.vue`               | 批量「移动到分组」对话框（`el-tree-select`）                               |
| `tests/utils/groupTree.test.ts`                         | `groupTree.ts` 单测                                                        |
| `tests/utils/groupManager.test.ts`                      | `groupManager.ts` 单测                                                     |
| `tests/composables/usePasswordManagement.group.test.ts` | 分组过滤联动单测                                                           |
| `tests/utils/backupExportGroups.test.ts`                | `.aph` v1/v2 分组兼容单测                                                  |
| `tests/utils/excelGroups.test.ts`                       | Excel/CSV/JSON 分组往返单测                                                |
| `tests/utils/cloudSyncSchemaGroups.test.ts`             | 云同步 schema 9 字段单测                                                   |

**修改：**

| 文件                                                             | 改动                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `utils/types.ts`                                                 | 分组常量与类型；`PasswordEntry.groupId`；`PasswordFormModel.groupId`；`UpdatePasswordMetadataData` 加 `groupId` |
| `utils/storageKeys.ts`                                           | `PASSWORD_GROUPS`、`OPTIONS_GROUP_COL_VISIBLE`                                                                  |
| `utils/storage/passwordCrud.ts`                                  | `METADATA_FIELDS` 加 `'groupId'`                                                                                |
| `utils/storage/configManager.ts`                                 | `getOptionsGroupColVisible` / `setOptionsGroupColVisible`                                                       |
| `utils/storage.ts`                                               | 门面展开 `groupManager`                                                                                         |
| `utils/passwordSort.ts`                                          | `compareBySortChain` / `sortByChain` 泛型化                                                                     |
| `composables/usePasswordManagement.ts`                           | 分组状态、分组过滤、`groupPath` 注入、分组 CRUD 编排、批量归组                                                  |
| `entrypoints/options/App.vue`                                    | 左右分栏 + 接入三个新组件                                                                                       |
| `entrypoints/options/styles.css`                                 | `.main-content` flex 布局 + `.content-right`                                                                    |
| `components/options/PasswordTable.vue`                           | 分组列（默认隐藏 + 齿轮开关 + 排序）+ 行拖拽                                                                    |
| `components/options/PasswordFormDialog.vue`                      | 分组 `el-tree-select` 字段                                                                                      |
| `components/options/SearchFilterBar.vue`                         | 选中态「移动到分组」按钮                                                                                        |
| `components/options/ImportDialog.vue`                            | 导入时按路径建组                                                                                                |
| `components/options/BackupImportDialog.vue`                      | `.aph` v2 分组重建                                                                                              |
| `utils/backupExport.ts`                                          | `BackupData` v2（`groups` + `groupId`）                                                                         |
| `utils/excelExport.ts`                                           | CSV/JSON 导出加分组列                                                                                           |
| `utils/excelJson.ts`                                             | JSON 导入解析 `groups`/`groupPath`                                                                              |
| `utils/excelCsv.ts`                                              | CSV 导入解析分组列                                                                                              |
| `utils/excelFormatMap.ts`                                        | `CsvColumnMapping.group` + 各格式映射                                                                           |
| `utils/excel.ts`                                                 | 门面签名透传 groups                                                                                             |
| `utils/cloudSync/schema.ts`                                      | 明文表 9 字段（分组列）                                                                                         |
| `utils/cloudSync/types.ts`                                       | `LocalSyncEntry.groupPath`                                                                                      |
| `utils/i18n/locales/{zh-CN,en}/options.json`                     | `options.group.*`                                                                                               |
| `utils/i18n/locales/{zh-CN,en}/excel.json`                       | `excel.header.group`、`excel.template.exampleGroup`                                                             |
| `docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`     | V1.2 → V1.3（明文表 9 字段）                                                                                    |
| `README.md` / `README.en.md` / `docs/ARCHITECTURE.md` / `.en.md` | 功能说明与架构详解                                                                                              |

---

## 任务 1：类型与存储键基础

**文件：**

- 修改：`utils/types.ts`（`PasswordEntry` 在 14-71 行，`PasswordEntryWithUI` 在 76-79 行，`UpdatePasswordMetadataData` 在 599-612 行，`PasswordFormModel` 在 667-680 行）
- 修改：`utils/storageKeys.ts:41`
- 修改：`utils/storage/passwordCrud.ts:261`

- [ ] **步骤 1：`PasswordEntry` 新增 `groupId`**

在 `utils/types.ts` 的 `order: number;`（第 70 行）之后、接口闭合 `}` 之前插入：

```ts
  /**
   * 所属分组 code（一对一，文件夹式归属）
   *
   * 指向 {@link PasswordGroup.code}；缺失、指向已删除分组或等于 {@link UNGROUPED_CODE}
   * 均视为「未分组」。属非敏感元数据（同 tag/order），归组与拖拽不触发解密-重加密。
   */
  groupId?: string;
```

- [ ] **步骤 2：新增分组类型与常量**

紧跟 `PasswordEntryWithUI` 接口（第 79 行 `}`）之后插入：

```ts
/**
 * 分组树根节点的虚拟 code
 *
 * 不落盘：一级分组的 parentCode 等于本值，运行时由 buildTree 构造根节点。
 * 选中根 = 查看全库（不做分组过滤）。
 */
export const ROOT_GROUP_CODE = '-1';

/**
 * 「未分组」虚拟叶子节点 code
 *
 * 不落盘、不可删除、不可重命名。承载所有无有效 groupId 的条目，
 * 既是存量数据的平滑落地点，也是批量整理的入口。
 */
export const UNGROUPED_CODE = '__ungrouped__';

/**
 * 密码分组（树形，邻接表表示）
 *
 * 扁平数组存储于 chrome.storage.local 的 `password_groups` 键，内存中拼成树。
 * 分组名与层级属非敏感组织维度，不加密；但日志不得记录分组名原文。
 */
export interface PasswordGroup {
  /** 分组唯一标识，由 generateId() 生成 */
  code: string;
  /** 分组名称：同级唯一、≤30 字符、禁纯空白、禁含 `/`（全路径分隔符） */
  name: string;
  /** 父分组 code；一级分组为 {@link ROOT_GROUP_CODE} */
  parentCode: string;
  /** 同级排序序号（升序） */
  order: number;
}

/**
 * 分组树渲染节点（buildTree 产出，供 el-tree 直接消费）
 *
 * `isVirtual` 标记根节点与「未分组」叶子：UI 据此禁用重命名/删除，
 * 并阻止其成为拖拽放置目标。虚拟节点的 name 为空串，文案由 UI 层 i18n 提供。
 */
export interface GroupTreeNode {
  code: string;
  name: string;
  order: number;
  children: GroupTreeNode[];
  /** 是否为虚拟节点（根 / 未分组），虚拟节点不可删改、不可作为拖拽父级 */
  isVirtual?: boolean;
}

/**
 * 带分组全路径的密码条目（Options 表格渲染用）
 *
 * `groupPath` 由 usePasswordManagement 在排序前注入（`/` 拼接，如 `工作/项目A`），
 * 未分组为空串。预计算避免表格每行重复递归上溯，同时让分组列可参与排序链。
 */
export interface PasswordEntryWithGroupPath extends PasswordEntry {
  /** 分组全路径（`/` 拼接）；未分组为空串 */
  groupPath: string;
}
```

- [ ] **步骤 3：`PasswordFormModel` 新增 `groupId`**

将 `PasswordFormModel`（667-680 行）的 `totp: string;` 之后插入：

```ts
/** 所属分组 code；空串或 UNGROUPED_CODE 表示未分组 */
groupId: string;
```

> `PasswordFormPatch = Omit<PasswordFormModel, 'tag'>` 自动包含 `groupId`，无需改动。

- [ ] **步骤 4：`UpdatePasswordMetadataData.updates` 加入 `groupId`**

将第 609-611 行改为：

```ts
  updates: {
    [K in
      | 'favorite'
      | 'favoriteUsedAt'
      | 'lastUsedAt'
      | 'updateTime'
      | 'tag'
      | 'order'
      | 'groupId']?: PasswordEntry[K] | null;
  };
```

- [ ] **步骤 5：`utils/storageKeys.ts` 新增两个键**

在 `OPTIONS_SORT_CHAIN`（第 41 行）之后插入：

```ts
  /** 密码分组树（扁平数组，邻接表表示；非敏感组织维度，不加密） */
  PASSWORD_GROUPS: 'password_groups',
  /** Options 密码表格「分组」列是否可见（用户自定义，默认 false 隐藏） */
  OPTIONS_GROUP_COL_VISIBLE: 'options_group_col_visible',
```

- [ ] **步骤 6：`METADATA_FIELDS` 加入 `groupId`**

将 `utils/storage/passwordCrud.ts` 第 261 行改为：

```ts
export const METADATA_FIELDS = [
  'favorite',
  'favoriteUsedAt',
  'lastUsedAt',
  'updateTime',
  'tag',
  'order',
  'groupId',
] as const;
```

> 该常量是单一事实源：`isMetadataOnlyChange`、`MetadataUpdate`、消息路由白名单均从此派生，改一处即全链路生效。

- [ ] **步骤 7：类型检查**

运行：`pnpm typecheck`
预期：报错集中在 `usePasswordManagement.ts` 的 `EMPTY_PASSWORD_FORM` 与 `passwordForm` 初值（缺 `groupId`），属任务 6 范围。确认 `utils/types.ts`、`utils/storageKeys.ts`、`utils/storage/passwordCrud.ts` 三文件自身无错。

- [ ] **步骤 8：Commit**

```bash
git add utils/types.ts utils/storageKeys.ts utils/storage/passwordCrud.ts
git commit -m "feat(types): 新增分组实体与条目 groupId 字段"
```

---

## 任务 2：`utils/groupTree.ts` 纯函数层

**文件：**

- 创建：`utils/groupTree.ts`
- 测试：`tests/utils/groupTree.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `tests/utils/groupTree.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import {
  buildTree,
  countEntriesByGroup,
  ensureGroupByPath,
  filterGroupsByKeyword,
  getDescendantCodes,
  getGroupPath,
  resolveEntryGroupId,
  validateGroupName,
} from '@/utils/groupTree';

/** 构造分组夹具 */
const g = (
  code: string,
  name: string,
  parentCode: string,
  order = 0,
): PasswordGroup => ({
  code,
  name,
  parentCode,
  order,
});

/**
 * 固定树形：
 * 根(-1)
 * ├── work(工作)
 * │   ├── projA(项目A)
 * │   │   └── fe(前端)
 * │   └── projB(项目B)
 * └── life(生活)
 */
const GROUPS: PasswordGroup[] = [
  g('work', '工作', ROOT_GROUP_CODE, 0),
  g('life', '生活', ROOT_GROUP_CODE, 1),
  g('projA', '项目A', 'work', 0),
  g('projB', '项目B', 'work', 1),
  g('fe', '前端', 'projA', 0),
];

describe('buildTree', () => {
  it('产出单根节点，根下按 order 升序排列一级分组，未分组恒在末尾', () => {
    const tree = buildTree(GROUPS);
    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.code).toBe(ROOT_GROUP_CODE);
    expect(root.isVirtual).toBe(true);
    expect(root.children.map(c => c.code)).toEqual([
      'work',
      'life',
      UNGROUPED_CODE,
    ]);
  });

  it('嵌套层级正确（work → projA → fe）', () => {
    const root = buildTree(GROUPS)[0];
    const work = root.children.find(c => c.code === 'work')!;
    expect(work.children.map(c => c.code)).toEqual(['projA', 'projB']);
    expect(
      work.children.find(c => c.code === 'projA')!.children.map(c => c.code),
    ).toEqual(['fe']);
  });

  it('未分组节点标记为虚拟且无子节点', () => {
    const ungrouped = buildTree(GROUPS)[0].children.find(
      c => c.code === UNGROUPED_CODE,
    )!;
    expect(ungrouped.isVirtual).toBe(true);
    expect(ungrouped.children).toEqual([]);
  });

  it('parentCode 指向不存在分组的孤儿节点挂到根下（不丢数据）', () => {
    const tree = buildTree([g('orphan', '孤儿', 'deleted-parent', 0)]);
    expect(tree[0].children.map(c => c.code)).toContain('orphan');
  });

  it('空分组列表仍产出根 + 未分组', () => {
    expect(buildTree([])[0].children.map(c => c.code)).toEqual([
      UNGROUPED_CODE,
    ]);
  });
});

describe('getGroupPath', () => {
  it('返回 / 拼接的全路径', () => {
    expect(getGroupPath('fe', GROUPS)).toBe('工作/项目A/前端');
  });

  it('一级分组路径即自身名称', () => {
    expect(getGroupPath('life', GROUPS)).toBe('生活');
  });

  it('未分组 / 根 / 无效 code / undefined 均返回空串', () => {
    expect(getGroupPath(UNGROUPED_CODE, GROUPS)).toBe('');
    expect(getGroupPath(ROOT_GROUP_CODE, GROUPS)).toBe('');
    expect(getGroupPath('not-exist', GROUPS)).toBe('');
    expect(getGroupPath(undefined, GROUPS)).toBe('');
  });

  it('父链断裂时只拼可解析的部分（不死循环）', () => {
    expect(getGroupPath('child', [g('child', '子', 'missing-parent', 0)])).toBe(
      '子',
    );
  });

  it('脏数据成环时不死循环', () => {
    const cyclic = [g('a', 'A', 'b', 0), g('b', 'B', 'a', 0)];
    expect(getGroupPath('a', cyclic)).toBeTypeOf('string');
  });
});

describe('getDescendantCodes', () => {
  it('返回本级 + 所有子孙', () => {
    expect([...getDescendantCodes('work', GROUPS)].sort()).toEqual([
      'fe',
      'projA',
      'projB',
      'work',
    ]);
  });

  it('叶子分组只含自身', () => {
    expect([...getDescendantCodes('fe', GROUPS)]).toEqual(['fe']);
  });

  it('未分组只含自身', () => {
    expect([...getDescendantCodes(UNGROUPED_CODE, GROUPS)]).toEqual([
      UNGROUPED_CODE,
    ]);
  });

  it('无效 code 返回空集', () => {
    expect(getDescendantCodes('nope', GROUPS).size).toBe(0);
  });
});

describe('filterGroupsByKeyword', () => {
  it('命中节点连同祖先链一并保留', () => {
    const kept = filterGroupsByKeyword(GROUPS, '前端');
    expect([...kept].sort()).toEqual(
      [ROOT_GROUP_CODE, UNGROUPED_CODE, 'fe', 'projA', 'work'].sort(),
    );
  });

  it('大小写不敏感匹配英文名', () => {
    expect(
      filterGroupsByKeyword([g('a', 'Work', ROOT_GROUP_CODE, 0)], 'work').has(
        'a',
      ),
    ).toBe(true);
  });

  it('关键词为空时保留全部', () => {
    const kept = filterGroupsByKeyword(GROUPS, '');
    for (const group of GROUPS) expect(kept.has(group.code)).toBe(true);
  });

  it('无命中时只保留根与未分组（树不空白）', () => {
    const kept = filterGroupsByKeyword(GROUPS, 'zzz');
    expect(kept.has(ROOT_GROUP_CODE)).toBe(true);
    expect(kept.has(UNGROUPED_CODE)).toBe(true);
    expect(kept.has('work')).toBe(false);
  });
});

describe('resolveEntryGroupId', () => {
  it('有效 groupId 原样返回', () => {
    expect(resolveEntryGroupId('work', GROUPS)).toBe('work');
  });

  it('undefined / 空串 / 已删除分组 均归一到未分组', () => {
    expect(resolveEntryGroupId(undefined, GROUPS)).toBe(UNGROUPED_CODE);
    expect(resolveEntryGroupId('', GROUPS)).toBe(UNGROUPED_CODE);
    expect(resolveEntryGroupId('deleted', GROUPS)).toBe(UNGROUPED_CODE);
  });
});

describe('ensureGroupByPath', () => {
  it('路径全部不存在时逐级创建', () => {
    const { code, created } = ensureGroupByPath('工作/项目A/前端', []);
    expect(created).toHaveLength(3);
    expect(created.map(c => c.name)).toEqual(['工作', '项目A', '前端']);
    expect(created[0].parentCode).toBe(ROOT_GROUP_CODE);
    expect(created[1].parentCode).toBe(created[0].code);
    expect(created[2].parentCode).toBe(created[1].code);
    expect(code).toBe(created[2].code);
  });

  it('同名同级复用，只创建缺失层级', () => {
    const { code, created } = ensureGroupByPath('工作/项目C', GROUPS);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('项目C');
    expect(created[0].parentCode).toBe('work');
    expect(code).toBe(created[0].code);
  });

  it('路径已完整存在时不创建任何分组', () => {
    const { code, created } = ensureGroupByPath('工作/项目A/前端', GROUPS);
    expect(created).toEqual([]);
    expect(code).toBe('fe');
  });

  it('空路径返回未分组且不创建', () => {
    const { code, created } = ensureGroupByPath('', GROUPS);
    expect(code).toBe(UNGROUPED_CODE);
    expect(created).toEqual([]);
  });

  it('忽略路径中的空段与首尾分隔符', () => {
    expect(ensureGroupByPath('/工作//项目A/', GROUPS).created).toEqual([]);
  });

  it('新建分组的 order 取同级末尾', () => {
    // 根下已有 work(order 0)、life(order 1)
    expect(ensureGroupByPath('新分组', GROUPS).created[0].order).toBe(2);
  });

  it('不修改入参数组', () => {
    const before = GROUPS.length;
    ensureGroupByPath('新分组/子', GROUPS);
    expect(GROUPS).toHaveLength(before);
  });
});

describe('countEntriesByGroup', () => {
  const entries = [
    makePasswordEntry({ id: '1', groupId: 'fe' }),
    makePasswordEntry({ id: '2', groupId: 'projB' }),
    makePasswordEntry({ id: '3', groupId: 'work' }),
    makePasswordEntry({ id: '4' }),
    makePasswordEntry({ id: '5', groupId: 'deleted' }),
  ];

  it('叶子分组计自身条目数', () => {
    const counts = countEntriesByGroup(GROUPS, entries);
    expect(counts.get('fe')).toBe(1);
    expect(counts.get('projB')).toBe(1);
  });

  it('父分组聚合子孙条目数', () => {
    const counts = countEntriesByGroup(GROUPS, entries);
    expect(counts.get('work')).toBe(3); // 自身 1 + projB 1 + fe 1
    expect(counts.get('projA')).toBe(1);
  });

  it('根节点计全部条目', () => {
    expect(countEntriesByGroup(GROUPS, entries).get(ROOT_GROUP_CODE)).toBe(5);
  });

  it('无 groupId 与无效 groupId 均计入未分组', () => {
    expect(countEntriesByGroup(GROUPS, entries).get(UNGROUPED_CODE)).toBe(2);
  });

  it('空条目时各分组计数为 0', () => {
    const counts = countEntriesByGroup(GROUPS, []);
    expect(counts.get('work')).toBe(0);
    expect(counts.get(ROOT_GROUP_CODE)).toBe(0);
  });
});

describe('validateGroupName', () => {
  it('纯空白返回 empty', () => {
    expect(validateGroupName('   ', GROUPS)).toBe('empty');
  });

  it('超过 30 字符返回 tooLong', () => {
    expect(validateGroupName('a'.repeat(31), GROUPS)).toBe('tooLong');
  });

  it('含 / 返回 invalidChar', () => {
    expect(validateGroupName('工作/子', GROUPS)).toBe('invalidChar');
  });

  it('同级重名返回 duplicate', () => {
    expect(validateGroupName('项目A', [g('x', '项目A', 'work', 0)])).toBe(
      'duplicate',
    );
  });

  it('不同级同名合法', () => {
    expect(validateGroupName('工作', [g('x', '项目A', 'work', 0)])).toBe(null);
  });

  it('合法名称返回 null', () => {
    expect(validateGroupName('新分组', GROUPS)).toBe(null);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/groupTree.test.ts`
预期：FAIL，报错 `Failed to resolve import "@/utils/groupTree"`

- [ ] **步骤 3：实现 `utils/groupTree.ts`**

```ts
/**
 * 分组树纯函数层
 *
 * 只承载与 Vue 响应式、chrome.storage 无关的树形计算，可独立单测。
 * 邻接表（parentCode）为唯一事实源，本模块不修改入参、不产生副作用。
 *
 * 约定：
 * - 全路径以 `/` 无空格拼接（分组名禁止含 `/`，见 validateGroupName）；
 * - 未分组与无效 code 的路径统一为空串，「未分组」文案由 UI 层 i18n 兜底，
 *   避免纯函数依赖语言包；
 * - 所有沿父链上溯的遍历都记录已访问 code，防御脏数据成环导致死循环。
 */
import type { GroupTreeNode, PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { generateId } from '@/utils/generateId';

/** 全路径分隔符（分组名禁止包含此字符） */
export const GROUP_PATH_SEPARATOR = '/';

/** 分组名最大长度 */
export const MAX_GROUP_NAME_LENGTH = 30;

/**
 * 表格行拖拽归组的 dataTransfer 类型标识
 *
 * 用自定义 MIME 而非 `text/plain`：el-tree 自身的节点拖拽也会写 text/plain，
 * 自定义类型让放置目标能精确区分「拖的是条目」还是「拖的是分组节点」。
 */
export const ENTRY_DRAG_MIME = 'application/x-aph-entry-ids';

/**
 * 扁平分组数组 → 树（含虚拟根与「未分组」叶子）
 *
 * parentCode 指向不存在分组的孤儿节点挂到根下，保证数据不丢失。
 * 同级按 order 升序；「未分组」恒为根的最后一个子节点。
 *
 * @param groups 扁平分组数组
 * @returns 单元素数组，元素为根节点
 */
export function buildTree(groups: readonly PasswordGroup[]): GroupTreeNode[] {
  const nodeByCode = new Map<string, GroupTreeNode>();
  for (const group of groups) {
    nodeByCode.set(group.code, {
      code: group.code,
      name: group.name,
      order: group.order,
      children: [],
    });
  }

  const root: GroupTreeNode = {
    code: ROOT_GROUP_CODE,
    name: '',
    order: 0,
    children: [],
    isVirtual: true,
  };

  for (const group of groups) {
    const node = nodeByCode.get(group.code)!;
    const parent =
      group.parentCode === ROOT_GROUP_CODE
        ? undefined
        : nodeByCode.get(group.parentCode);
    // 父节点缺失（已删除/数据损坏）时挂到根下，避免节点凭空消失
    (parent ?? root).children.push(node);
  }

  const sortNodes = (nodes: GroupTreeNode[]): void => {
    nodes.sort((a, b) => a.order - b.order);
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(root.children);

  root.children.push({
    code: UNGROUPED_CODE,
    name: '',
    order: Number.MAX_SAFE_INTEGER,
    children: [],
    isVirtual: true,
  });
  return [root];
}

/**
 * 取分组全路径（`/` 拼接）
 *
 * @param code 分组 code（可为 undefined）
 * @param groups 扁平分组数组
 * @returns 全路径；未分组、根或无效 code 返回空串
 */
export function getGroupPath(
  code: string | undefined,
  groups: readonly PasswordGroup[],
): string {
  if (!code || code === UNGROUPED_CODE || code === ROOT_GROUP_CODE) return '';
  const byCode = new Map(groups.map(group => [group.code, group]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: PasswordGroup | undefined = byCode.get(code);
  while (current && !visited.has(current.code)) {
    visited.add(current.code);
    segments.unshift(current.name);
    current =
      current.parentCode === ROOT_GROUP_CODE
        ? undefined
        : byCode.get(current.parentCode);
  }
  return segments.join(GROUP_PATH_SEPARATOR);
}

/**
 * 取本级 + 所有子孙分组的 code 集（聚合筛选用）
 *
 * @param code 起始分组 code
 * @param groups 扁平分组数组
 * @returns code 集合；无效 code 返回空集，未分组返回仅含自身的集合
 */
export function getDescendantCodes(
  code: string,
  groups: readonly PasswordGroup[],
): Set<string> {
  const result = new Set<string>();
  if (code === UNGROUPED_CODE) {
    result.add(UNGROUPED_CODE);
    return result;
  }
  if (!groups.some(group => group.code === code)) return result;

  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    const list = childrenByParent.get(group.parentCode);
    if (list) list.push(group.code);
    else childrenByParent.set(group.parentCode, [group.code]);
  }

  const stack = [code];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const child of childrenByParent.get(current) ?? []) stack.push(child);
  }
  return result;
}

/**
 * 树搜索：返回需保留的节点 code 集（命中节点 + 其祖先链）
 *
 * 保留祖先链是为了让 el-tree 过滤后层级依然完整可展开。
 * 关键词为空时保留全部；无命中时仍保留根与未分组，避免树完全空白。
 *
 * @param groups 扁平分组数组
 * @param keyword 搜索关键词（大小写不敏感）
 * @returns 需保留的 code 集（含 ROOT_GROUP_CODE 与 UNGROUPED_CODE）
 */
export function filterGroupsByKeyword(
  groups: readonly PasswordGroup[],
  keyword: string,
): Set<string> {
  const kept = new Set<string>([ROOT_GROUP_CODE, UNGROUPED_CODE]);
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) {
    for (const group of groups) kept.add(group.code);
    return kept;
  }

  const byCode = new Map(groups.map(group => [group.code, group]));
  for (const group of groups) {
    if (!group.name.toLowerCase().includes(trimmed)) continue;
    let current: PasswordGroup | undefined = group;
    const visited = new Set<string>();
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      kept.add(current.code);
      current =
        current.parentCode === ROOT_GROUP_CODE
          ? undefined
          : byCode.get(current.parentCode);
    }
  }
  return kept;
}

/**
 * 归一条目的分组归属
 *
 * 缺失、空串或指向已删除分组的 groupId 一律归到「未分组」，
 * 保证删除分组后条目不会因悬空引用而消失或报错。
 *
 * @param groupId 条目上的 groupId
 * @param groups 扁平分组数组
 * @returns 有效的分组 code 或 UNGROUPED_CODE
 */
export function resolveEntryGroupId(
  groupId: string | undefined,
  groups: readonly PasswordGroup[],
): string {
  if (!groupId || groupId === UNGROUPED_CODE) return UNGROUPED_CODE;
  return groups.some(group => group.code === groupId)
    ? groupId
    : UNGROUPED_CODE;
}

/**
 * 按全路径逐级建组（同名同级复用）
 *
 * 供 Excel/CSV 导入与云同步拉取使用：文件与云端以路径为分组交换格式，
 * 落地时需还原为邻接表。忽略空段与首尾分隔符，空路径归到未分组。
 *
 * @param path 全路径（`/` 拼接）
 * @param groups 现有扁平分组数组（不被修改）
 * @returns 叶子分组 code 与本次新建的分组（调用方负责合并落盘）
 */
export function ensureGroupByPath(
  path: string,
  groups: readonly PasswordGroup[],
): { code: string; created: PasswordGroup[] } {
  const segments = String(path ?? '')
    .split(GROUP_PATH_SEPARATOR)
    .map(segment => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return { code: UNGROUPED_CODE, created: [] };

  const existing: PasswordGroup[] = [...groups];
  const created: PasswordGroup[] = [];
  let parentCode = ROOT_GROUP_CODE;
  let currentCode = ROOT_GROUP_CODE;

  for (const segment of segments) {
    const hit = existing.find(
      group => group.parentCode === parentCode && group.name === segment,
    );
    if (hit) {
      currentCode = hit.code;
      parentCode = hit.code;
      continue;
    }
    const siblings = existing.filter(group => group.parentCode === parentCode);
    const nextOrder =
      siblings.length === 0
        ? 0
        : Math.max(...siblings.map(group => group.order)) + 1;
    const newGroup: PasswordGroup = {
      code: generateId(),
      name: segment.slice(0, MAX_GROUP_NAME_LENGTH),
      parentCode,
      order: nextOrder,
    };
    existing.push(newGroup);
    created.push(newGroup);
    currentCode = newGroup.code;
    parentCode = newGroup.code;
  }

  return { code: currentCode, created };
}

/**
 * 统计每个分组（含子孙聚合）的条目数
 *
 * 根节点计全部条目，未分组计无有效 groupId 的条目。供树节点渲染 `名称 (N)`。
 *
 * @param groups 扁平分组数组
 * @param entries 密码条目（只需 groupId）
 * @returns code → 条目数（含 ROOT_GROUP_CODE 与 UNGROUPED_CODE）
 */
export function countEntriesByGroup(
  groups: readonly PasswordGroup[],
  entries: readonly { groupId?: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group.code, 0);
  counts.set(ROOT_GROUP_CODE, 0);
  counts.set(UNGROUPED_CODE, 0);

  const byCode = new Map(groups.map(group => [group.code, group]));
  for (const entry of entries) {
    counts.set(ROOT_GROUP_CODE, (counts.get(ROOT_GROUP_CODE) ?? 0) + 1);
    const resolved = resolveEntryGroupId(entry.groupId, groups);
    if (resolved === UNGROUPED_CODE) {
      counts.set(UNGROUPED_CODE, (counts.get(UNGROUPED_CODE) ?? 0) + 1);
      continue;
    }
    // 沿父链逐级 +1，实现祖先聚合计数
    let current: PasswordGroup | undefined = byCode.get(resolved);
    const visited = new Set<string>();
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      counts.set(current.code, (counts.get(current.code) ?? 0) + 1);
      current =
        current.parentCode === ROOT_GROUP_CODE
          ? undefined
          : byCode.get(current.parentCode);
    }
  }
  return counts;
}

/**
 * 校验分组名合法性
 *
 * @param name 待校验名称
 * @param siblings 同级已有分组（重命名时应排除自身）
 * @returns 错误标识；合法时返回 null
 */
export function validateGroupName(
  name: string,
  siblings: readonly PasswordGroup[],
): 'empty' | 'tooLong' | 'invalidChar' | 'duplicate' | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) return 'tooLong';
  if (trimmed.includes(GROUP_PATH_SEPARATOR)) return 'invalidChar';
  if (siblings.some(group => group.name === trimmed)) return 'duplicate';
  return null;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/groupTree.test.ts`
预期：PASS（全部用例）

- [ ] **步骤 5：Commit**

```bash
git add utils/groupTree.ts tests/utils/groupTree.test.ts
git commit -m "feat(groupTree): 新增分组树纯函数层（建树/路径/子孙聚合/树搜索/路径建组）"
```

---

## 任务 3：`utils/storage/groupManager.ts` 存储层

**文件：**

- 创建：`utils/storage/groupManager.ts`
- 测试：`tests/utils/groupManager.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `tests/utils/groupManager.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

let localStore: Record<string, unknown>;

const jsonRoundTrip = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as unknown;
const localGet = vi.fn(async (key: string | string[]) => {
  const keys = Array.isArray(key) ? key : [key];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in localStore) out[k] = localStore[k];
  return out;
});
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(items))
    localStore[key] = jsonRoundTrip(value);
});
const localRemove = vi.fn(async (key: string | string[]) => {
  for (const k of Array.isArray(key) ? key : [key]) delete localStore[k];
});

beforeEach(() => {
  localStore = {};
  localGet.mockClear();
  localSet.mockClear();
  localRemove.mockClear();
  vi.stubGlobal('chrome', {
    storage: { local: { get: localGet, set: localSet, remove: localRemove } },
  });
});

afterEach(() => vi.unstubAllGlobals());

import {
  createGroup,
  deleteGroup,
  getAllGroups,
  moveGroup,
  renameGroup,
  reorderGroups,
  saveGroups,
} from '@/utils/storage/groupManager';

const seed = (groups: PasswordGroup[]) => {
  localStore[STORAGE_KEYS.PASSWORD_GROUPS] = jsonRoundTrip(groups);
};
const seedPasswords = (entries: unknown[]) => {
  localStore[STORAGE_KEYS.PASSWORDS] = jsonRoundTrip(entries);
};
const readGroups = () =>
  localStore[STORAGE_KEYS.PASSWORD_GROUPS] as PasswordGroup[];
const readPasswords = () =>
  localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;

describe('getAllGroups', () => {
  it('无键时返回空数组', async () => {
    expect(await getAllGroups()).toEqual([]);
  });

  it('返回已存分组', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    expect(await getAllGroups()).toEqual([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    ]);
  });

  it('非数组脏数据降级为空数组', async () => {
    localStore[STORAGE_KEYS.PASSWORD_GROUPS] = 'corrupted';
    expect(await getAllGroups()).toEqual([]);
  });

  it('过滤掉缺 code/name 的非法项', async () => {
    localStore[STORAGE_KEYS.PASSWORD_GROUPS] = [
      { code: 'a' },
      null,
      { code: 'b', name: 'B' },
    ];
    expect(await getAllGroups()).toEqual([{ code: 'b', name: 'B' }]);
  });
});

describe('createGroup', () => {
  it('在根下创建一级分组，order 取同级末尾', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    const created = await createGroup('B', ROOT_GROUP_CODE);
    expect(created.name).toBe('B');
    expect(created.parentCode).toBe(ROOT_GROUP_CODE);
    expect(created.order).toBe(1);
    expect(readGroups()).toHaveLength(2);
  });

  it('创建子分组挂在指定父级下', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    expect((await createGroup('A1', 'a')).parentCode).toBe('a');
  });

  it('名称自动 trim', async () => {
    seed([]);
    expect((await createGroup('  工作  ', ROOT_GROUP_CODE)).name).toBe('工作');
  });

  it('同级重名抛错', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(createGroup('A', ROOT_GROUP_CODE)).rejects.toThrow(
      'duplicate',
    );
  });

  it('不同级同名允许', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(createGroup('A', 'a')).resolves.toBeDefined();
  });

  it('空名 / 含斜杠 / 超长 分别抛对应错误', async () => {
    seed([]);
    await expect(createGroup('   ', ROOT_GROUP_CODE)).rejects.toThrow('empty');
    await expect(createGroup('a/b', ROOT_GROUP_CODE)).rejects.toThrow(
      'invalidChar',
    );
    await expect(createGroup('a'.repeat(31), ROOT_GROUP_CODE)).rejects.toThrow(
      'tooLong',
    );
  });

  it('不允许在未分组下建子分组', async () => {
    seed([]);
    await expect(createGroup('X', UNGROUPED_CODE)).rejects.toThrow(
      'invalidParent',
    );
  });
});

describe('renameGroup', () => {
  it('重命名成功', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await renameGroup('a', 'A2');
    expect(readGroups()[0].name).toBe('A2');
  });

  it('与其他同级重名抛错', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
    ]);
    await expect(renameGroup('a', 'B')).rejects.toThrow('duplicate');
  });

  it('改回自身当前名称不报重名', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(renameGroup('a', 'A')).resolves.toBeUndefined();
  });

  it('不存在的 code 静默返回', async () => {
    seed([]);
    await expect(renameGroup('nope', 'X')).resolves.toBeUndefined();
  });
});

describe('moveGroup', () => {
  const tree: PasswordGroup[] = [
    { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'b', name: 'B', parentCode: 'a', order: 0 },
    { code: 'c', name: 'C', parentCode: ROOT_GROUP_CODE, order: 1 },
  ];

  it('移动到另一父级下', async () => {
    seed(tree);
    await moveGroup('b', 'c');
    expect(readGroups().find(g => g.code === 'b')!.parentCode).toBe('c');
  });

  it('移动到根变为一级分组', async () => {
    seed(tree);
    await moveGroup('b', ROOT_GROUP_CODE);
    expect(readGroups().find(g => g.code === 'b')!.parentCode).toBe(
      ROOT_GROUP_CODE,
    );
  });

  it('禁止移入自己的子孙或自身（防环）', async () => {
    seed(tree);
    await expect(moveGroup('a', 'b')).rejects.toThrow('cycle');
    await expect(moveGroup('a', 'a')).rejects.toThrow('cycle');
  });

  it('禁止移入未分组', async () => {
    seed(tree);
    await expect(moveGroup('a', UNGROUPED_CODE)).rejects.toThrow(
      'invalidParent',
    );
  });
});

describe('reorderGroups', () => {
  it('按给定顺序重写同级 order', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
      { code: 'c', name: 'C', parentCode: ROOT_GROUP_CODE, order: 2 },
    ]);
    await reorderGroups(ROOT_GROUP_CODE, ['c', 'a', 'b']);
    const groups = readGroups();
    expect(groups.find(g => g.code === 'c')!.order).toBe(0);
    expect(groups.find(g => g.code === 'a')!.order).toBe(1);
    expect(groups.find(g => g.code === 'b')!.order).toBe(2);
  });

  it('不影响其他层级的 order', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'a1', name: 'A1', parentCode: 'a', order: 5 },
    ]);
    await reorderGroups(ROOT_GROUP_CODE, ['a']);
    expect(readGroups().find(g => g.code === 'a1')!.order).toBe(5);
  });
});

describe('deleteGroup', () => {
  const tree: PasswordGroup[] = [
    { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'a1', name: 'A1', parentCode: 'a', order: 0 },
    { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
  ];

  it('toUngrouped：级联删分组，条目 groupId 被清空', async () => {
    seed(tree);
    seedPasswords([
      makePasswordEntry({ id: '1', groupId: 'a' }),
      makePasswordEntry({ id: '2', groupId: 'a1' }),
      makePasswordEntry({ id: '3', groupId: 'b' }),
    ]);
    await deleteGroup('a', 'toUngrouped');

    expect(readGroups().map(g => g.code)).toEqual(['b']);
    const passwords = readPasswords();
    expect('groupId' in passwords[0]).toBe(false);
    expect('groupId' in passwords[1]).toBe(false);
    expect(passwords[2].groupId).toBe('b');
  });

  it('toTrash：级联删分组，条目移入回收站', async () => {
    seed(tree);
    seedPasswords([
      makePasswordEntry({ id: '1', groupId: 'a' }),
      makePasswordEntry({ id: '2', groupId: 'a1' }),
      makePasswordEntry({ id: '3', groupId: 'b' }),
    ]);
    await deleteGroup('a', 'toTrash');

    expect(readGroups().map(g => g.code)).toEqual(['b']);
    expect(readPasswords().map(p => p.id)).toEqual(['3']);
    const trash = localStore[STORAGE_KEYS.TRASH] as Array<
      Record<string, unknown>
    >;
    expect(trash.map(e => e.id).sort()).toEqual(['1', '2']);
    expect(trash[0].deletedAt).toBeTypeOf('number');
  });

  it('空分组直接删除，不触碰条目', async () => {
    seed(tree);
    seedPasswords([makePasswordEntry({ id: '3', groupId: 'b' })]);
    await deleteGroup('b', 'toUngrouped');
    expect(
      readGroups()
        .map(g => g.code)
        .sort(),
    ).toEqual(['a', 'a1']);
    expect(readPasswords()[0].groupId).toBe('b');
  });

  it('拒绝删除虚拟节点', async () => {
    seed(tree);
    await expect(deleteGroup(ROOT_GROUP_CODE, 'toUngrouped')).rejects.toThrow(
      'virtual',
    );
    await expect(deleteGroup(UNGROUPED_CODE, 'toUngrouped')).rejects.toThrow(
      'virtual',
    );
  });

  it('不存在的 code 静默返回', async () => {
    seed(tree);
    await expect(deleteGroup('nope', 'toUngrouped')).resolves.toBeUndefined();
  });
});

describe('saveGroups', () => {
  it('整体写回', async () => {
    const groups: PasswordGroup[] = [
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    ];
    await saveGroups(groups);
    expect(readGroups()).toEqual(groups);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/groupManager.test.ts`
预期：FAIL，报错 `Failed to resolve import "@/utils/storage/groupManager"`

- [ ] **步骤 3：实现 `utils/storage/groupManager.ts`**

```ts
/**
 * 分组存储层（chrome.storage.local 的 `password_groups` 键）
 *
 * 分组是非敏感组织维度（仅名称 + 层级），不加密存储；但日志只记录 code 与数量，
 * 绝不记录分组名原文，避免泄露用户的组织习惯。
 *
 * 所有变更均为读-改-写：chrome.storage 读取异常必须抛出而非降级空数组，
 * 否则会用「仅含新分组」的数组整体覆盖真实分组树（与 passwordCrud 同款不变量）。
 */
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { generateId } from '@/utils/generateId';
import { getDescendantCodes, validateGroupName } from '@/utils/groupTree';
import {
  batchUpdatePasswordMetadata,
  getAllPasswordsRaw,
} from './passwordCrud';
import { moveToTrash } from './trashManager';

/**
 * 读取全量分组
 *
 * 脏数据（非数组 / 缺字段项）降级过滤：分组丢失不致命，条目会归到「未分组」；
 * 但 chrome.storage 读取异常必须抛出，避免后续写回覆盖真实数据。
 */
export async function getAllGroups(): Promise<PasswordGroup[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORD_GROUPS);
    const raw = result[STORAGE_KEYS.PASSWORD_GROUPS];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is PasswordGroup =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as PasswordGroup).code === 'string' &&
        typeof (item as PasswordGroup).name === 'string',
    );
  } catch (error) {
    logger.error('读取分组失败:', error);
    throw error;
  }
}

/** 整体写回分组数组 */
export async function saveGroups(
  groups: readonly PasswordGroup[],
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORD_GROUPS]: [...groups],
    });
  } catch (error) {
    logger.error('保存分组失败:', error);
    throw error;
  }
}

/** 校验挂载点：虚拟「未分组」不可有子节点，也不可被删改 */
function assertNotUngrouped(code: string): void {
  if (code === UNGROUPED_CODE) throw new Error('invalidParent');
}

/** 校验名称，失败时抛出带原因标识的 Error（调用方据此选 i18n 文案） */
function assertValidName(
  name: string,
  siblings: readonly PasswordGroup[],
): void {
  const reason = validateGroupName(name, siblings);
  if (reason) throw new Error(reason);
}

/**
 * 新建分组
 *
 * @param name 分组名（自动 trim，同级唯一、≤30 字符、禁含 `/`）
 * @param parentCode 父分组 code，一级分组传 ROOT_GROUP_CODE
 * @returns 新建的分组
 */
export async function createGroup(
  name: string,
  parentCode: string,
): Promise<PasswordGroup> {
  assertNotUngrouped(parentCode);
  const groups = await getAllGroups();
  const siblings = groups.filter(group => group.parentCode === parentCode);
  const trimmed = String(name ?? '').trim();
  assertValidName(trimmed, siblings);

  const created: PasswordGroup = {
    code: generateId(),
    name: trimmed,
    parentCode,
    order:
      siblings.length === 0
        ? 0
        : Math.max(...siblings.map(group => group.order)) + 1,
  };
  await saveGroups([...groups, created]);
  return created;
}

/**
 * 重命名分组（同级唯一校验排除自身）
 *
 * @param code 目标分组 code
 * @param name 新名称
 */
export async function renameGroup(code: string, name: string): Promise<void> {
  assertNotUngrouped(code);
  const groups = await getAllGroups();
  const target = groups.find(group => group.code === code);
  if (!target) return;

  const trimmed = String(name ?? '').trim();
  const siblings = groups.filter(
    group => group.parentCode === target.parentCode && group.code !== code,
  );
  assertValidName(trimmed, siblings);

  await saveGroups(
    groups.map(group =>
      group.code === code ? { ...group, name: trimmed } : group,
    ),
  );
}

/**
 * 移动分组到新父级（防环：目标不得是自身或自身的子孙）
 *
 * @param code 被移动的分组 code
 * @param newParentCode 新父分组 code，传 ROOT_GROUP_CODE 变为一级分组
 */
export async function moveGroup(
  code: string,
  newParentCode: string,
): Promise<void> {
  assertNotUngrouped(newParentCode);
  const groups = await getAllGroups();
  if (!groups.some(group => group.code === code)) return;
  if (getDescendantCodes(code, groups).has(newParentCode))
    throw new Error('cycle');

  const siblings = groups.filter(
    group => group.parentCode === newParentCode && group.code !== code,
  );
  const nextOrder =
    siblings.length === 0
      ? 0
      : Math.max(...siblings.map(group => group.order)) + 1;
  await saveGroups(
    groups.map(group =>
      group.code === code
        ? { ...group, parentCode: newParentCode, order: nextOrder }
        : group,
    ),
  );
}

/**
 * 同级重排序
 *
 * @param parentCode 共同父级 code
 * @param orderedCodes 该层级新的顺序（未列出的同级分组保持原 order）
 */
export async function reorderGroups(
  parentCode: string,
  orderedCodes: readonly string[],
): Promise<void> {
  const groups = await getAllGroups();
  const orderMap = new Map(orderedCodes.map((code, index) => [code, index]));
  await saveGroups(
    groups.map(group =>
      group.parentCode === parentCode && orderMap.has(group.code)
        ? { ...group, order: orderMap.get(group.code)! }
        : group,
    ),
  );
}

/**
 * 删除分组（级联删除子孙）
 *
 * 两种条目处置语义由调用方（删除确认对话框）裁决：
 * - `toUngrouped`：条目 groupId 清空，归入「未分组」，零数据丢失；
 * - `toTrash`：条目移入回收站（30 天可恢复），非物理删除。
 *
 * @param code 目标分组 code（虚拟节点拒绝删除）
 * @param mode 条目处置方式
 */
export async function deleteGroup(
  code: string,
  mode: 'toUngrouped' | 'toTrash',
): Promise<void> {
  if (code === ROOT_GROUP_CODE || code === UNGROUPED_CODE)
    throw new Error('virtual');
  const groups = await getAllGroups();
  if (!groups.some(group => group.code === code)) return;

  const doomed = getDescendantCodes(code, groups);
  const passwords = await getAllPasswordsRaw();
  const affectedIds = passwords
    .filter(entry => doomed.has(entry.groupId ?? ''))
    .map(entry => entry.id);

  if (mode === 'toTrash') {
    if (affectedIds.length > 0) await moveToTrash(affectedIds);
  } else if (affectedIds.length > 0) {
    // groupId: undefined 经 chrome.storage 的 JSON 序列化后等价删键（与 favoriteUsedAt 同款语义）
    await batchUpdatePasswordMetadata(
      affectedIds.map(id => ({ id, updates: { groupId: undefined } })),
    );
  }

  await saveGroups(groups.filter(group => !doomed.has(group.code)));
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/groupManager.test.ts`
预期：PASS

> `moveToTrash` 内部会读写 `STORAGE_KEYS.PASSWORDS` / `TRASH`，并调用 `deleteHistoryByEntryIds`、`removeReminder`（见 `trashManager.ts:4-5`），这些都走同一个 `chrome.storage.local` 桩，无需额外 mock。

- [ ] **步骤 5：Commit**

```bash
git add utils/storage/groupManager.ts tests/utils/groupManager.test.ts
git commit -m "feat(groupManager): 新增分组 CRUD 存储层与删除二选一语义"
```

---

## 任务 4：分组列显隐配置 + StorageUtils 门面

**文件：**

- 修改：`utils/storage/configManager.ts`（在 `setOptionsPageSize` 之后，约 443 行）
- 修改：`utils/storage.ts`

- [ ] **步骤 1：`configManager.ts` 新增分组列显隐配置**

在 `setOptionsPageSize` 函数（第 443 行 `}`）之后插入：

```ts
// ==================== Options 分组列显隐配置 ====================

/**
 * 获取 Options 表格「分组」列是否可见
 *
 * 默认隐藏：左侧分组树已表达当前归属，聚合视图下才需要路径列区分来源。
 * 属展示偏好，读取异常降级为默认值，不阻断列表加载。
 */
export async function getOptionsGroupColVisible(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(
      STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE,
    );
    return result[STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE] === true;
  } catch (error) {
    logger.error('获取分组列显隐配置失败:', error);
    return false;
  }
}

/**
 * 保存 Options 表格「分组」列显隐偏好
 */
export async function setOptionsGroupColVisible(
  visible: boolean,
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE]: visible,
    });
  } catch (error) {
    logger.error('保存分组列显隐配置失败:', error);
    throw error;
  }
}
```

- [ ] **步骤 2：把 groupManager 接入 StorageUtils 门面**

将 `utils/storage.ts` 的模块注释块补一行 `- groupManager.ts    — 密码分组树 CRUD`，并加入导入与展开：

```ts
import * as groupManager from './storage/groupManager';
```

在 `...autoSaveManager,` 之后插入：

```ts
  // 分组树 CRUD
  ...groupManager,
```

- [ ] **步骤 3：类型检查**

运行：`pnpm typecheck`
预期：`utils/storage.ts`、`utils/storage/configManager.ts`、`utils/storage/groupManager.ts` 无错（`usePasswordManagement` 的 `groupId` 相关错误留待任务 6）

- [ ] **步骤 4：Commit**

```bash
git add utils/storage.ts utils/storage/configManager.ts
git commit -m "feat(storage): 新增分组列显隐配置并接入 StorageUtils 门面"
```

---

## 任务 5：i18n 文案

**文件：**

- 修改：`utils/i18n/locales/zh-CN/options.json`、`utils/i18n/locales/en/options.json`
- 修改：`utils/i18n/locales/zh-CN/excel.json`、`utils/i18n/locales/en/excel.json`
- 测试：`tests/utils/i18nBundles.test.ts`（既有守卫，无需修改）

- [ ] **步骤 1：`zh-CN/options.json` 新增 `options.group.*`**

在 `"options.sort.clear": "清除排序",` 之后插入：

```json
  "options.group.title": "分组",
  "options.group.rootName": "分组",
  "options.group.ungrouped": "未分组",
  "options.group.searchPlaceholder": "搜索分组",
  "options.group.create": "新建分组",
  "options.group.createSub": "新建子分组",
  "options.group.createTitle": "新建分组",
  "options.group.createSubTitle": "在「{parent}」下新建子分组",
  "options.group.rename": "重命名",
  "options.group.renameTitle": "重命名分组",
  "options.group.nameLabel": "分组名称",
  "options.group.delete": "删除分组",
  "options.group.deleteTitle": "删除分组「{name}」？",
  "options.group.deleteMessage": "该分组下有 {entries} 个条目、{subGroups} 个子分组",
  "options.group.deleteEmptyMessage": "该分组为空，删除后不可恢复",
  "options.group.deleteGroupOnly": "仅删除分组",
  "options.group.deleteGroupOnlyTip": "分组及子分组被移除，条目移入「未分组」，数据不会丢失",
  "options.group.deleteGroupAndData": "删除分组和数据",
  "options.group.deleteGroupAndDataTip": "分组及子分组被移除，{entries} 个条目移入回收站（30 天内可恢复）",
  "options.group.deleteSuccess": "分组已删除",
  "options.group.nameRequired": "分组名称不能为空",
  "options.group.nameTooLong": "分组名称不能超过 {max} 个字符",
  "options.group.nameInvalidChar": "分组名称不能包含 /",
  "options.group.nameDuplicate": "同级已存在同名分组",
  "options.group.createSuccess": "分组已创建",
  "options.group.renameSuccess": "分组已重命名",
  "options.group.moveSuccess": "已移动到「{name}」",
  "options.group.moveToGroup": "移动到分组 ({count})",
  "options.group.batchMoveTitle": "移动到分组",
  "options.group.batchMoveTip": "选中的 {count} 个条目将移动到所选分组",
  "options.group.selectPlaceholder": "选择分组",
  "options.group.formLabel": "分组",
  "options.group.column": "分组",
  "options.group.showColumn": "显示分组列",
  "options.group.columnSettings": "列显示",
  "options.group.operationFailed": "分组操作失败",
```

- [ ] **步骤 2：`en/options.json` 新增对应 key（key 集必须完全一致）**

在 `"options.sort.clear"` 之后插入：

```json
  "options.group.title": "Groups",
  "options.group.rootName": "Groups",
  "options.group.ungrouped": "Ungrouped",
  "options.group.searchPlaceholder": "Search groups",
  "options.group.create": "New Group",
  "options.group.createSub": "New Subgroup",
  "options.group.createTitle": "New Group",
  "options.group.createSubTitle": "New subgroup under \"{parent}\"",
  "options.group.rename": "Rename",
  "options.group.renameTitle": "Rename Group",
  "options.group.nameLabel": "Group name",
  "options.group.delete": "Delete Group",
  "options.group.deleteTitle": "Delete group \"{name}\"?",
  "options.group.deleteMessage": "This group contains {entries} entries and {subGroups} subgroups",
  "options.group.deleteEmptyMessage": "This group is empty. Deleting it cannot be undone",
  "options.group.deleteGroupOnly": "Delete group only",
  "options.group.deleteGroupOnlyTip": "The group and its subgroups are removed; entries move to \"Ungrouped\". No data is lost",
  "options.group.deleteGroupAndData": "Delete group and data",
  "options.group.deleteGroupAndDataTip": "The group and its subgroups are removed; {entries} entries move to Trash (recoverable for 30 days)",
  "options.group.deleteSuccess": "Group deleted",
  "options.group.nameRequired": "Group name is required",
  "options.group.nameTooLong": "Group name cannot exceed {max} characters",
  "options.group.nameInvalidChar": "Group name cannot contain /",
  "options.group.nameDuplicate": "A group with this name already exists at the same level",
  "options.group.createSuccess": "Group created",
  "options.group.renameSuccess": "Group renamed",
  "options.group.moveSuccess": "Moved to \"{name}\"",
  "options.group.moveToGroup": "Move to group ({count})",
  "options.group.batchMoveTitle": "Move to Group",
  "options.group.batchMoveTip": "The {count} selected entries will be moved to the chosen group",
  "options.group.selectPlaceholder": "Select a group",
  "options.group.formLabel": "Group",
  "options.group.column": "Group",
  "options.group.showColumn": "Show group column",
  "options.group.columnSettings": "Columns",
  "options.group.operationFailed": "Group operation failed",
```

- [ ] **步骤 3：`excel.json` 新增分组列文案**

`zh-CN/excel.json` 在 `"excel.header.totp"` 之后插入：

```json
  "excel.header.group": "分组",
  "excel.template.exampleGroup": "工作/示例项目",
```

`en/excel.json` 对应位置插入：

```json
  "excel.header.group": "Group",
  "excel.template.exampleGroup": "Work/Example Project",
```

- [ ] **步骤 4：运行 i18n 守卫测试**

运行：`pnpm test:run -- tests/utils/i18nBundles.test.ts`
预期：PASS（zh/en key 集对齐、前缀正确、跨文件无重复）

- [ ] **步骤 5：格式检查**

运行：`pnpm exec prettier --check utils/i18n/locales/zh-CN/options.json utils/i18n/locales/en/options.json utils/i18n/locales/zh-CN/excel.json utils/i18n/locales/en/excel.json`
预期：通过。若报格式问题，对同样文件列表跑 `pnpm exec prettier --write` 后重跑 check。

- [ ] **步骤 6：Commit**

```bash
git add utils/i18n/locales/zh-CN/options.json utils/i18n/locales/en/options.json utils/i18n/locales/zh-CN/excel.json utils/i18n/locales/en/excel.json
git commit -m "feat(i18n): 新增分组功能中英文文案"
```

---

## 任务 6：`usePasswordManagement` 分组状态与过滤联动

**文件：**

- 修改：`utils/passwordSort.ts:89-126`（泛型化）
- 修改：`composables/usePasswordManagement.ts`
- 测试：`tests/composables/usePasswordManagement.group.test.ts`

- [ ] **步骤 1：泛型化 `utils/passwordSort.ts` 的排序链函数**

将 `compareBySortChain`（89-110 行）签名改为泛型（函数体不变）：

```ts
export function compareBySortChain<T extends PasswordEntry>(
  a: T,
  b: T,
  chain: readonly SortCriterion[],
  priorityFn?: (entry: T) => number,
): number {
```

将 `sortByChain`（120-126 行）改为：

```ts
export function sortByChain<T extends PasswordEntry>(
  list: T[],
  chain: readonly SortCriterion[],
  priorityFn?: (entry: T) => number,
): T[] {
  return list.sort((a, b) => compareBySortChain(a, b, chain, priorityFn));
}
```

> 泛型化是行为等价的最小改动：`compareByField` 内部用 `(a as any)[prop]` 动态取值，天然支持 `groupPath` 这类附加字段；泛型只是让返回类型保留 `groupPath`，避免注入的路径被排序函数抹掉。既有调用方（`PasswordEntry[]`）不受影响。

- [ ] **步骤 2：编写失败的测试**

创建 `tests/composables/usePasswordManagement.group.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

let localStore: Record<string, unknown>;
const jsonRoundTrip = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as unknown;

beforeEach(() => {
  localStore = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in localStore) out[k] = localStore[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items))
            localStore[k] = jsonRoundTrip(v);
        }),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(async () => {}),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

import { usePasswordManagement } from '@/composables/usePasswordManagement';

const GROUPS: PasswordGroup[] = [
  { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
  { code: 'projA', name: '项目A', parentCode: 'work', order: 0 },
  { code: 'life', name: '生活', parentCode: ROOT_GROUP_CODE, order: 1 },
];

/** 建立带预置数据的 composable 实例（直接注入 passwords，绕过解密加载） */
async function setup(
  entries: ReturnType<typeof makePasswordEntry>[],
  groups = GROUPS,
) {
  localStore[STORAGE_KEYS.PASSWORD_GROUPS] = jsonRoundTrip(groups);
  const composable = usePasswordManagement({
    validityForm: ref({ validityHours: 24 }),
  });
  composable.passwords.value = entries;
  composable.groups.value = groups;
  await nextTick();
  return composable;
}

describe('分组过滤联动', () => {
  const entries = [
    makePasswordEntry({ id: '1', username: 'a', groupId: 'work' }),
    makePasswordEntry({ id: '2', username: 'b', groupId: 'projA' }),
    makePasswordEntry({ id: '3', username: 'c', groupId: 'life' }),
    makePasswordEntry({ id: '4', username: 'd' }),
  ];

  it('默认选中根节点时不过滤（全库）', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    expect(selectedGroupCode.value).toBe(ROOT_GROUP_CODE);
    expect(filteredPasswords.value.map(p => p.id).sort()).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('选中父分组时聚合本级 + 子孙条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = 'work';
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id).sort()).toEqual(['1', '2']);
  });

  it('选中叶子分组时只含该分组条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = 'projA';
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['2']);
  });

  it('选中未分组时只含无有效 groupId 的条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = UNGROUPED_CODE;
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['4']);
  });

  it('指向已删除分组的条目归入未分组', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup([
      makePasswordEntry({ id: '9', groupId: 'deleted-group' }),
    ]);
    selectedGroupCode.value = UNGROUPED_CODE;
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['9']);
  });

  it('切换分组时清空选中并回到第 1 页', async () => {
    const { selectedGroupCode, selectedIds, currentPage } =
      await setup(entries);
    selectedIds.value = ['1', '2'];
    currentPage.value = 3;
    selectedGroupCode.value = 'life';
    await nextTick();
    expect(selectedIds.value).toEqual([]);
    expect(currentPage.value).toBe(1);
  });
});

describe('groupPath 注入', () => {
  it('每行注入 / 拼接的全路径，未分组为空串', async () => {
    const { filteredPasswords } = await setup([
      makePasswordEntry({ id: '1', groupId: 'projA' }),
      makePasswordEntry({ id: '2', groupId: 'life' }),
      makePasswordEntry({ id: '3' }),
    ]);
    const byId = Object.fromEntries(
      filteredPasswords.value.map(p => [p.id, p.groupPath]),
    );
    expect(byId['1']).toBe('工作/项目A');
    expect(byId['2']).toBe('生活');
    expect(byId['3']).toBe('');
  });

  it('pagedPasswords 携带 groupPath', async () => {
    const { pagedPasswords } = await setup([
      makePasswordEntry({ id: '1', groupId: 'work' }),
    ]);
    expect(pagedPasswords.value[0].groupPath).toBe('工作');
  });
});

describe('分组树派生数据', () => {
  it('groupTree 含虚拟根与未分组', async () => {
    const { groupTree } = await setup([]);
    expect(groupTree.value).toHaveLength(1);
    expect(groupTree.value[0].code).toBe(ROOT_GROUP_CODE);
    expect(groupTree.value[0].children.map(c => c.code)).toEqual([
      'work',
      'life',
      UNGROUPED_CODE,
    ]);
  });

  it('groupEntryCounts 聚合子孙计数', async () => {
    const { groupEntryCounts } = await setup([
      makePasswordEntry({ id: '1', groupId: 'projA' }),
      makePasswordEntry({ id: '2', groupId: 'work' }),
      makePasswordEntry({ id: '3' }),
    ]);
    expect(groupEntryCounts.value.get('work')).toBe(2);
    expect(groupEntryCounts.value.get('projA')).toBe(1);
    expect(groupEntryCounts.value.get(UNGROUPED_CODE)).toBe(1);
    expect(groupEntryCounts.value.get(ROOT_GROUP_CODE)).toBe(3);
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`pnpm test:run -- tests/composables/usePasswordManagement.group.test.ts`
预期：FAIL，报错 `selectedGroupCode` / `groups` / `groupTree` / `groupEntryCounts` 未从 composable 返回

- [ ] **步骤 4：加入分组状态与派生 computed**

在 `composables/usePasswordManagement.ts` 顶部导入区，把第 3 行的类型导入改为：

```ts
import type {
  PasswordEntry,
  PasswordEntryWithGroupPath,
  PasswordEntryWithUI,
  PasswordFormModel,
  PasswordGroup,
} from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
```

在第 19 行 `createPasswordFormRules` 导入之后加入：

```ts
import {
  buildTree,
  countEntriesByGroup,
  getDescendantCodes,
  getGroupPath,
  MAX_GROUP_NAME_LENGTH,
  resolveEntryGroupId,
} from '@/utils/groupTree';
```

在 `const filterUrls = ref<string[]>([]);`（第 83 行）之后插入：

```ts
/**
 * 分组树（扁平数组，邻接表）
 *
 * 与 passwords 同源加载：loadPasswords 时一并读取，保证列表过滤与树渲染一致。
 */
const groups = ref<PasswordGroup[]>([]);

/** 当前选中的分组 code（默认根节点 = 全库，不做分组过滤） */
const selectedGroupCode = ref<string>(ROOT_GROUP_CODE);

/** 表格「分组」列是否可见（默认隐藏，用户偏好持久化） */
const groupColVisible = ref(false);

/** 读取分组列显隐偏好（fire-and-forget，失败保持默认隐藏） */
void StorageUtils.getOptionsGroupColVisible().then(visible => {
  groupColVisible.value = visible;
});

/** 分组树渲染节点（含虚拟根与未分组叶子） */
const groupTree = computed(() => buildTree(groups.value));

/** 各分组（含子孙聚合）的条目数，供树节点渲染计数 */
const groupEntryCounts = computed(() =>
  countEntriesByGroup(groups.value, passwords.value),
);

/**
 * 当前选中分组的可见 code 集
 *
 * 根节点返回 null 表示「不过滤」，避免为全库场景构造无用的大 Set。
 */
const visibleGroupCodes = computed<Set<string> | null>(() => {
  if (selectedGroupCode.value === ROOT_GROUP_CODE) return null;
  if (selectedGroupCode.value === UNGROUPED_CODE)
    return new Set([UNGROUPED_CODE]);
  return getDescendantCodes(selectedGroupCode.value, groups.value);
});

/** 判定条目是否落在当前选中分组范围内 */
const matchesGroupScope = (entry: Pick<PasswordEntry, 'groupId'>): boolean => {
  const codes = visibleGroupCodes.value;
  if (!codes) return true;
  return codes.has(resolveEntryGroupId(entry.groupId, groups.value));
};
```

- [ ] **步骤 5：分组过滤前置 + `groupPath` 注入**

将 `searchFilteredPasswords`（113-127 行）与 `filteredPasswords`（129-142 行）整体替换为：

```ts
/**
 * 命中分组范围 + 关键词搜索 + 收藏过滤的条目（筛选下拉候选的基准集）
 *
 * 分组过滤置于最前：先由左侧树缩小范围，关键词再在范围内过滤（组内搜索语义）。
 * 不含标签/网址筛选自身：下拉候选应反映「当前语境下可选项」，
 * 若叠加筛选自身会导致选中一个选项后其余候选被互相挤掉。
 */
const searchFilteredPasswords = computed<PasswordEntryWithGroupPath[]>(() => {
  // 分组过滤与 groupPath 注入合并为一次遍历：路径计算需递归上溯，
  // 合并可避免对同一批条目做两趟 O(N) 扫描
  const scoped: PasswordEntryWithGroupPath[] = [];
  for (const entry of passwords.value) {
    if (!matchesGroupScope(entry)) continue;
    scoped.push({
      ...entry,
      groupPath: getGroupPath(entry.groupId, groups.value),
    });
  }

  let result = scoped;

  if (debouncedSearchKeyword.value) {
    const keyword = debouncedSearchKeyword.value;
    // 智能匹配：子串（大小写不敏感）优先，拼音模块预热后自动补齐全拼/首字母命中
    result = result.filter(p =>
      matchesKeyword([p.username, p.tag, p.remark, p.url], keyword),
    );
  }

  if (favoriteOnly.value) {
    result = result.filter(p => p.favorite);
  }

  return result;
});

const filteredPasswords = computed<PasswordEntryWithGroupPath[]>(() => {
  let result: PasswordEntryWithGroupPath[] = searchFilteredPasswords.value;

  if (filterTags.value.length > 0) {
    result = result.filter(p =>
      parseTags(p.tag).some(tag => filterTags.value.includes(tag)),
    );
  }

  if (filterUrls.value.length > 0) {
    result = result.filter(p =>
      filterUrls.value.includes(normalizeToHostname(p.url || '')),
    );
  }

  // 始终按当前排序链排序（替代 el-table 客户端排序）；
  // groupPath 已在上方注入，故分组列可作为排序字段参与链式比较
  return sortByChain([...result], sortChain.value);
});
```

- [ ] **步骤 6：`pagedPasswords` 类型跟随**

将 `pagedPasswords`（167-173 行）改为：

```ts
/** 当前页条目（表格实际渲染的数据源）；页码越界时按最后一页取值，避免空白页 */
const pagedPasswords = computed<PasswordEntryWithGroupPath[]>(() => {
  const all = filteredPasswords.value;
  const maxPage = Math.max(1, Math.ceil(all.length / pageSize.value));
  const page = Math.min(currentPage.value, maxPage);
  const start = (page - 1) * pageSize.value;
  return all.slice(start, start + pageSize.value);
});
```

- [ ] **步骤 7：把 `selectedGroupCode` 加入两个 watch**

将第 190-192 行的 watch 改为：

```ts
watch(
  [
    debouncedSearchKeyword,
    favoriteOnly,
    filterTags,
    filterUrls,
    sortChain,
    selectedGroupCode,
  ],
  () => {
    currentPage.value = 1;
  },
);
```

将第 244-247 行的 `watch(favoriteOnly, ...)` 改为：

```ts
/** 过滤条件变化时清空选中状态（结果集语义已变，避免批量操作误伤不可见条目） */
watch([favoriteOnly, selectedGroupCode], () => {
  selectedIds.value = [];
});
```

- [ ] **步骤 8：`loadPasswords` 并行加载分组**

将 `loadPasswords`（463-491 行）中 `passwords.value = await StorageUtils.getAllPasswords();` 一行替换为：

```ts
// 分组与条目并行加载：分组过滤依赖两者同时就绪，串行会拉长首屏
const [entries, groupList] = await Promise.all([
  StorageUtils.getAllPasswords(),
  StorageUtils.getAllGroups().catch((error: unknown) => {
    // 分组读取失败不致命：降级为空树，条目全部归入「未分组」
    logger.error('加载分组失败，降级为未分组:', error);
    return [] as PasswordGroup[];
  }),
]);
passwords.value = entries;
groups.value = groupList;
```

- [ ] **步骤 9：表单初值与保存路径带上 `groupId`**

将 `EMPTY_PASSWORD_FORM`（第 29 行）改为：

```ts
const EMPTY_PASSWORD_FORM = {
  username: '',
  password: '',
  url: '',
  tag: '',
  remark: '',
  totp: '',
  groupId: '',
} as const;
```

将 `passwordForm` 初值（91-98 行）改为：

```ts
const passwordForm = ref<PasswordFormModel>({
  username: '',
  password: '',
  url: '',
  tag: '',
  remark: '',
  totp: '',
  groupId: '',
});
```

将 `openPasswordDialog`（574-579 行）改为：

```ts
const openPasswordDialog = (prefillUrl = '') => {
  isEditingPassword.value = false;
  editingPasswordId.value = '';
  // 新增条目默认归入当前选中分组：选中根或未分组时留空（= 未分组）
  const presetGroupId =
    selectedGroupCode.value === ROOT_GROUP_CODE ||
    selectedGroupCode.value === UNGROUPED_CODE
      ? ''
      : selectedGroupCode.value;
  passwordForm.value = {
    ...EMPTY_PASSWORD_FORM,
    url: prefillUrl,
    groupId: presetGroupId,
  };
  showPasswordDialog.value = true;
};
```

将 `editPassword`（582-594 行）的 `passwordForm.value` 赋值补一行：

```ts
      groupId: password.groupId ?? '',
```

将 `handlePasswordFormSave` 编辑分支的 `updatedFields`（645-653 行）补一行（放在 `totp` 之后）：

```ts
          groupId: passwordForm.value.groupId || undefined,
```

将新增分支的 `StorageUtils.savePassword({...})` 入参（668-677 行）补同一行：

```ts
            groupId: passwordForm.value.groupId || undefined,
```

- [ ] **步骤 10：`copyPassword` 副本继承分组**

将 `copyPassword` 的 `newPasswordEntry`（699-708 行）补一行（放在 `totp` 之后）：

```ts
        groupId: password.groupId,
```

- [ ] **步骤 11：新增分组 CRUD 编排方法**

在 `removeDuplicates` 函数结束（第 1062 行 `};`）之后插入：

```ts
// ==================== 分组管理编排 ====================

/** 重新加载分组树（CRUD 后调用，保持树与计数同步） */
const reloadGroups = async () => {
  try {
    groups.value = await StorageUtils.getAllGroups();
  } catch (error) {
    logger.error('重新加载分组失败:', error);
    ElMessage.error(t('options.group.operationFailed'));
  }
};

/**
 * 把分组操作的错误标识翻译为用户可读提示
 *
 * groupManager 抛出的是稳定英文标识（duplicate/tooLong/...），
 * 在此集中映射到 i18n 文案，避免存储层依赖语言包。
 */
const reportGroupError = (error: unknown) => {
  const reason = error instanceof Error ? error.message : '';
  if (reason === 'duplicate') {
    ElMessage.error(t('options.group.nameDuplicate'));
  } else if (reason === 'tooLong') {
    ElMessage.error(
      t('options.group.nameTooLong', { max: MAX_GROUP_NAME_LENGTH }),
    );
  } else if (reason === 'empty') {
    ElMessage.error(t('options.group.nameRequired'));
  } else if (reason === 'invalidChar') {
    ElMessage.error(t('options.group.nameInvalidChar'));
  } else {
    logger.error('分组操作失败:', error);
    ElMessage.error(t('options.group.operationFailed'));
  }
};

/**
 * 新建分组
 * @param name 分组名
 * @param parentCode 父分组 code（一级分组传 ROOT_GROUP_CODE）
 */
const createGroup = async (name: string, parentCode: string) => {
  try {
    await runLocalOperation(async () => {
      await StorageUtils.createGroup(name, parentCode);
    });
    await reloadGroups();
    ElMessage.success(t('options.group.createSuccess'));
  } catch (error) {
    reportGroupError(error);
  }
};

/**
 * 重命名分组
 * @param code 目标分组 code
 * @param name 新名称
 */
const renameGroup = async (code: string, name: string) => {
  try {
    await runLocalOperation(async () => {
      await StorageUtils.renameGroup(code, name);
    });
    await reloadGroups();
    ElMessage.success(t('options.group.renameSuccess'));
  } catch (error) {
    reportGroupError(error);
  }
};

/**
 * 删除分组（条目处置由确认对话框裁决）
 * @param code 目标分组 code
 * @param mode 'toUngrouped' 条目移入未分组 / 'toTrash' 条目进回收站
 */
const deleteGroup = async (code: string, mode: 'toUngrouped' | 'toTrash') => {
  try {
    // 被删范围若包含当前选中分组，先回退到根，避免右侧列表停留在不存在的范围
    const selectedWillVanish = getDescendantCodes(code, groups.value).has(
      selectedGroupCode.value,
    );
    await runLocalOperation(async () => {
      await StorageUtils.deleteGroup(code, mode);
    });
    if (selectedWillVanish) selectedGroupCode.value = ROOT_GROUP_CODE;
    await reloadGroups();
    await loadPasswords();
    ElMessage.success(t('options.group.deleteSuccess'));
  } catch (error) {
    reportGroupError(error);
  }
};

/**
 * 移动分组到新父级（树内拖拽）
 * @param code 被移动分组 code
 * @param newParentCode 新父级 code
 */
const moveGroup = async (code: string, newParentCode: string) => {
  try {
    await runLocalOperation(async () => {
      await StorageUtils.moveGroup(code, newParentCode);
    });
  } catch (error) {
    reportGroupError(error);
  } finally {
    // 失败也要重载：el-tree 已就地改动节点位置，需以存储为准回滚视图
    await reloadGroups();
  }
};

/**
 * 同级重排序（树内拖拽）
 * @param parentCode 共同父级
 * @param orderedCodes 新顺序
 */
const reorderGroups = async (parentCode: string, orderedCodes: string[]) => {
  try {
    await runLocalOperation(async () => {
      await StorageUtils.reorderGroups(parentCode, orderedCodes);
    });
  } catch (error) {
    reportGroupError(error);
  } finally {
    await reloadGroups();
  }
};

/**
 * 批量归组（表格行拖拽 / 批量移动对话框共用）
 *
 * 走元数据轻量路径（groupId 已在 METADATA_FIELDS 白名单内），不触发解密重加密；
 * 保留原 updateTime，归组不干扰「最近更新」排序。
 *
 * @param entryIds 目标条目 ID 列表
 * @param targetCode 目标分组 code；UNGROUPED_CODE 表示移出分组
 */
const moveEntriesToGroup = async (entryIds: string[], targetCode: string) => {
  if (entryIds.length === 0) return;
  const nextGroupId = targetCode === UNGROUPED_CODE ? undefined : targetCode;
  try {
    await runLocalOperation(async () => {
      await StorageUtils.batchUpdatePasswordMetadata(
        entryIds.map(id => {
          const entry = passwords.value.find(p => p.id === id);
          return {
            id,
            updates: { groupId: nextGroupId, updateTime: entry?.updateTime },
          };
        }),
      );
    });
    // 就地更新：filteredPasswords computed 自动重算分组过滤与路径
    for (const id of entryIds) {
      const entry = passwords.value.find(p => p.id === id);
      if (entry) entry.groupId = nextGroupId;
    }
    const targetName = nextGroupId
      ? (getGroupPath(nextGroupId, groups.value).split('/').pop() ?? '')
      : t('options.group.ungrouped');
    ElMessage.success(t('options.group.moveSuccess', { name: targetName }));
  } catch (error) {
    logger.error('批量归组失败:', error);
    ElMessage.error(t('options.group.operationFailed'));
  }
};

/**
 * 切换「分组」列显隐并持久化偏好
 * @param visible 是否显示
 */
const setGroupColVisible = (visible: boolean) => {
  groupColVisible.value = visible;
  void StorageUtils.setOptionsGroupColVisible(visible).catch(error => {
    logger.error('保存分组列显隐偏好失败:', error);
  });
};
```

- [ ] **步骤 12：导出新增状态与方法**

在 `return { ... }` 的「状态」区（`filterUrls,` 之后）加入：

```ts
    groups,
    groupTree,
    groupEntryCounts,
    selectedGroupCode,
    groupColVisible,
```

在「方法」区（`removeDuplicates,` 之后）加入：

```ts
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    reorderGroups,
    moveEntriesToGroup,
    reloadGroups,
    setGroupColVisible,
```

- [ ] **步骤 13：运行测试验证通过**

运行：`pnpm test:run -- tests/composables/usePasswordManagement.group.test.ts`
预期：PASS

- [ ] **步骤 14：跑既有测试确认无回归**

运行：`pnpm test:run -- tests/composables/ tests/utils/passwordSort.test.ts`
预期：PASS

> 若 `usePasswordManagement.form.test.ts` 因 `passwordForm` 新增 `groupId` 而断言失败，按「新增字段」修正断言（补 `groupId: ''`），不得删除或跳过用例。

- [ ] **步骤 15：Commit**

```bash
git add utils/passwordSort.ts composables/usePasswordManagement.ts tests/composables/usePasswordManagement.group.test.ts
git commit -m "feat(options): 分组过滤联动与 groupPath 注入"
```

---

## 任务 7：`GroupTreePanel.vue` 左侧分组树

**文件：**

- 创建：`components/options/GroupTreePanel.vue`

- [ ] **步骤 1：创建组件**

```vue
<template>
  <aside class="group-panel">
    <div class="group-panel__header">
      <el-input
        v-model="keyword"
        class="group-panel__search"
        :placeholder="t('options.group.searchPlaceholder')"
        :prefix-icon="Search"
        size="small"
        clearable
      />
      <el-tooltip
        :content="t('options.group.create')"
        placement="top"
        :show-after="400"
      >
        <el-button
          :icon="Plus"
          size="small"
          circle
          :aria-label="t('options.group.create')"
          @click="promptCreate(ROOT_GROUP_CODE)"
        />
      </el-tooltip>
    </div>

    <el-tree
      ref="treeRef"
      class="group-panel__tree"
      :data="treeData"
      :props="TREE_PROPS"
      node-key="code"
      :expand-on-click-node="false"
      default-expand-all
      highlight-current
      :current-node-key="selectedGroupCode"
      draggable
      :allow-drop="allowDrop"
      :allow-drag="allowDrag"
      :filter-node-method="filterNode"
      @node-click="handleNodeClick"
      @node-drop="handleNodeDrop"
    >
      <template #default="{ data }">
        <!--
          节点内容同时作为「表格行拖入归组」的放置目标：
          原生 dragover/drop 挂在节点根元素上，与 el-tree 自身的节点拖拽
          （dataTransfer 无 ENTRY_DRAG_MIME）通过 hasEntryPayload 区分，互不干扰。
        -->
        <span
          class="group-node"
          :class="{ 'is-drop-target': dropTargetCode === data.code }"
          @dragover="handleEntryDragOver($event, data.code)"
          @dragleave="handleEntryDragLeave(data.code)"
          @drop="handleEntryDrop($event, data.code)"
        >
          <span class="group-node__label">{{ nodeLabel(data) }}</span>
          <span class="group-node__count"
            >({{ entryCounts.get(data.code) ?? 0 }})</span
          >
          <span
            v-if="!data.isVirtual"
            class="group-node__actions"
          >
            <el-button
              :icon="Plus"
              link
              size="small"
              :title="t('options.group.createSub')"
              :aria-label="t('options.group.createSub')"
              @click.stop="promptCreate(data.code)"
            />
            <el-button
              :icon="Edit"
              link
              size="small"
              :title="t('options.group.rename')"
              :aria-label="t('options.group.rename')"
              @click.stop="promptRename(data)"
            />
            <el-button
              :icon="Delete"
              link
              size="small"
              :title="t('options.group.delete')"
              :aria-label="t('options.group.delete')"
              @click.stop="$emit('requestDelete', data.code)"
            />
          </span>
        </span>
      </template>
    </el-tree>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import type { GroupTreeNode } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import {
  ENTRY_DRAG_MIME,
  filterGroupsByKeyword,
  MAX_GROUP_NAME_LENGTH,
} from '@/utils/groupTree';
import { useI18n } from '@/utils/i18n';

/**
 * 左侧分组树面板
 *
 * 职责：分组名搜索（纯 UI 过滤，不影响右侧列表）、树渲染与计数、分组 CRUD 入口、
 * 树内拖拽移动/排序、作为表格行拖入的归组放置目标。
 * 分组数据的读写全部由父级（App.vue → usePasswordManagement）编排，
 * 本组件只负责渲染与向上发事件，保持无状态。
 */
const props = defineProps<{
  /** 分组树渲染节点（含虚拟根与未分组叶子） */
  treeData: GroupTreeNode[];
  /** 各分组（含子孙聚合）条目数 */
  entryCounts: Map<string, number>;
  /** 当前选中分组 code */
  selectedGroupCode: string;
}>();

const emit = defineEmits<{
  /** 选中分组（驱动右侧列表过滤） */
  select: [code: string];
  /** 请求新建分组 */
  create: [name: string, parentCode: string];
  /** 请求重命名分组 */
  rename: [code: string, name: string];
  /** 请求删除分组（由父级弹确认对话框裁决条目处置） */
  requestDelete: [code: string];
  /** 树内拖拽移动分组 */
  move: [code: string, newParentCode: string];
  /** 树内同级拖拽排序 */
  reorder: [parentCode: string, orderedCodes: string[]];
  /** 表格行拖入归组 */
  dropEntries: [entryIds: string[], targetCode: string];
}>();

const { t } = useI18n();

/** el-tree 字段映射 */
const TREE_PROPS = { label: 'name', children: 'children' } as const;

/** el-tree 节点实例的最小结构（仅声明本组件用到的字段） */
interface TreeNodeInstance {
  data: GroupTreeNode;
  parent?: TreeNodeInstance;
  childNodes: TreeNodeInstance[];
}

const treeRef = ref<{
  filter: (value: string) => void;
  store: { nodesMap: Record<string, TreeNodeInstance> };
}>();
/** 分组名搜索关键词（组件内部状态，纯 UI 过滤） */
const keyword = ref('');
/** 当前作为条目放置目标高亮的节点 code */
const dropTargetCode = ref<string | null>(null);

/**
 * 把树节点摊平为 { code, name, parentCode } 供纯函数消费
 *
 * 复用 groupTree 的过滤/校验逻辑而非在组件内重写，保证与单测口径一致。
 */
const flatNodes = computed(() => {
  const flat: Array<{ code: string; name: string; parentCode: string }> = [];
  const walk = (list: readonly GroupTreeNode[], parentCode: string) => {
    for (const node of list) {
      flat.push({ code: node.code, name: node.name, parentCode });
      walk(node.children, node.code);
    }
  };
  walk(props.treeData, ROOT_GROUP_CODE);
  return flat;
});

/** 树搜索：命中节点 + 祖先链保留，保证层级完整可展开 */
const visibleCodes = computed(() =>
  filterGroupsByKeyword(flatNodes.value, keyword.value),
);

/** 虚拟节点显示 i18n 文案（buildTree 中 name 为空串，纯函数不依赖语言包） */
const nodeLabel = (data: GroupTreeNode): string => {
  if (data.code === ROOT_GROUP_CODE) return t('options.group.rootName');
  if (data.code === UNGROUPED_CODE) return t('options.group.ungrouped');
  return data.name;
};

/** el-tree 过滤回调：只保留命中集内的节点 */
const filterNode = (_value: string, data: Record<string, unknown>): boolean => {
  if (!keyword.value.trim()) return true;
  return visibleCodes.value.has(String(data.code));
};

/** 关键词变化时触发 el-tree 重新过滤 */
watch(keyword, value => {
  treeRef.value?.filter(value);
});

const handleNodeClick = (data: GroupTreeNode) => {
  emit('select', data.code);
};

/** 虚拟节点（根 / 未分组）不可拖动 */
const allowDrag = (node: TreeNodeInstance): boolean => !node.data.isVirtual;

/**
 * 拖拽落点约束
 *
 * - 不允许放进「未分组」（它不能有子节点）；
 * - 根节点只允许 `inner`（成为一级分组），不允许在根前后插入排序；
 * - 防环由 moveGroup 的服务端校验兜底，此处不重复计算子孙集。
 */
const allowDrop = (
  _draggingNode: TreeNodeInstance,
  dropNode: TreeNodeInstance,
  type: 'prev' | 'inner' | 'next',
): boolean => {
  if (dropNode.data.code === UNGROUPED_CODE) return false;
  if (dropNode.data.code === ROOT_GROUP_CODE) return type === 'inner';
  return true;
};

/**
 * 树内拖拽落定：区分「移动到新父级」与「同级重排」
 *
 * el-tree 已完成节点位置变更，这里只把新结构回写存储；
 * 落库后父级 reloadGroups 重建 treeData，以存储为唯一事实源。
 */
const handleNodeDrop = (
  draggingNode: TreeNodeInstance,
  dropNode: TreeNodeInstance,
  position: 'before' | 'after' | 'inner',
) => {
  const draggedCode = draggingNode.data.code;
  if (position === 'inner') {
    emit('move', draggedCode, dropNode.data.code);
    return;
  }
  const newParentCode = dropNode.parent?.data.code ?? ROOT_GROUP_CODE;
  if (newParentCode !== draggingNode.parent?.data.code) {
    emit('move', draggedCode, newParentCode);
  }
  // 同级顺序以 el-tree 拖拽后的实际结构为准
  const siblings = (
    treeRef.value?.store.nodesMap[newParentCode]?.childNodes ?? []
  ).map(child => child.data.code);
  emit('reorder', newParentCode, siblings);
};

// ==================== 表格行拖入归组 ====================

/** 判定拖拽载荷是否来自密码表格（区分 el-tree 自身的节点拖拽） */
const hasEntryPayload = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes(ENTRY_DRAG_MIME);

const handleEntryDragOver = (event: DragEvent, code: string) => {
  if (!hasEntryPayload(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTargetCode.value = code;
};

const handleEntryDragLeave = (code: string) => {
  if (dropTargetCode.value === code) dropTargetCode.value = null;
};

const handleEntryDrop = (event: DragEvent, code: string) => {
  if (!hasEntryPayload(event)) return;
  event.preventDefault();
  dropTargetCode.value = null;
  const entryIds = (event.dataTransfer?.getData(ENTRY_DRAG_MIME) ?? '')
    .split(',')
    .filter(Boolean);
  if (entryIds.length === 0) return;
  // 拖到根节点视为移出分组（归入未分组）
  emit(
    'dropEntries',
    entryIds,
    code === ROOT_GROUP_CODE ? UNGROUPED_CODE : code,
  );
};

/**
 * 名称校验（供 ElMessageBox.prompt 的 inputValidator）
 *
 * 返回 true 表示通过，返回字符串即错误提示。同级重名判定需排除自身（重命名场景）。
 */
const validateName = (
  input: string,
  parentCode: string,
  selfCode?: string,
): true | string => {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return t('options.group.nameRequired');
  if (trimmed.length > MAX_GROUP_NAME_LENGTH)
    return t('options.group.nameTooLong', { max: MAX_GROUP_NAME_LENGTH });
  if (trimmed.includes('/')) return t('options.group.nameInvalidChar');
  const duplicated = flatNodes.value.some(
    node =>
      node.parentCode === parentCode &&
      node.code !== selfCode &&
      node.name === trimmed,
  );
  if (duplicated) return t('options.group.nameDuplicate');
  return true;
};

/** 新建分组：ElMessageBox.prompt + 名称校验 */
const promptCreate = async (parentCode: string) => {
  const parentName =
    flatNodes.value.find(node => node.code === parentCode)?.name ?? '';
  const message =
    parentCode === ROOT_GROUP_CODE
      ? ''
      : t('options.group.createSubTitle', { parent: parentName });
  try {
    const { value } = await ElMessageBox.prompt(
      message,
      t('options.group.createTitle'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        inputPlaceholder: t('options.group.nameLabel'),
        inputValidator: (input: string) => validateName(input, parentCode),
      },
    );
    emit('create', value.trim(), parentCode);
  } catch {
    // 用户取消或校验未通过，无需处理
  }
};

/** 重命名分组 */
const promptRename = async (data: GroupTreeNode) => {
  const parentCode =
    flatNodes.value.find(node => node.code === data.code)?.parentCode ??
    ROOT_GROUP_CODE;
  try {
    const { value } = await ElMessageBox.prompt(
      '',
      t('options.group.renameTitle'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        inputValue: data.name,
        inputPlaceholder: t('options.group.nameLabel'),
        inputValidator: (input: string) =>
          validateName(input, parentCode, data.code),
      },
    );
    emit('rename', data.code, value.trim());
  } catch {
    // 用户取消或校验未通过，无需处理
  }
};
</script>

<style scoped>
.group-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 240px;
  max-height: calc(100vh - 32px);
  margin: 0 0 32px 32px;
  overflow: hidden;
  background: white;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
}

.group-panel__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--aph-surface-line);
}

.group-panel__search {
  flex: 1;
  min-width: 0;
}

.group-panel__tree {
  flex: 1;
  padding: 8px 4px;
  overflow-y: auto;
}

.group-panel__tree::-webkit-scrollbar {
  width: 4px;
}

.group-panel__tree::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.group-node {
  display: flex;
  flex: 1;
  gap: 4px;
  align-items: center;
  min-width: 0;
  padding-right: 4px;
}

.group-node.is-drop-target {
  background: rgb(var(--aph-primary-rgb) / 12%);
  border-radius: 4px;
  outline: 1px dashed var(--aph-primary);
}

.group-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-node__count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 操作按钮默认隐藏，hover 节点时显现，避免树视觉噪声 */
.group-node__actions {
  display: none;
  flex-shrink: 0;
  margin-left: auto;
}

.group-node:hover .group-node__actions {
  display: inline-flex;
}

.group-node__actions .el-button {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-left: 2px;
}

/* 窄屏：左栏收窄为顶部区块，宽度占满 */
@media (width <= 768px) {
  .group-panel {
    width: auto;
    max-height: 240px;
    margin: 0 16px 16px;
  }
}
</style>
```

- [ ] **步骤 2：lint 与样式检查**

运行：`pnpm lint && pnpm lint:style`
预期：PASS

> `ElMessageBox` 由 `wxt.config.ts` 的 `AutoImport` 显式声明（与 `PasswordTable.vue` 同款用法），无需手动 import。若 lint 报 `ElMessageBox` 未定义，检查 `wxt.config.ts` 的 AutoImport `imports` 列表是否含 `ElMessageBox`；缺失则补上，不要用 `// eslint-disable`。

- [ ] **步骤 3：Commit**

```bash
git add components/options/GroupTreePanel.vue
git commit -m "feat(options): 新增左侧分组树面板（树搜索/CRUD/拖拽/归组放置）"
```

---

## 任务 8：`GroupDeleteDialog.vue` 删除确认对话框

**文件：**

- 创建：`components/options/GroupDeleteDialog.vue`

- [ ] **步骤 1：创建组件**

```vue
<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.group.deleteTitle', { name: groupName })"
    width="480px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="group-delete__message">
      {{
        isEmpty
          ? t('options.group.deleteEmptyMessage')
          : t('options.group.deleteMessage', {
              entries: entryCount,
              subGroups: subGroupCount,
            })
      }}
    </p>

    <!-- 空分组无需二选一：只有一种语义，直接确认 -->
    <div
      v-if="!isEmpty"
      class="group-delete__choices"
    >
      <label class="group-delete__choice">
        <el-radio
          v-model="mode"
          value="toUngrouped"
        >
          <span class="group-delete__choice-title">{{
            t('options.group.deleteGroupOnly')
          }}</span>
        </el-radio>
        <span class="group-delete__choice-tip">{{
          t('options.group.deleteGroupOnlyTip')
        }}</span>
      </label>
      <label class="group-delete__choice">
        <el-radio
          v-model="mode"
          value="toTrash"
        >
          <span
            class="group-delete__choice-title group-delete__choice-title--danger"
          >
            {{ t('options.group.deleteGroupAndData') }}
          </span>
        </el-radio>
        <span class="group-delete__choice-tip">
          {{
            t('options.group.deleteGroupAndDataTip', { entries: entryCount })
          }}
        </span>
      </label>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="$emit('update:modelValue', false)">{{
          t('common.cancel')
        }}</el-button>
        <el-button
          :type="mode === 'toTrash' && !isEmpty ? 'danger' : 'primary'"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/utils/i18n';

/**
 * 删除分组确认对话框
 *
 * 三个动作（仅删分组 / 删分组和数据 / 取消）超出 ElMessageBox 的双按钮能力，故自定义。
 * 默认选中「仅删除分组」——数据安全优先，破坏性动作需用户显式改选。
 */
const props = defineProps<{
  modelValue: boolean;
  /** 待删除分组名（标题展示） */
  groupName: string;
  /** 该分组（含子孙）下的条目数 */
  entryCount: number;
  /** 该分组下的子分组数（含子孙） */
  subGroupCount: number;
  /** 删除进行中 */
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 用户确认删除，携带条目处置方式 */
  confirm: [mode: 'toUngrouped' | 'toTrash'];
}>();

const { t } = useI18n();

/** 条目处置方式；空分组时该值无意义，父级直接删 */
const mode = ref<'toUngrouped' | 'toTrash'>('toUngrouped');

/** 空分组（无条目、无子分组）：不展示二选一 */
const isEmpty = computed(
  () => props.entryCount === 0 && props.subGroupCount === 0,
);

/** 每次打开都重置为安全默认值，避免上次选择残留 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) mode.value = 'toUngrouped';
  },
);

const handleConfirm = () => {
  emit('confirm', isEmpty.value ? 'toUngrouped' : mode.value);
};
</script>

<style scoped>
.group-delete__message {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.group-delete__choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-delete__choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid var(--aph-surface-line);
  border-radius: 6px;
  transition: border-color 0.2s ease;
}

.group-delete__choice:hover {
  border-color: var(--aph-primary);
}

.group-delete__choice-title {
  font-size: 14px;
  font-weight: 500;
}

.group-delete__choice-title--danger {
  color: var(--el-color-danger);
}

.group-delete__choice-tip {
  padding-left: 24px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
```

- [ ] **步骤 2：lint 与样式检查**

运行：`pnpm lint && pnpm lint:style`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add components/options/GroupDeleteDialog.vue
git commit -m "feat(options): 新增删除分组确认对话框（仅删分组/删分组和数据二选一）"
```

---

## 任务 9：`BatchGroupDialog.vue` 批量移动对话框

**文件：**

- 创建：`components/options/BatchGroupDialog.vue`

- [ ] **步骤 1：创建组件**

```vue
<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.group.batchMoveTitle')"
    width="440px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="targetCode = UNGROUPED_CODE"
  >
    <p class="batch-group__tip">
      {{ t('options.group.batchMoveTip', { count }) }}
    </p>
    <el-tree-select
      v-model="targetCode"
      class="batch-group__select"
      :data="selectData"
      :props="TREE_PROPS"
      node-key="code"
      check-strictly
      :render-after-expand="false"
      default-expand-all
      :placeholder="t('options.group.selectPlaceholder')"
    />
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="$emit('update:modelValue', false)">{{
          t('common.cancel')
        }}</el-button>
        <el-button
          type="primary"
          :disabled="!targetCode"
          @click="$emit('confirm', targetCode)"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GroupTreeNode } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { useI18n } from '@/utils/i18n';

/**
 * 批量「移动到分组」对话框
 *
 * 与 BatchTagDialog 同款形态：选中条目后触发，选定目标分组即批量改 groupId。
 * 根节点不可作为目标（语义是「全库」而非一个真实分组），故从选项中剔除，
 * 只保留真实分组与「未分组」。
 */
const props = defineProps<{
  modelValue: boolean;
  /** 分组树渲染节点 */
  treeData: GroupTreeNode[];
  /** 选中条目数 */
  count: number;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
  /** 确认移动，携带目标分组 code（UNGROUPED_CODE 表示移出分组） */
  confirm: [targetCode: string];
}>();

const { t } = useI18n();

const TREE_PROPS = { label: 'label', children: 'children' } as const;

/** 目标分组 code，默认「未分组」（最安全的非破坏性选择） */
const targetCode = ref<string>(UNGROUPED_CODE);

/** el-tree-select 数据：虚拟节点补 i18n 文案，剔除根节点 */
const selectData = computed(() => {
  const mapNode = (
    node: GroupTreeNode,
  ): { code: string; label: string; children: unknown[] } => ({
    code: node.code,
    label:
      node.code === UNGROUPED_CODE ? t('options.group.ungrouped') : node.name,
    children: node.children.map(mapNode),
  });
  const root = props.treeData.find(node => node.code === ROOT_GROUP_CODE);
  return (root?.children ?? []).map(mapNode);
});
</script>

<style scoped>
.batch-group__tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.batch-group__select {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
```

- [ ] **步骤 2：lint 与样式检查**

运行：`pnpm lint && pnpm lint:style`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add components/options/BatchGroupDialog.vue
git commit -m "feat(options): 新增批量移动到分组对话框"
```

---

## 任务 10：`PasswordTable.vue` 分组列与行拖拽

**文件：**

- 修改：`components/options/PasswordTable.vue`

- [ ] **步骤 1：扩展 props/emits 与导入**

将 `defineProps`（339-350 行）替换为：

```ts
const props = defineProps<{
  /** 表格数据（含预计算的分组全路径） */
  data: PasswordEntryWithGroupPath[];
  /** 加载状态 */
  loading: boolean;
  /** 行类名函数 */
  rowClassName?: (data: { row: PasswordEntry; rowIndex: number }) => string;
  /** 当前搜索关键词（用于命中高亮，空串时不高亮） */
  searchKeyword?: string;
  /** 当前多列排序链（驱动表头方向/优先级指示） */
  sortChain: readonly SortCriterion[];
  /** 「分组」列是否可见（默认隐藏，由表头齿轮开关控制） */
  groupColVisible?: boolean;
  /** 当前选中条目 ID（拖拽时决定搬运单行还是整批） */
  selectedIds?: string[];
}>();
```

> 原文件 `defineProps<{...}>()` 未赋值给变量；改为 `const props = defineProps<...>()` 后，模板中的 `data`/`loading` 等引用不变（`<script setup>` 自动暴露），脚本内新增的拖拽逻辑用 `props.data` / `props.selectedIds` 访问。

将 `defineEmits`（352-361 行）替换为：

```ts
defineEmits<{
  selectionChange: [selection: PasswordEntry[]];
  columnSort: [prop: string];
  togglePassword: [row: PasswordEntry];
  viewDetail: [row: PasswordEntry];
  copy: [row: PasswordEntry];
  edit: [row: PasswordEntry];
  toggleFavorite: [id: string];
  deletePassword: [id: string];
  /** 切换「分组」列显隐 */
  'update:groupColVisible': [value: boolean];
}>();
```

将第 320 行的 vue 导入改为：

```ts
import {
  ref,
  onBeforeUpdate,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
} from 'vue';
```

将第 321 行的图标导入加入 `Setting`：

```ts
import {
  CopyDocument,
  Edit,
  Delete,
  View,
  Hide,
  Star,
  StarFilled,
  Link,
  Setting,
} from '@element-plus/icons-vue';
```

将第 322 行的类型导入改为：

```ts
import type { PasswordEntry, PasswordEntryWithGroupPath } from '@/utils/types';
import { ENTRY_DRAG_MIME } from '@/utils/groupTree';
```

- [ ] **步骤 2：新增「分组」列**

在 `tag` 列的 `</el-table-column>`（第 167 行）之后、`remark` 列之前插入：

```vue
<!--
        分组列：默认隐藏，由操作列表头的齿轮开关控制。
        显示全路径（工作/项目A），聚合视图下区分条目来自哪个子分组；
        groupPath 为空串（未分组）时显示 i18n 兜底文案。
      -->
<el-table-column
  v-if="groupColVisible"
  prop="groupPath"
  min-width="140"
  show-overflow-tooltip
>
        <template #header>
          <SortHeaderCell
            :label="t('options.group.column')"
            prop="groupPath"
            :chain="sortChain"
            @sort="prop => $emit('columnSort', prop)"
          />
        </template>
        <template #default="{ row }">
          <span v-if="row.groupPath">{{ row.groupPath }}</span>
          <span
            v-else
            class="no-tag"
            >{{ t('options.group.ungrouped') }}</span
          >
        </template>
      </el-table-column>
```

- [ ] **步骤 3：操作列表头加齿轮开关**

将操作列（229-234 行）的开头：

```vue
      <el-table-column
        :label="t('common.actions')"
        header-align="center"
        width="210"
        fixed="right"
      >
```

替换为：

```vue
      <el-table-column
        header-align="center"
        width="210"
        fixed="right"
      >
        <template #header>
          <span class="actions-header">
            {{ t('common.actions') }}
            <el-popover
              placement="bottom-end"
              :width="180"
              trigger="click"
            >
              <template #reference>
                <el-button
                  :icon="Setting"
                  link
                  size="small"
                  :aria-label="t('options.group.columnSettings')"
                  :title="t('options.group.columnSettings')"
                />
              </template>
              <el-checkbox
                :model-value="groupColVisible"
                :label="t('options.group.showColumn')"
                @update:model-value="$emit('update:groupColVisible', $event === true)"
              />
            </el-popover>
          </span>
        </template>
```

> 该列原有的 `<template #default="{ row }">`（操作按钮组）保持不变，紧跟在新的 `#header` 之后。

- [ ] **步骤 4：行拖拽（事件委托 + draggable 标记）**

`el-table` 未暴露行级 `draggable` 配置，采用容器事件委托：`rowClassName` 已把条目 id 写进 `tr` 的 class（见 `usePasswordManagement.handleRowClassName`），从 class 反查行数据。

将模板最外层 `<div class="password-list">`（第 2 行）改为：

```vue
  <div
    ref="tableHostRef"
    class="password-list"
  >
```

在 `<script setup>` 的 `onBeforeUpdate` 回调（405-408 行）之后插入：

```ts
// ==================== 行拖拽归组 ====================

/** 表格容器引用（dragstart 事件委托挂载点） */
const tableHostRef = ref<HTMLElement | null>(null);

/**
 * 行拖拽起始：把条目 ID 写入 dataTransfer
 *
 * 拖拽已选中的行 → 搬运整批选中条目；拖拽未选中的行 → 只搬运该行。
 * 用自定义 MIME（ENTRY_DRAG_MIME）让左侧分组树能区分「拖条目」与「拖分组节点」；
 * text/plain 兜底：部分浏览器要求至少设置一种标准类型才允许拖拽。
 */
const handleRowDragStart = (
  event: DragEvent,
  row: PasswordEntryWithGroupPath,
) => {
  const selected = props.selectedIds ?? [];
  const ids = selected.includes(row.id) ? selected : [row.id];
  event.dataTransfer?.setData(ENTRY_DRAG_MIME, ids.join(','));
  event.dataTransfer?.setData('text/plain', ids.join(','));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
};

/**
 * 事件委托：容器监听冒泡的 dragstart，从 tr 的 class 反查行数据
 *
 * 委托方式只挂一个监听器，不随行数增长，也无需在行销毁时逐个清理。
 */
const handleContainerDragStart = (event: DragEvent) => {
  const target = event.target as HTMLElement | null;
  const row = target?.closest?.('tr.el-table__row');
  if (!row) return;
  // rowClassName 把条目 id 写进了 tr 的 class 列表；排除 Element Plus 自身的类名
  const id = [...row.classList].find(
    cls => !cls.startsWith('el-') && cls !== 'new-item' && cls !== 'del-item',
  );
  if (!id) return;
  const entry = props.data.find(item => item.id === id);
  if (entry) handleRowDragStart(event, entry);
};

/** 给所有表格行设置 draggable（数据更新后行 DOM 重建，需重新标记） */
const markRowsDraggable = () => {
  tableHostRef.value
    ?.querySelectorAll('tr.el-table__row')
    .forEach(row => row.setAttribute('draggable', 'true'));
};

onMounted(() => {
  tableHostRef.value?.addEventListener('dragstart', handleContainerDragStart);
  void nextTick(markRowsDraggable);
});

onUnmounted(() => {
  tableHostRef.value?.removeEventListener(
    'dragstart',
    handleContainerDragStart,
  );
});

// 翻页/过滤/排序后行 DOM 重建，重新标记 draggable
watch(
  () => props.data,
  () => void nextTick(markRowsDraggable),
);
```

- [ ] **步骤 5：补充样式**

在 `<style scoped>` 的 `.no-tag` 规则（535-539 行）之后插入：

```css
/* 操作列表头：标题 + 列显隐齿轮 */
.actions-header {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

/* 可拖拽行：抓取光标提示 */
:deep(.el-table__body-wrapper tr.el-table__row) {
  cursor: grab;
}

:deep(.el-table__body-wrapper tr.el-table__row:active) {
  cursor: grabbing;
}
```

- [ ] **步骤 6：lint / 样式 / 类型检查**

运行：`pnpm lint && pnpm lint:style && pnpm typecheck`
预期：PASS（`App.vue` 尚未传新 props，`groupColVisible`/`selectedIds` 为可选，不报错）

- [ ] **步骤 7：Commit**

```bash
git add components/options/PasswordTable.vue
git commit -m "feat(options): 密码表格新增分组列与行拖拽归组"
```

---

## 任务 11：`PasswordFormDialog.vue` 分组选择器

**文件：**

- 修改：`components/options/PasswordFormDialog.vue`

- [ ] **步骤 1：新增分组表单项**

在 `tag` 的 `</el-form-item>`（第 108 行）之后、`remark` 表单项之前插入：

```vue
<el-form-item :label="t('options.group.formLabel')" prop="groupId">
          <el-tree-select
            v-model="localForm.groupId"
            :data="groupSelectData"
            :props="GROUP_TREE_PROPS"
            node-key="code"
            check-strictly
            :render-after-expand="false"
            default-expand-all
            clearable
            :disabled="loading"
            :placeholder="t('options.group.selectPlaceholder')"
            style="width: 100%"
          />
        </el-form-item>
```

- [ ] **步骤 2：props 新增分组树**

在 `defineProps` 的 `passwordRules: PasswordRuleItem[];`（第 285 行）之后插入：

```ts
  /** 分组树渲染节点（供分组下拉选择；空数组时下拉只有「未分组」） */
  groupTree: GroupTreeNode[];
```

将第 245 行的类型导入改为：

```ts
import type {
  GroupTreeNode,
  PasswordFormModel,
  PasswordFormPatch,
} from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
```

- [ ] **步骤 3：`localForm` 加入 `groupId` 并打通双向同步**

将 `localForm`（306-312 行）改为：

```ts
const localForm = reactive({
  username: props.form.username,
  password: props.form.password,
  url: props.form.url,
  remark: props.form.remark,
  totp: props.form.totp,
  groupId: props.form.groupId,
});
```

将 `formModel`（第 324 行）改为：

```ts
const formModel = computed(() => ({ ...localForm, tag: props.form.tag }));
```

> 该行内容不变（`localForm` 已含 `groupId`，展开自动带上），列出仅为确认无需改动。

将 props → local 的 watch（327-336 行）补一行：

```ts
localForm.groupId = val.groupId;
```

将 local → parent 的 watch（339-347 行）的 emit 载荷补一行：

```ts
    groupId: val.groupId,
```

- [ ] **步骤 4：分组下拉数据源**

在 `totpPreviewValid`（第 356 行）之后插入：

```ts
/** el-tree-select 字段映射 */
const GROUP_TREE_PROPS = { label: 'label', children: 'children' } as const;

/**
 * 分组下拉数据：剔除虚拟根（语义是「全库」不可选），
 * 「未分组」补 i18n 文案并映射为空串（与 PasswordFormModel.groupId 的未分组约定一致）。
 */
const groupSelectData = computed(() => {
  const mapNode = (
    node: GroupTreeNode,
  ): { code: string; label: string; children: unknown[] } => ({
    code: node.code === UNGROUPED_CODE ? '' : node.code,
    label:
      node.code === UNGROUPED_CODE ? t('options.group.ungrouped') : node.name,
    children: node.children.map(mapNode),
  });
  const root = props.groupTree.find(node => node.code === ROOT_GROUP_CODE);
  return (root?.children ?? []).map(mapNode);
});
```

- [ ] **步骤 5：lint / 类型检查**

运行：`pnpm lint && pnpm typecheck`
预期：报错 `App.vue` 未传 `groupTree` prop——属任务 12 范围；本组件自身无错。

- [ ] **步骤 6：Commit**

```bash
git add components/options/PasswordFormDialog.vue
git commit -m "feat(options): 密码表单弹窗新增分组选择器"
```

---

## 任务 12：`SearchFilterBar.vue` 批量移动按钮 + `App.vue` 左右分栏集成

**文件：**

- 修改：`components/options/SearchFilterBar.vue`
- 修改：`entrypoints/options/App.vue`
- 修改：`entrypoints/options/styles.css`

- [ ] **步骤 1：`SearchFilterBar.vue` 新增「移动到分组」按钮**

在「批量编辑标签」按钮（15-21 行）之后插入：

```vue
<el-button
  v-if="selectedCount > 0"
  :icon="FolderOpened"
  @click="$emit('batchMoveGroup')"
>
      {{ t('options.group.moveToGroup', { count: selectedCount }) }}
    </el-button>
```

将第 103 行的图标导入加入 `FolderOpened`：

```ts
import {
  Search,
  Delete,
  Star,
  StarFilled,
  PriceTag,
  Download,
  FolderOpened,
} from '@element-plus/icons-vue';
```

在 `defineEmits` 的 `batchEditTags: [];` 之后加入：

```ts
batchMoveGroup: [];
```

- [ ] **步骤 2：`App.vue` 模板改为左右分栏**

将 `<!-- 主内容区域 -->` 的 `<div v-if="isAuthenticated" class="main-content">`（32-35 行）到 `PasswordTable` + 分页栏结束（第 178 行 `</div>`）之间的结构重组为：

```vue
    <!-- 主内容区域：左侧分组树 + 右侧密码管理 -->
    <div
      v-if="isAuthenticated"
      class="main-content"
    >
      <!-- 左侧分组树（空数据时也显示：分组管理不依赖条目存在） -->
      <GroupTreePanel
        :tree-data="groupTree"
        :entry-counts="groupEntryCounts"
        :selected-group-code="selectedGroupCode"
        @select="selectedGroupCode = $event"
        @create="createGroup"
        @rename="renameGroup"
        @request-delete="openGroupDeleteDialog"
        @move="moveGroup"
        @reorder="reorderGroups"
        @drop-entries="moveEntriesToGroup"
      />

      <div class="content-right">
        <!-- 头部 -->
        <HeaderBar ...（原有 props/事件不变） />

        <!-- 搜索和筛选（空数据时隐藏） -->
        <SearchFilterBar
          ...（原有 props/事件不变）
          @batch-move-group="showBatchGroupDialog = true"
        />

        <!-- 展示密码列表总数和搜索结果总数 -->
        ...（原 password-list-info 区块不变）

        <!-- 空数据状态引导 -->
        <EmptyGuide ...（不变） />

        <!-- 密码列表 -->
        <PasswordTable
          v-else
          :data="pagedPasswords"
          :loading="tableLoading"
          :search-keyword="searchKeyword"
          :row-class-name="handleRowClassName"
          :sort-chain="sortChain"
          :group-col-visible="groupColVisible"
          :selected-ids="selectedIds"
          @update:group-col-visible="setGroupColVisible"
          @selection-change="handleSelectionChange"
          @column-sort="handleColumnSort"
          @toggle-password="togglePasswordVisibility"
          @view-detail="onViewDetail"
          @copy="copyPassword"
          @edit="editPassword"
          @toggle-favorite="toggleFavorite"
          @delete-password="deletePassword"
        />

        <!-- 分页栏 -->
        ...（原 pagination-bar 区块不变）
      </div>
    </div>
```

> 即：原 `.main-content` 的全部子节点包进新的 `<div class="content-right">`，`GroupTreePanel` 作为其前面的兄弟节点。`HeaderBar`/`SearchFilterBar`/info/`EmptyGuide`/分页栏的原有 props 与事件一律不动，仅 `PasswordTable` 新增 3 个绑定、`SearchFilterBar` 新增 1 个事件。

- [ ] **步骤 3：`App.vue` 挂载两个新对话框**

在 `<!-- 批量编辑标签弹窗 -->` 的 `BatchTagDialog`（296-300 行）之后插入：

```vue
<!-- 批量移动到分组弹窗 -->
<BatchGroupDialog
  v-model="showBatchGroupDialog"
  :tree-data="groupTree"
  :count="selectedIds.length"
  @confirm="handleBatchGroupConfirm"
/>

<!-- 删除分组确认弹窗（仅删分组 / 删分组和数据 二选一） -->
<GroupDeleteDialog
  v-model="showGroupDeleteDialog"
  :group-name="pendingDeleteGroup?.name ?? ''"
  :entry-count="pendingDeleteGroupStats.entryCount"
  :sub-group-count="pendingDeleteGroupStats.subGroupCount"
  :loading="groupDeleteLoading"
  @confirm="handleGroupDeleteConfirm"
/>
```

- [ ] **步骤 4：`App.vue` 脚本接入**

在异步组件声明区（`BatchTagDialog` 声明之后，第 340 行附近）加入：

```ts
const BatchGroupDialog = defineAsyncComponent(
  () => import('@/components/options/BatchGroupDialog.vue'),
);
const GroupDeleteDialog = defineAsyncComponent(
  () => import('@/components/options/GroupDeleteDialog.vue'),
);
```

在静态导入区（`SearchFilterBar` 导入之后，第 352 行附近）加入：

```ts
import GroupTreePanel from '@/components/options/GroupTreePanel.vue';
```

> `GroupTreePanel` 静态导入：它是首屏布局的一部分（左栏骨架），异步加载会造成布局跳动。

在 `usePasswordManagement` 解构（644-701 行）中补入新成员：

```ts
  groups,
  groupTree,
  groupEntryCounts,
  selectedGroupCode,
  groupColVisible,
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
  reorderGroups,
  moveEntriesToGroup,
  setGroupColVisible,
```

在 `PasswordFormDialog` 的模板绑定中补一个 prop：

```vue
:group-tree="groupTree"
```

在 `showBatchTagDialog` 声明（第 704 行）之后插入：

```ts
/** 批量移动到分组弹窗可见性 */
const showBatchGroupDialog = ref(false);

/**
 * 批量移动确认：归组后关闭弹窗
 * @param targetCode 目标分组 code（UNGROUPED_CODE = 移出分组）
 */
const handleBatchGroupConfirm = async (targetCode: string) => {
  await moveEntriesToGroup(selectedIds.value, targetCode);
  showBatchGroupDialog.value = false;
};

/** 删除分组确认弹窗可见性 */
const showGroupDeleteDialog = ref(false);
/** 删除进行中状态 */
const groupDeleteLoading = ref(false);
/** 待删除的分组 */
const pendingDeleteGroup = ref<PasswordGroup | null>(null);

/** 待删除分组的统计（条目数含子孙聚合；子分组数含子孙） */
const pendingDeleteGroupStats = computed(() => {
  const target = pendingDeleteGroup.value;
  if (!target) return { entryCount: 0, subGroupCount: 0 };
  const doomed = getDescendantCodes(target.code, groups.value);
  return {
    entryCount: groupEntryCounts.value.get(target.code) ?? 0,
    subGroupCount: Math.max(0, doomed.size - 1),
  };
});

/**
 * 打开删除分组确认弹窗
 * @param code 目标分组 code
 */
const openGroupDeleteDialog = (code: string) => {
  pendingDeleteGroup.value =
    groups.value.find(group => group.code === code) ?? null;
  if (!pendingDeleteGroup.value) return;
  showGroupDeleteDialog.value = true;
};

/**
 * 删除分组确认：按用户选择的处置方式执行
 * @param mode 'toUngrouped' 条目移入未分组 / 'toTrash' 条目进回收站
 */
const handleGroupDeleteConfirm = async (mode: 'toUngrouped' | 'toTrash') => {
  const target = pendingDeleteGroup.value;
  if (!target) return;
  groupDeleteLoading.value = true;
  try {
    await deleteGroup(target.code, mode);
    showGroupDeleteDialog.value = false;
    pendingDeleteGroup.value = null;
  } finally {
    groupDeleteLoading.value = false;
  }
};
```

在 `App.vue` 顶部导入区补充：

```ts
import type {
  FloatingButtonConfig,
  PasswordEntry,
  PasswordGroup,
} from '@/utils/types';
import { getDescendantCodes } from '@/utils/groupTree';
```

> 第 309 行已有 `import type { FloatingButtonConfig, PasswordEntry } from '@/utils/types';`，把 `PasswordGroup` 合并进该行即可。

- [ ] **步骤 5：`SORT_LABEL_KEYS` 补分组列映射**

将 `App.vue` 的 `SORT_LABEL_KEYS`（367-374 行）补一行：

```ts
  groupPath: 'options.group.column',
```

- [ ] **步骤 6：`styles.css` 布局改造**

将 `entrypoints/options/styles.css` 的 `.main-content` 规则（9-13 行）替换为：

```css
/* 主内容区域：左侧分组树 + 右侧管理区 */
.main-content {
  display: flex;
  gap: 0;
  align-items: flex-start;
  min-height: 100vh;
  padding: 20px 0 0;
  background: var(--aph-surface-2);
}

/* 右侧管理区：占据剩余宽度，min-width 防止表格挤压左栏 */
.content-right {
  flex: 1;
  min-width: 0;
}

/* 窄屏：左右栏改为纵向堆叠 */
@media (width <= 768px) {
  .main-content {
    flex-direction: column;
    padding-top: 16px;
  }

  .content-right {
    width: 100%;
  }
}
```

> 原 `.main-content` 无 padding（`HeaderBar` 自带边距）；新增 `padding: 20px 0 0` 让左栏树与右栏头部垂直对齐。`GroupTreePanel` 自带 `margin: 0 0 32px 32px`，`SearchFilterBar`/`PasswordTable` 自带 `margin: 0 32px`，左右间距由各自组件维持，`.content-right` 不再额外加边距。若视觉验证发现右栏组件的 `margin: 0 32px` 与新布局冲突（如表格右侧溢出），只调整 `.content-right` 的 padding，不改子组件既有 margin。

- [ ] **步骤 7：lint / 样式 / 类型检查**

运行：`pnpm lint && pnpm lint:style && pnpm typecheck`
预期：PASS

- [ ] **步骤 8：全量测试**

运行：`pnpm test:run`
预期：PASS（含既有全部用例）

- [ ] **步骤 9：构建验证**

运行：`pnpm build`
预期：构建成功，无新增 chunk 警告（`GroupTreePanel` 进首屏 chunk，`BatchGroupDialog`/`GroupDeleteDialog` 为异步 chunk）

- [ ] **步骤 10：Commit**

```bash
git add components/options/SearchFilterBar.vue entrypoints/options/App.vue entrypoints/options/styles.css
git commit -m "feat(options): 管理页左右分栏集成分组树与批量归组"
```

---

## 任务 13：分组合并纯函数 + `.aph` 加密备份 v2

**文件：**

- 修改：`utils/groupTree.ts`（新增 `mergeImportedGroups`、`resolveImportedGroups`）
- 修改：`utils/backupExport.ts`
- 修改：`components/options/BackupImportDialog.vue`
- 修改：`entrypoints/options/App.vue`（两处 `exportEncryptedBackup` 调用）
- 测试：`tests/utils/groupTree.test.ts`（追加）、`tests/utils/backupExportGroups.test.ts`（新建）

- [ ] **步骤 1：扩展测试夹具以支持 `groupPath`**

`tests/helpers/passwordEntry.ts` 的 `overrides` 类型为 `Partial<PasswordEntry>`，无法携带导入边界的中间态字段 `groupPath`。将该文件改为：

```ts
import type { PasswordEntry } from '@/utils/types';

/**
 * 构造合法的 PasswordEntry 测试夹具
 *
 * 供各 utils 测试共用，避免在多个测试文件中重复维护默认字段。
 * 仅提供满足类型约束的最小默认值，具体字段由 overrides 覆盖。
 *
 * overrides 额外接受 `groupPath`：它是导入边界（CSV/JSON）的中间态字段，
 * 不属于 PasswordEntry，但导入类测试需要构造带路径的条目。
 *
 * @param overrides 需要覆盖的字段
 * @returns 完整的 PasswordEntry（可能附带 groupPath）
 */
export function makePasswordEntry(
  overrides: Partial<PasswordEntry> & { groupPath?: string } = {},
): PasswordEntry & { groupPath?: string } {
  return {
    id: 'id',
    username: 'u',
    password: 'p',
    url: '',
    tag: '',
    remark: '',
    createTime: 0,
    updateTime: 0,
    order: 0,
    ...overrides,
  };
}
```

> 返回类型是 `PasswordEntry` 的超集，既有测试把它当 `PasswordEntry` 用仍然成立，无需改动其他测试文件。

- [ ] **步骤 2：编写 `mergeImportedGroups` / `resolveImportedGroups` 的失败测试**

在 `tests/utils/groupTree.test.ts` 末尾追加（并在顶部导入列表补 `mergeImportedGroups`、`resolveImportedGroups`）：

```ts
describe('mergeImportedGroups', () => {
  it('导入分组全部重新生成 code，并返回旧→新映射', () => {
    const imported: PasswordGroup[] = [
      g('old-work', '工作', ROOT_GROUP_CODE, 0),
      g('old-proj', '项目A', 'old-work', 0),
    ];
    const { groups, codeMap } = mergeImportedGroups(imported, []);
    expect(groups).toHaveLength(2);
    expect(groups[0].code).not.toBe('old-work');
    expect(codeMap.get('old-work')).toBe(groups[0].code);
    // 父子关系按映射重建
    expect(groups[1].parentCode).toBe(codeMap.get('old-work'));
  });

  it('与现有分组同名同级时复用，不产生重复分组', () => {
    const { groups, codeMap } = mergeImportedGroups(
      [g('old-work', '工作', ROOT_GROUP_CODE, 0)],
      GROUPS,
    );
    expect(codeMap.get('old-work')).toBe('work');
    expect(groups.filter(x => x.name === '工作')).toHaveLength(1);
    expect(groups).toHaveLength(GROUPS.length);
  });

  it('父级复用、子级新建时挂在复用的父级下', () => {
    const { groups, codeMap } = mergeImportedGroups(
      [
        g('old-work', '工作', ROOT_GROUP_CODE, 0),
        g('old-new', '新子组', 'old-work', 0),
      ],
      GROUPS,
    );
    expect(codeMap.get('old-work')).toBe('work');
    expect(
      groups.find(x => x.code === codeMap.get('old-new'))!.parentCode,
    ).toBe('work');
  });

  it('父级先于子级处理（导入数组顺序颠倒也能正确重建）', () => {
    const { groups, codeMap } = mergeImportedGroups(
      [
        g('old-fe', '前端', 'old-proj', 0),
        g('old-proj', '项目X', 'old-work', 0),
        g('old-work', '工作X', ROOT_GROUP_CODE, 0),
      ],
      [],
    );
    expect(groups.find(x => x.code === codeMap.get('old-fe'))!.parentCode).toBe(
      codeMap.get('old-proj'),
    );
  });

  it('空导入不改变现有分组', () => {
    const { groups, codeMap } = mergeImportedGroups([], GROUPS);
    expect(groups).toHaveLength(GROUPS.length);
    expect(codeMap.size).toBe(0);
  });
});

describe('resolveImportedGroups', () => {
  it('文件自带 groups 时按 codeMap 重写条目 groupId', () => {
    const imported = [g('old-work', '工作', ROOT_GROUP_CODE, 0)];
    const result = resolveImportedGroups(
      {
        entries: [makePasswordEntry({ id: '1', groupId: 'old-work' })],
        groups: imported,
      },
      [],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.entries[0].groupId).toBe(result.groups[0].code);
  });

  it('条目带 groupPath 时按路径逐级建组', () => {
    const result = resolveImportedGroups(
      {
        entries: [makePasswordEntry({ id: '1', groupPath: '工作/项目A' })],
        groups: [],
      },
      [],
    );
    expect(result.groups.map(x => x.name)).toEqual(['工作', '项目A']);
    expect(result.entries[0].groupId).toBe(result.groups[1].code);
  });

  it('groupPath 与自带 groups 同时存在时以 groupPath 为准', () => {
    const result = resolveImportedGroups(
      {
        entries: [
          makePasswordEntry({ id: '1', groupId: 'old', groupPath: '新路径' }),
        ],
        groups: [g('old', '旧', ROOT_GROUP_CODE, 0)],
      },
      [],
    );
    expect(result.entries[0].groupId).toBe(
      result.groups.find(x => x.name === '新路径')!.code,
    );
  });

  it('无分组信息时条目 groupId 被清空（归未分组）', () => {
    const result = resolveImportedGroups(
      { entries: [makePasswordEntry({ id: '1' })], groups: [] },
      GROUPS,
    );
    expect(result.entries[0].groupId).toBeUndefined();
    expect(result.groups).toHaveLength(GROUPS.length);
  });

  it('多条目共享同一路径时只建一次组', () => {
    const result = resolveImportedGroups(
      {
        entries: [
          makePasswordEntry({ id: '1', groupPath: '工作' }),
          makePasswordEntry({ id: '2', groupPath: '工作' }),
        ],
        groups: [],
      },
      [],
    );
    expect(result.groups.filter(x => x.name === '工作')).toHaveLength(1);
  });

  it('返回的条目不含 groupPath 字段（落盘前剥离中间态）', () => {
    const result = resolveImportedGroups(
      {
        entries: [makePasswordEntry({ id: '1', groupPath: '工作' })],
        groups: [],
      },
      [],
    );
    expect('groupPath' in result.entries[0]).toBe(false);
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/groupTree.test.ts`
预期：FAIL，报错 `mergeImportedGroups` / `resolveImportedGroups` 未导出

- [ ] **步骤 4：在 `utils/groupTree.ts` 实现两个函数**

在文件顶部导入区加入类型：

```ts
import type {
  GroupTreeNode,
  PasswordEntry,
  PasswordGroup,
} from '@/utils/types';
```

在 `validateGroupName` 之后追加：

```ts
/**
 * 导入用条目：可能携带分组全路径（CSV/Excel）或文件内 code（JSON/.aph）
 *
 * `groupPath` 是导入边界的中间态，落盘前由 resolveImportedGroups 剥离。
 */
export type ImportedPasswordEntry = Omit<PasswordEntry, 'id' | 'order'> & {
  groupPath?: string;
};

/** 导入解析结果：条目 + 文件内自带的分组树（仅 JSON/.aph 有，CSV 为空数组） */
export interface ParsedImportData {
  entries: ImportedPasswordEntry[];
  groups: PasswordGroup[];
}

/**
 * 合并导入的分组树到现有分组
 *
 * 导入的 code 一律重新生成：不同设备/不同备份文件的 code 可能撞车，直接沿用会
 * 把两棵无关的树粘在一起。同名同级复用现有分组，避免重复导入产生一堆同名分组。
 *
 * 处理顺序按层级 BFS（父先于子），保证子分组挂载时父级的新 code 已在映射表中，
 * 因此不依赖导入数组的原始顺序。
 *
 * @param imported 文件内的分组树
 * @param existing 现有分组（不被修改）
 * @returns 合并后的完整分组数组 + 旧 code → 新 code 映射
 */
export function mergeImportedGroups(
  imported: readonly PasswordGroup[],
  existing: readonly PasswordGroup[],
): { groups: PasswordGroup[]; codeMap: Map<string, string> } {
  const groups: PasswordGroup[] = [...existing];
  const codeMap = new Map<string, string>();
  if (imported.length === 0) return { groups, codeMap };

  const importedByCode = new Map(imported.map(group => [group.code, group]));
  const childrenOf = (parentCode: string) =>
    imported.filter(group => group.parentCode === parentCode);

  /** 在 groups 中找同名同级的现有分组（parentCode 已是映射后的新 code） */
  const findExisting = (name: string, parentCode: string) =>
    groups.find(
      group => group.parentCode === parentCode && group.name === name,
    );

  const nextOrder = (parentCode: string) => {
    const siblings = groups.filter(group => group.parentCode === parentCode);
    return siblings.length === 0
      ? 0
      : Math.max(...siblings.map(group => group.order)) + 1;
  };

  // 逐层处理：roots 是 parentCode 不在导入集内的节点（含 parentCode === ROOT_GROUP_CODE）
  let frontier = imported.filter(
    group => !importedByCode.has(group.parentCode),
  );
  const visited = new Set<string>();
  while (frontier.length > 0) {
    const next: PasswordGroup[] = [];
    for (const group of frontier) {
      if (visited.has(group.code)) continue;
      visited.add(group.code);
      const mappedParent =
        group.parentCode === ROOT_GROUP_CODE
          ? ROOT_GROUP_CODE
          : (codeMap.get(group.parentCode) ?? ROOT_GROUP_CODE);
      const hit = findExisting(group.name, mappedParent);
      if (hit) {
        codeMap.set(group.code, hit.code);
      } else {
        const created: PasswordGroup = {
          code: generateId(),
          name: group.name,
          parentCode: mappedParent,
          order: nextOrder(mappedParent),
        };
        groups.push(created);
        codeMap.set(group.code, created.code);
      }
      next.push(...childrenOf(group.code));
    }
    frontier = next;
  }

  // 兜底：环状脏数据导致 BFS 未覆盖的节点，按根级挂载，避免分组凭空丢失
  for (const group of imported) {
    if (visited.has(group.code)) continue;
    const created: PasswordGroup = {
      code: generateId(),
      name: group.name,
      parentCode: ROOT_GROUP_CODE,
      order: nextOrder(ROOT_GROUP_CODE),
    };
    groups.push(created);
    codeMap.set(group.code, created.code);
  }

  return { groups, codeMap };
}

/**
 * 把导入数据解析为可落盘的条目 + 完整分组数组
 *
 * 两种分组来源统一处理：
 * - 文件自带 `groups`（JSON / .aph v2）：经 mergeImportedGroups 重建并按 codeMap 改写条目 groupId；
 * - 条目带 `groupPath`（CSV / Excel / 云同步）：按路径逐级建组（同名同级复用）。
 * 两者同时存在时以 `groupPath` 为准（路径是更显式的用户意图）。
 *
 * `groupPath` 是导入边界中间态，返回的条目已剥离该字段，可直接交给 batchSavePasswords。
 *
 * @param data 导入解析结果
 * @param existing 现有分组（不被修改）
 * @returns 待落盘的条目（含有效 groupId）与合并后的完整分组数组
 */
export function resolveImportedGroups(
  data: ParsedImportData,
  existing: readonly PasswordGroup[],
): { entries: Omit<PasswordEntry, 'id' | 'order'>[]; groups: PasswordGroup[] } {
  const { groups, codeMap } = mergeImportedGroups(data.groups, existing);

  const entries: Omit<PasswordEntry, 'id' | 'order'>[] = [];
  for (const entry of data.entries) {
    const { groupPath, ...rest } = entry;
    let groupId: string | undefined;
    if (groupPath && groupPath.trim()) {
      const resolved = ensureGroupByPath(groupPath, groups);
      // ensureGroupByPath 不修改入参，新建的分组需并入累积数组供后续条目复用
      groups.push(...resolved.created);
      groupId = resolved.code === UNGROUPED_CODE ? undefined : resolved.code;
    } else if (entry.groupId && codeMap.has(entry.groupId)) {
      groupId = codeMap.get(entry.groupId);
    }
    entries.push(
      groupId ? { ...rest, groupId } : { ...rest, groupId: undefined },
    );
  }

  return { entries, groups };
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/groupTree.test.ts`
预期：PASS

- [ ] **步骤 6：编写 `.aph` v2 的失败测试**

创建 `tests/utils/backupExportGroups.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/** 捕获 downloadBlob 写入的内容（.aph 为二进制，JSON 为文本） */
let capturedParts: BlobPart[] = [];

beforeEach(() => {
  capturedParts = [];
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: () => ({ click: vi.fn(), style: {} }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  const OriginalBlob = globalThis.Blob;
  vi.stubGlobal(
    'Blob',
    class extends OriginalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        capturedParts = parts;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

import {
  exportEncryptedBackup,
  importEncryptedBackup,
} from '@/utils/backupExport';

const GROUPS: PasswordGroup[] = [
  { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
  { code: 'proj', name: '项目A', parentCode: 'work', order: 0 },
];

/** 把导出的 Blob 内容还原为 File 供导入解析 */
const toFile = async (): Promise<File> => {
  const blob = new Blob(capturedParts);
  return new File([await blob.arrayBuffer()], 'backup.aph');
};

describe('.aph 备份分组往返', () => {
  it('v2 导出后导入可还原分组树与条目归属', async () => {
    const entries = [
      makePasswordEntry({ id: '1', username: 'a', groupId: 'proj' }),
    ];
    await exportEncryptedBackup(entries, 'master-pass', GROUPS);

    const result = await importEncryptedBackup(await toFile(), 'master-pass');
    expect(result.groups.map(g => g.name)).toEqual(['工作', '项目A']);
    expect(result.entries).toHaveLength(1);
    // code 重新生成，但父子关系与归属保持一致
    const projCode = result.groups.find(g => g.name === '项目A')!.code;
    expect(result.entries[0].groupId).toBe(projCode);
    expect(result.groups.find(g => g.name === '项目A')!.parentCode).toBe(
      result.groups.find(g => g.name === '工作')!.code,
    );
  });

  it('未传 groups 时导出空分组数组，导入得到空树', async () => {
    await exportEncryptedBackup(
      [makePasswordEntry({ id: '1' })],
      'master-pass',
    );
    const result = await importEncryptedBackup(await toFile(), 'master-pass');
    expect(result.groups).toEqual([]);
    expect(result.entries[0].groupId).toBeUndefined();
  });

  it('v1 旧备份（无 groups 字段）导入时条目归未分组', async () => {
    // 手工构造 v1 密文：复用导出逻辑但篡改 version 不可行，改为直接验证
    // importEncryptedBackup 对缺失 groups 的容错——用 v2 导出后删掉 groups 再加密
    const v1Payload = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      count: 1,
      entries: [
        {
          username: 'a',
          password: 'p',
          url: '',
          tag: '',
          remark: '',
          createTime: 0,
          updateTime: 0,
        },
      ],
    });
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode('master-pass'),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 600_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(v1Payload),
    );
    const output = new Uint8Array(
      salt.length + iv.length + ciphertext.byteLength,
    );
    output.set(salt, 0);
    output.set(iv, salt.length);
    output.set(new Uint8Array(ciphertext), salt.length + iv.length);

    const result = await importEncryptedBackup(
      new File([output], 'old.aph'),
      'master-pass',
    );
    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].groupId).toBeUndefined();
  });

  it('主密码错误时拒绝解密（不因新增 groups 字段而改变错误路径）', async () => {
    await exportEncryptedBackup(
      [makePasswordEntry({ id: '1' })],
      'master-pass',
      GROUPS,
    );
    await expect(
      importEncryptedBackup(await toFile(), 'wrong-pass'),
    ).rejects.toThrow();
  });
});
```

- [ ] **步骤 7：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/backupExportGroups.test.ts`
预期：FAIL（`exportEncryptedBackup` 只接受 2 个参数；`importEncryptedBackup` 返回数组而非 `{ entries, groups }`）

- [ ] **步骤 8：改造 `utils/backupExport.ts`**

将 `BACKUP_VERSION`（第 7 行）改为：

```ts
/**
 * 备份文件版本标识
 *
 * - v1：仅条目（历史格式，导入时条目全部归「未分组」）
 * - v2：条目携带 groupId + 顶层 groups 分组树
 */
const BACKUP_VERSION = 2;
```

将 `BackupData`（16-21 行）改为：

```ts
/** 备份数据结构 */
interface BackupData {
  version: number;
  exportedAt: number;
  count: number;
  entries: Omit<PasswordEntry, 'id' | 'order'>[];
  /** 分组树（v2 新增；v1 文件缺失该字段，导入时视为空树） */
  groups?: PasswordGroup[];
}
```

将第 1 行的类型导入改为：

```ts
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
```

将 `exportEncryptedBackup` 签名与 `backupData` 构造（48-65 行）改为：

```ts
export async function exportEncryptedBackup(
  passwords: PasswordEntry[],
  masterPassword: string,
  groups: readonly PasswordGroup[] = [],
): Promise<void> {
  try {
    const backupData: BackupData = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      count: passwords.length,
      entries: passwords.map(p => ({
        username: p.username,
        password: p.password,
        url: p.url,
        tag: p.tag,
        remark: p.remark,
        totp: p.totp,
        createTime: p.createTime,
        updateTime: p.updateTime,
        favorite: p.favorite,
        groupId: p.groupId,
      })),
      groups: [...groups],
    };
```

将 `importEncryptedBackup` 的返回类型与返回语句（109-140 行）改为：

```ts
export async function importEncryptedBackup(
  file: File,
  masterPassword: string,
): Promise<{ entries: Omit<PasswordEntry, 'id' | 'order'>[]; groups: PasswordGroup[] }> {
```

```ts
if (!backupData.version || !Array.isArray(backupData.entries)) {
  throw new Error(t('backup.invalidStructure'));
}

// v1 文件无 groups 字段：降级为空树，条目 groupId 由调用方归一到「未分组」
const groups = Array.isArray(backupData.groups) ? backupData.groups : [];
return { entries: backupData.entries, groups };
```

- [ ] **步骤 9：更新 `BackupImportDialog.vue` 调用方**

将第 253 行的 `previewData` 声明改为：

```ts
const previewData = ref<Omit<PasswordEntry, 'id' | 'order'>[]>([]);
/** 备份文件内自带的分组树（v1 文件为空数组） */
const previewGroups = ref<PasswordGroup[]>([]);
```

将第 219-223 行的导入改为：

```ts
import { importEncryptedBackup } from '@/utils/backupExport';
import { resolveImportedGroups } from '@/utils/groupTree';
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
```

将 `handleDecrypt` 中第 312 行改为：

```ts
const { entries, groups } = await importEncryptedBackup(
  selectedFile.value,
  masterPassword.value.trim(),
);
previewGroups.value = groups;
```

将 `handleImport`（339-354 行）的保存逻辑改为：

```ts
const handleImport = async () => {
  if (previewData.value.length === 0) return;

  try {
    importing.value = true;
    // 分组先落盘再存条目：条目的 groupId 指向合并后的新 code，顺序颠倒会产生悬空引用
    const existingGroups = await StorageUtils.getAllGroups();
    const { entries, groups } = resolveImportedGroups(
      { entries: previewData.value, groups: previewGroups.value },
      existingGroups,
    );
    await StorageUtils.saveGroups(groups);
    await StorageUtils.batchSavePasswords(entries);
    ElMessage.success(
      t('options.import.importSuccess', { count: entries.length }),
    );
    emit('imported');
    handleClose();
  } catch (error) {
    logger.error('导入失败:', error);
    ElMessage.error(t('options.import.importFailed'));
  } finally {
    importing.value = false;
  }
};
```

将 `handleClose`（357-367 行）补一行重置：

```ts
previewGroups.value = [];
```

- [ ] **步骤 10：更新 `App.vue` 的两处导出调用**

将 `handleEncryptedBackupExport` 中第 551 行改为：

```ts
await exportEncryptedBackup(passwords.value, masterPassword, groups.value);
```

将 `backupToEmail` 中第 980 行改为：

```ts
await exportEncryptedBackup(passwords.value, masterPassword, groups.value);
```

> `groups` 已在任务 12 步骤 4 从 `usePasswordManagement` 解构。

- [ ] **步骤 11：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/backupExportGroups.test.ts tests/utils/groupTree.test.ts`
预期：PASS

- [ ] **步骤 12：类型检查与 lint**

运行：`pnpm typecheck && pnpm lint`
预期：PASS

- [ ] **步骤 13：Commit**

```bash
git add tests/helpers/passwordEntry.ts utils/groupTree.ts utils/backupExport.ts components/options/BackupImportDialog.vue entrypoints/options/App.vue tests/utils/groupTree.test.ts tests/utils/backupExportGroups.test.ts
git commit -m "feat(backup): .aph 备份升级 v2 携带分组树"
```

---

## 任务 14：Excel / CSV / JSON 通道带分组

**文件：**

- 修改：`utils/excelFormatMap.ts`、`utils/excelCsv.ts`、`utils/excelJson.ts`、`utils/excelExport.ts`、`utils/excel.ts`
- 修改：`components/options/ImportDialog.vue`
- 修改：`composables/usePasswordManagement.ts`（导出调用传 groups）
- 测试：`tests/utils/excelGroups.test.ts`（新建）

> **行为变更（规格 §7.3 已批准）**：LastPass 的 `grouping` 列与 Bitwarden 的 `folder` 列此前映射到 `tag`，现改映射到 `group`（按路径建组）。理由：这两列在源工具中本就是文件夹语义，塞进扁平 tag 会丢失层级；改映射后导入结果更贴近用户原意。

- [ ] **步骤 1：编写失败的测试**

创建 `tests/utils/excelGroups.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { FORMAT_COLUMN_MAP } from '@/utils/excelFormatMap';
import { parseCSVBuffer } from '@/utils/excelCsv';
import { parsePasswordJSON } from '@/utils/excelJson';

/** 文本 → ArrayBuffer（CSV 解析入口只接受字节） */
const toBuffer = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('CSV 列映射', () => {
  it('native 格式含分组列映射', () => {
    expect(FORMAT_COLUMN_MAP.native.group).toContain('分组');
  });

  it('lastpass grouping 映射到 group 而非 tag', () => {
    expect(FORMAT_COLUMN_MAP.lastpass.group).toContain('grouping');
    expect(FORMAT_COLUMN_MAP.lastpass.tag).not.toContain('grouping');
  });

  it('bitwarden folder 映射到 group 而非 tag', () => {
    expect(FORMAT_COLUMN_MAP.bitwarden.group).toContain('folder');
    expect(FORMAT_COLUMN_MAP.bitwarden.tag).not.toContain('folder');
  });
});

describe('CSV 导入解析分组列', () => {
  it('解析出 groupPath，groups 为空数组（由 resolveImportedGroups 建组）', () => {
    const csv = [
      '用户名(必填),密码,网址,标签,备注,两步验证,分组',
      'alice,pw,example.com,t1,r1,,工作/项目A',
    ].join('\n');
    const result = parseCSVBuffer(toBuffer(csv), 'native');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].groupPath).toBe('工作/项目A');
    expect(result.groups).toEqual([]);
  });

  it('无分组列时 groupPath 为空串', () => {
    const csv = ['用户名(必填),密码', 'alice,pw'].join('\n');
    expect(parseCSVBuffer(toBuffer(csv), 'native').entries[0].groupPath).toBe(
      '',
    );
  });

  it('bitwarden folder 列解析为 groupPath', () => {
    const csv = [
      'folder,login_username,login_password,login_uri,notes',
      'Work/Sites,alice,pw,example.com,note',
    ].join('\n');
    const result = parseCSVBuffer(toBuffer(csv), 'bitwarden');
    expect(result.entries[0].groupPath).toBe('Work/Sites');
  });
});

describe('JSON 导入解析分组', () => {
  it('解析 groups 数组与条目 groupId', () => {
    const payload = {
      version: 2,
      groups: [
        { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
      ],
      entries: [{ username: 'alice', password: 'pw', groupId: 'work' }],
    };
    const result = parsePasswordJSON(JSON.stringify(payload));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('工作');
    expect(result.entries[0].groupId).toBe('work');
  });

  it('无 groups 字段时降级为空树（v1 JSON 兼容）', () => {
    const result = parsePasswordJSON(
      JSON.stringify([{ username: 'alice', password: 'pw' }]),
    );
    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('groups 为脏数据时降级为空树，不影响条目', () => {
    const result = parsePasswordJSON(
      JSON.stringify({ groups: 'corrupted', entries: [{ username: 'a' }] }),
    );
    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('条目 groupPath 字段也被解析（与 CSV 口径一致）', () => {
    const result = parsePasswordJSON(
      JSON.stringify([{ username: 'a', groupPath: '工作/项目A' }]),
    );
    expect(result.entries[0].groupPath).toBe('工作/项目A');
  });
});

describe('导出携带分组', () => {
  const GROUPS: PasswordGroup[] = [
    { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'proj', name: '项目A', parentCode: 'work', order: 0 },
  ];

  it('buildCsvRows 输出全路径分组列', async () => {
    const { buildCsvRows } = await import('@/utils/excelExport');
    const rows = buildCsvRows(
      [makePasswordEntry({ id: '1', username: 'alice', groupId: 'proj' })],
      GROUPS,
    );
    // 列顺序：用户名/密码/网址/标签/备注/两步验证/分组/创建时间/更新时间
    expect(rows[0][6]).toBe('工作/项目A');
  });

  it('未分组条目导出空串', async () => {
    const { buildCsvRows } = await import('@/utils/excelExport');
    expect(buildCsvRows([makePasswordEntry({ id: '1' })], GROUPS)[0][6]).toBe(
      '',
    );
  });

  it('buildJsonPayload 含 groups 与条目 groupId', async () => {
    const { buildJsonPayload } = await import('@/utils/excelExport');
    const payload = buildJsonPayload(
      [makePasswordEntry({ id: '1', groupId: 'proj' })],
      GROUPS,
    );
    expect(payload.groups).toHaveLength(2);
    expect(payload.entries[0].groupId).toBe('proj');
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/excelGroups.test.ts`
预期：FAIL（`CsvColumnMapping` 无 `group`；`parseCSVBuffer` 返回数组；`buildCsvRows`/`buildJsonPayload` 未导出）

- [ ] **步骤 3：`utils/excelFormatMap.ts` 加 group 映射**

将 `CsvColumnMapping` 接口改为：

```ts
/** CSV 列映射配置 */
export interface CsvColumnMapping {
  username: string[];
  password: string[];
  url: string[];
  tag: string[];
  remark: string[];
  totp: string[];
  /** 分组列（全路径，`/` 分隔）；导入时按路径逐级建组 */
  group: string[];
}
```

将 `FORMAT_COLUMN_MAP` 各格式改为（`group` 加在每个格式末尾）：

```ts
export const FORMAT_COLUMN_MAP: Record<
  Exclude<ImportFormat, 'auto'>,
  CsvColumnMapping
> = {
  native: {
    username: [
      '用户名(必填)',
      '用户名',
      '账号',
      'Username (Required)',
      'username',
      'Username',
    ],
    password: ['密码', 'password', 'Password'],
    url: ['网址', 'URL', 'url', '网站地址', '链接'],
    tag: ['标签', 'tag', 'Tag', '分类'],
    remark: ['备注', 'remark', 'Remark', '说明'],
    totp: ['两步验证', 'TOTP', 'totp', '密钥'],
    group: ['分组', 'group', 'Group', '分组路径'],
  },
  chrome: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL', 'origin'],
    tag: ['name', 'Name'],
    remark: ['note', 'Note'],
    totp: ['otpauth', 'otp_auth'],
    group: [],
  },
  lastpass: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL'],
    tag: [],
    remark: ['extra', 'Extra'],
    totp: ['totp', 'TOTP'],
    group: ['grouping', 'Grouping'],
  },
  bitwarden: {
    username: ['login_username', 'Login Username'],
    password: ['login_password', 'Login Password'],
    url: ['login_uri', 'Login URI'],
    tag: [],
    remark: ['notes', 'Notes'],
    totp: ['login_totp', 'Login TOTP'],
    group: ['folder', 'Folder'],
  },
  '1password': {
    username: ['Username', 'username'],
    password: ['Password', 'password'],
    url: ['Url', 'URL', 'url'],
    tag: ['Title', 'title'],
    remark: ['Notes', 'notes'],
    totp: ['OTPAuth', 'otpauth', 'totp'],
    group: [],
  },
};
```

> `detectFormat`（`excelCsv.ts:186-216`）的 LastPass 判定依赖 `headerSet.has('grouping')`、Bitwarden 判定依赖 `login_uri` 等，均不受本次映射调整影响，无需改动。

- [ ] **步骤 4：`utils/excelCsv.ts` 解析分组列并改返回结构**

将第 1 行的类型导入改为：

```ts
import type { PasswordEntry } from '@/utils/types';
import type {
  ImportedPasswordEntry,
  ParsedImportData,
} from '@/utils/groupTree';
```

将 `parseCSVBuffer`（18-48 行）的返回类型与两处 `results` 声明改为 `ParsedImportData`：

```ts
export function parseCSVBuffer(
  buffer: ArrayBuffer,
  format: ImportFormat = 'auto',
): ParsedImportData {
  // 优先使用 UTF-8 解码
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  let results = parseCSVFromText(utf8Text, format);

  if (results.length === 0) {
    // UTF-8 无结果时尝试 GBK 解码（WPS / 中文 Excel 常见编码）
    try {
      const gbkText = new TextDecoder('gbk', { fatal: false }).decode(buffer);
      // 仅在解码结果不同时才重试（避免相同文本重复解析）
      if (gbkText !== utf8Text) {
        logger.info('UTF-8 解析无结果，尝试 GBK 编码回退');
        results = parseCSVFromText(gbkText, format);
        if (results.length > 0) {
          logger.info(`GBK 编码回退成功，解析出 ${results.length} 条数据`);
        }
      }
    } catch {
      // 当前环境不支持 GBK 解码器，忽略
    }
  }

  if (results.length === 0) {
    logger.warn('CSV 解析结果为空，请检查文件编码和格式');
  }

  // CSV 无分组树结构，分组由 groupPath 在落盘前经 resolveImportedGroups 建组
  return { entries: results, groups: [] };
}
```

将 `parseCSVFromText`（53 行）与 `parseRowsWithMapping`（103-136 行）的返回类型改为 `ImportedPasswordEntry[]`，并在 `parseRowsWithMapping` 的 `results.push({...})` 中补一行：

```ts
      groupPath: (findColumn(row, mapping.group) || '').trim(),
```

> `findColumn` 对空候选数组（`group: []`）返回空串，故 chrome/1password 格式天然得到 `groupPath: ''`，无需分支。

- [ ] **步骤 5：`utils/excelJson.ts` 解析 groups 并改返回结构**

将第 1 行的类型导入改为：

```ts
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';
import type {
  ImportedPasswordEntry,
  ParsedImportData,
} from '@/utils/groupTree';
```

将 `parsePasswordJSON`（19 行）签名改为：

```ts
export function parsePasswordJSON(text: string): ParsedImportData {
```

将函数体的 `return entries.map(...)` 部分（41-68 行）改为：

```ts
const parsedEntries: ImportedPasswordEntry[] = entries
  .map((row: any) => {
    const username = row.username || row['用户名'] || row['账号'] || '';
    const password = row.password || row['密码'] || '';
    const url = row.url || row['网址'] || row['网站地址'] || row['链接'] || '';
    const tag = row.tag || row['标签'] || row['分类'] || '';
    const remark = row.remark || row['备注'] || row['说明'] || '';
    const totp = row.totp || row['两步验证'] || row.otpauth || '';
    const groupPath = row.groupPath || row['分组'] || '';
    const groupId = typeof row.groupId === 'string' ? row.groupId : undefined;

    const cTime = parseTimestamp(
      row.createTime ?? row['创建时间'] ?? row.CreateTime,
    );
    const uTime = parseTimestamp(
      row.updateTime ??
        row['更新时间'] ??
        row.UpdateTime ??
        row.modifyTime ??
        row['修改时间'],
    );
    const createTime = cTime ?? uTime ?? now;
    const updateTime = uTime ?? cTime ?? now;

    return {
      username: String(username).trim(),
      password: String(password).trim(),
      url: String(url).trim(),
      tag: String(tag).trim(),
      remark: String(remark).trim(),
      totp: String(totp).trim(),
      groupPath: String(groupPath).trim(),
      groupId,
      createTime,
      updateTime,
    };
  })
  .filter(item => item.username);

return { entries: parsedEntries, groups: parseGroups(raw) };
```

在 `parsePasswordJSON` 之前新增分组解析辅助函数：

```ts
/**
 * 解析 JSON 文件内自带的分组树
 *
 * 文件内容视为不可信输入：逐项校验 code/name/parentCode 为字符串、order 为有限数字，
 * 非法项丢弃；整体非数组时降级为空树（条目随后归入「未分组」），不阻断导入。
 */
function parseGroups(raw: any): PasswordGroup[] {
  const list = Array.isArray(raw?.groups) ? raw.groups : [];
  const result: PasswordGroup[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { code, name, parentCode, order } = item as Record<string, unknown>;
    if (typeof code !== 'string' || code === '') continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({
      code,
      name: name.trim(),
      parentCode:
        typeof parentCode === 'string' && parentCode !== ''
          ? parentCode
          : ROOT_GROUP_CODE,
      order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
    });
  }
  return result;
}
```

> 原 `if (entries.length === 0) { logger.warn(...); return []; }` 早退分支改为 `return { entries: [], groups: parseGroups(raw) };`，保持「空条目也还原分组树」的语义（用户可能只想导入分组结构）。

- [ ] **步骤 6：`utils/excelExport.ts` 抽出可测的纯函数并加分组列**

将 `CSV_HEADER_KEYS`（14-22 行）改为（在 `totp` 之后、`createTime` 之前插入 group）：

```ts
/** CSV 表头 i18n key 列表（顺序即导出列顺序，用户名列可切换「必填」标注） */
const CSV_HEADER_KEYS = [
  'excel.header.password',
  'excel.header.url',
  'excel.header.tag',
  'excel.header.remark',
  'excel.header.totp',
  'excel.header.group',
  'excel.header.createTime',
  'excel.header.updateTime',
] as const;
```

在 `serializeCsvRows` 之后新增两个导出的纯函数：

```ts
/**
 * 构造 CSV 行数据（表头除外）
 *
 * 抽出为独立纯函数以便单测列顺序与分组路径渲染，导出与模板下载共用。
 * 分组列输出全路径（`/` 拼接），未分组为空串。
 *
 * @param passwords 待导出条目
 * @param groups 分组树（用于解析全路径）
 */
export function buildCsvRows(
  passwords: readonly PasswordEntry[],
  groups: readonly PasswordGroup[] = [],
): string[][] {
  return passwords.map(p => [
    p.username,
    p.password,
    p.url,
    p.tag || '',
    p.remark || '',
    p.totp || '',
    getGroupPath(p.groupId, groups),
    formatDate(p.createTime || Date.now()),
    formatDate(p.updateTime || Date.now()),
  ]);
}

/**
 * 构造 JSON 导出载荷
 *
 * 与 `.aph` v2 同口径：顶层带 groups 分组树，条目带 groupId（文件内 code，
 * 导入时由 mergeImportedGroups 重新生成并映射）。
 *
 * @param passwords 待导出条目
 * @param groups 分组树
 */
export function buildJsonPayload(
  passwords: readonly PasswordEntry[],
  groups: readonly PasswordGroup[] = [],
) {
  return {
    version: 2,
    exportedAt: Date.now(),
    count: passwords.length,
    groups: [...groups],
    entries: passwords.map(p => ({
      username: p.username,
      password: p.password,
      url: p.url,
      tag: p.tag,
      remark: p.remark,
      totp: p.totp,
      groupId: p.groupId,
      createTime: p.createTime,
      updateTime: p.updateTime,
    })),
  };
}
```

将第 1 行的类型导入改为：

```ts
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import { getGroupPath } from '@/utils/groupTree';
```

将 `exportToCSV`（65-85 行）改为：

```ts
export function exportToCSV(
  passwords: PasswordEntry[],
  filename: string = 'passwords.csv',
  groups: readonly PasswordGroup[] = [],
): void {
  try {
    const csv = serializeCsvRows([
      buildCsvHeaders(),
      ...buildCsvRows(passwords, groups),
    ]);
    downloadBlob(['\uFEFF' + csv], 'text/csv;charset=utf-8', filename);
  } catch (error) {
    logger.error('导出CSV失败:', error);
    const err = new Error('导出CSV失败');
    (err as any).cause = error;
    throw err;
  }
}
```

将 `downloadTemplate`（90-106 行）的示例行改为（在 `''`（totp）之后插入分组示例）：

```ts
export function downloadTemplate(): void {
  const now = formatDate(Date.now());
  const csv = serializeCsvRows([
    buildCsvHeaders(true),
    [
      'example@email.com',
      'password123',
      'https://example.com',
      t('excel.template.exampleTag'),
      t('excel.template.exampleRemark'),
      '',
      t('excel.template.exampleGroup'),
      now,
      now,
    ],
  ]);
  downloadBlob(
    ['\uFEFF' + csv],
    'text/csv;charset=utf-8',
    'password_template.csv',
  );
}
```

将 `exportToJSON`（115-141 行）改为：

```ts
export function exportToJSON(
  passwords: PasswordEntry[],
  filename: string = 'passwords.json',
  groups: readonly PasswordGroup[] = [],
): void {
  try {
    const jsonStr = JSON.stringify(
      buildJsonPayload(passwords, groups),
      null,
      2,
    );
    downloadBlob([jsonStr], 'application/json;charset=utf-8', filename, true);
  } catch (error) {
    logger.error('导出 JSON 失败:', error);
    const err = new Error('导出 JSON 失败');
    (err as any).cause = error;
    throw err;
  }
}
```

- [ ] **步骤 7：`utils/excel.ts` 门面透传**

将 `ExcelUtils` 各方法改为：

```ts
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import type { ImportFormat } from '@/utils/excelFormatMap';
import type { ParsedImportData } from '@/utils/groupTree';
import { parseCSVBuffer } from '@/utils/excelCsv';
import { parsePasswordJSON } from '@/utils/excelJson';
import {
  downloadTemplate as downloadCsvTemplate,
  exportToCSV as exportCsv,
  exportToJSON as exportJson,
} from '@/utils/excelExport';

export class ExcelUtils {
  /** 导出密码数据到 CSV（带 BOM，Excel 可直接双击打开且中文不乱码） */
  static exportToCSV(
    passwords: PasswordEntry[],
    filename: string = 'passwords.csv',
    groups: readonly PasswordGroup[] = [],
  ): void {
    exportCsv(passwords, filename, groups);
  }

  /**
   * 解析 CSV 文件为密码数据，支持多编码自动回退
   * @param buffer CSV 文件原始字节
   * @param format 导入格式，'auto' 时自动检测
   */
  static parseCSV(
    buffer: ArrayBuffer,
    format: ImportFormat = 'auto',
  ): ParsedImportData {
    return parseCSVBuffer(buffer, format);
  }

  /** 下载 CSV 模板（Excel 可直接打开） */
  static downloadTemplate(): void {
    downloadCsvTemplate();
  }

  /**
   * 解析 JSON 文本为密码数据
   * 支持数组格式或 `{ entries, groups }` 包裹格式，字段映射兼容中英文列名。
   */
  static parseJSON(text: string): ParsedImportData {
    return parsePasswordJSON(text);
  }

  /**
   * 导出密码数据为 JSON 文件
   * 导出结构：`{ version, exportedAt, count, groups, entries }`
   */
  static exportToJSON(
    passwords: PasswordEntry[],
    filename: string = 'passwords.json',
    groups: readonly PasswordGroup[] = [],
  ): void {
    exportJson(passwords, filename, groups);
  }
}
```

- [ ] **步骤 8：`ImportDialog.vue` 适配新返回结构**

将解析调用处（第 280 行附近）改为：

```ts
data = ExcelUtils.parseCSV(buffer, importFormat.value as ImportFormat).entries;
```

将 JSON 分支的 `ExcelUtils.parseJSON(...)` 调用同样改为取 `.entries`，并把 `.groups` 存入新的 ref：

```ts
/** 文件内自带的分组树（CSV 恒为空数组，JSON 可能携带） */
const parsedGroups = ref<PasswordGroup[]>([]);
```

在 `<script setup>` 导入区加入：

```ts
import type { PasswordGroup } from '@/utils/types';
import { resolveImportedGroups } from '@/utils/groupTree';
```

将 `handleImport`（330-348 行）改为：

```ts
const handleImport = async () => {
  if (previewData.value.length === 0 || !selectedFile.value) return;

  try {
    loading.value = true;

    // 分组先落盘再存条目：条目 groupId 指向合并后的新 code，顺序颠倒会产生悬空引用
    const existingGroups = await StorageUtils.getAllGroups();
    const { entries, groups } = resolveImportedGroups(
      { entries: previewData.value, groups: parsedGroups.value },
      existingGroups,
    );
    await StorageUtils.saveGroups(groups);
    // 批量保存密码（单次读写，避免逐条 savePassword 导致的 O(M×N) 数据搬运）
    await StorageUtils.batchSavePasswords(entries);

    ElMessage.success(
      t('options.import.importSuccess', { count: entries.length }),
    );
    emit('imported');
    handleClose();
  } catch (error) {
    logger.error('导入失败:', error);
    ElMessage.error(t('options.import.importFailed'));
  } finally {
    loading.value = false;
  }
};
```

将 `handleClose` 补一行 `parsedGroups.value = [];`。

- [ ] **步骤 9：`usePasswordManagement` 导出调用传 groups**

将 `exportEntriesToCSV` 中第 814 行改为：

```ts
ExcelUtils.exportToCSV(entries, filename, groups.value);
```

将 `exportPasswordsJson` 中第 941 行改为：

```ts
ExcelUtils.exportToJSON(passwords.value, filename, groups.value);
```

- [ ] **步骤 10：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/excelGroups.test.ts`
预期：PASS

- [ ] **步骤 11：全量测试 + 类型检查 + lint**

运行：`pnpm test:run && pnpm typecheck && pnpm lint`
预期：PASS

> 既有 Excel 相关测试若断言 `parseCSV` 返回数组，改为取 `.entries`；若断言 CSV 列数/列序，按新增的分组列（第 7 列）修正。不得删除或跳过用例。

- [ ] **步骤 12：Commit**

```bash
git add utils/excelFormatMap.ts utils/excelCsv.ts utils/excelJson.ts utils/excelExport.ts utils/excel.ts components/options/ImportDialog.vue composables/usePasswordManagement.ts tests/utils/excelGroups.test.ts
git commit -m "feat(import-export): Excel/CSV/JSON 通道携带分组"
```

---

## 任务 15：云同步明文表加分组列（规格 V1.2 → V1.3）

**文件：**

- 修改：`utils/cloudSync/types.ts`（`LocalSyncEntry` 加 `groupPath`）
- 修改：`utils/cloudSync/schema.ts`（明文表 8 → 9 字段）
- 修改：`docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`（V1.3 修订）
- 测试：`tests/utils/cloudSyncSchemaGroups.test.ts`（新建）

> **前置说明**：云同步的 `syncEngine.ts` / `diff.ts` / `adapters/` 尚未实现（见 `utils/cloudSync/` 现状），本任务只改已存在的类型与 schema 层。`LocalSyncEntry → groupPath` 的组装（`getGroupPath`）与云端拉取建组（`ensureGroupByPath`）属 syncEngine 实现时的职责，在云同步规格 V1.3 中记录约定，本计划不实现 syncEngine。

- [ ] **步骤 1：编写失败的测试**

创建 `tests/utils/cloudSyncSchemaGroups.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  PLAINTEXT_FIELDS,
  PLAINTEXT_TABLE_SPEC,
  SYNCED_TEXT_FIELDS,
  entryToFields,
  fieldsToEntry,
  getRequiredFieldNames,
} from '@/utils/cloudSync/schema';

describe('云同步明文表分组列', () => {
  it('字段名常量含分组', () => {
    expect(PLAINTEXT_FIELDS.group).toBe('分组');
  });

  it('表结构为 9 字段，分组列位于标签之后、本地更新时间之前', () => {
    const names = PLAINTEXT_TABLE_SPEC.map(f => f.name);
    expect(names).toHaveLength(9);
    expect(names.indexOf(PLAINTEXT_FIELDS.group)).toBe(
      names.indexOf(PLAINTEXT_FIELDS.tag) + 1,
    );
    expect(names.indexOf(PLAINTEXT_FIELDS.group)).toBe(
      names.indexOf(PLAINTEXT_FIELDS.localUpdateTime) - 1,
    );
  });

  it('分组列为文本类型且非索引列', () => {
    const groupField = PLAINTEXT_TABLE_SPEC.find(
      f => f.name === PLAINTEXT_FIELDS.group,
    )!;
    expect(groupField.type).toBe('text');
    expect(groupField.primary).toBeFalsy();
  });

  it('结构校验必需字段含分组', () => {
    expect(getRequiredFieldNames('plaintext')).toContain(
      PLAINTEXT_FIELDS.group,
    );
  });

  it('哈希口径含分组（分组变更参与 LWW diff）', () => {
    expect(SYNCED_TEXT_FIELDS).toContain('groupPath');
  });

  it('entryToFields 输出分组全路径', () => {
    const fields = entryToFields({
      id: '1',
      username: 'u',
      password: 'p',
      url: '',
      tag: '',
      remark: '',
      totp: '',
      groupPath: '工作/项目A',
      updateTime: 0,
    });
    expect(fields[PLAINTEXT_FIELDS.group]).toBe('工作/项目A');
  });

  it('fieldsToEntry 还原 groupPath，缺失时为空串', () => {
    const withGroup = fieldsToEntry({
      [PLAINTEXT_FIELDS.id]: '1',
      [PLAINTEXT_FIELDS.username]: 'u',
      [PLAINTEXT_FIELDS.password]: 'p',
      [PLAINTEXT_FIELDS.url]: '',
      [PLAINTEXT_FIELDS.tag]: '',
      [PLAINTEXT_FIELDS.remark]: '',
      [PLAINTEXT_FIELDS.totp]: '',
      [PLAINTEXT_FIELDS.group]: '工作/项目A',
      [PLAINTEXT_FIELDS.localUpdateTime]: 123,
    });
    expect(withGroup.entry.groupPath).toBe('工作/项目A');

    const withoutGroup = fieldsToEntry({ [PLAINTEXT_FIELDS.id]: '1' });
    expect(withoutGroup.entry.groupPath).toBe('');
  });

  it('密文表结构不受影响（仍为 9 个分片字段，无分组列）', async () => {
    const { ENCRYPTED_TABLE_SPEC } = await import('@/utils/cloudSync/schema');
    expect(ENCRYPTED_TABLE_SPEC.some(f => f.name === '分组')).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test:run -- tests/utils/cloudSyncSchemaGroups.test.ts`
预期：FAIL（`PLAINTEXT_FIELDS.group` 为 undefined、表结构 8 字段、`SYNCED_TEXT_FIELDS` 无 `groupPath`）

- [ ] **步骤 3：`utils/cloudSync/types.ts` 的 `LocalSyncEntry` 加 `groupPath`**

将 `LocalSyncEntry`（255-264 行）改为：

```ts
/** 参与同步的本地条目投影（同步字段 + LWW 所需元数据） */
export interface LocalSyncEntry {
  id: string;
  username: string;
  password: string;
  url: string;
  tag: string;
  remark: string;
  totp: string;
  /**
   * 分组全路径（`/` 拼接，未分组为空串）
   *
   * 云端以路径为分组交换格式（云端表无 code 概念）；syncEngine 组装本投影时
   * 用 getGroupPath(entry.groupId, groups) 计算，拉取方向用 ensureGroupByPath 还原。
   */
  groupPath: string;
  updateTime: number;
}
```

- [ ] **步骤 4：`utils/cloudSync/schema.ts` 加分组列**

将 `PLAINTEXT_FIELDS`（21-30 行）改为：

```ts
/** 明文表字段名 */
export const PLAINTEXT_FIELDS = {
  username: '用户名',
  password: '密码',
  url: '网址',
  tag: '标签',
  remark: '备注',
  totp: 'TOTP',
  group: '分组',
  localUpdateTime: '本地更新时间',
  id: 'ID',
} as const;
```

将 `PLAINTEXT_TABLE_SPEC`（46-55 行）改为：

```ts
/** 明文表结构规格（顺序即云端列顺序） */
export const PLAINTEXT_TABLE_SPEC: TableFieldSpec[] = [
  { name: PLAINTEXT_FIELDS.username, type: 'text', primary: true },
  { name: PLAINTEXT_FIELDS.password, type: 'text' },
  { name: PLAINTEXT_FIELDS.url, type: 'text' },
  { name: PLAINTEXT_FIELDS.tag, type: 'text' },
  { name: PLAINTEXT_FIELDS.remark, type: 'text' },
  { name: PLAINTEXT_FIELDS.totp, type: 'text' },
  { name: PLAINTEXT_FIELDS.group, type: 'text' },
  { name: PLAINTEXT_FIELDS.localUpdateTime, type: 'number' },
  { name: PLAINTEXT_FIELDS.id, type: 'text', hidden: true },
];
```

将 `getRequiredFieldNames` 的明文分支（99-108 行）在 `PLAINTEXT_FIELDS.totp,` 之后加一行：

```ts
        PLAINTEXT_FIELDS.group,
```

将 `SYNCED_TEXT_FIELDS`（117 行）改为：

```ts
/**
 * 参与内容哈希的同步字段（固定顺序）
 *
 * **明确不含 ID、updateTime、云端修改时间**：扩展自身推送会刷新云端 record
 * 修改时间，若混入会导致哈希恒 ≠ 快照，把「刚推完的行」误判为「云端侧变更」。
 * groupPath 参与哈希：分组归属变更需要触发 LWW 同步。
 */
export const SYNCED_TEXT_FIELDS = [
  'username',
  'password',
  'url',
  'tag',
  'remark',
  'totp',
  'groupPath',
] as const;
```

将 `entryToFields`（120-131 行）改为：

```ts
/** 本地条目 → 云端行字段（明文模式） */
export function entryToFields(
  entry: LocalSyncEntry,
): Record<string, string | number> {
  return {
    [PLAINTEXT_FIELDS.username]: entry.username,
    [PLAINTEXT_FIELDS.password]: entry.password,
    [PLAINTEXT_FIELDS.url]: entry.url,
    [PLAINTEXT_FIELDS.tag]: entry.tag,
    [PLAINTEXT_FIELDS.remark]: entry.remark,
    [PLAINTEXT_FIELDS.totp]: entry.totp,
    [PLAINTEXT_FIELDS.group]: entry.groupPath,
    [PLAINTEXT_FIELDS.localUpdateTime]: entry.updateTime,
    [PLAINTEXT_FIELDS.id]: entry.id,
  };
}
```

将 `fieldsToEntry`（139-161 行）的返回对象 `entry` 中 `totp` 之后加一行：

```ts
      groupPath: text(PLAINTEXT_FIELDS.group),
```

并把返回类型中 `Omit<LocalSyncEntry, 'updateTime'>` 保持不变（`groupPath` 已含在 `LocalSyncEntry` 内）。

- [ ] **步骤 5：运行测试验证通过**

运行：`pnpm test:run -- tests/utils/cloudSyncSchemaGroups.test.ts`
预期：PASS

- [ ] **步骤 6：跑云同步既有测试确认无回归**

运行：`pnpm test:run -- tests/utils/`
预期：PASS

> 若既有云同步测试（如 hash/schema 相关）断言 8 字段或 6 个同步字段，按 9 字段/7 字段修正断言，不得删除用例。

- [ ] **步骤 7：回改云同步规格文档 V1.2 → V1.3**

修改 `docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`：

1. 头部版本行改为：

```markdown
- 版本：V1.3（V1.2 基础上：明文表新增「分组」列，联动 Options 树形分组功能）
```

2. 在「## V1.2 修订说明」之前插入新节：

```markdown
## V1.3 修订说明

1. **明文表新增「分组」列**（8 → 9 字段，位于「标签」之后、「本地更新时间」之前，text 类型）：值为分组全路径（`/` 拼接，如 `工作/项目A`），未分组为空串。联动 `docs/superpowers/specs/2026-09-23-options-group-tree-design.md`（Options 树形分组）。
2. **`SYNCED_TEXT_FIELDS` 哈希口径加入 `groupPath`**：分组归属变更参与 LWW diff 与冲突判定。
3. **`LocalSyncEntry` 新增 `groupPath` 字段**：云端以路径为分组交换格式（云端表无本地 code 概念）；推送方向由 syncEngine 用 `getGroupPath(entry.groupId, groups)` 组装，拉取方向用 `ensureGroupByPath` 逐级建组后写回条目 `groupId`。
4. **密文模式不受影响**：整库 JSON 快照与 `.aph` v2 同构，天然包含 `groups` + `groupId`，表结构不变。
5. **兼容性**：既有 8 字段云端表在 `checkTableSchema` 中将判定「缺失字段：分组」，按 §11 终止同步并引导用户删除云端表由系统重建（不自动改表结构）。
```

3. §4.1 明文模式表结构表格：在「TOTP」行（序 6）之后插入新行，后续序号顺延：

```markdown
| 7 | 分组 | 1 | text | 分组全路径（`/` 拼接），未分组为空串 |
```

原「本地更新时间」序号 7 → 8，「ID」序号 8 → 9。

4. §14 测试表 `adapters/feishu`、`adapters/tencent` 行不变；在表格末尾「建表/探测」行之前插入：

```markdown
| `schema`（分组列） | 明文表 9 字段、分组列位置与类型、`entryToFields`/`fieldsToEntry` 路径往返、`SYNCED_TEXT_FIELDS` 含 groupPath、密文表不含分组列 |
```

- [ ] **步骤 8：格式检查**

运行：`pnpm exec prettier --check docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`
预期：通过（若报格式问题，对该文件跑 `--write` 后重查）

- [ ] **步骤 9：Commit**

```bash
git add utils/cloudSync/types.ts utils/cloudSync/schema.ts docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md tests/utils/cloudSyncSchemaGroups.test.ts
git commit -m "feat(cloudSync): 明文表新增分组列并回改规格至 V1.3"
```

---

## 任务 16：文档同步与最终验证

**文件：**

- 修改：`README.md`、`README.en.md`
- 修改：`docs/ARCHITECTURE.md`、`docs/ARCHITECTURE.en.md`

- [ ] **步骤 1：README 功能清单加分组**

在 `README.md` 的功能特性列表中（找到密码管理相关条目，如标签/收藏所在列表），插入一条：

```markdown
- 🗂️ **树形分组**：管理页左侧分组树，支持无限层级、拖拽归组、组内搜索；分组随加密备份/导入导出/云同步全通道携带
```

在 `README.en.md` 对应位置插入：

```markdown
- 🗂️ **Group Tree**: sidebar group tree on the options page with unlimited nesting, drag-and-drop grouping, and in-group search; groups travel with encrypted backups, import/export, and cloud sync
```

> 插入位置以两文件现有功能列表的实际结构为准，保持条目风格（emoji + 加粗标题 + 说明）一致。

- [ ] **步骤 2：ARCHITECTURE 功能实现详解加分组树节**

在 `docs/ARCHITECTURE.md` 的「功能实现详解」章节末尾新增小节：

```markdown
### 树形分组（Options 管理页）

**数据结构**：邻接表独立存储。`password_groups` 键存扁平数组 `[{ code, name, parentCode, order }]`，一级分组 `parentCode = '-1'`（虚拟根）；条目经 `PasswordEntry.groupId` 一对一归属分组，缺失/悬空引用归一到虚拟「未分组」节点。分组为非敏感组织维度，不加密；`groupId` 列入 `METADATA_FIELDS` 白名单，归组走元数据轻量路径（不解密重加密）。

**模块分层**：

- `utils/groupTree.ts`：纯函数层（建树/全路径/子孙聚合/树搜索/路径建组/导入合并），无 IO 可独立测试；
- `utils/storage/groupManager.ts`：CRUD 存储层，删除分组支持「条目移入未分组」与「条目进回收站」两种语义；
- `composables/usePasswordManagement.ts`：`selectedGroupCode` 驱动过滤链最前置的分组过滤（本级 + 子孙聚合），并为每行注入 `groupPath` 供表格分组列渲染与排序；
- `components/options/GroupTreePanel.vue`：左栏树（分组名搜索仅过滤树、不影响右侧列表），承载树内拖拽与表格行拖入归组（自定义 MIME `application/x-aph-entry-ids` 区分两类拖拽）。

**搜索联动**：左侧树搜索只过滤分组名（保留命中节点祖先链）；右侧主搜索在选中分组范围内做 AND 过滤——选根为全库、选具体分组为本级 + 子孙、选未分组为无归属条目。

**数据通道**：`.aph` 备份升 v2（顶层 `groups` + 条目 `groupId`，v1 导入归未分组）；JSON 同口径；CSV/Excel 以全路径列交换（导入按路径逐级建组，同名同级复用）；云同步明文表 9 字段含「分组」列（见云同步规格 V1.3），密文快照天然携带。导入的分组 code 一律重新生成并按同名同级复用合并，避免跨设备 code 撞车。
```

在 `docs/ARCHITECTURE.en.md` 的对应章节（"Feature Implementation Details" 或同等小节）末尾新增同事实的英文版：

```markdown
### Group Tree (Options Page)

**Data model**: adjacency list in dedicated storage. The `password_groups` key holds a flat array `[{ code, name, parentCode, order }]`; top-level groups use `parentCode = '-1'` (virtual root). Entries belong to exactly one group via `PasswordEntry.groupId`; missing or dangling references resolve to the virtual "Ungrouped" node. Groups are a non-sensitive organizational dimension and are not encrypted; `groupId` is whitelisted in `METADATA_FIELDS`, so regrouping takes the lightweight metadata path (no decrypt-reencrypt).

**Module layers**:

- `utils/groupTree.ts`: pure functions (tree building / full path / descendant aggregation / tree search / path-based group creation / import merging), IO-free and unit-testable;
- `utils/storage/groupManager.ts`: CRUD storage layer; deleting a group supports two semantics — move entries to "Ungrouped" or move entries to Trash;
- `composables/usePasswordManagement.ts`: `selectedGroupCode` drives a group filter at the very front of the filter chain (self + descendants aggregation) and injects `groupPath` per row for the table's group column and sorting;
- `components/options/GroupTreePanel.vue`: left-panel tree (its search box filters group names only, never the entry list), hosting in-tree drag and drop-to-group from table rows (custom MIME `application/x-aph-entry-ids` distinguishes the two drag sources).

**Search interlock**: the tree search filters group names only (keeping ancestor chains of hits); the main search applies an AND filter within the selected group — root means the whole vault, a concrete group means self + descendants, "Ungrouped" means entries without a valid group.

**Data channels**: `.aph` backups upgraded to v2 (top-level `groups` + per-entry `groupId`; v1 imports land in "Ungrouped"); JSON follows the same shape; CSV/Excel exchange groups as full-path columns (imports create groups level by level, reusing same-name siblings); cloud sync plaintext tables carry a 9th "分组" column (see cloud sync spec V1.3), while encrypted snapshots include groups natively. Imported group codes are always regenerated and merged by same-name-same-level reuse to avoid cross-device code collisions.
```

- [ ] **步骤 3：格式检查**

运行：`pnpm exec prettier --check README.md README.en.md docs/ARCHITECTURE.md docs/ARCHITECTURE.en.md`
预期：通过（若报格式问题，对报出的文件跑 `--write` 后重查）

- [ ] **步骤 4：最终全量验证**

依次运行并确认全部通过：

```bash
pnpm typecheck
pnpm lint
pnpm lint:style
pnpm test:run
pnpm build
```

预期：全部 PASS / 构建成功。

- [ ] **步骤 5：手动冒烟验证清单（构建产物加载到 Chrome）**

逐项确认：

1. 左栏树显示「分组」根 + 「未分组」，存量条目全部计入未分组；
2. 新建/重命名/删除分组（含有子分组场景的二选一确认框）；
3. 选中分组后右侧列表只显示本级 + 子孙条目；树搜索只过滤树；
4. 右侧关键词搜索在选中分组内生效（AND）；
5. 表格齿轮开关显示/隐藏分组列，分组列可排序；
6. 编辑弹窗可选分组；表格行拖到树节点归组；批量选中 → 移动到分组；
7. 树内拖拽移动分组与同级排序；
8. `.aph` 导出 → 清空数据 → 导入，分组树还原；旧 v1 `.aph` 文件导入不报错、条目归未分组；
9. CSV 导出含分组列；带分组列的 CSV 导入自动建组；下载模板含分组列；
10. 窄窗口（≤768px）布局纵向堆叠不溢出。

- [ ] **步骤 6：Commit**

```bash
git add README.md README.en.md docs/ARCHITECTURE.md docs/ARCHITECTURE.en.md
git commit -m "docs: 树形分组功能说明与架构文档"
```

---

## 自检记录

**规格覆盖度**（对照 `2026-09-23-options-group-tree-design.md`）：

| 规格章节                                           | 对应任务                             |
| -------------------------------------------------- | ------------------------------------ |
| §2 数据结构                                        | 任务 1                               |
| §3.1 groupManager                                  | 任务 3                               |
| §3.2 groupTree                                     | 任务 2（导入合并函数在任务 13 补充） |
| §4 UI 布局                                         | 任务 7/10/12                         |
| §5 搜索联动                                        | 任务 6/7                             |
| §6 管理操作 + 删除确认框 + 归组入口                | 任务 3/7/8/9/11/12                   |
| §7.1 .aph                                          | 任务 13                              |
| §7.2 JSON                                          | 任务 14                              |
| §7.3 Excel/CSV                                     | 任务 14                              |
| §7.4 云同步 V1.3                                   | 任务 15                              |
| §8 i18n/文档/测试                                  | 任务 5/16 + 各任务内嵌测试           |
| §9 安全边界（日志不记分组名/无效降级/防环/回收站） | 任务 2/3 实现内嵌                    |

**类型一致性**：`PasswordGroup`/`GroupTreeNode`/`PasswordEntryWithGroupPath`/`ROOT_GROUP_CODE`/`UNGROUPED_CODE` 在任务 1 定义，任务 2-15 一致引用；`ParsedImportData`/`ImportedPasswordEntry` 在任务 13 定义、任务 14 引用（任务 14 依赖任务 13 先完成，执行顺序不可颠倒）；`ENTRY_DRAG_MIME` 在任务 2 定义、任务 7/10 引用。

**执行顺序约束**：任务 1 → 2 → 3 → 4 严格串行（类型 → 纯函数 → 存储 → 门面）；任务 5（i18n）可与 2-4 并行；任务 6 依赖 1-4；任务 7-12 依赖 6；任务 13 依赖 2；任务 14 依赖 13；任务 15 依赖 1；任务 16 最后。
