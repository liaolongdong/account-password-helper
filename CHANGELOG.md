# Changelog

## [2.9.0](https://github.com/liaolongdong/account-password-helper/compare/v2.8.0...v2.9.0) (2026-07-08)


### Features

* **background:** 实现 Service Worker 保活及侧边栏数据一站式加载 ([2a73c30](https://github.com/liaolongdong/account-password-helper/commit/2a73c30256bd1d272a74b8c3ac98913881bcff2d))
* **content:** 新增页面切换时预唤醒 Service Worker 机制 ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))
* **form:** 支持更多输入类型并完善登录元素检测触发机制 ([0969407](https://github.com/liaolongdong/account-password-helper/commit/09694073e0c345403b70b5a92e5c6e36f27568a3))
* **parser:** 优化 CSV 文件解析支持多编码回退 ([5033e42](https://github.com/liaolongdong/account-password-helper/commit/5033e42fdea7962cd1f95bbca3855b44a6706d5c))
* **popup:** 打开 popup 时预唤醒 Service Worker ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))
* **sidepanel:** 实现初始化数据并行竞速加载 ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))


### Bug Fixes

* **form-detector:** 修复手机号单字段登录检测逻辑及缓存管理 ([00e34c3](https://github.com/liaolongdong/account-password-helper/commit/00e34c3eb8c8c2b72104e0f9675c3f7c80edb4b3))
* **session:** 优化会话过期状态管理，防止认证状态闪烁 ([708ca95](https://github.com/liaolongdong/account-password-helper/commit/708ca9590b4753680a67804274f06a645d887afd))
* **sidepanel:** 延长超时及增强缓存预热逻辑 ([4df28a8](https://github.com/liaolongdong/account-password-helper/commit/4df28a8927bc2159063e6e7e06bf42d45c57dc27))
* **storage:** 优化缓存和加载流程，提升性能和稳定性 ([01235a9](https://github.com/liaolongdong/account-password-helper/commit/01235a992f46a116ab44c3d9d285d41b7106ebb5))


### Performance Improvements

* **sidepanel:** 优化 SidePanel 性能与非阻塞 CSS 加载 ([c8ea61f](https://github.com/liaolongdong/account-password-helper/commit/c8ea61fb0ceae525ff728342dd24217c5ee3f1c3))
* **sidepanel:** 优化 Windows 下侧边栏性能与加载体验 ([5a72683](https://github.com/liaolongdong/account-password-helper/commit/5a72683a2dd6dc2dcf239f102b7fc995f80d6890))
* **sidepanel:** 优化侧边栏密码数据加载流程及设置弹窗加载时机 ([4364aa7](https://github.com/liaolongdong/account-password-helper/commit/4364aa7283d2f6d4a2113df90bc1e600ed7a9f3d))
* **sidepanel:** 优化加载体验与数据初始化策略 ([ae41eb5](https://github.com/liaolongdong/account-password-helper/commit/ae41eb5cb070de4416b29ec776db5f324e0b0c6b))
* **sidepanel:** 优化模块延迟加载与缓存预热提升性能 ([0aa80d9](https://github.com/liaolongdong/account-password-helper/commit/0aa80d900acf4fa19412ba91db82f1c3d76938f6))
* **sw:** 优化 Service Worker 冷启动性能和加密模块按需加载 ([ff9e05e](https://github.com/liaolongdong/account-password-helper/commit/ff9e05ecb2e891603ba19ccae667dd551f380db4))

## [2.8.0](https://github.com/liaolongdong/account-password-helper/compare/v2.7.0...v2.8.0) (2026-06-30)


### Features

* **LoginAutoSave:** 增强密码字段标记和动态监听功能 ([e0a4d21](https://github.com/liaolongdong/account-password-helper/commit/e0a4d21d057ce881d776e3b14aa0ca5182fe808f))
* **LoginAutoSave:** 增强密码字段标记和动态监听功能 ([eba118e](https://github.com/liaolongdong/account-password-helper/commit/eba118ec1a92cbecc2a50e088b6481c08f3ba1d1))

## [2.7.0](https://github.com/liaolongdong/account-password-helper/compare/v2.6.1...v2.7.0) (2026-06-29)


### Features

* **autosave:** 实现登录表单字段实时同步弹窗显示内容 ([a10b021](https://github.com/liaolongdong/account-password-helper/commit/a10b0211843e46c1b1642d6d341ca87e30be7d1b))
* **content:** 支持跨frame登录表单检测和密码填充 ([f4dd1b9](https://github.com/liaolongdong/account-password-helper/commit/f4dd1b958d54897def33c727c724df389bb784e6))

## [2.6.1](https://github.com/liaolongdong/account-password-helper/compare/v2.6.0...v2.6.1) (2026-06-25)


### Bug Fixes

* **ui:** 优化侧边栏自动弹出提示文案 ([e17324c](https://github.com/liaolongdong/account-password-helper/commit/e17324c7ce8f1358428df26dc357487068b2b1ca))

## [2.6.0](https://github.com/liaolongdong/account-password-helper/compare/v2.5.0...v2.6.0) (2026-06-24)


### Features

* **deps:** 添加 @element-plus/icons-vue 依赖 ([bfa8ed5](https://github.com/liaolongdong/account-password-helper/commit/bfa8ed5c557d92d9d5cc079afe18682b583b7223))
* **floating-buttons:** 实现页面悬浮按钮组功能 ([eae34fc](https://github.com/liaolongdong/account-password-helper/commit/eae34fc33ca7ca53f34c2de2fc8257a0ca839129))
* **ui:** 增加下载链接与下载按钮，完善安装指引 ([5e4812b](https://github.com/liaolongdong/account-password-helper/commit/5e4812bbef781021d176ab3b2035c5de23d3e937))
* **ui:** 增加下载链接与下载按钮，完善安装指引 ([a7f5fef](https://github.com/liaolongdong/account-password-helper/commit/a7f5fefab93c588891677872d0fdfa4258533498))

## [2.5.0](https://github.com/liaolongdong/account-password-helper/compare/v2.4.0...v2.5.0) (2026-06-23)

### Features

- **settings:** 添加收藏上限与悬浮按钮偏好设置功能 ([eda3ceb](https://github.com/liaolongdong/account-password-helper/commit/eda3ceb680aeefd127b6e1b99a1f1468253ad8cf))

### Bug Fixes

- **build:** 解决无效注释构建警告 ([4256cc6](https://github.com/liaolongdong/account-password-helper/commit/4256cc643cd132f30e1af999f069d9958864eacb))
- **passwords:** 优化本地操作避免存储监听重复触发刷新 ([727ace5](https://github.com/liaolongdong/account-password-helper/commit/727ace560d2f3cac855c6a2c2b9a3cd295bef9a9))

## [2.4.0](https://github.com/liaolongdong/account-password-helper/compare/v2.3.0...v2.4.0) (2026-06-22)

### Features

- **favoriteLimit:** 新增收藏上限设置功能，支持收藏自动替换 ([2ab5543](https://github.com/liaolongdong/account-password-helper/commit/2ab5543105c43725435484a39ade2fb46e8075d7))
- **import:** 支持自有模板格式的CSV导入 ([410d7d2](https://github.com/liaolongdong/account-password-helper/commit/410d7d248efe07156ef6e303e3e0c35e665b3e3e))
- **options:** 将悬浮按钮设置整合为偏好设置弹窗 ([1c044a7](https://github.com/liaolongdong/account-password-helper/commit/1c044a78831c771c173cdc7d1468b107fe44a2c8))
- **passwordTable:** 优化操作栏 tooltip 行为及收藏交互反馈 ([eee8a40](https://github.com/liaolongdong/account-password-helper/commit/eee8a40153d5d8013317ed4014d489743b708b9b))

### Bug Fixes

- **options:** 优化备份及导入文件格式校验和处理 ([aaa16d7](https://github.com/liaolongdong/account-password-helper/commit/aaa16d780ddbd7af3080544645fe433f43f8b238))

### Performance Improvements

- **storage:** 优化批量保存密码的性能 ([08683fb](https://github.com/liaolongdong/account-password-helper/commit/08683fbfb56b14e4756caec7280f0693b90a5e2b))

## [2.3.0](https://github.com/liaolongdong/account-password-helper/compare/v2.2.0...v2.3.0) (2026-06-21)

### Features

- **clipboard:** 添加剪贴板自动清除功能及密码生成器 ([ce33163](https://github.com/liaolongdong/account-password-helper/commit/ce331632ce0f5807cbc0661ffd6d49c51a75417d))

## [2.2.0](https://github.com/liaolongdong/account-password-helper/compare/v2.1.0...v2.2.0) (2026-06-21)

### Features

- **clipboard:** 添加剪贴板自动清除功能及密码生成器 ([f0fed69](https://github.com/liaolongdong/account-password-helper/commit/f0fed6912516db83e849c81285bcaffb984bf162))

## [2.1.0](https://github.com/liaolongdong/account-password-helper/compare/v2.0.0...v2.1.0) (2026-06-20)

### Features

- **export:** 支持密码数据的 JSON 格式导入导出 ([edfe08d](https://github.com/liaolongdong/account-password-helper/commit/edfe08d268e3d0394dfb65ba7174afbcff341c3c))
- **options:** 支持 JSON 格式密码数据导入导出 ([f9f5694](https://github.com/liaolongdong/account-password-helper/commit/f9f5694c4dbfe93262b901715876f205a3b95b1e))
- **tag:** 新增标签溢出检测及优化标签颜色和样式 ([1570d04](https://github.com/liaolongdong/account-password-helper/commit/1570d04d86475d3ac1b9f81ff9575035f3d20d32))

### Bug Fixes

- **utils:** 调整标签颜色生成算法为轻雾色系 ([c203cac](https://github.com/liaolongdong/account-password-helper/commit/c203cac1df5d2b145fa2598c0160a7a509f53cc3))
