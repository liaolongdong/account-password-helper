# Options 管理页树形分组设计规格

- 日期：2026-09-23
- 版本：V1.0
- 状态：待用户审查
- 范围：密码管理器扩展 Options 管理页，新增左侧树形分组导航，搜索与分组联动，分组数据贯穿备份/导入导出/云同步全通道

## 1. 背景与目标

项目是本地优先的密码管理器扩展。当前 Options 管理页（`entrypoints/options/App.vue`）为单栏布局：`HeaderBar` → `SearchFilterBar` → `PasswordTable` → 分页，条目仅有扁平 `tag`（英文逗号拼接字符串）作为分类维度，**没有任何层级分组概念**。

用户希望在管理页左侧增加**树形分组**功能，并让搜索与分组联动：

- 左侧分组树，上方带独立的分组名搜索框；
- 分组树根节点为虚拟"分组"（`parentCode = -1`）；
- 右侧密码表格新增一列"分组"（默认隐藏，可开关显示）；
- 选中某分组时，右侧主搜索在该分组（本级 + 子孙）范围内做 AND 过滤。

本功能是**纯本地组织维度**的新增，不引入任何网络请求、不新增 Chrome 权限、不改变加密格式。分组数据按用户明确要求贯穿所有数据通道（`.aph` 备份、JSON、Excel/CSV、云文档同步）。

### 1.1 已确认固化决策

| 决策点           | 结论                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 归属关系         | **一对一（文件夹式）**：每个条目只属于一个分组，`PasswordEntry` 加 `groupId`；`tag` 扁平标签保持不动，作为正交维度      |
| 树结构           | **邻接表独立存储**：扁平数组 `[{ code, name, parentCode, order }]`，内存拼树；根为虚拟节点 `parentCode = -1`            |
| 存量归类         | **虚拟"未分组"节点**（不可删/改名），所有无有效 `groupId` 的条目归此，也是批量整理入口                                  |
| 选中分组显示范围 | **本级 + 所有子孙（聚合）**；不限层级深度                                                                               |
| 树级名称         | 右侧表格"分组"列显示**全路径**（`/` 无空格拼接，如 `工作/项目A/前端`），聚合视图下区分条目来源                          |
| 左侧树搜索       | 只过滤**分组名称**，命中高亮 + 保留祖先链，**不影响**右侧密码列表                                                       |
| 右侧主搜索       | 在**选中分组范围内**做 AND 过滤（组内搜索）；选根"分组"= 全库，选"未分组"= 仅未分组                                     |
| 分组列显隐       | 表格新增"分组"列，**默认隐藏** + 表头齿轮开关可显示；**支持按分组路径参与排序链**                                       |
| 删除分组语义     | 有子分组/条目时弹**确认框二选一**：「仅删除分组」（条目移入未分组）/「删除分组和数据」（条目进回收站）；空分组直接删    |
| 拖拽范围         | **全做**：树内节点拖拽移动分组 + 同级拖拽排序 + 表格条目行拖到左侧树归组                                                |
| 功能边界         | **仅 Options 管理页**；侧边栏/Popup 完全不感知分组，保持现状                                                            |
| 树节点计数       | 每个分组名后显示该分组（含子孙）条目数，如 `工作 (12)`                                                                  |
| 分组名约束       | 同级内名称唯一、长度 ≤ 30 字符、禁止纯空白、**禁止包含 `/`**（`/` 是全路径分隔符，允许会造成 Excel/云同步路径往返歧义） |
| 数据通道         | **全部加入**：`.aph` 备份、JSON、Excel/CSV、云文档同步均携带分组                                                        |

### 1.2 非目标（YAGNI）

- 不做多对多分组（一个条目属于多个分组）；
- 不做侧边栏/Popup 的分组展示或筛选；
- 不做分组图标/颜色自定义；
- 不做分组级别的独立权限或加密；
- 不做分组的定时/自动归类（如按域名自动建组）；
- 不限制分组层级深度（邻接表天然支持，UI 正常缩进渲染）。

## 2. 数据结构

### 2.1 分组实体（`utils/types.ts` 新增）

