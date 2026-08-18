# Changelog

## [3.3.0](https://github.com/liaolongdong/account-password-helper/compare/v3.2.0...v3.3.0) (2026-08-14)


### Features

* **background:** 实现非 Windows 会话失效后的宽限期保活机制 ([8381e48](https://github.com/liaolongdong/account-password-helper/commit/8381e4812d6006a04bf89d73948f76ef918a01b4))


### Performance Improvements

* **core:** 优化 Service Worker 全平台常驻保活体验 ([c47c7f0](https://github.com/liaolongdong/account-password-helper/commit/c47c7f036fb3a2193ba6c8c48956ed4d30cd8a4a))

## [3.2.0](https://github.com/liaolongdong/account-password-helper/compare/v3.1.0...v3.2.0) (2026-08-12)


### Features

* **searchFilterBar:** 优化批量操作按钮和标签筛选交互布局 ([7940429](https://github.com/liaolongdong/account-password-helper/commit/7940429844ff3b1054a64acc4bfc6182409ed3bc))


### Performance Improvements

* **session:** 优化会话锁定状态快速判定及预热机制 ([348992a](https://github.com/liaolongdong/account-password-helper/commit/348992a64c265966b5325b8f6f3bc3ccd85bb55e))

## [3.1.0](https://github.com/liaolongdong/account-password-helper/compare/v3.0.2...v3.1.0) (2026-08-11)


### Features

* **auth:** 实现 TOTP 两步登录活码胶囊与接力机制 ([fd1b8a6](https://github.com/liaolongdong/account-password-helper/commit/fd1b8a6df560221a3becd60311ad363e8ec9406d))
* **background:** 优化并实现系统闲置锁定功能 ([a7c02b5](https://github.com/liaolongdong/account-password-helper/commit/a7c02b5d9d6f7ccd152540b75586f90567e76cfd))
* **options:** 新增标签筛选与批量标签编辑功能 ([d15b62a](https://github.com/liaolongdong/account-password-helper/commit/d15b62a64e4909c0dacbb3151189292b36eb70dd))
* **sidepanel:** 优化侧边栏资源预热策略，支持跨平台轻量预热 ([f8be9c7](https://github.com/liaolongdong/account-password-helper/commit/f8be9c7d27104704c8541624a57ded37d8313023))
* **sidepanel:** 支持拼音智能搜索与命中高亮功能 ([6173205](https://github.com/liaolongdong/account-password-helper/commit/61732052c1a1801f1f571e1b967cd7ce36747911))

## [3.0.2](https://github.com/liaolongdong/account-password-helper/compare/v3.0.1...v3.0.2) (2026-08-06)


### Bug Fixes

* **inlineDropdown:** 修复面板事件冒泡及焦点泄漏问题 ([f9d831b](https://github.com/liaolongdong/account-password-helper/commit/f9d831b39fa329aba825f283a9c2f658185111f6))

## [3.0.1](https://github.com/liaolongdong/account-password-helper/compare/v3.0.0...v3.0.1) (2026-08-05)


### Bug Fixes

* **license:** LICENSE 还原为 GPL-3.0 官方全文以修复 GitHub 许可证识别 ([db03acd](https://github.com/liaolongdong/account-password-helper/commit/db03acd83a73e5ad3ef4f9d9855194da7a16bc07))
* **license:** LICENSE 还原为 GPL-3.0 官方全文以修复 GitHub 许可证识别 ([190cdf9](https://github.com/liaolongdong/account-password-helper/commit/190cdf9d866ae7919c668243e6037be8d7f55d6f))

## [3.0.0](https://github.com/liaolongdong/account-password-helper/compare/v2.18.0...v3.0.0) (2026-08-05)


### ⚠ BREAKING CHANGES

* **license:** 开源协议由 MIT 切换为 GPL-3.0-only

### Features

* **popup:** 添加闲置自动锁定时长设置及锁按钮提示文案 ([621f5b5](https://github.com/liaolongdong/account-password-helper/commit/621f5b50e502f21e3be8b6a05e2fae45e1437e56))


### Bug Fixes

* **FormDetector:** 改进失焦后等待 DOM 稳定机制并同步失焦处理 ([206a8e0](https://github.com/liaolongdong/account-password-helper/commit/206a8e060d05705f95118b37e72cdd2ef9809324))


### Miscellaneous Chores

* **license:** 开源协议由 MIT 切换为 GPL-3.0-only ([bedbbf2](https://github.com/liaolongdong/account-password-helper/commit/bedbbf2ffc817882654ed3ccfb1dcae57df11862))

## [2.18.0](https://github.com/liaolongdong/account-password-helper/compare/v2.17.0...v2.18.0) (2026-08-03)

### Features

- **background:** 优化侧边栏密码缓存加载性能 ([9019f40](https://github.com/liaolongdong/account-password-helper/commit/9019f40d1d99a0f491036f63196ea5284523ed48))

### Bug Fixes

- **content:** 优化表单填充的焦点和字段检测逻辑 ([b240bd1](https://github.com/liaolongdong/account-password-helper/commit/b240bd1e20877486c8f5d5b62d0de697f66236c6))
- **sidepanel:** 优化密码列表元数据静默刷新和就地修补逻辑 ([30c56e0](https://github.com/liaolongdong/account-password-helper/commit/30c56e03e26718bba110c9156142b69156d51dd3))
- **sidepanel:** 使用静默刷新避免侧边栏列表闪烁 ([c7f6b8f](https://github.com/liaolongdong/account-password-helper/commit/c7f6b8f6a62ad2ab92eaeb6eaad768b6d601e9d0))

### Performance Improvements

- **sidepanel:** 优化冷启动背景数据竞速与迟到数据处理 ([284f8ae](https://github.com/liaolongdong/account-password-helper/commit/284f8aeddb8618a4563136ff10e388a5f6d8defa))
- **utils:** 调整侧边栏资源预热逻辑及门控策略 ([284f8ae](https://github.com/liaolongdong/account-password-helper/commit/284f8aeddb8618a4563136ff10e388a5f6d8defa))

## [2.17.0](https://github.com/liaolongdong/account-password-helper/compare/v2.16.0...v2.17.0) (2026-07-30)

### Features

- **ui:** 默认填充方式改为内联并添加首次引导气泡 ([c2cfbee](https://github.com/liaolongdong/account-password-helper/commit/c2cfbee72cc46472e1b4c5e9ba99bfc55f85babc))

## [2.16.0](https://github.com/liaolongdong/account-password-helper/compare/v2.15.0...v2.16.0) (2026-07-29)

### Features

- **security:** 改进凭证指纹生成策略以防止误判 ([70628dc](https://github.com/liaolongdong/account-password-helper/commit/70628dc40af3dc3d36ff95be6dbd30511d551c52))
- **ui:** 重构首页特性展示与文案优化 ([a94f742](https://github.com/liaolongdong/account-password-helper/commit/a94f7425d9806e881a718b3d47ffb829193477fd))

## [2.15.0](https://github.com/liaolongdong/account-password-helper/compare/v2.14.0...v2.15.0) (2026-07-28)

### Features

- **core:** 支持TOTP扫码添加和网站图标展示 ([17f770a](https://github.com/liaolongdong/account-password-helper/commit/17f770abd41d346cefa671bd53e36c62ff0ab520))

## [2.14.0](https://github.com/liaolongdong/account-password-helper/compare/v2.13.0...v2.14.0) (2026-07-28)

### Features

- **background:** 优化 Service Worker 保活机制，提升启动性能和锁屏体验 ([3cc0bde](https://github.com/liaolongdong/account-password-helper/commit/3cc0bdee3f858abb9d928c536f2db6e9be9f1140))
- **core:** 优化一键填充快捷键的会话未验证处理 ([0e7c3d8](https://github.com/liaolongdong/account-password-helper/commit/0e7c3d80fa642e7e0e64f5069930606659a96c37))
- **inlineDropdown:** 新增内联下拉快捷键及面板展开功能 ([1f77940](https://github.com/liaolongdong/account-password-helper/commit/1f779401086c2e7e5e51ab3cba6920e9024b1f0d))

## [2.13.0](https://github.com/liaolongdong/account-password-helper/compare/v2.12.0...v2.13.0) (2026-07-27)

### Features

- **sidepanel:** 优化侧边栏资源预热机制，支持多层依赖递归加载 ([b5c8c37](https://github.com/liaolongdong/account-password-helper/commit/b5c8c37a7d0043ebed2807618cda917c62933f98))
- **ui:** 新增微信交流群信息及回顶滚动功能 ([9982020](https://github.com/liaolongdong/account-password-helper/commit/9982020f2947b47470de6a9fc3b06a85a15070f6))

### Bug Fixes

- **ci:** 校验 Chrome 扩展 ID 格式防止发布失败 ([891275f](https://github.com/liaolongdong/account-password-helper/commit/891275f8e848c80555fedd295fc8c355107fcc21))

### Performance Improvements

- **sidepanel:** 优化加密模块延迟加载与超时处理 ([7f5c021](https://github.com/liaolongdong/account-password-helper/commit/7f5c0218ef6dfa1a0a743ed5023d9ef55c411f41))

## [2.12.0](https://github.com/liaolongdong/account-password-helper/compare/v2.11.1...v2.12.0) (2026-07-26)

### Features

- **background:** 启动时预热 Windows 侧边栏资源以减少首次加载白屏 ([816563f](https://github.com/liaolongdong/account-password-helper/commit/816563f3e9220ba5e0cc0b3468b2c8a159e5a5a3))
- **ci:** 增加 Chrome Web Store OAuth 凭据校验步骤 ([3487a55](https://github.com/liaolongdong/account-password-helper/commit/3487a55bf4b1f55d8c7c2b4a2ece224af8a4a77c))
- **core:** 增加密码健康检测新维度及多语言支持 ([b7d8da9](https://github.com/liaolongdong/account-password-helper/commit/b7d8da981e3980c7766efd97c951b1d37c2810a6))
- **core:** 增强密码管理功能，支持主密码修改与回收站 ([293e823](https://github.com/liaolongdong/account-password-helper/commit/293e82325d30dbd0649a0d2918479442e67f73d0))
- **excel:** 支持多语言表头导入导出及模板改进 ([3b5a52f](https://github.com/liaolongdong/account-password-helper/commit/3b5a52fdeef93f97d9c18758510e0991523662bd))
- **i18n:** 增加多语言支持及语言切换功能 ([468edb4](https://github.com/liaolongdong/account-password-helper/commit/468edb45f4ccbd8ba8d70d45e7d97e87ddb48302))
- **perfMetrics:** 侧边栏打开性能埋点及时间戳追踪改进 ([816563f](https://github.com/liaolongdong/account-password-helper/commit/816563f3e9220ba5e0cc0b3468b2c8a159e5a5a3))
- **quick_fill:** 添加一键填充快捷键及相关支持功能 ([64693d3](https://github.com/liaolongdong/account-password-helper/commit/64693d32057ebc9cb5889602c3dba433e79ab040))
- **security:** 强化跨域 frame 填充权限及委托通知安全校验 ([9ffcdf8](https://github.com/liaolongdong/account-password-helper/commit/9ffcdf8698a65d8e97e494c001ac15407dfd5cba))
- **session:** 实现主密码修改后会话密钥重置自愈机制 ([94c4430](https://github.com/liaolongdong/account-password-helper/commit/94c443052039d9edf34cd55f212e8bc830f8226a))
- **storage:** 添加回收站和密码修改历史功能 ([358450a](https://github.com/liaolongdong/account-password-helper/commit/358450a1277f3eb5596588e9ae5cd194df1f78e0))

### Bug Fixes

- **storage:** 优化回收站删除及主密码修改错误处理 ([d443c57](https://github.com/liaolongdong/account-password-helper/commit/d443c57f8bcbff71ec703756680b2c1bff2a4e29))

### Performance Improvements

- **sidepanel:** 优化侧边栏数据加载及竞速逻辑性能采集 ([816563f](https://github.com/liaolongdong/account-password-helper/commit/816563f3e9220ba5e0cc0b3468b2c8a159e5a5a3))

## [2.11.1](https://github.com/liaolongdong/account-password-helper/compare/v2.11.0...v2.11.1) (2026-07-23)

### Bug Fixes

- **config:** 优化扩展名称和描述文本 ([367568e](https://github.com/liaolongdong/account-password-helper/commit/367568e4e972d2f4942530b6b1fab3b09fad4296))

## [2.11.0](https://github.com/liaolongdong/account-password-helper/compare/v2.10.0...v2.11.0) (2026-07-23)

### Features

- **assets:** 添加功能插图及大纲文档 ([692c309](https://github.com/liaolongdong/account-password-helper/commit/692c3091561702fb3d3947b0557089067c1c55af))
- **auth:** 增加两步验证(TOTP)功能支持 ([76cd669](https://github.com/liaolongdong/account-password-helper/commit/76cd6699f244a4b5c92840df9cf83e4051db4fb0))
- **autoSave:** 优化自动保存密码的智能提示和更新逻辑 ([2f7575a](https://github.com/liaolongdong/account-password-helper/commit/2f7575a8a78b175d342fd7e0d99bac63f4c14c4a))
- **chrome-store:** 集成并推广Chrome应用商店安装方式 ([bdf3137](https://github.com/liaolongdong/account-password-helper/commit/bdf31376bb25143790d65f60c70d43d84903f2a8))
- **idleLock:** 新增浏览器重启锁定功能 ([a65eadb](https://github.com/liaolongdong/account-password-helper/commit/a65eadb2838ab4e0b0fe881d26e6d719c449bd67))
- **options:** 增加邮箱备份加密功能及界面优化 ([75808c4](https://github.com/liaolongdong/account-password-helper/commit/75808c4ca272a727023ea7e15d4863f66e0bce9f))
- **security:** 增加浏览器重启锁定功能并增强备份安全性 ([bacc90b](https://github.com/liaolongdong/account-password-helper/commit/bacc90be0a3c109d6be1a2311847edddbbf2c8ea))
- **security:** 添加安全体检仪表盘与本地TOTP两步验证码功能 ([1f5dce8](https://github.com/liaolongdong/account-password-helper/commit/1f5dce888e90c88230399fdf6d474a93a119b20d))
- **security:** 添加安全体检仪表盘及入口按钮 ([7958ff3](https://github.com/liaolongdong/account-password-helper/commit/7958ff3a8d9c6ef36783a0d44f4f338ffcf4bba9))
- **shortcuts:** 新增快捷键绑定状态及手动设置引导 ([e15fabd](https://github.com/liaolongdong/account-password-helper/commit/e15fabd27fc6740a773f86e3ef14a21e5832b036))
- **sidepanel:** 支持全局自动触发登录功能 ([f2373c2](https://github.com/liaolongdong/account-password-helper/commit/f2373c279c27f72c170b811ba87222c9822ab728))
- **sidepanel:** 添加本地操作标志防止全量重载闪烁 ([5ac20a6](https://github.com/liaolongdong/account-password-helper/commit/5ac20a69bb27ecf45d522ffa0b77be100f0c26c1))
- **swpersist:** 实现 Windows 平台 Service Worker 差异化保活策略 ([b58b278](https://github.com/liaolongdong/account-password-helper/commit/b58b278d63852b0f92b59fcf175ccd71fb15f009))
- **ui:** 添加主题换肤与内联填充功能 ([ff75836](https://github.com/liaolongdong/account-password-helper/commit/ff7583679d7c502847bd20dca8cf19e46e579cde))

### Bug Fixes

- **binary:** 修复二进制文件差异问题 ([28cf8d6](https://github.com/liaolongdong/account-password-helper/commit/28cf8d6c248f41e65277759fbb57733701154c51))
- **binary:** 解决二进制文件差异问题 ([df88c19](https://github.com/liaolongdong/account-password-helper/commit/df88c197478332c781bd501e5328e9292243c2b2))
- **ci:** 修复 GitHub Actions secrets 引用问题 ([ccf4a8a](https://github.com/liaolongdong/account-password-helper/commit/ccf4a8a36da7644821b9d05519095e99bd0f4401))
- **content:** 规避扩展上下文失效导致的异常问题 ([1b8d42a](https://github.com/liaolongdong/account-password-helper/commit/1b8d42a96054eda9c340c0a0ccc165fa03cb2a43))
- **lang-switch:** 优化语言切换按钮默认状态和顺序 ([a16446b](https://github.com/liaolongdong/account-password-helper/commit/a16446bd7f0dea14258caa6a287a6a3d40095d5f))
- **options:** 补充加密备份主密码的提醒信息 ([d6dba00](https://github.com/liaolongdong/account-password-helper/commit/d6dba00ee4f4b979d372673705008b45417a7669))
- **popup:** 优化侧边栏打开逻辑 ([d0b6973](https://github.com/liaolongdong/account-password-helper/commit/d0b69730c8de20b121a94bd7804e8cd893fd0531))
- **security:** 增强密码数据访问安全与主密码校验机制 ([a07b3cb](https://github.com/liaolongdong/account-password-helper/commit/a07b3cbe494548834fda7191702269a86574a772))
- **session:** 优化会话过期处理与清除逻辑 ([9bfb008](https://github.com/liaolongdong/account-password-helper/commit/9bfb00888f1b1374601e675e1d2a8e1da13f7017))
- **storage:** 确保密码数据 at-rest 全部以密文存储 ([ddd56f9](https://github.com/liaolongdong/account-password-helper/commit/ddd56f9cfb86827bdeeb8aca595abf3337187b31))
- **ui:** 优化标签最大宽度避免溢出裁切 ([131a97d](https://github.com/liaolongdong/account-password-helper/commit/131a97da3b827aee974e6d9236ec776b3a144cd6))
- **ui:** 注释禁用下载权限显示行 ([5c53a39](https://github.com/liaolongdong/account-password-helper/commit/5c53a39a91ea73c7c946d7aa68c070b2686acdf6))

### Performance Improvements

- **sidepanel:** 优化侧边栏资源预热逻辑，缩短冷启动等待时间 ([72645ad](https://github.com/liaolongdong/account-password-helper/commit/72645ad2db42365a95c45bedcb401c2655b36b34))

## [2.10.0](https://github.com/liaolongdong/account-password-helper/compare/v2.9.0...v2.10.0) (2026-07-09)

### Features

- **faq:** 优化常见问题与帮助对话框分类和动效 ([f1b4745](https://github.com/liaolongdong/account-password-helper/commit/f1b47454dd50d2f4ea78deff2e74d00740c995eb))

## [2.9.0](https://github.com/liaolongdong/account-password-helper/compare/v2.8.0...v2.9.0) (2026-07-08)

### Features

- **background:** 实现 Service Worker 保活及侧边栏数据一站式加载 ([2a73c30](https://github.com/liaolongdong/account-password-helper/commit/2a73c30256bd1d272a74b8c3ac98913881bcff2d))
- **content:** 新增页面切换时预唤醒 Service Worker 机制 ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))
- **form:** 支持更多输入类型并完善登录元素检测触发机制 ([0969407](https://github.com/liaolongdong/account-password-helper/commit/09694073e0c345403b70b5a92e5c6e36f27568a3))
- **parser:** 优化 CSV 文件解析支持多编码回退 ([5033e42](https://github.com/liaolongdong/account-password-helper/commit/5033e42fdea7962cd1f95bbca3855b44a6706d5c))
- **popup:** 打开 popup 时预唤醒 Service Worker ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))
- **sidepanel:** 实现初始化数据并行竞速加载 ([844de77](https://github.com/liaolongdong/account-password-helper/commit/844de779ca3656e9e86f21b523eb452a7471f104))

### Bug Fixes

- **form-detector:** 修复手机号单字段登录检测逻辑及缓存管理 ([00e34c3](https://github.com/liaolongdong/account-password-helper/commit/00e34c3eb8c8c2b72104e0f9675c3f7c80edb4b3))
- **session:** 优化会话过期状态管理，防止认证状态闪烁 ([708ca95](https://github.com/liaolongdong/account-password-helper/commit/708ca9590b4753680a67804274f06a645d887afd))
- **sidepanel:** 延长超时及增强缓存预热逻辑 ([4df28a8](https://github.com/liaolongdong/account-password-helper/commit/4df28a8927bc2159063e6e7e06bf42d45c57dc27))
- **storage:** 优化缓存和加载流程，提升性能和稳定性 ([01235a9](https://github.com/liaolongdong/account-password-helper/commit/01235a992f46a116ab44c3d9d285d41b7106ebb5))

### Performance Improvements

- **sidepanel:** 优化 SidePanel 性能与非阻塞 CSS 加载 ([c8ea61f](https://github.com/liaolongdong/account-password-helper/commit/c8ea61fb0ceae525ff728342dd24217c5ee3f1c3))
- **sidepanel:** 优化 Windows 下侧边栏性能与加载体验 ([5a72683](https://github.com/liaolongdong/account-password-helper/commit/5a72683a2dd6dc2dcf239f102b7fc995f80d6890))
- **sidepanel:** 优化侧边栏密码数据加载流程及设置弹窗加载时机 ([4364aa7](https://github.com/liaolongdong/account-password-helper/commit/4364aa7283d2f6d4a2113df90bc1e600ed7a9f3d))
- **sidepanel:** 优化加载体验与数据初始化策略 ([ae41eb5](https://github.com/liaolongdong/account-password-helper/commit/ae41eb5cb070de4416b29ec776db5f324e0b0c6b))
- **sidepanel:** 优化模块延迟加载与缓存预热提升性能 ([0aa80d9](https://github.com/liaolongdong/account-password-helper/commit/0aa80d900acf4fa19412ba91db82f1c3d76938f6))
- **sw:** 优化 Service Worker 冷启动性能和加密模块按需加载 ([ff9e05e](https://github.com/liaolongdong/account-password-helper/commit/ff9e05ecb2e891603ba19ccae667dd551f380db4))

## [2.8.0](https://github.com/liaolongdong/account-password-helper/compare/v2.7.0...v2.8.0) (2026-06-30)

### Features

- **LoginAutoSave:** 增强密码字段标记和动态监听功能 ([e0a4d21](https://github.com/liaolongdong/account-password-helper/commit/e0a4d21d057ce881d776e3b14aa0ca5182fe808f))
- **LoginAutoSave:** 增强密码字段标记和动态监听功能 ([eba118e](https://github.com/liaolongdong/account-password-helper/commit/eba118ec1a92cbecc2a50e088b6481c08f3ba1d1))

## [2.7.0](https://github.com/liaolongdong/account-password-helper/compare/v2.6.1...v2.7.0) (2026-06-29)

### Features

- **autosave:** 实现登录表单字段实时同步弹窗显示内容 ([a10b021](https://github.com/liaolongdong/account-password-helper/commit/a10b0211843e46c1b1642d6d341ca87e30be7d1b))
- **content:** 支持跨frame登录表单检测和密码填充 ([f4dd1b9](https://github.com/liaolongdong/account-password-helper/commit/f4dd1b958d54897def33c727c724df389bb784e6))

## [2.6.1](https://github.com/liaolongdong/account-password-helper/compare/v2.6.0...v2.6.1) (2026-06-25)

### Bug Fixes

- **ui:** 优化侧边栏自动弹出提示文案 ([e17324c](https://github.com/liaolongdong/account-password-helper/commit/e17324c7ce8f1358428df26dc357487068b2b1ca))

## [2.6.0](https://github.com/liaolongdong/account-password-helper/compare/v2.5.0...v2.6.0) (2026-06-24)

### Features

- **deps:** 添加 @element-plus/icons-vue 依赖 ([bfa8ed5](https://github.com/liaolongdong/account-password-helper/commit/bfa8ed5c557d92d9d5cc079afe18682b583b7223))
- **floating-buttons:** 实现页面悬浮按钮组功能 ([eae34fc](https://github.com/liaolongdong/account-password-helper/commit/eae34fc33ca7ca53f34c2de2fc8257a0ca839129))
- **ui:** 增加下载链接与下载按钮，完善安装指引 ([5e4812b](https://github.com/liaolongdong/account-password-helper/commit/5e4812bbef781021d176ab3b2035c5de23d3e937))
- **ui:** 增加下载链接与下载按钮，完善安装指引 ([a7f5fef](https://github.com/liaolongdong/account-password-helper/commit/a7f5fefab93c588891677872d0fdfa4258533498))

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
