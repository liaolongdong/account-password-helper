# 页面悬浮按钮组功能实现计划

## 需求概述

为Chrome插件增加页面右侧悬浮按钮组，包含3个按钮：
1. **快速填充侧边栏显隐按钮** - 控制侧边栏显示/隐藏
2. **密码管理页面跳转按钮**（中间按钮）- 跳转到密码管理页面，避免重复打开
3. **插件设置按钮** - 设置悬浮按钮展示方式、快捷键等

### 核心交互

- **拖拽功能**：按住中间按钮可拖拽，拖拽时三个按钮合并为一个，释放时自动吸附到最近边缘并展开
- **动效要求**：所有交互都需要平滑动画效果
- **位置持久化**：按钮位置跨页面/会话保存
- **显示控制**：用户可控制悬浮按钮是否显示，隐藏后可在密码管理页面重新开启

---

## 技术方案

### 架构

```
Content Script (原生DOM + Shadow DOM)
├── FloatingButtonManager (生命周期管理)
├── DragHandler (拖拽逻辑)
├── AnimationController (动效控制)
└── SettingsPanel (设置面板)
```

使用 **Shadow DOM** 隔离样式，避免与宿主页面冲突。

---

## 实现步骤

### 阶段1: 基础架构

**任务1.1**: 创建核心管理类

新建 `entrypoints/content/floatingButtons/FloatingButtonManager.ts`:
- 创建Shadow DOM根节点
- 渲染3个按钮的HTML结构
- 注入隔离CSS样式
- 从Chrome Storage读取并应用位置配置

**任务1.2**: 集成到content.ts

修改 `entrypoints/content.ts`:
- 导入并实例化FloatingButtonManager
- 在FormDetector初始化后创建悬浮按钮
- 监听storage变化以响应显示/隐藏配置

**任务1.3**: 扩展类型定义

修改 `utils/types.ts`:
```typescript
// 新增消息类型
TOGGLE_SIDEPANEL_VISIBILITY = 'TOGGLE_SIDEPANEL_VISIBILITY',
OPEN_OPTIONS_PAGE = 'OPEN_OPTIONS_PAGE',
TOGGLE_FLOATING_BUTTONS = 'TOGGLE_FLOATING_BUTTONS',

// 新增接口
interface FloatingButtonConfig {
  visible: boolean;           // 是否显示悬浮按钮
  position: 'left' | 'right'; // 位置
  offsetY: number;            // 垂直偏移(px)
  opacity: number;            // 透明度(0-1)
}
```

### 阶段2: 按钮样式与图标

**任务2.1**: 创建按钮样式

新建 `entrypoints/content/floatingButtons/styles.ts`:
- 按钮组垂直排列样式
- 左右位置切换样式
- 悬停效果
- 图标样式

**任务2.2**: 创建SVG图标

新建 `entrypoints/content/floatingButtons/icons.ts`:
- 侧边栏图标（展开/收起状态）
- 密码管理图标（钥匙/盾牌）
- 设置图标（齿轮）
- 拖拽手柄图标（6个点）

### 阶段3: 拖拽功能

**任务3.1**: 创建拖拽处理器

新建 `entrypoints/content/floatingButtons/DragHandler.ts`:
- 监听中间按钮的mousedown/touchstart
- 计算拖拽偏移量
- 使用transform实时更新位置
- 支持触摸设备

**任务3.2**: 实现吸附逻辑

在DragHandler中添加:
- 计算最近边缘（左/右）
- 释放时平滑吸附动画
- 保存最终位置到Chrome Storage

### 阶段4: 动效实现

**任务4.1**: 创建动画控制器

新建 `entrypoints/content/floatingButtons/AnimationController.ts`:
- `collapse()`: 拖拽开始时，其他按钮淡出缩小合并到中间按钮
- `expand()`: 拖拽结束时，按钮展开恢复
- `snapToEdge()`: 吸附动画（cubic-bezier缓动）

**任务4.2**: 定义CSS动画

在styles.ts中添加:
```css
/* 折叠状态 */
.button-group[data-state="collapsed"] .btn:not(.active) {
  opacity: 0;
  transform: scale(0.5);
}

/* 展开动画 */
.btn { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
```

### 阶段5: 按钮功能实现

**任务5.1**: 侧边栏切换按钮

实现点击逻辑:
- 发送SHOW_SIDEPANEL或HIDE_SIDEPANEL消息
- 切换按钮图标状态
- 添加loading状态防止重复点击

**任务5.2**: 密码管理跳转按钮

修改 `entrypoints/background.ts`:
- 查询是否已有options.html打开
- 已打开则激活该标签页并聚焦窗口
- 未打开则创建新标签页

**任务5.3**: 设置按钮

实现点击逻辑:
- 在Shadow DOM内创建设置面板
- 面板内容：显示/隐藏开关、透明度滑块、快捷键链接

### 阶段6: 设置面板

**任务6.1**: 创建设置面板UI