```ts
/** 分组树根节点的虚拟 code（不落盘，运行时构造） */
export const ROOT_GROUP_CODE = '-1';

/** "未分组"虚拟叶子节点 code（不落盘，不可删/改名） */
export const UNGROUPED_CODE = '__ungrouped__';

/**
 * 密码分组（树形，邻接表表示）
 *
 * 扁平存储于 chrome.storage.local，内存中拼成树。
 * 一级分组的 parentCode === ROOT_GROUP_CODE；子分组指向父分组的 code。
 */
export interface PasswordGroup {
  /** 分组唯一标识，由 generateId() 生成 */
  code: string;
  /** 分组名称，同级唯一、≤30 字符、禁纯空白 */
  name: string;
  /** 父分组 code；一级分组为 ROOT_GROUP_CODE */
  parentCode: string;
  /** 同级排序序号（升序） */
  order: number;
}
```

### 2.2 条目字段（`utils/types.ts` 的 `PasswordEntry` 新增）

```ts
export interface PasswordEntry {
  // ... 现有字段 ...
  /**
   * 所属分组 code（一对一）
   *
   * 指向 PasswordGroup.code；缺失、无效或等于 UNGROUPED_CODE 均视为"未分组"。
   * 属非敏感元数据（同 tag/order），归组/拖拽不触发解密-重加密。
   */
  groupId?: string;
}
```

- `groupId` 归入**非敏感元数据**：加入 `utils/storage/passwordCrud.ts` 的 `METADATA_FIELDS` 常量（单一事实源），使 `updatePasswordInSession` / `batchUpdatePasswordMetadata` / `isMetadataOnlyChange` / 消息路由白名单自动同步，归组走轻量更新路径。
- `UpdatePasswordMetadataData.updates`（`utils/types.ts`）的字段联合类型同步加入 `groupId`。

### 2.3 存储键（`utils/storageKeys.ts` 新增）

```ts
export const STORAGE_KEYS = {
  // ... 现有键 ...
  /** 密码分组树（扁平数组，邻接表表示；非敏感组织维度，不加密） */
  PASSWORD_GROUPS: 'password_groups',
  /** Options 密码表格"分组"列是否可见（用户自定义，默认 false 隐藏） */
  OPTIONS_GROUP_COL_VISIBLE: 'options_group_col_visible',
};
```

- 分组数据**不加密**：仅组织维度（分组名 + 层级），不含账号/密码/网址等敏感值，与 `tag` 同级对待。
- 条目 `groupId` 随条目存储：它在 `PasswordEntry` 上，属非敏感字段，落盘时处于条目的明文元数据区（`SENSITIVE_FIELDS` 之外），与 `tag`/`order`/`favorite` 一致。

## 3. 存储层与纯函数

### 3.1 `utils/storage/groupManager.ts`（新增，分组 CRUD）

| 函数            | 签名                                                                | 说明                                                                                                                   |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `getAllGroups`  | `() => Promise<PasswordGroup[]>`                                    | 读取扁平数组，失败抛错（不降级空数组，避免覆盖）                                                                       |
| `saveGroups`    | `(groups: PasswordGroup[]) => Promise<void>`                        | 整体写回（读-改-写路径统一入口）                                                                                       |
| `createGroup`   | `(name: string, parentCode: string) => Promise<PasswordGroup>`      | 校验同级名唯一 + 长度，`code = generateId()`，`order` 取同级末尾                                                       |
| `renameGroup`   | `(code: string, name: string) => Promise<void>`                     | 校验同级名唯一 + 长度                                                                                                  |
| `deleteGroup`   | `(code: string, mode: 'toUngrouped' \| 'toTrash') => Promise<void>` | 级联删除分组及子孙；`toUngrouped` 把条目 `groupId` 清空，`toTrash` 把条目移入回收站（复用 `trashManager.moveToTrash`） |
| `moveGroup`     | `(code: string, newParentCode: string) => Promise<void>`            | 改 `parentCode`；校验不能移入自己的子孙（防环）                                                                        |
| `reorderGroups` | `(parentCode: string, orderedCodes: string[]) => Promise<void>`     | 同级重排 `order`                                                                                                       |

- 所有写操作经 `chrome.storage.local`，与 `passwordCrud` 同款读-改-写；调用方（composable）用 `runLocalOperation` 包裹避免 storage watcher 触发全量重载。
- `deleteGroup` 的 `toTrash` 分支：先收集本级 + 子孙分组下所有条目 id，调 `moveToTrash(ids)`，再删分组；`toUngrouped` 分支：把这些条目 `groupId` 置空（`batchUpdatePasswordMetadata`），再删分组。

### 3.2 `utils/groupTree.ts`（新增，纯函数，无 IO，可独立测试）

