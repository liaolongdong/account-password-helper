# 密码管理工具加密解密逻辑优化方案

## 概述

优化密码管理工具的加密解密逻辑，实现会话期间明文存储、会话失效时加密存储的无缝切换机制，提升读取性能并确保数据安全。

## 需求分析

### 用户需求
1. **会话期间明文存储** - 主密码验证成功后，敏感字段（username、password、url、remark）以明文存储
2. **功能模块适配** - 密码列表加载、搜索、复制、编辑、删除等功能正确处理明文数据
3. **会话失效时加密** - 会话过期或清除时自动重新加密所有敏感字段
4. **无缝切换** - 会话建立时解密，会话结束时加密的自动转换
5. **兼容性** - 处理加密+明文混合数据
6. **性能优化** - 会话有效期内避免重复加解密

### 现有实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 会话创建时解密 | ✅ 已实现 | `createSession()` 调用 `decryptAllPasswordsOnSessionCreate()` |
| 会话清除时加密 | ✅ 已实现 | `clearSession()` 调用 `encryptAllPasswordsBeforeSessionClear()` |
| 同步会话检查 | ✅ 已实现 | `isSessionActiveSync()` 基于内存变量快速判断 |
| 保存/更新决策 | ✅ 已实现 | `savePassword()`/`updatePassword()` 使用会话状态决定是否加密 |
| 数据读取优化 | ⚠️ 需优化 | `getAllPasswords()` 会话有效时仍检查加密标记 |
| 前端调用简化 | ⚠️ 需优化 | 会话有效时仍传递 masterPassword 参数 |

## 实现方案

### 核心原则

**状态驱动的数据访问**：
- 会话有效期内 → 所有数据操作基于明文，跳过加解密
- 会话无效时 → 数据操作需主密码进行加解密
- 转换时机 → 仅在会话创建/销毁时批量转换一次

---

### 修改 1：优化 `getAllPasswords()` 方法

**文件**: `utils/storage.ts`  
**位置**: 第 526-567 行

**当前问题**：即使会话有效、数据已明文，仍检查 `encrypted` 标记并准备解密

**优化方案**：
```typescript
static async getAllPasswords(masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    // 优化：会话有效时直接返回明文数据，无需任何加密检查
    if (this.isSessionActiveSync()) {
      const rawData = await this.getAllPasswordsRaw();
      return rawData as PasswordEntry[];
    }

    // 会话无效时，执行原有逻辑
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const entries: (PasswordEntry | EncryptedPasswordEntry)[] = result[STORAGE_KEYS.PASSWORDS] || [];

    const hasEncryptedEntries = entries.some(entry => 'encrypted' in entry && entry.encrypted === true);

    if (!hasEncryptedEntries) {
      return entries as PasswordEntry[];
    }

    if (!masterPassword) {
      throw new Error('需要主密码来解密数据');
    }

    // 解密逻辑保持不变...
  } catch (error) {
    console.error('StorageUtils: 获取密码列表失败:', error);
    throw new Error('加载密码列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
  }
}
```

---

### 修改 2：优化 `getPasswordsByUrl()` 方法

**文件**: `utils/storage.ts`  
**位置**: 第 572-588 行

**当前问题**：始终传递 masterPassword 给 `getAllPasswords()`

**优化方案**：
```typescript
static async getPasswordsByUrl(url: string, masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    // 优化：会话有效时不传递 masterPassword
    const sessionActive = this.isSessionActiveSync();
    const allPasswords = sessionActive
      ? await this.getAllPasswords()
      : await this.getAllPasswords(masterPassword);

    const filteredPasswords = allPasswords.filter(p => {
      if (!p.url || p.url.trim() === '') return true;
      return url.includes(p.url) || p.url.includes(url);
    });

    await this.applySavedSortConfig(filteredPasswords);
    return filteredPasswords;
  } catch (error) {
    console.error('StorageUtils: 根据URL搜索密码失败:', error);
    return [];
  }
}
```

---

### 修改 3：优化 `searchPasswords()` 方法

**文件**: `utils/storage.ts`  
**位置**: 第 593-614 行

**优化方案**：与 `getPasswordsByUrl()` 相同，根据会话状态决定是否传递 masterPassword

---

### 修改 4：简化 SidePanel 的 `loadPasswords()` 方法

**文件**: `entrypoints/sidepanel/App.vue`  
**位置**: 第 314-344 行

**当前问题**：会话有效时仍获取并传递 masterPassword

