# SidePanel Windows 性能优化方案

## 问题根因

侧边栏 `initSidepanelData()` 中存在 **`initializing` 状态阻塞 UI** 的设计缺陷：

```
HTML 加载 → Vue 挂载 → onMounted():
  1. Promise.all([loadCurrentTab(), isSessionValid()])  ✓ ~100ms
  2. 并行启动:
     a. loadPasswords(true) → storage 直读         ✓ ~50-200ms (数据在此步就已就绪!)
     b. getCachedPasswordsFromBackground(1200ms)    ✗ Windows SW 冷启动 → 超时 1200ms
  3. await cachePromise  ← 🔴 阻塞 1200ms, 此时 storage 数据早已就绪
  4. await storagePromise ← storage 早已完成, 立即返回
  5. finally { initializing = false }  ← 🔴 至此 UI 才显示
```

- **Mac**: SW 热启动 ~20ms，缓存快速返回 → `initializing` 在 ~300ms 变为 false → 秒开
- **Windows**: SW 冷启动 800-1500ms，缓存超时 → `initializing` 在 ~1500ms+ 才变为 false → 4~5 秒白屏

实际上 `loadPasswords()` 在 ~50-200ms 时已完成，`passwords.value` 和 `loading.value` 都已就绪，但 `v-if="initializing"` 将整个 UI 屏蔽为 loading 动画。

## 优化任务

### 任务 1: 修复 `initializing` 阻塞模式 —— 储存数据就绪即解除 loading

**文件**: `composables/useSidepanelData.ts`

**核心改动**: 当存储路径（authoritative source）数据加载完成时，立即将 `initializing` 设为 `false`，不再等待缓存响应。缓存仅作为「锦上添花」的快速路径，不得阻塞 UI。

**具体变更**:
1. `initSidepanelData()` 中，将 `await cachePromise` 后置，不再阻塞主流程：
   - 存储路径完成后立即 `initializing = false`，展示密码列表
   - 缓存路径作为 fire-and-forget 后台同步，仅用于加速下一次打开
2. 缩短 `getCachedPasswordsFromBackground` 超时从 1200ms → 500ms（SW 热启动 20ms 即可命中，500ms 已足够宽容）
3. 添加 `storageReady` 本地标志位，`loadPasswords()` 完成后通过回调或 watch 驱动 `initializing`

### 任务 2: Service Worker 预唤醒机制

**文件**: 
- `entrypoints/background/messageRouter.ts` (新增简单 ping handler)
- `entrypoints/content.ts` (添加 content script 侧预唤醒)
- `composables/useSidepanelData.ts` (可选：sidepanel 侧快速探测)

**核心改动**: 在 content script 检测到用户可能即将打开侧边栏时（如点击扩展图标、悬浮按钮、快捷键），提前发送轻量消息唤醒 SW。

**具体变更**:
1. 在 `messageRouter.ts` 中添加 `PING_SW` 消息类型（极简 handler，直接 sendResponse）
2. content script 中，当 `FloatingButtonManager` 的「快速填充」按钮被 hover/focus 时，发送 `PING_SW` 预热 SW
3. sidepanel 侧的 `initSidepanelData` 在 port 连接后立即发送一个轻量 `PING_CACHE` 消息，不等响应，目的是提前激活 SW 的消息处理循环

### 任务 3: 优化 `isSessionValid()` —— 批量读取 + 内存缓存

**文件**: `utils/sessionManager-storage.ts`

**核心改动**: `isSessionValid()` 在 sidepanel 首次加载时必须从 storage 恢复会话状态，当前已做批量读取优化（6 keys 一次 `get`），但可进一步减少不必要的操作。

**具体变更**:
1. 首次加载时，`isSessionValid()` 的批量读取结果中 `PASSWORDS` key 可以省略 —— sidepanel 不需要在此阶段读取密码数据（由 `loadPasswords` 负责）
2. 将批量读取从 6 keys 减少到 5 keys（移除 `STORAGE_KEYS.PASSWORDS`）
3. 用 `chrome.storage.session`（内存级存储）缓存会话有效性结果，sidepanel 下次同标签页打开时直接命中

### 任务 4: Element Plus 图标按需加载优化

**文件**: `entrypoints/sidepanel/App.vue`

**核心改动**: 当前模板中导入了 12 个 Element Plus 图标组件，部分图标在初始渲染时不可见。将非首屏必需的图标改为异步/懒加载，减少 Vue 组件树编译开销。

**具体变更**:
1. 首屏不可见的图标（如 `Check`, `Timer`, `Refresh`, `User`, `Link`, `Clock` — 仅在排序下拉中可见）改用 `shallowRef` + 动态 `defineAsyncComponent`
2. `Sort`, `StarFilled`, `Star`, `Plus` 等直接可见的图标保持同步导入

### 任务 5: 存储读取并行化微调

**文件**: `composables/useSidepanelData.ts`

**核心改动**: 将 `loadCurrentTab()` + `isSessionValid()` 的并行化提前到 `initSidepanelData` 的更早阶段，与 port 连接和事件注册并行执行，进一步压缩串行等待时间。

**具体变更**:
1. 将 `Promise.all([loadCurrentTab(), StorageUtils.isSessionValid()])` 提前到 port 连接和事件注册之后立即执行（已是最佳位置）
2. 将 `sortConfig` 的读取从 `loadPasswords` 内部移至 init 阶段与 session check 并行（可再节省 ~50ms）

### 任务 6: HTML 级 Skeleton Screen 升级

**文件**: `entrypoints/sidepanel/index.html`

**核心改动**: 当前 HTML loading 占位只是一个 spinner + "加载中..."，用户体验较差。升级为包含头部骨架 + 搜索框占位的 skeleton screen，让用户在白屏期间有「正在加载」的明确预期。

**具体变更**:
1. 添加头部栏骨架（灰色圆角矩形占位）
2. 添加搜索框骨架
3. 添加 3-5 个列表项骨架（使用 CSS animation pulse 效果）
4. Vue mount 后 `#app-loading` 自动被替换，无需额外清理逻辑

---

## 预期效果

| 指标 | 优化前 (Windows) | 优化后 (Windows) | macOS 参考 |
|------|-----------------|-----------------|-----------|
| Vue mount 到首帧渲染 | ~1500ms | ~300ms | ~200ms |
| `initializing` 持续时间 | ~1500ms+ | ~300ms | ~300ms |
| 密码列表可见时间 | ~4~5s | ~0.5~1s | ~0.3~0.5s |
| 白屏感知时长 | 明显白屏 | 几乎无感 | 几乎无感 |

## 风险评估

- **任务 1**: 低风险。存储路径本就是 authoritative source，提前展示不影响数据正确性。缓存路径仅用于后续打开的加速。
- **任务 2**: 低风险。PING 消息为纯探测，无副作用。
- **任务 3**: 低风险。`PASSWORDS` 在 `loadPasswords` 中会重新读取，此处移除不影响正确性。
- **任务 4**: 低风险。动态导入的图标在排序下拉展开时才会加载，已使用 `defineAsyncComponent` 保证降级。
- **任务 5**: 低风险。仅调整并行化粒度，不改变执行逻辑。
- **任务 6**: 零风险。纯 HTML/CSS 改动，Vue mount 后自动替换。