| 函数                    | 签名                                                                                    | 说明                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildTree`             | `(groups: PasswordGroup[]) => GroupTreeNode[]`                                          | 扁平→树（含虚拟根 + 未分组叶子），按 `order` 排序                                                                                                                             |
| `getGroupPath`          | `(code: string, groups: PasswordGroup[]) => string`                                     | 返回 `/` 拼接的全路径 `工作/项目A`；未分组（`UNGROUPED_CODE`）与无效 code 均返回**空串**（纯函数不依赖 i18n，"未分组"文案由 UI 层用 `t('options.group.ungrouped')` 兜底渲染） |
| `getDescendantCodes`    | `(code: string, groups: PasswordGroup[]) => Set<string>`                                | 返回本级 + 所有子孙 code 集（聚合筛选用）                                                                                                                                     |
| `filterGroupsByKeyword` | `(groups: PasswordGroup[], keyword: string) => Set<string>`                             | 树搜索：返回命中节点 + 其祖先链 code 集（保层级完整）                                                                                                                         |
| `resolveEntryGroupId`   | `(groupId: string \| undefined, groups: PasswordGroup[]) => string`                     | 无效/缺失 groupId 归一到 `UNGROUPED_CODE`                                                                                                                                     |
| `ensureGroupByPath`     | `(path: string, groups: PasswordGroup[]) => { code: string; created: PasswordGroup[] }` | 按全路径逐级建组（同名同级复用），返回叶子 code + 新建的分组（供导入/云同步用）                                                                                               |
| `countEntriesByGroup`   | `(groups: PasswordGroup[], entries: PasswordEntry[]) => Map<string, number>`            | 每个分组（含子孙）的条目数，供树节点计数                                                                                                                                      |

- `GroupTreeNode` 类型：`{ code, name, order, children: GroupTreeNode[], isVirtual?: boolean }`（`isVirtual` 标记根/未分组，UI 据此禁用删改）。

## 4. UI 布局（左右分栏）

### 4.1 `entrypoints/options/App.vue` 主内容区改造

`isAuthenticated` 后的 `.main-content` 改为 **flex 左右布局**：

```
.main-content (flex row)
├── GroupTreePanel.vue   (左侧，固定宽 ~240px，可折叠)
└── .content-right (flex:1)  ← 现有 HeaderBar/SearchFilterBar/info/PasswordTable/分页整体移入
```

- `HeaderBar` 保持在右侧内容区顶部（不跨左栏），维持现有数据管理/设置下拉位置。
- 响应式：窄屏（≤768px，沿用现有断点）左侧树折叠为顶部 `el-select`（下拉选择分组），右侧全宽。

### 4.2 `components/options/GroupTreePanel.vue`（新增）

- **顶部**：分组名搜索框（`el-input`，只过滤分组名）+ "＋新建分组"按钮（建在根下）。
- **主体**：`el-tree`
  - `draggable`，`allow-drop` 约束：不能拖进自己子孙、不能拖到"未分组"内、根节点不可拖动；
  - 节点渲染 `名称 (条目数)`，条目数含子孙聚合；
  - 节点 hover 出现 ＋（建子分组）/ ✎（重命名）/ 🗑（删除）图标；
  - 虚拟根"分组"与"未分组"节点：不可删/改名（`isVirtual` 标记），"分组"= 看全部，"未分组"= 看无分组条目；
  - 当前选中节点高亮。
- **props**：`groups`、`entryCountMap`、`selectedGroupCode`；树搜索 `keyword` 为组件内部状态（不外提，纯 UI 过滤）。
- **emits**：`select(code)`、`create(parentCode)`、`rename(code, name)`、`delete(code, mode)`、`move(code, newParentCode)`、`reorder(parentCode, orderedCodes)`、`drop-entries(entryIds, targetCode)`（表格行拖入）。
- 重命名/新建统一用 `ElMessageBox.prompt`（含同级名唯一 + 长度校验）；删除用 `ElMessageBox`（见 §6 确认框）。

### 4.3 `components/options/PasswordTable.vue` 改造

- 新增"分组"列：`prop="groupPath"`，由 `usePasswordManagement` 在 `filteredPasswords` 派生时（排序**之前**）为每行预计算 `groupPath = getGroupPath(row.groupId, groups)` 注入到条目副本（避免列内每行重复递归上溯；必须先于 `sortByChain` 注入，分组列排序才能读到该字段），`pagedPasswords` 自然携带，**默认隐藏**。
- 表头齿轮开关（`el-popover` + 复选）控制"分组"列显隐，状态持久化到新增键 `STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE`（独立布尔键，不并入其他配置）。
- "分组"列接入 `SortHeaderCell`，支持加入排序链（按 `groupPath` 字符串 `localeCompare`；排序链 `prop` 用 `groupPath`，`SORT_LABEL_KEYS` 加映射）。
- 行 `draggable="true"`，`dragstart` 时 `dataTransfer` 写入条目 id（多选时写全部选中 id）。

## 5. 搜索联动（核心）

### 5.1 左侧树搜索（分组名过滤）

- `GroupTreePanel` 内部 `keyword` 状态，调 `filterGroupsByKeyword(groups, keyword)` 得到保留 code 集，`el-tree` 据此过滤节点（命中 + 祖先链），命中文字高亮。
- **纯 UI 过滤，不触碰右侧密码列表**，清空即恢复完整树。

### 5.2 右侧主搜索（组内 AND 过滤）

`composables/usePasswordManagement.ts` 新增 `selectedGroupCode` 状态（默认 `ROOT_GROUP_CODE`）。`filteredPasswords` 计算链**最前置**插入分组过滤：

```
filteredPasswords =
  分组过滤(selectedGroupCode)      ← 新增，最前置
  → 关键词过滤(debouncedSearchKeyword)
  → 收藏过滤(favoriteOnly)
  → 标签过滤(filterTags)
  → 网址过滤(filterUrls)
  → sortByChain(sortChain)