**优化方案**：
```typescript
const loadPasswords = async () => {
  try {
    loading.value = true;

    const sessionValid = await StorageUtils.isSessionValid();
    if (!sessionValid) {
      isAuthenticated.value = false;
      passwords.value = [];
      return;
    }

    // 会话有效，直接获取数据（StorageUtils 内部会判断是否需要解密）
    let loadedPasswords: PasswordEntry[];
    if (currentDomain.value) {
      loadedPasswords = await StorageUtils.getPasswordsByUrl(currentDomain.value);
    } else {
      loadedPasswords = await StorageUtils.getAllPasswords();
      sortPasswords(loadedPasswords);
    }

    passwords.value = loadedPasswords;
    await updatePasswordCacheInBackground(loadedPasswords, currentDomain.value, isAuthenticated.value);
  } catch (error) {
    console.error('加载密码列表失败:', error);
    ElMessage.error('加载密码列表失败');
  } finally {
    loading.value = false;
  }
};
```

---

### 修改 5：简化 Options 页面的 `loadPasswords()` 方法

**文件**: `entrypoints/options/App.vue`  
**位置**: 找到 `loadPasswords` 函数定义处

**优化方案**：与 SidePanel 相同的简化逻辑

---

### 修改 6（可选）：增强 `isSessionValid()` 状态一致性校验

**文件**: `utils/storage.ts`  
**位置**: 第 816-864 行

**目的**：处理浏览器崩溃恢复等边界情况

**优化方案**：在会话恢复成功后，检查数据状态是否一致
```typescript
// 在 isSessionValid() 返回 true 之前增加
if (sessionValid) {
  // 检查数据状态一致性
  const rawData = await this.getAllPasswordsRaw();
  const hasEncrypted = rawData.some(e => (e as EncryptedPasswordEntry).encrypted === true);
  
  if (hasEncrypted) {
    // 会话有效但数据已加密，需要重新解密
    console.warn('StorageUtils: 检测到状态不一致，正在修复...');
    const masterPassword = await this.getSessionMasterPasswordDecrypted();
    if (masterPassword) {
      await this.decryptAllPasswordsOnSessionCreate(masterPassword);
    }
  }
}
```

---

## 实现步骤

### 步骤 1：修改 storage.ts 核心方法
1. 优化 `getAllPasswords()` - 会话有效时直接返回明文
2. 优化 `getPasswordsByUrl()` - 根据会话状态传参
3. 优化 `searchPasswords()` - 根据会话状态传参
4. 增强 `isSessionValid()` - 添加状态一致性校验

### 步骤 2：简化前端调用
1. 修改 `entrypoints/sidepanel/App.vue` 的 `loadPasswords()`
2. 修改 `entrypoints/options/App.vue` 的 `loadPasswords()`
3. 移除不必要的 masterPassword 获取和传递逻辑

### 步骤 3：测试验证
1. 运行扩展，测试各场景
2. 检查 Chrome Storage 中的数据状态
3. 验证性能提升

---

## 验证方案

### 功能测试清单

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 首次设置 | 设置主密码 | 创建会话，数据明文存储 |
| 会话有效 | 添加密码 | 直接明文保存，无加密 |
| 会话有效 | 编辑密码 | 直接明文更新，无加密 |
| 会话有效 | 加载列表 | 直接读取明文，无解密操作 |
| 会话有效 | 搜索/筛选 | 基于明文操作 |
| 会话过期 | 自动触发 | 所有数据自动加密 |
| 重新登录 | 验证主密码 | 所有数据自动解密 |
| 手动清除 | 清除会话 | 数据加密，显示登录页 |
| 混合状态 | 加载列表 | 只解密加密条目 |
| 浏览器重启 | 恢复会话 | 数据状态与会话状态一致 |

### 性能验证
```javascript
// 在浏览器控制台测试
console.time('loadPasswords');
await StorageUtils.getAllPasswords();
console.timeEnd('loadPasswords');
```

### 数据状态检查
```javascript
// 检查存储中的数据状态
const result = await chrome.storage.local.get('account_passwords');
console.log('加密条目数:', result.account_passwords?.filter(e => e.encrypted).length);
console.log('明文条目数:', result.account_passwords?.filter(e => !e.encrypted).length);
```

---

## 关键文件

- `utils/storage.ts` - 核心存储逻辑修改
- `entrypoints/sidepanel/App.vue` - SidePanel 调用简化
- `entrypoints/options/App.vue` - Options 页面调用简化

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据状态不一致 | 中 | `isSessionValid()` 增加状态校验和自动修复 |
| 加密失败导致明文泄露 | 高 | `clearSession()` 中加密失败时不清除会话密钥 |
| 并发操作冲突 | 低 | 所有操作前检查 `isSessionActiveSync()` |
