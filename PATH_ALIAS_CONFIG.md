# WXT 路径别名配置说明

## 📋 配置概述

本项目已成功配置WXT框架中的路径别名，类似于Vite的路径别名功能。

## 🔧 配置文件

### 1. wxt.config.ts

```typescript
import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Vite 配置，包括路径别名
  vite: () => ({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@/components': path.resolve(__dirname, './components'),
        '@/utils': path.resolve(__dirname, './utils'),
        '@/entrypoints': path.resolve(__dirname, './entrypoints'),
        '@/assets': path.resolve(__dirname, './assets')
      }
    }
  }),
  manifest: {
    // ... 其他配置
  }
});
```

### 2. tsconfig.json

```json
{
  "compilerOptions": {
    // ... 其他配置
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@/components/*": ["./components/*"],
      "@/utils/*": ["./utils/*"],
      "@/entrypoints/*": ["./entrypoints/*"],
      "@/assets/*": ["./assets/*"]
    }
  }
}
```

## 🎯 支持的路径别名

| 别名             | 对应路径         | 说明          |
| ---------------- | ---------------- | ------------- |
| `@/`             | `./`             | 项目根目录    |
| `@/components/`  | `./components/`  | Vue组件目录   |
| `@/utils/`       | `./utils/`       | 工具函数目录  |
| `@/entrypoints/` | `./entrypoints/` | WXT入口点目录 |
| `@/assets/`      | `./assets/`      | 静态资源目录  |

## 📝 使用示例

### TypeScript/JavaScript 文件中使用

```typescript
// 使用别名导入
import { StorageUtils } from '@/utils/storage';
import type { PasswordEntry } from '@/utils/types';
import { ExcelUtils } from '@/utils/excel';

// 替代传统的相对路径导入
// import { StorageUtils } from '../../utils/storage';
```

### Vue 组件中使用

```vue
<script setup lang="ts">
import { StorageUtils } from '@/utils/storage';
import ImportDialog from '@/components/ImportDialog.vue';
</script>
```

## ✅ 配置验证

路径别名配置已通过以下方式验证：

1. ✅ **TypeScript 编译**：无类型错误
2. ✅ **WXT 构建**：构建成功，无模块解析错误
3. ✅ **实际使用**：项目中多个文件成功使用路径别名导入

## 🔍 技术要点

### WXT 中的 Vite 配置

- WXT 基于 Vite 构建，可以通过 `vite` 配置项传递 Vite 配置
- 配置必须使用函数形式：`vite: () => ({})`
- 支持所有 Vite 的 resolve.alias 配置

### TypeScript 路径映射

- 需要在 `tsconfig.json` 中配置 `paths` 映射
- `baseUrl` 必须设置为当前目录 `.`
- 路径映射确保 TypeScript 能够正确解析别名

## 🚀 优势

1. **简化导入路径**：避免复杂的相对路径 `../../`
2. **提高可维护性**：文件移动时无需修改导入路径
3. **增强可读性**：路径语义更清晰
4. **支持 IDE 智能提示**：完整的 TypeScript 支持

## 📂 项目结构

```
account-password-helper/
├── components/          # @/components
├── entrypoints/         # @/entrypoints
├── utils/              # @/utils
├── assets/             # @/assets
├── tsconfig.json       # TypeScript 配置
└── wxt.config.ts       # WXT 配置（包含路径别名）
```

配置完成后，您可以在项目的任何地方使用 `@/` 开头的路径别名来导入模块，提升开发体验！