新建 `entrypoints/content/floatingButtons/SettingsPanel.ts`:
```
┌─────────────────────────────────┐
│  悬浮按钮设置                    │
├─────────────────────────────────┤
│  显示悬浮按钮: [开关]           │
│  按钮透明度:   [滑块] 80%       │
│  快捷键设置:   [修改快捷键]     │
│                                 │
│         [关闭]                  │
└─────────────────────────────────┘
```

**任务6.2**: 实现配置保存

- 配置变更时保存到Chrome Storage
- 实时应用配置（无需刷新页面）

### 阶段7: 密码管理页面集成

**任务7.1**: 添加悬浮按钮控制入口

修改 `entrypoints/options/App.vue`:
- 在页面头部添加"显示悬浮按钮"开关
- 开关状态与Chrome Storage同步

### 阶段8: 存储扩展

**任务8.1**: 扩展存储工具

修改 `utils/storage.ts`:
- 新增FLOATING_BUTTON_CONFIG存储键
- 添加读写方法：
  - `getFloatingButtonConfig()`
  - `saveFloatingButtonConfig(config)`

---

## 文件变更清单

### 新增文件 (6个)

| 文件路径 | 功能 |
|---------|------|
| `entrypoints/content/floatingButtons/FloatingButtonManager.ts` | 核心管理类 |
| `entrypoints/content/floatingButtons/DragHandler.ts` | 拖拽逻辑 |
| `entrypoints/content/floatingButtons/AnimationController.ts` | 动效控制 |
| `entrypoints/content/floatingButtons/SettingsPanel.ts` | 设置面板 |
| `entrypoints/content/floatingButtons/styles.ts` | 样式定义 |
| `entrypoints/content/floatingButtons/icons.ts` | SVG图标 |

### 修改文件 (4个)

| 文件路径 | 修改内容 |
|---------|---------|
| `entrypoints/content.ts` | 初始化FloatingButtonManager |
| `entrypoints/background.ts` | 处理新消息类型、优化页面跳转逻辑 |
| `entrypoints/options/App.vue` | 添加悬浮按钮显示控制开关 |
| `utils/types.ts` | 新增消息类型和配置接口 |
| `utils/storage.ts` | 新增悬浮按钮配置存储方法 |

---

## 验证计划

### 功能测试

1. **按钮显示**
   - 在普通网页加载后悬浮按钮正确显示在右侧
   - 按钮图标清晰可见

2. **按钮点击**
   - 点击侧边栏按钮，侧边栏正确打开/关闭
   - 点击密码管理按钮，跳转到options页面
   - 多次点击密码管理按钮，不会打开多个页面
   - 点击设置按钮，设置面板正确显示

3. **拖拽功能**
   - 按住中间按钮可以拖拽
   - 拖拽开始时其他两个按钮合并到中间
   - 拖拽过程中按钮跟随鼠标移动
   - 释放后按钮吸附到最近边缘
   - 吸附后三个按钮展开恢复

4. **动效**
   - 按钮合并动画平滑
   - 按钮展开动画平滑
   - 吸附动画平滑

5. **位置持久化**
   - 刷新页面后按钮位置保持
   - 关闭浏览器重新打开后位置保持
   - 切换到其他页面位置同步

6. **设置功能**
   - 关闭悬浮按钮后不再显示
   - 在密码管理页面打开悬浮按钮后重新显示
   - 透明度调节实时生效

### 兼容性测试

- 测试不同网站（GitHub、Google、百度等）
- 测试触摸设备（如有）
- 测试窗口resize时按钮位置正确

---

## 关键实现细节

### Shadow DOM 结构

```html
<floating-button-root>
  #shadow-root (closed)
    <style>...</style>
    <div class="floating-container" data-position="right">
      <div class="button-group" data-state="expanded">
        <button class="btn btn-sidepanel" title="快速填充">
          <svg>...</svg>
        </button>
        <button class="btn btn-options active" title="密码管理">
          <svg>...</svg>
          <div class="drag-handle">⋮⋮</div>
        </button>
        <button class="btn btn-settings" title="设置">
          <svg>...</svg>
        </button>
      </div>
    </div>
</floating-button-root>
```

### 拖拽动画时序

```
拖拽开始 (mousedown)
  └─ [0ms] 标记isDragging
  └─ [0-150ms] 其他按钮淡出缩小 (opacity: 0, scale: 0.5)
  └─ [150ms] 完成折叠

拖拽中 (mousemove)
  └─ 实时更新transform位置
  └─ 显示吸附预览线

拖拽结束 (mouseup)
  └─ [0ms] 计算最近边缘
  └─ [0-300ms] 吸附动画 (cubic-bezier)
  └─ [300ms] 吸附完成
  └─ [300-500ms] 按钮展开动画 (opacity: 1, scale: 1)
  └─ [500ms] 完成，保存位置
```

### 存储结构

```typescript
// Chrome Storage 键
FLOATING_BUTTON_CONFIG: 'floating_button_config'

// 数据结构
{
  visible: true,       // 是否显示
  position: 'right',   // 左/右
  offsetY: 0,          // 垂直偏移(px)
  opacity: 0.9         // 透明度
}
```