```

分组过滤规则：

- `selectedGroupCode === ROOT_GROUP_CODE` → 不过滤（全部条目）；
- `selectedGroupCode === UNGROUPED_CODE` → 仅保留 `resolveEntryGroupId(groupId) === UNGROUPED_CODE` 的条目；
- 具体分组 → 仅保留 `groupId ∈ getDescendantCodes(code)` 的条目（本级 + 子孙聚合）。

- `searchFilteredPasswords`（筛选下拉候选基准集）同样前置分组过滤，保证标签/网址候选反映"当前分组 + 搜索语境"。
- 切换分组时：清空 `selectedIds`、`currentPage` 回到 1（复用现有 `watch([debouncedSearchKeyword, favoriteOnly, filterTags, filterUrls, sortChain])` 策略，把 `selectedGroupCode` 加入该 watch）。

## 6. 分组管理操作

### 6.1 操作集

| 操作     | 交互                                                        | 落盘                                       |
| -------- | ----------------------------------------------------------- | ------------------------------------------ |
| 新建分组 | 树上方"＋新建分组"（建根下）；节点 hover"＋"（建子分组）    | `createGroup`                              |
| 重命名   | 节点 hover"✎" → `ElMessageBox.prompt`（与 §4.2 一致）       | `renameGroup`                              |
| 删除分组 | 节点 hover"🗑" → 确认框                                      | `deleteGroup(code, mode)`                  |
| 移动分组 | 拖拽树节点到另一节点（含拖到根 = 变一级）                   | `moveGroup`                                |
| 同级排序 | 树内同级拖拽                                                | `reorderGroups`                            |
| 条目归组 | ① 弹窗 `el-tree-select`；② 表格行拖到树；③ 批量"移动到分组" | `batchUpdatePasswordMetadata` 改 `groupId` |

### 6.2 删除分组确认框（二选一）

当分组下有子分组或条目时，弹**自定义对话框** `components/options/GroupDeleteDialog.vue`（新增；三个动作按钮超出 `ElMessageBox` 双按钮能力，故自定义）：

- 标题：`删除分组「{name}」？`
- 说明：`该分组下有 {N} 个条目、{M} 个子分组`
- 动作按钮：
  - **仅删除分组**：分组及子孙移除，N 个条目移入"未分组"（`groupId` 清空，数据不丢）；
  - **删除分组和数据**（danger 样式）：分组及子孙移除，N 个条目进**回收站**（30 天可恢复，复用 `trashManager`）；
  - **取消**。
- 空分组（无子分组、无条目）：不弹此对话框，直接 `ElMessageBox.confirm` 简单确认后删除。

### 6.3 归组入口

- **① 弹窗下拉**：`PasswordFormDialog.vue` 新增"分组"字段，用 `el-tree-select`（数据源 `buildTree(groups)`，可选"未分组"）；`passwordForm` 加 `groupId`，保存时随条目落盘。`PasswordFormModel`（`utils/types.ts`）加 `groupId?: string`。
- **② 表格行拖拽**：见 §4.3 + §5（`GroupTreePanel` 节点为放置目标，drop 调 `batchUpdatePasswordMetadata`）。
- **③ 批量移动**：`SearchFilterBar.vue` 选中态新增"移动到分组"按钮，弹 `el-tree-select` 对话框（复用 `BatchTagDialog.vue` 形态），确认后批量改 `groupId`。

## 7. 导入导出 / 云同步（全部带分组）

### 7.1 `.aph` 加密备份（`utils/backupExport.ts`）

- `BackupData` 升 `version: 2`，新增 `groups: PasswordGroup[]`，`entries` 每条带 `groupId`。
- 导出：`exportEncryptedBackup(passwords, masterPassword, groups)` 写入分组树。
- 导入：`importEncryptedBackup` 返回 `{ entries, groups }`；读 v1 旧备份（无 `groups`）→ 条目全归未分组，向前兼容；读 v2 → 重建分组树 + 按 code 映射条目 `groupId`（导入时 code 重新生成避免与现有冲突，维护旧 code → 新 code 映射）。

### 7.2 JSON 导出/导入（`utils/excelJson.ts`）

- 导出：带 `groups` + 条目 `groupId`（与 `.aph` 同口径）。
- 导入：`parsePasswordJSON` 解析 `groups`，按 code 映射重建；无 `groups` 时条目归未分组。

### 7.3 Excel/CSV（`utils/excelFormatMap.ts` + `utils/excelCsv.ts` + `utils/excel.ts`）

- `CsvColumnMapping` 加 `group: string[]`；各格式映射：
  - `native`：`['分组', 'group', 'Group', '分组路径']`；
  - `chrome`/`lastpass`/`bitwarden`/`1password`：复用其既有分组语义列（如 bitwarden `folder`、lastpass `grouping`）——**注意**：这些列当前已映射到 `tag`，需决策是改映射到 `group` 还是保持 `tag`。**本设计决定**：第三方格式的 folder/grouping 列改映射到 `group`（按路径建组），更符合语义；`native` 模板新增独立"分组"列。
- 导出：CSV/Excel 新增"分组"列，值为全路径 `getGroupPath(groupId)`（`工作/项目A`，用 `/` 分隔）。
- 导入：`parseCSVBuffer` 解析"分组"列 → `ensureGroupByPath` 逐级建组（同名同级复用）→ 条目 `groupId` 指向叶子。
- 下载模板（`ExcelUtils.downloadTemplate`）：表头加"分组"列 + 示例路径。

### 7.4 云文档同步（修订云同步规格 V1.2 → V1.3）

> 本功能会修改已定稿但尚未完全实现的云同步规格（`docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md`，状态"待用户审查"，实现仅完成基础模块）。现在改成本最低。

- **明文模式表结构**（云同步规格 §4.1）：8 → **9 字段**，新增"分组"列（全路径文本，飞书 type=1，腾讯 text），置于"标签"之后、"本地更新时间"之前。
- **`utils/cloudSync/schema.ts`** 同步调整：
  - `PLAINTEXT_FIELDS` 加 `group: '分组'`；
  - `PLAINTEXT_TABLE_SPEC` 插入分组列；
  - `getRequiredFieldNames('plaintext')` 加"分组"；
  - `entryToFields` / `fieldsToEntry` 处理分组全路径 ↔ `groupId`（云端存路径，本地存 code，边界用 `getGroupPath` / `ensureGroupByPath` 转换）；
  - `SYNCED_TEXT_FIELDS` 哈希口径**加入分组**（`['username','password','url','tag','remark','totp','group']`），使分组变更参与 LWW diff。
- **`utils/cloudSync/types.ts`** 的 `LocalSyncEntry` 加 `groupPath: string`（同步边界统一以全路径为交换格式；syncEngine 组装 `LocalSyncEntry` 时负责用 `getGroupPath(entry.groupId, groups)` 计算，未分组为空串）。
- **密文模式**：整库 JSON 序列化天然包含 `groups` + `groupId`（密文快照是 `BackupData` 同构），**无需改表结构**。
- 云端拉取（恢复/明文双向）：按"分组"列路径 `ensureGroupByPath` 建组后写回条目 `groupId`。
- **云同步规格文档回改**：§4.1 表结构、§3.2 字段类型说明、§14 测试矩阵（schema 9 字段）、版本号 V1.2 → V1.3 + 修订说明。

## 8. i18n / 文档 / 测试

### 8.1 i18n

- `utils/i18n/locales/zh-CN/options.json` + `en/options.json` 新增 `options.group.*` namespace：
  - `title`（分组）、`create`（新建分组）、`rename`、`delete`、`ungrouped`（未分组）、`rootName`（分组）、`searchPlaceholder`（搜索分组）、`moveToGroup`（移动到分组）、`entryCount`（{count} 个条目）、`subGroupCount`（{count} 个子分组）、`deleteConfirmTitle`、`deleteConfirmMessage`、`deleteGroupOnly`（仅删除分组）、`deleteGroupAndData`（删除分组和数据）、`nameRequired`、`nameTooLong`、`nameDuplicate`、`groupColumn`（分组）、`showGroupColumn`（显示分组列）等。
- 中英 key 集必须一致，跑 `tests/utils/i18nBundles.test.ts`。
- 仅 Options 侧使用，**不新增 i18n-lite 文案**（无 content/background 可见文案）。

### 8.2 文档

- `README.md` / `README.en.md`：功能说明新增"树形分组"。
- `docs/ARCHITECTURE.md` / `.en.md`：「功能实现详解」新增"分组树"节（数据结构、存储、搜索联动、拖拽）。
- 云同步规格 V1.2 → V1.3 回改（§7.4）。
- `wxt.config.ts`：**无权限变化**。

### 8.3 测试

| 模块                    | 测试用例                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groupTree.ts`          | `buildTree` 扁平→树、`getGroupPath` 全路径、`getDescendantCodes` 子孙聚合、`filterGroupsByKeyword` 命中 + 祖先链、`resolveEntryGroupId` 无效归一、`ensureGroupByPath` 逐级建组 + 同名复用、`countEntriesByGroup` 聚合计数 |
| `groupManager`          | CRUD 往返、同级名唯一校验、删除二选一（toUngrouped 条目清空 / toTrash 进回收站）、moveGroup 防环、reorderGroups                                                                                                           |
| `usePasswordManagement` | 分组过滤联动（根/具体分组/未分组）、切换分组清空选中 + 回第 1 页、分组 + 关键词 AND、分组列排序链                                                                                                                         |
| 备份兼容                | `.aph` v1→v2 导入（旧备份归未分组）、v2 往返（groups + groupId）、JSON 同口径                                                                                                                                             |
| Excel                   | 路径建组导入、全路径导出、模板含分组列、第三方 folder/grouping 列映射到 group                                                                                                                                             |
| 云同步 schema           | 明文表 9 字段、`entryToFields`/`fieldsToEntry` 分组路径 ↔ code、`SYNCED_TEXT_FIELDS` 含分组                                                                                                                               |

**验证矩阵**：`pnpm typecheck`、`pnpm lint`、`pnpm test:run`、`pnpm build`；文档与 JSON 改动跑 `pnpm exec prettier --check <files>`。

## 9. 安全与兼容边界

1. **分组非敏感**：分组名 + 层级不含账号/密码，不加密存储；但分组名仍**不得**写入日志（`utils/logger.ts` 仅记录 code/数量，不记录分组名原文，避免泄露用户组织习惯）。
2. **`groupId` 无效降级**：条目 `groupId` 指向已删除分组时，`resolveEntryGroupId` 归一到未分组，不报错、不丢条目。
3. **删除数据安全**：「删除分组和数据」走回收站（30 天可恢复），非物理删除；「仅删除分组」条目移入未分组，零数据丢失。
4. **向前兼容**：旧 `.aph`/JSON/Excel 备份无分组数据时正常导入（条目归未分组）；旧版本扩展读新备份忽略 `groups`/`groupId` 字段（JSON 解析容错）。
5. **云同步规格联动**：明文表加列会改变已批准表结构与 diff 哈希口径，必须同步回改云同步规格文档并更新其测试；密文模式不受影响。
6. **拖拽防环**：`moveGroup` 校验目标不是自己的子孙，`el-tree` `allow-drop` 同步约束，双重防护。
7. **性能**：分组过滤/路径计算为纯函数，条目数百级时 `getDescendantCodes` 结果可缓存（按 groups 引用 memoize）；归组走元数据轻量路径，不触发全量解密重加密。

## 10. 范围外（YAGNI）

- 不做多对多分组；不做侧边栏/Popup 分组；不做分组图标/颜色；不做分组级加密或权限；不做自动归类；不做分组层级深度硬限制；不做分组回收站（删除即删，条目可进回收站）。
