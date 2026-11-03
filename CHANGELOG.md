# Changelog

## [3.20.0](https://github.com/liaolongdong/account-password-helper/compare/v3.19.0...v3.20.0) (2026-10-27)


### Features

* **identity:** 右键召唤个人信息库与引导登记恢复密钥，文档、商店文案与归因同步 ([ff7395c](https://github.com/liaolongdong/account-password-helper/commit/ff7395c83330ecb2ccafd5968c41f44f13dc3e06))
* **identity:** 网页输入框右键可召唤个人信息库，取完值一键回到原网页 ([8ef2ab9](https://github.com/liaolongdong/account-password-helper/commit/8ef2ab907dfd71db1ab909f6d6fdb9acdeb33db2))


### Bug Fixes

* **options:** 备份轻提醒的关闭活过刷新，三路输入读全前不出声 ([fcfefea](https://github.com/liaolongdong/account-password-helper/commit/fcfefead95910d66c49b67a484e0b97c1cfc27e3))

## [3.19.0](https://github.com/liaolongdong/account-password-helper/compare/v3.18.0...v3.19.0) (2026-10-26)


### Features

* **auth:** 主密码提示语与忘记密码找回向导 ([dd6a634](https://github.com/liaolongdong/account-password-helper/commit/dd6a634c3ca878263a0daf5c2934937ade441732))
* **backup:** 备份状态从数据管理菜单上移到头部徽标，并补会话内轻提醒 ([b4bb0e4](https://github.com/liaolongdong/account-password-helper/commit/b4bb0e4b1f40c86ab7fd6be524125cb73715d9e9))
* **options:** 个人信息表单的 11 个内置字段补上格式型 placeholder ([93e12ed](https://github.com/liaolongdong/account-password-helper/commit/93e12ed98d88ed12f527b7f1c4843d92635ebb45))
* **options:** 主密码提示语可随时修改或清除，不再只有首次那一次 ([400da87](https://github.com/liaolongdong/account-password-helper/commit/400da87c6b7a363d14344181f92491cdc7b6188f))
* **recovery:** 不可解记录不再把用户逼回清空，并在下载时刻点明明文风险 ([009ce77](https://github.com/liaolongdong/account-password-helper/commit/009ce778eefb034852250c9d0d790cd4ad212906))
* **recovery:** 离线恢复密钥补上「忘记主密码仍能取回本机库」的出口 ([1262b0d](https://github.com/liaolongdong/account-password-helper/commit/1262b0d84f8d53d1cc84b8f5c4a405c65956ecfb))
* **seo:** 给已发布页面的 JSON-LD 补一层结构守卫，并订正 pricing 两处自相矛盾的实体描述 ([27d9ed2](https://github.com/liaolongdong/account-password-helper/commit/27d9ed27d4440884e3d0e7884423afb9ed2dd851))


### Bug Fixes

* **a11y:** 54 处硬编码灰阶文字并回令牌，灰阶不再能绕过 AA 地板 ([eb9975d](https://github.com/liaolongdong/account-password-helper/commit/eb9975d5785b6b6cc87d9446f8bf07fa17bcb312))
* **a11y:** 中性文字三档改为按「最暗浅底」定值，muted 从 2.06:1 提到 4.54:1 ([bd708b7](https://github.com/liaolongdong/account-password-helper/commit/bd708b7649f4ee9edd5abff870134437983de8ff))
* **a11y:** 主色文字压白底提到 WCAG AA，六套主题各配一支「强」档 ([8d31d31](https://github.com/liaolongdong/account-password-helper/commit/8d31d31089e2d21a24f2f18960fd3c781c32e0e7))
* **a11y:** 图标不再一律算「装饰」，承载控件与状态的图形补到 1.4.11 的 3:1 ([1f7483a](https://github.com/liaolongdong/account-password-helper/commit/1f7483a5865149ecf65c357a8a5179e1c2bb42c1))
* **a11y:** 强档语义令牌改按 12 面浅底定值并补 success 档，13 处彩色文字并回令牌 ([6565650](https://github.com/liaolongdong/account-password-helper/commit/6565650e2a0b442a4259718dd01c677419b49934))
* **a11y:** 扩展页主色文字统一走强档，并补浅主色底文字令牌 ([649f2b4](https://github.com/liaolongdong/account-password-helper/commit/649f2b41ba8d8adc0d4ed7922095ea34506b399a))
* **a11y:** 报错与安全披露文字从语义色收回强档，含 EP 自带的表单校验报错 ([63e62fd](https://github.com/liaolongdong/account-password-helper/commit/63e62fd2238daf15a33aa2dd0a2bf34a8e02f1cb))
* **a11y:** 浅底告警的文字从 EP 语义色收回常规层级，三档统一达到 AA ([18f6d72](https://github.com/liaolongdong/account-password-helper/commit/18f6d72e5b8ea20765196eff3d92123acde8a6df))
* **a11y:** 灰阶守卫阈值 16 → 24，逮出溜过去的 TOTP 复制按钮 2.06:1 ([e7922b2](https://github.com/liaolongdong/account-password-helper/commit/e7922b24112f161fc0c633139154b72c0b7d64db))
* **auth:** about:srcdoc 框架不再被当成扩展自身上下文，内容脚本的迁移闸门补全 ([3957d4f](https://github.com/liaolongdong/account-password-helper/commit/3957d4faf7989fbabc80d36c7558fb3ee4fee55b))
* **auth:** 解锁只付一次慢哈希，换钥进行中不再冒充「密码错误」 ([01896ef](https://github.com/liaolongdong/account-password-helper/commit/01896ef56d0cafc2127b715258c5749549d412a1))
* **auth:** 重置确认文案限定到本插件数据并补上「无法撤销」 ([12139d0](https://github.com/liaolongdong/account-password-helper/commit/12139d0143f7f3d8c6bb3b4429a18fefc8a31c61))
* **backup:** 换钥匙批次不再刷新待备份时间戳，收掉 rekey 的备份误报 ([17b673c](https://github.com/liaolongdong/account-password-helper/commit/17b673c34aa3a5e0ba5c320c51696d403e4826ce))
* **backup:** 离线恢复不再凭空欠一次备份；锁定广播开始看回执 ([b25c2fa](https://github.com/liaolongdong/account-password-helper/commit/b25c2fa9557b8e639390fdb2bd095c0b5663661a))
* **backup:** 锁定页的只读验证开始数失败次数，连续三次进 30 秒冷却 ([e8de51a](https://github.com/liaolongdong/account-password-helper/commit/e8de51ad81c97a27062ae14a37987c49298b7c9c))
* **copy:** 备份提醒不再称「唯一退路」，找回向导把删除范围限定到本插件数据 ([38c4e24](https://github.com/liaolongdong/account-password-helper/commit/38c4e24372dbcf9c2475516620edf0e1bedd476e))
* **options:** 口令生成器选「无分隔符」不再退化成空框，分隔符选项文案进 i18n ([de99529](https://github.com/liaolongdong/account-password-helper/commit/de995290383ee92cd8beb3601003d2d8d7856a19))
* **options:** 备份口令输入也提示大写锁定，并清掉只写不读的判据字段 ([d3cc635](https://github.com/liaolongdong/account-password-helper/commit/d3cc6357bc00395e1a55c778e59e76eb21124f7a))
* **options:** 备份徽标与轻提醒按「欠哪份备份」分派出口，收掉身份库送错入口 ([b3801fb](https://github.com/liaolongdong/account-password-helper/commit/b3801fbaa16c23fbc11b7ee203e895ec6d395444))
* **options:** 备份轻提醒不再谎报耗时，并点名「下一份」欠的备份 ([7bdd8e2](https://github.com/liaolongdong/account-password-helper/commit/7bdd8e2db96831c7a3de34dd82afda62775a8093))
* **options:** 弹窗统一垂直+水平居中，改密弹窗不再顶出页面级滚动条 ([545b6fe](https://github.com/liaolongdong/account-password-helper/commit/545b6fe0766738b833232aab2b8b94ad801a3750))
* **options:** 恢复一键锁定的玻璃态底色，并给 :deep 选择器加耦合守卫 ([a233995](https://github.com/liaolongdong/account-password-helper/commit/a2339957c7708b6553a96c891f754248eba2839b))
* **options:** 恢复与备份验证的三个密码框补 placeholder ([f29a6d2](https://github.com/liaolongdong/account-password-helper/commit/f29a6d2e76157b501d52082d4ef2d84786effb9a))
* **options:** 悬停不再冲掉徽标状态色，并补上恢复弹窗的密码显隐 ([6a805a5](https://github.com/liaolongdong/account-password-helper/commit/6a805a55918facebeb36b004acd2f58f6a7c0aa8))
* **options:** 改密弹窗并入长内容弹窗约定，草稿存续期间关掉 Esc 与 X ([413aa39](https://github.com/liaolongdong/account-password-helper/commit/413aa396398429a465f0b366094a1cca5d4a078e))
* **options:** 改密弹窗第一屏就点名旧恢复套件作废，并修浅底告警 2.04:1 ([dd5cc01](https://github.com/liaolongdong/account-password-helper/commit/dd5cc01e2811114fb7ef28f69f87c84c728f130d))
* **options:** 添加密码按钮不再被全局级联吃掉，恢复域补文件选择反馈与格式说明 ([be75882](https://github.com/liaolongdong/account-password-helper/commit/be75882665b4e6c147658df7437811db7b43c2d8))
* **options:** 窄屏找回「立即锁定」，焦点环换成两侧都达标的深色环 ([d4784d1](https://github.com/liaolongdong/account-password-helper/commit/d4784d128f921bbabfda021814b1f72d93615435))
* **options:** 第三批评审收口，图标、显隐、选择器一致性与存量注释 ([734c057](https://github.com/liaolongdong/account-password-helper/commit/734c05747f38f40988f48f5673139123ef80c987))
* **options:** 认证屏不再裁切、去掉幽灵滚动条，重排逃生出口并补上恢复套件的知情同意门 ([589b278](https://github.com/liaolongdong/account-password-helper/commit/589b2786c7ed876f3fe8e0aec78f96a2c62dec83))
* **options:** 页脚 .dialog-footer 补齐各组件自己的声明，状态点改走同值的 EP success 令牌 ([806013f](https://github.com/liaolongdong/account-password-helper/commit/806013f85a71757758d2ae490c202fff55a67fb8))
* **options:** 骨架屏补上备份徽标占位，并把这条耦合钉成断言 ([2f7ab73](https://github.com/liaolongdong/account-password-helper/commit/2f7ab739aacf21152506c9ea09d96a73ad95f6d2))
* **options:** 骨架徽标占位与真实徽标同高，并把尺寸一致性钉成判据 ([bdab2e2](https://github.com/liaolongdong/account-password-helper/commit/bdab2e2b0c382a78b846b326aa62ba3fd0508d77))
* **perf:** 锁定首屏为一个布尔位不再拉回整条换钥依赖图 ([dc36ae9](https://github.com/liaolongdong/account-password-helper/commit/dc36ae920903650dd8a1980fe5f9cc0fe6ff8a29))
* **perf:** 错误码登记表不再以值依赖进 popup 首屏 ([036c45a](https://github.com/liaolongdong/account-password-helper/commit/036c45a4ae75210ef0395367760550e49291f2f0))
* **recovery:** 套件草稿存续期间关掉 Esc 与 X，退出只走会说明后果的那条路 ([3e33f1d](https://github.com/liaolongdong/account-password-helper/commit/3e33f1d598aa9cc4d2adf3c0459a1ef8598bcf07))
* **recovery:** 找回向导补上离线恢复密钥这条退路，对外口径不再说「只能清空」 ([478dce6](https://github.com/liaolongdong/account-password-helper/commit/478dce669bb3e2d516cfdb1188298c1da1ea179f))
* **recovery:** 把坏记录从死路补成知情门，并补 hover 对比度与套件明文确认 ([0779112](https://github.com/liaolongdong/account-password-helper/commit/07791121f18dd08c3952f852f523cc9747976329))
* **recovery:** 换钥结果带上被携带的条数，改密收尾不再只报「成功」 ([b5eb667](https://github.com/liaolongdong/account-password-helper/commit/b5eb66741b66dd58688bc8f985bf0ac1382bba6c))
* **recovery:** 收掉深度评审在换钥并发窗口上逮到的六处问题 ([6ac54bb](https://github.com/liaolongdong/account-password-helper/commit/6ac54bba0e2d9b2a7a0aecdeb9107e171d012904))
* **recovery:** 收掉独立评审在离线恢复上逮到的四处真问题 ([a1146f1](https://github.com/liaolongdong/account-password-helper/commit/a1146f1df1570ccbc0c1c229d73f3c165f148eba))
* **recovery:** 锁定广播不再等慢盘清理，fresh 读不再重复解包，提示语门槛按次计 ([3440740](https://github.com/liaolongdong/account-password-helper/commit/3440740d99782355b8ca2059182e9b9914e9a468))
* **security:** 主密码强度门槛收到存储层，错误码改判别联合 ([61639b5](https://github.com/liaolongdong/account-password-helper/commit/61639b5d3cf7bcca19e4a9e9e5734d4cc1e6b94f))
* **seo:** 英文页三段超预算的 meta 文案压回 170 字符，并补根目录页面守卫 ([a036723](https://github.com/liaolongdong/account-password-helper/commit/a036723dd7e9e0e27352361e18ce1c4982ea5b4d))
* **session:** 换钥提交与发布之间被别的窗口锁定时不再复活会话，未采纳要回执而不是静默返回 ([fe4c158](https://github.com/liaolongdong/account-password-helper/commit/fe4c1584bc6309adf453d88aba82f97f3f68d5ed))
* **session:** 换钥漂移守卫按值比对校验配置，正常改密不再被自己判成并发写 ([fb25c6b](https://github.com/liaolongdong/account-password-helper/commit/fb25c6b727a39bfc9e7c583359966f3298ca29bc))
* **session:** 锁定不再被换钥复活，网页上下文的旧版迁移交回扩展侧 ([a6e9f70](https://github.com/liaolongdong/account-password-helper/commit/a6e9f70c1469a8a19cfefd3a945d66bf9ec7e8d7))
* **sidepanel:** 元数据被换钥挡下时不再向调用方谎报已保存 ([0e3070b](https://github.com/liaolongdong/account-password-helper/commit/0e3070bc30f858fb9cb56f3c28f0f9bce1f3726b))
* **sidepanel:** 动态码在时间窗末尾不再取到就过期，填充与复制共用一次「等下一窗」 ([9f9be85](https://github.com/liaolongdong/account-password-helper/commit/9f9be85ce2649f38b0f1f8d108869083ac856ebf))
* **sidepanel:** 验证码改到跨入口往返之后才算，等来的寿命留给投递 ([fed0203](https://github.com/liaolongdong/account-password-helper/commit/fed0203b33558ab25b5987d11c2935f44fc1e750))
* **storage:** 元数据快重试预算耗尽后排一次有界长退避，队列不再只等用户再操作一次 ([ee4b9c2](https://github.com/liaolongdong/account-password-helper/commit/ee4b9c274d14e22578c1736b910824e75311c317))
* **storage:** 密码库写者之间不再互相抹行：落盘前合并 + 同上下文写队列 ([634d279](https://github.com/liaolongdong/account-password-helper/commit/634d2798bc0e10393066236b2f927de60a6e6af7))
* **tooling:** 忽略并行会话的本地 worktree，恢复主树可用的 pnpm lint 门禁 ([c569a7b](https://github.com/liaolongdong/account-password-helper/commit/c569a7bc6a5448b38451adef59b1b9d8b0383b45))
* 认证屏与窄屏头部版式收口、恢复套件知情同意扩门，附两轮评审回灌 ([e75f25d](https://github.com/liaolongdong/account-password-helper/commit/e75f25d827c0b2392025d5f5e08ca0663c8d3708))


### Reverts

* **options:** 主按钮回到品牌浅蓝，并把「不许自行改主题色」写成判据 ([32c1f64](https://github.com/liaolongdong/account-password-helper/commit/32c1f642a312db240a2125ee3f65de6643595494))
* **theme:** 全站主色回到唯一那支品牌浅蓝，并回退图标配色提交 ([34f572b](https://github.com/liaolongdong/account-password-helper/commit/34f572b990c5493c7c79a44bdca174bffa5b1b8a))

## [3.18.0](https://github.com/liaolongdong/account-password-helper/compare/v3.17.0...v3.18.0) (2026-10-23)


### Features

* **identity:** 身份库检索把首个命中滚进视野 ([ab98055](https://github.com/liaolongdong/account-password-helper/commit/ab980559ec373bffa3dc0c4263ab6bad0ff2af6d))
* **match:** 列表排序改按「与当前站点的关联度」，档位只管可见性 ([e162ffd](https://github.com/liaolongdong/account-password-helper/commit/e162ffd2b47e7f480b077c0edacd72132c3eafa9))
* **options:** 快捷键一览补上命令面板的 ⌘K，面板 footer 加「快捷键」入口 ([ed67838](https://github.com/liaolongdong/account-password-helper/commit/ed67838ad2b7212363df076914f11b522b5a67ae))
* **options:** 站点筛选与环回别名同口径，候选给出折叠写法与端口分布 ([f176789](https://github.com/liaolongdong/account-password-helper/commit/f17678948d94d1a2b872a9ca922bcdbe4eee9f57))
* **sidepanel:** 本地页可绑定远端环境，复用 dev/fat/uat/prod 账号直接填充 ([9d60686](https://github.com/liaolongdong/account-password-helper/commit/9d606862f22b20bc4123f43f6458c621dc801374))
* 身份库检索首屏定位、本地端点匹配与关联度排序、头部工具条重排 ([4d4b49b](https://github.com/liaolongdong/account-password-helper/commit/4d4b49b2f4882881cecd20ceabb8b1710f24cbb1))


### Bug Fixes

* **content:** 命令面板方向键不再被悬停抢走游标，并为 28 条命令补上同源图标 ([ba0172b](https://github.com/liaolongdong/account-password-helper/commit/ba0172be167e7bf51a8aa72e261d0198f6613f40))
* **match:** 列表排序改按「与当前站点的关联度」，本机其他端口不再沉底 ([b309384](https://github.com/liaolongdong/account-password-helper/commit/b3093847be64c7be1c906f0cb854f19207e9be33))
* **match:** 按代码评审收口别名与端口通配的边角，删除只被测试使用的判据 ([6750278](https://github.com/liaolongdong/account-password-helper/commit/6750278e1942e89ffcaccdf60d925b6afc555e17))
* **match:** 本地开发端点补回主机门，环回三写法折叠为同一主体，并新增端口通配 ([c68897b](https://github.com/liaolongdong/account-password-helper/commit/c68897b6c295c33e5958ed61f97add946005842d))
* **options:** 跨子域名匹配弹窗的圆点与标题行中心对齐，补真机几何守卫 ([8e8fffc](https://github.com/liaolongdong/account-password-helper/commit/8e8fffceec189a52736291443d7bba049c83f7cf))
* **sidepanel:** 端口芯片改用「本页有无被挡条目」判据，并补本地端点的真机 e2e ([852f5af](https://github.com/liaolongdong/account-password-helper/commit/852f5affb82e7239ec7185d4f2153c7e874b8c7c))

## [3.17.0](https://github.com/liaolongdong/account-password-helper/compare/v3.16.0...v3.17.0) (2026-10-22)


### Features

* **background:** 工具栏图标随会话状态在钥匙与挂锁间切换 ([cb33e75](https://github.com/liaolongdong/account-password-helper/commit/cb33e75374f07d85201941e6fc91b7b2adb2747a))
* **content:** 个人信息气泡首次说明开关在哪，收起按钮带快捷键标注 ([ba2b189](https://github.com/liaolongdong/account-password-helper/commit/ba2b189a512604753d1253a2366520decb281cf8))
* **content:** 五类国内场景上词典，机构证照那族写法归第 3.5 层独占 ([823b396](https://github.com/liaolongdong/account-password-helper/commit/823b396e945e832fffcffaa4cda5272d1873fa82))
* **content:** 偏好设置弹窗补底栏滚动摘要，底缘改 mask 线性渐隐 ([ce4a43e](https://github.com/liaolongdong/account-password-helper/commit/ce4a43e0e82ca78fbfbac5803ca9212af511b73f))
* **content:** 偏好设置行序按使用频率重排，个人信息字段提示紧跟快速填充方式 ([ad5c0a4](https://github.com/liaolongdong/account-password-helper/commit/ad5c0a48794e27a38cebaf8634352ba33271e72b))
* **content:** 填充成功在页面内回执，锚定刚写入的那个字段 ([816c494](https://github.com/liaolongdong/account-password-helper/commit/816c4944fa3c9b0eb99c2806fda48b10b57583f0))
* **content:** 影子 DOM 穿透总闸进偏好面板，翻转即重检测 ([21235fc](https://github.com/liaolongdong/account-password-helper/commit/21235fcaf2bcc5ec3de5a71303bd644fc07205a8))
* **content:** 手机号+验证码登录页可填充，账号回退到手机号框 ([7e94911](https://github.com/liaolongdong/account-password-helper/commit/7e94911456d110cbf8ae86e76f4a5816c851f536))
* **content:** 机构证照号的闸门出口改判编号族，证据只认这一格自己的标签与属性 ([0936df8](https://github.com/liaolongdong/account-password-helper/commit/0936df8f075f6695a44fe7983dccf086dde5abd7))
* **content:** 编号族翻案，第 17 档 serialNumber 把落点说成自定义字段 ([1f13f05](https://github.com/liaolongdong/account-password-helper/commit/1f13f05a1999054a2fcb6907fc6fcc229c9c1536))
* **content:** 身份提示深链带上本人姓名检索词，并救回组件库式兄弟块标签 ([6e92d5c](https://github.com/liaolongdong/account-password-helper/commit/6e92d5cc81cc787cf79f8164fea94f77d6d95989))
* **content:** 身份提示认得组件库形状与卡类三档，且只跟随能打字的框 ([7a4587d](https://github.com/liaolongdong/account-password-helper/commit/7a4587dbb098e3371cd2253ab9babc3fe4475ca2))
* **content:** 难记的号码补齐词表，四条误报按子串收窄 ([a2eb398](https://github.com/liaolongdong/account-password-helper/commit/a2eb398abd2136c340aef886b6129a6ce9833de7))
* **content:** 页面个人信息字段提示——只报字段类型，零明文跨界 ([b0eda69](https://github.com/liaolongdong/account-password-helper/commit/b0eda69be14c6b27d2dd6d8200a93b9001d52cff))
* **identity:** 身份信息库回收站——删除可恢复，30 天自动清理 ([d435e7f](https://github.com/liaolongdong/account-password-helper/commit/d435e7f671dcdd918a375d4aa8789ea58a41bf23))
* **landing:** 工作原理段末补「打开速度带」，四段机制说明取代秒表演示 ([bca4028](https://github.com/liaolongdong/account-password-helper/commit/bca4028a9a25f1378dde4d0d9a473214005a972a))
* **options:** 个人信息库上限抬到 100，计数并入全选行、批量按钮间距收到 8px ([9f831d8](https://github.com/liaolongdong/account-password-helper/commit/9f831d88f02f44ea69719fa87cc318042daee36a))
* **options:** 个人信息库卡片标题区支持点击折叠 ([59db9af](https://github.com/liaolongdong/account-password-helper/commit/59db9afaa9d7a3655a4394d2b1f39e7cded5512e))
* **options:** 分享文案补充产品说明页并突出开源与加密 ([fefb605](https://github.com/liaolongdong/account-password-helper/commit/fefb605dd5647bce004e8cfc7498c88a3bd92842))
* **options:** 增加安全起步清单与同事分享入口 ([aefa606](https://github.com/liaolongdong/account-password-helper/commit/aefa606c4347a5acbb9e6c2bbb3578553d65a8fd))
* **options:** 增加更新提示与一次性评价引导 ([30cffd2](https://github.com/liaolongdong/account-password-helper/commit/30cffd27374bc20c1a60e5e1c81f5358f64ec944))
* **options:** 安全体检增加本机趋势与报告就绪等待 ([b9ccc00](https://github.com/liaolongdong/account-password-helper/commit/b9ccc00e2991d9a9a3c835bc7eae396f1e06dc5f))
* **options:** 更新弹窗亮点扩到五条并加语言小图标 ([9a5b97f](https://github.com/liaolongdong/account-password-helper/commit/9a5b97f7a5fa7ce3df2aa59971ebe90095801dd5))
* **options:** 更新提示改为弹窗并补充关于页评价入口 ([c9a672a](https://github.com/liaolongdong/account-password-helper/commit/c9a672a628bfafcc624a4e52f9dbcd965df3a9da))
* **options:** 站点规则支持在页面点选拾取选择器 ([1351234](https://github.com/liaolongdong/account-password-helper/commit/13512343aabddff7627f04f14b105aba860b32f6))
* **options:** 评价引导改为密码库满 7 天且用过一次后询问 ([c4edca8](https://github.com/liaolongdong/account-password-helper/commit/c4edca8ff3be12334eeba914db338c06062489c1))
* **options:** 评价引导改为首次成功填充满 7 天后触发 ([c2ee6b9](https://github.com/liaolongdong/account-password-helper/commit/c2ee6b9b7dda64773091b67addaa4db40000a088))
* **options:** 身份库加一条「只在搜不到时才打开」的认格通道，页面那行长字终于能用 ([2f069b0](https://github.com/liaolongdong/account-password-helper/commit/2f069b0d056e5583eca42bd9e64a6e26b7e3c72c))
* **options:** 身份库检索面收进内置字段名，标签列同时变成高亮面 ([8e3a911](https://github.com/liaolongdong/account-password-helper/commit/8e3a9117eab78fe8f31fcae3016b59cefb1be64e))
* **options:** 身份库零命中的空态给一条出路，深链不再把人送到死路上 ([02f6c49](https://github.com/liaolongdong/account-password-helper/commit/02f6c495ac85904b5152086306691acfa4892771))
* **seo:** 落地页首帧写进服务字节，并补无 JS 文字兜底与 llms.txt 入口 ([49e133d](https://github.com/liaolongdong/account-password-helper/commit/49e133d2f05ca1d612590ee425e07781e5cc23ec))
* **sidepanel:** 支持按端口隔离同域名不同端口的账号 ([1f32ae3](https://github.com/liaolongdong/account-password-helper/commit/1f32ae31af991aa220e6a19b2c05bdbdf3b1983f))
* **site:** 悬浮安装入口支持收起并补作者个人博客 ([dc12f53](https://github.com/liaolongdong/account-password-helper/commit/dc12f537667ddea69955bd11a40d20f245840dd1))
* **site:** 新增中英作者页并接入站点发现链路 ([092e365](https://github.com/liaolongdong/account-password-helper/commit/092e3659b5b74fc4c3898281d5c96ed966d16517))
* **site:** 落地页增加多环境匹配交互演示 ([43768f6](https://github.com/liaolongdong/account-password-helper/commit/43768f6cf85654525c7cd062878e733b84ef5b86))
* **site:** 补齐 RSS、llms-full 与博客无障碍结构 ([05c6e57](https://github.com/liaolongdong/account-password-helper/commit/05c6e57d912e624b78f73645020dd46bdea31ed0))
* 个人信息字段提示、个人信息库回收站，并更名个人信息库 ([3ab25e5](https://github.com/liaolongdong/account-password-helper/commit/3ab25e5f6994dabe7177b7e6b975ab4c8719144d))
* 删除撤销、Options 首屏与落地页 SEO/图片收口 ([57a1613](https://github.com/liaolongdong/account-password-helper/commit/57a16136296d1af1d2af3b870279aa015c729907))


### Bug Fixes

* **a11y:** 悬浮按钮设置面板与两个密码弹窗补齐键盘可达 ([0c922bf](https://github.com/liaolongdong/account-password-helper/commit/0c922bfb4a29dd15fdef109b0122c5b4d85f04a2))
* **background:** 内联面板填充失败不再「点了没反应」，三条后台判死路径补发页面提示条 ([1188d0d](https://github.com/liaolongdong/account-password-helper/commit/1188d0d343996aef5fdeb73e1346e20b0dbaf957))
* **content:** tel / cell 改整词判定，酒店名这类框不再被读成手机号输入框 ([16e0e0e](https://github.com/liaolongdong/account-password-helper/commit/16e0e0ee580300f46dd5d82aa4bd596887de93f7))
* **content:** 个人信息气泡那行首次说明加图标与深蓝，不再被当成次要文字 ([c105232](https://github.com/liaolongdong/account-password-helper/commit/c105232d5d7f05577f8684167d2dc35d28fc5468))
* **content:** 修正手机号回退填错目标框及填充回执/图标/收藏三处竞态 ([c9fc71d](https://github.com/liaolongdong/account-password-helper/commit/c9fc71d441868f2ef6d4dff43f14f4c8c6a62763))
* **content:** 偏好设置弹窗底缘改用线性淡出，撤回上一版的椭圆投影 ([af0af10](https://github.com/liaolongdong/account-password-helper/commit/af0af10c33d944aaff820b2613604d4f975116fc))
* **content:** 偏好设置弹窗底缘补 10px 固定留白，淡出改为「不越过内边距带」 ([2523ff1](https://github.com/liaolongdong/account-password-helper/commit/2523ff1d69b233b890848e69993455cb8f6218ae))
* **content:** 偏好设置弹窗底部不再被读成「切坏了」 ([727e2f7](https://github.com/liaolongdong/account-password-helper/commit/727e2f74c7702ee818d43085a1da315c6477dc19))
* **content:** 关闸那一下把屏上那枚身份提示一起收起 ([d202624](https://github.com/liaolongdong/account-password-helper/commit/d2026245fa84da66f10c907b8cf13d0fbc690aff))
* **content:** 右键菜单填充的回执跟着写入档位走，站点改写值不再报「已填充」 ([38b82d6](https://github.com/liaolongdong/account-password-helper/commit/38b82d6eeb618bfaeb5e1bef246176d46b6fb039))
* **content:** 填充回执加一次写后复检，值被站点异步改写时不再谎报「已填充」 ([0816dcd](https://github.com/liaolongdong/account-password-helper/commit/0816dcd7ca7d0a45f79bf492d59bfa4f12e594e4))
* **content:** 填充目标按值形状与字段语义排序，二选一登录页不再写错框 ([3baebe7](https://github.com/liaolongdong/account-password-helper/commit/3baebe73f1f2189ef2670713f5e94eb417341f8f))
* **content:** 字段分档三处串味——名/姓拆分、单位名、中文「单位名称」 ([8e1482c](https://github.com/liaolongdong/account-password-helper/commit/8e1482c555eb3f03e499e9768d2f9f3ea8cc9985))
* **content:** 换成 TS 的 DOM 类型里真存在的形状 ([33db6ce](https://github.com/liaolongdong/account-password-helper/commit/33db6ce5d1c5381b420390e7700bf73f9bdbe165))
* **content:** 收敛填充评审三项缺陷——误点自定义复选框、假成功回执与不可信 reason 降级 ([462ae81](https://github.com/liaolongdong/account-password-helper/commit/462ae81eb71681a8130e96183d8068075526b767))
* **content:** 站点规则不再把密码写进验证码框，短信码站点可只钉账号一侧 ([d5c0ba5](https://github.com/liaolongdong/account-password-helper/commit/d5c0ba5ee13a53ab7b4d9dae27a5717a02acc790))
* **content:** 站点规则照用户设置执行，来源写进填充回执 ([e343797](https://github.com/liaolongdong/account-password-helper/commit/e343797e9ae6de6ad643f18b95c23d9a597a7d10))
* **content:** 站点规则那两档回执可悬停暂停并延长停留 ([5e5a0db](https://github.com/liaolongdong/account-password-helper/commit/5e5a0db78532b66297f88e3da40fee44f8b46a8e))
* **content:** 设置面板回灌全局配置时，Shadow DOM 总闸不再被画成关 ([3eab310](https://github.com/liaolongdong/account-password-helper/commit/3eab310eca3cfdfab510201ba38b73cc4099231b))
* **content:** 评审回灌六条子串误报，正向短语收窄、账号词元让给登录 ([ce901bb](https://github.com/liaolongdong/account-password-helper/commit/ce901bb3eef49a31a5c6f3477b74c06345d1de69))
* **content:** 豆包登录弹窗——注入 UI 宿主事件隔离防误关，role=checkbox 协议自动勾选 ([c117323](https://github.com/liaolongdong/account-password-helper/commit/c117323cd1ded5100f6b71ba7f1db5bc1382761d))
* **content:** 身份提示气泡的焦点路径三条收口（上一轮自查所引入） ([535109d](https://github.com/liaolongdong/account-password-helper/commit/535109d6add784eae487dab5ed9332783d9852fa))
* **content:** 身份提示气泡键盘可达并跟着换肤，回执胶囊文字收进 AA 档 ([4128d82](https://github.com/liaolongdong/account-password-helper/commit/4128d82fd91dc2e9be90dbe23e2f637b22bae26c))
* **content:** 身份提示的核对原因改为敏感信息 ([18bfd1e](https://github.com/liaolongdong/account-password-helper/commit/18bfd1ee956dc3bfe1708231dfde7f90be9cf006))
* **content:** 身份提示的让位判据改取 shouldShowSidePanel ([5f0db68](https://github.com/liaolongdong/account-password-helper/commit/5f0db6841491e22c7de846318fdbacacd144d05a))
* **content:** 遮蔽框不参与形状回推，password 进结构性排除 ([0f3aa57](https://github.com/liaolongdong/account-password-helper/commit/0f3aa5775ed6287efdfe7100bc5eed78c52ecdf5))
* **deps:** vitest 抬到 4.1.12，消掉 @vitest/mocker 的 2 条 Dependabot 告警 ([43c424e](https://github.com/liaolongdong/account-password-helper/commit/43c424e1e742bb22719a5ccb8381213d5fd506c7))
* **deps:** vitest 抬到 4.1.12，消掉 @vitest/mocker 的 2 条告警 ([0f2427d](https://github.com/liaolongdong/account-password-helper/commit/0f2427dbacfeeae6e73885c65f2f186108ea5165))
* **deps:** 用 pnpm override 把 vite 钉到 ~8.2.4，消掉 3 条 Dependabot 告警 ([e3139fd](https://github.com/liaolongdong/account-password-helper/commit/e3139fd6c1b8c6b361cdbae34ce4df9fb680141a))
* **docs:** 账本里那处逐字写出的真实姓名改成不复述的说法 ([e731569](https://github.com/liaolongdong/account-password-helper/commit/e731569d685d08129457a455a6aa509edd02fef8))
* harden shadow selectors, identity trash, and undo flows ([fd9f694](https://github.com/liaolongdong/account-password-helper/commit/fd9f6948649cef5aebe28ca9c683c6e2da647fd5))
* **i18n:** 跨上下文回话只传结构化原因，文案由消费侧按自身语言出 ([bf44d0d](https://github.com/liaolongdong/account-password-helper/commit/bf44d0d7f253854c658e316975fcf2a7ffebe77d))
* **identity-hint:** 深链不再按角色预选类别，一律「全部」档 + 检索词 ([efbb03a](https://github.com/liaolongdong/account-password-helper/commit/efbb03a50105060add992439fc38383e8298ec7a))
* **messageRouter:** 修复填充异常信息泄漏页面问题 ([5206886](https://github.com/liaolongdong/account-password-helper/commit/52068867247c0e80f374abe289df0a49660242ce))
* **motion:** 悬浮按钮按压反馈改走关键帧，撤掉假时长 ([1d86727](https://github.com/liaolongdong/account-password-helper/commit/1d8672758f478199886c3e73781a5ceb82fa74b4))
* **motion:** 接力胶囊补上减弱动效档 ([ca1f50a](https://github.com/liaolongdong/account-password-helper/commit/ca1f50ace4c44cd7eff959abf45511a0e254c499))
* **motion:** 时长收进三档令牌，删除动画与 CSS 节奏对齐到 200ms ([1fea3d9](https://github.com/liaolongdong/account-password-helper/commit/1fea3d984d8a582c95096055fc9c756d6b731eb2))
* **options:** 个人信息库选择栏两枚按钮净间距收到 12px ([c29629f](https://github.com/liaolongdong/account-password-helper/commit/c29629fdf397890c12f06cc2d972df61e2a2ee40))
* **options:** 中性启动骨架改为进度条并补侧边栏首帧用例 ([402fd28](https://github.com/liaolongdong/account-password-helper/commit/402fd2807441bc1f15a9400528582312fa2fdb3d))
* **options:** 主密码验证弹窗打开后把焦点还给密码输入框 ([96da6c1](https://github.com/liaolongdong/account-password-helper/commit/96da6c128170f6ca205dcb79691c782b958e9b72))
* **options:** 侧边栏与悬浮按钮的管理入口也预判 vault 首屏 ([aa3732b](https://github.com/liaolongdong/account-password-helper/commit/aa3732b429124e0863453e4e7f7d49a339245149))
* **options:** 分享文案改用自动登录并补充个人信息库 ([3aaa71b](https://github.com/liaolongdong/account-password-helper/commit/3aaa71ba9fda765f0c43b13e924dcfbf99c3aed9))
* **options:** 弹窗 footer 按钮间距收到 12px，关于抽屉三按钮提到默认档 ([dc0137f](https://github.com/liaolongdong/account-password-helper/commit/dc0137f6db0f0f83f890600d684a00503557e567))
* **options:** 永久关闭后仍记录首次填充锚点 ([53e902e](https://github.com/liaolongdong/account-password-helper/commit/53e902eb78f7e7e01c095261c412a7e078afaf9b))
* **options:** 评价弹窗的迟到关闭事件不再改写永久关闭，体检报告改为每次重算 ([4b038e6](https://github.com/liaolongdong/account-password-helper/commit/4b038e624caebc8d980455912d5f16e1370f0d2c))
* **options:** 锁定态隐藏身份提示并让首屏骨架跟随认证状态 ([38c074f](https://github.com/liaolongdong/account-password-helper/commit/38c074f5a304cf936e733ff4a8eef377df3955bb))
* **options:** 首屏骨架平滑交接与站点规则配对提示实时刷新 ([3395d17](https://github.com/liaolongdong/account-password-helper/commit/3395d17595ba27297f80d1d4379e5944c872dd31))
* **options:** 首帧骨架预判上次视图，消除验证骨架闪烁 ([1e7ed55](https://github.com/liaolongdong/account-password-helper/commit/1e7ed5504fc6fe0ef68fe5b8d0c273d718b95cec))
* **sidepanel:** 两处 catch 收窄到 unknown，补上上轮 P2-5 的真源 ([a20322a](https://github.com/liaolongdong/account-password-helper/commit/a20322a79df62a9b1286940de00b9e87c42057db))
* **sidepanel:** 验证码填充回执跟着写入档位走，复检未通过不再报「填充成功」 ([c0ab57a](https://github.com/liaolongdong/account-password-helper/commit/c0ab57a3cacb23741a9b78e977695cd4914e4f04))
* **site:** 作者页补齐商店链接并修正开源贡献者身份 ([48fee34](https://github.com/liaolongdong/account-password-helper/commit/48fee3460d5b92f0eca9eb24fe0449308f1ab98f))
* **storage:** 回收站恢复不再把空操作报成成功，换钥前复验快照 ([b67942a](https://github.com/liaolongdong/account-password-helper/commit/b67942a7962b4997096658c1c907b9decb94ccee))
* type-guard cross-root selector visibility check ([628839d](https://github.com/liaolongdong/account-password-helper/commit/628839d8d7abcdff7aad120af12eae0cacda6cca))
* **ui:** 四条静默失败路径给出可动作的反馈 ([8a92bc3](https://github.com/liaolongdong/account-password-helper/commit/8a92bc3e80d9089ff63cce9022c9f77af6e8d9e4))


### Reverts

* **ci:** 撤掉无效的 CodeQL 行内抑制，改在告警侧标记误报 ([31f03bd](https://github.com/liaolongdong/account-password-helper/commit/31f03bd9c9c91387c3c2ba5a7b85f3f6fcd5152a))
* **content:** 撤回偏好设置弹窗底缘的全部可供性改动 ([381e665](https://github.com/liaolongdong/account-password-helper/commit/381e6658cc12e00cb28bab303dd8d29d87832328))

## [3.16.0](https://github.com/liaolongdong/account-password-helper/compare/v3.15.2...v3.16.0) (2026-10-14)


### Features

* **backup:** 备份提醒接通落盘闭环——全库导出才撤提醒，判定与接线补守卫 ([da254c7](https://github.com/liaolongdong/account-password-helper/commit/da254c7ff0cf31adf0ceb842e1c8da227af04d64))
* **identity:** 身份库主密码复验改成三档策略，默认「本会话内复验一次」 ([f542787](https://github.com/liaolongdong/account-password-helper/commit/f542787107d0012fafc92b26e95a5e55063f622f))
* **options:** 「关于」简介改成一段能读的事实 + 五条核心能力清单 ([f8dd7b7](https://github.com/liaolongdong/account-password-helper/commit/f8dd7b788766b5ebb20bd5c44afa833f6010793c))
* **options:** 「查看详情」改用自绘详情卡，替掉语义是「提示」的圆圈 i ([8f0b054](https://github.com/liaolongdong/account-password-helper/commit/8f0b054a2a498bf1c3a018f451c45601a262bdf0))
* **options:** 新增「关于」抽屉，集中版本、数据存放口径与对外出口 ([54d6d48](https://github.com/liaolongdong/account-password-helper/commit/54d6d48ebe2a115c09e94133e7baa15dbcd83d1f))
* **scripts:** 实现 main 分支自动同步合并工具 ([6d27ac8](https://github.com/liaolongdong/account-password-helper/commit/6d27ac8da80ce5e83c4be2d18b78d58dadb5f841))
* **site-rules:** 站点规则可按域名覆盖快速填充入口 ([7b14d3d](https://github.com/liaolongdong/account-password-helper/commit/7b14d3d9a6228eb6a2137211699819eb3a9d11c0))
* **theme:** 占位符独立成 --aph-text-placeholder 令牌，内联下拉同色收口 ([5f25e23](https://github.com/liaolongdong/account-password-helper/commit/5f25e23af3aa79b02edc93bce668a624f6816a77))
* 身份库复验三档 + 备份提醒落盘闭环 + 占位符令牌，对外文档口径随功能落地即刷 ([108e058](https://github.com/liaolongdong/account-password-helper/commit/108e058e751e64b3d9ba8481ff1d04acd9cf2292))


### Bug Fixes

* **command-palette:** 遮罩先成为滚动容器，再剪断滚轮到底部列表的滚动链 ([e22e721](https://github.com/liaolongdong/account-password-helper/commit/e22e721c289af6536f52dc23684d450d1ae0d607))
* **deploy:** Worker 静态资源只装公开落地页闭包 ([c60f63b](https://github.com/liaolongdong/account-password-helper/commit/c60f63bc880de2949c16f20eae4a331e9f298785))
* **deploy:** Worker 静态资源只装公开落地页闭包 ([a635a37](https://github.com/liaolongdong/account-password-helper/commit/a635a37165fc9af05bed9e2b29ba1ad341aae9fd))
* **options:** 「关于」抽屉的品牌标改用产物图标，堵住首屏 eager 预算被拆出新 chunk ([ae00ae2](https://github.com/liaolongdong/account-password-helper/commit/ae00ae28e6e27869cd93a1f9cb0a380987ed90d7))
* **options:** 「关于」抽屉的许可证订正为 GPL-3.0，并补全文出口与纵向版式 ([e947e1c](https://github.com/liaolongdong/account-password-helper/commit/e947e1c8957a260feee21beb095787386316383b))
* **options:** 「关于」简介的英文开关名改成界面真实显示的 Auto-submit login ([164c4a4](https://github.com/liaolongdong/account-password-helper/commit/164c4a48bc8e1c52a356a7786043b7a0a7985422))
* **options:** 抽屉标题与正文之间的空带由 52px 收到 24px ([1bc2c0a](https://github.com/liaolongdong/account-password-helper/commit/1bc2c0ac9b54b5069415636d05ed62c9b528a615))
* **options:** 条目详情抽屉长值折行、字段名不再竖排，备注补高亮与一键复制 ([8a79760](https://github.com/liaolongdong/account-password-helper/commit/8a79760e72f04c199546c2b318bebbceb9d46cd1))
* **options:** 站点筛选把「（无网址）」当普通一档，勾了站点不再带出没填网址的条目 ([a192e7b](https://github.com/liaolongdong/account-password-helper/commit/a192e7b89b9009386a720e4c677aebd32dfa3b10))
* **options:** 站点规则「跟随全局」改用非空哨兵，替掉英文占位符 ([e807276](https://github.com/liaolongdong/account-password-helper/commit/e807276a3d56b7e289c1ae8f6dbdb7205ee7d61c))
* **options:** 表格截断浮层收到 500px 上限，与标签气泡共用同一档宽度 ([2e42ba4](https://github.com/liaolongdong/account-password-helper/commit/2e42ba4f4c89dbc30a9506ba42e06191e59289f9))
* **options:** 顶部工具条左右两组按钮净间距统一为 12px ([933f03c](https://github.com/liaolongdong/account-password-helper/commit/933f03c88ffb92d12a82abc511ba86d4b9525396))
* **sidepanel:** 两颗复制图标之间的净间距由 12px 收到 8px ([7a0cc89](https://github.com/liaolongdong/account-password-helper/commit/7a0cc8952442ab85e4c09d91994ef97358cd5e2e))
* **site-rules:** 修正影子 DOM 穿透行提示语左对齐问题 ([c709c0c](https://github.com/liaolongdong/account-password-helper/commit/c709c0c27abcb5b2953b83dd74b98600d8a27d95))
* **site-rules:** 清掉唯一覆盖时移除规则，而不是把用户堵在改不回去的死路上 ([7cbd38d](https://github.com/liaolongdong/account-password-helper/commit/7cbd38db256b9c553424d0b0e993064fe7463e77))
* **store-shots:** 修掉两处把 Node 常量写进浏览器侧脚本的引用错误，seed 时压掉新手引导 ([2a59bef](https://github.com/liaolongdong/account-password-helper/commit/2a59bef952a73400ee72bb6418a9edcf29fdc418))

## [3.15.2](https://github.com/liaolongdong/account-password-helper/compare/v3.15.1...v3.15.2) (2026-10-11)


### Bug Fixes

* **options:** 筛选下拉的悬浮 title 补到整行与闭合态选中标签 ([5fb7bfb](https://github.com/liaolongdong/account-password-helper/commit/5fb7bfb9b5f5cad7960a84b891f7f2f072fadad2))
* **options:** 筛选下拉的悬浮 title 补到整行与闭合态选中标签 ([5e50556](https://github.com/liaolongdong/account-password-helper/commit/5e50556ee8362f1d457aa5b6202721829ca5c164))

## [3.15.1](https://github.com/liaolongdong/account-password-helper/compare/v3.15.0...v3.15.1) (2026-10-11)


### Bug Fixes

* **options:** 复验门槛弹窗剪断滚动链，动作图标净间距归一到 8px ([55c4aea](https://github.com/liaolongdong/account-password-helper/commit/55c4aeaf9ac3dbe11dcaa0868fe8d5955391d73a))
* **scripts:** 私钥与 Publisher ID 的两处 CLI 提示不再指向错地方 ([f8a92f4](https://github.com/liaolongdong/account-password-helper/commit/f8a92f4140c6fda8ab3aec180c35762271dc947e))

## [3.15.0](https://github.com/liaolongdong/account-password-helper/compare/v3.14.1...v3.15.0) (2026-10-11)


### Features

* **content:** 自动保存的标签预填只取页面标题里的站点名 ([8c1d3ab](https://github.com/liaolongdong/account-password-helper/commit/8c1d3ab9f6d49279e7a0d891b1084028315b6162))
* **options:** 按站点筛选、标签上限 5、详情抽屉一键检索身份库 ([3f280ff](https://github.com/liaolongdong/account-password-helper/commit/3f280ff929d6b1f780a7db23c84dc459d0d27ffd))
* **options:** 标签 / 站点筛选从下拉搬进管理页常驻左侧分类栏 ([707f34d](https://github.com/liaolongdong/account-password-helper/commit/707f34dcdf0f6772890c0a112d3f6353cfc10614))
* **options:** 标签筛选候选带条目数与悬浮原文，两个下拉形状对齐 ([4f86a96](https://github.com/liaolongdong/account-password-helper/commit/4f86a962634ed3ded80fdc20924eb31b89bcb3bf))
* **options:** 站点筛选与标签上限 5，详情图标去眼睛化，候选面板滚动隔离 ([885cb96](https://github.com/liaolongdong/account-password-helper/commit/885cb969c0cf21edb7033105f8a2d2ca09a0ba68))
* **options:** 站点筛选补「（无网址）」一档，把没填网址的条目挑出来 ([b11c4b2](https://github.com/liaolongdong/account-password-helper/commit/b11c4b21bac099add0afe338d8e87a02d23b62db))
* **options:** 管理页新增「按站点筛选」，标签上限放宽到 5 ([34881aa](https://github.com/liaolongdong/account-password-helper/commit/34881aa6403a9bc6c2a83cb2a2c5ae6b2ed3f490))
* **options:** 详情抽屉一键把用户名带去身份库检索 ([f632017](https://github.com/liaolongdong/account-password-helper/commit/f63201768bed16939964dda7145a631c84c5b80a))


### Bug Fixes

* **options:** 弹窗关掉不再把列表弹回顶部，候选面板不再拖着列表滚 ([efbcef4](https://github.com/liaolongdong/account-password-helper/commit/efbcef40aecb804653c5081a0f6d049ee10f1e89))
* **options:** 详情按钮改用圆圈 i，把眼睛留给「显示 / 隐藏密码」 ([a39436d](https://github.com/liaolongdong/account-password-helper/commit/a39436dd7bf0fca57b9286a2d616ee09d5a3ab53))


### Reverts

* **options:** 撤销「左侧分类栏」，标签 / 站点筛选恢复为筛选栏下拉 ([96513ba](https://github.com/liaolongdong/account-password-helper/commit/96513baf5f3852e236718fc0ceac6d53babee381))
* **options:** 撤销弹窗滚动还原——归零是 Playwright 自己滚的 ([5903ba7](https://github.com/liaolongdong/account-password-helper/commit/5903ba7820c9f4d8ec5add29aa8c08856b6a2df0))

## [3.14.1](https://github.com/liaolongdong/account-password-helper/compare/v3.14.0...v3.14.1) (2026-10-09)


### Bug Fixes

* **ci:** 商店 status 档免构建免 tag，凭据链自检随时可跑 ([39ffdb0](https://github.com/liaolongdong/account-password-helper/commit/39ffdb0cdf136adcfa390f3006a00514f35f14a5))

## [3.14.0](https://github.com/liaolongdong/account-password-helper/compare/v3.13.1...v3.14.0) (2026-10-09)


### Features

* **identity:** 身份信息库排序增至五档，拖拽排位落盘为手动序 ([2c34ad8](https://github.com/liaolongdong/account-password-helper/commit/2c34ad8e53c6226919472b46c9930a4d0bea553d))
* **identity:** 身份信息库支持逐张折叠与四档排序，档位作为视图偏好落盘 ([42e406d](https://github.com/liaolongdong/account-password-helper/commit/42e406d18e086e3a9dd5d32420547ba8018e9e5d))
* **options:** 密码管理页内置文档中页，引导补一步「当场打开侧边栏」 ([d967413](https://github.com/liaolongdong/account-password-helper/commit/d9674132c9ff2fa1ae96e8f3026fd762a93b759e))
* **options:** 指引页目录跟随滚动、条带与正文共用一根基准线，阅读宽度收到 696px ([236226b](https://github.com/liaolongdong/account-password-helper/commit/236226b08b2a62eeaf089c775633107895a3b8ad))
* **options:** 新增聚光式新手引导，光圈直接套住页面上的真实按钮 ([779bbfd](https://github.com/liaolongdong/account-password-helper/commit/779bbfd747e2d8939196c973842b5976931503fb))
* **options:** 新增聚光式新手引导，身份信息库支持逐张折叠与四档排序 ([447a909](https://github.com/liaolongdong/account-password-helper/commit/447a909d322bb329ad35e357f18163380e92bf99))
* **site:** compare 两页铺上滚动入场，门控页由 2 个增至 4 个且守卫会配对读 CSS ([e5d6a84](https://github.com/liaolongdong/account-password-helper/commit/e5d6a84d8f42130808c21127b227b05385d147d6))
* **site:** f8 装上可点的生成器演示，强度条读的是扩展那四条规则 ([26c996c](https://github.com/liaolongdong/account-password-helper/commit/26c996c3da2c4efc87ed542509c4b3da1946ea01))
* **site:** 场景表逐行错峰与分类筛选，补粘性安装入口和行悬停回色 ([e3438f8](https://github.com/liaolongdong/account-password-helper/commit/e3438f825e66b3530d63d4710aecae6063188422))
* **site:** 官网 20 个对外页面自动跟随系统暗色，令牌层成为唯一改色入口 ([3539e0d](https://github.com/liaolongdong/account-password-helper/commit/3539e0dcaaa7ba303192f16439fd64962dadcd80))
* 侧边栏有界渲染窗口与按单帧预算反推的批次，附安全/评审回灌、量具与对外口径收口 ([ee9cac0](https://github.com/liaolongdong/account-password-helper/commit/ee9cac0f71b5f97040ae0ab65a27c3de22321d3b))


### Bug Fixes

* **benchmarks:** meta.only 的空数组恒为真，跑全部场景时按约定记 all ([20ffacb](https://github.com/liaolongdong/account-password-helper/commit/20ffacb7a84250094eb7f54fe1ab1eec6bd385b0))
* **blog:** 五张封面的角标计数跟上门牌，blogMeta 补 15 例产物守卫 ([0b3d5dd](https://github.com/liaolongdong/account-password-helper/commit/0b3d5ddb3dc0a38e064b1386c02d3089b125b34f))
* **blog:** 博客 12 页一次性修掉五类 SEO 缺陷，并补上会变的守卫 ([b1c0b89](https://github.com/liaolongdong/account-password-helper/commit/b1c0b896efe70cd698ddcf2c571b94a56dc6a695))
* **blog:** 博客 12 页链接与序号文字改走 --accent-ink，生成器两份模板同步 ([3334b81](https://github.com/liaolongdong/account-password-helper/commit/3334b81fa7e147de35dbc3c632e5fb465fd547fb))
* **copy:** 语言包那句「零联网」改限定口径，守卫扫描面补上三处对外表面 ([24ef71b](https://github.com/liaolongdong/account-password-helper/commit/24ef71b382a662efef37a6434d9e6ea99b58ab4a))
* **crypto:** PBKDF2 轮数收进 utils/cryptoParams.ts 单一真源 ([62cbf2d](https://github.com/liaolongdong/account-password-helper/commit/62cbf2d203046106fc47fa470cae64b3149a6f1b))
* **i18n:** 「大列表分页」点明管理页归属，并说明侧边栏按需渲染不跟随档位 ([c69521d](https://github.com/liaolongdong/account-password-helper/commit/c69521d8aada9fd3fa602f5ea772f2518b168440))
* **landing/compare:** 判定格与链接改走墨色令牌，英文版补齐 .card 并钉上成对守卫 ([08c02f1](https://github.com/liaolongdong/account-password-helper/commit/08c02f1d7bdf82fd6b164d2d4270f154493e443b))
* **landing:** 官网六页「实底色当文字用」全部改走墨色令牌，并给正文链接补上着色规则 ([7b40419](https://github.com/liaolongdong/account-password-helper/commit/7b404190a76faff0685787984695bc973d48c574))
* **landing:** 暗档不再拿实底主色当文字色，另起 --primary-ink / --success-ink 两枚文字令牌 ([4c890c0](https://github.com/liaolongdong/account-password-helper/commit/4c890c0a56771c121ceea62d70f85c77cca34d7c))
* **options:** 两轴评审回灌——指引页 link 按钮不可见与四处文案/文档口径 ([024a1cd](https://github.com/liaolongdong/account-password-helper/commit/024a1cd71edb7d4bc5e5076325241b5aae21d207))
* **options:** 引导末步的文档退路行改左对齐，链接内部禁止折行 ([41b8b8e](https://github.com/liaolongdong/account-password-helper/commit/41b8b8ebc62d82a46365867da2d7d32d6addea58))
* **options:** 表格截断浮层对指针透明，不再吃掉上一行的八处点击 ([97f0536](https://github.com/liaolongdong/account-password-helper/commit/97f05369c4dd1929cc7989a20cb42a6daf37aa3e))
* **options:** 表格截断浮层对指针透明，紧凑行距下不再吃掉上一行的八处点击 ([ff85d89](https://github.com/liaolongdong/account-password-helper/commit/ff85d895e808a3b374150cc211578989e69b0719))
* **security:** 夹具页事件日志改用 DOM 构造，消除 innerHTML 注入点 ([ade26b7](https://github.com/liaolongdong/account-password-helper/commit/ade26b757c293b9d61ab51ad05193642882d7a79))
* **seo:** FAQPage 结构化数据由 19 条白名单改为 42 条全量，覆盖面从此有守卫 ([e60ea8a](https://github.com/liaolongdong/account-password-helper/commit/e60ea8adaf9b1915bf73e52e410e32d27b0080f4))
* **seo:** front matter 补三道形状校验，ld+json 的尖号统一转义，sitemap 日期收口 ([3e9b242](https://github.com/liaolongdong/account-password-helper/commit/3e9b242f70279aa4c7052cdd461ec3d7f4bf4e32))
* **seo:** sitemap 自述日期对齐、隐私页双 h1 合一与口径订正、product-site 副本 noindex ([4943ebd](https://github.com/liaolongdong/account-password-helper/commit/4943ebdaf214e8e22b94a0f0ff70c8ad4cbca8bc))
* **seo:** 分享卡按语言分中英两张 1200×630，compare 两页补齐图标与 theme-color ([58f2c3c](https://github.com/liaolongdong/account-password-helper/commit/58f2c3c43c31bdef21131e5ec673fbaa9a2ee408))
* **seo:** 博客回改补登 modified 到 2026-10-02，重生成 12 页并同步 sitemap ([4752fb8](https://github.com/liaolongdong/account-password-helper/commit/4752fb8456505031008ede795369b2906099ff5a))
* **sidepanel:** 复制验证码时取消待执行的密码自动清除，避免抹掉正要粘贴的活码 ([12d1bfb](https://github.com/liaolongdong/account-password-helper/commit/12d1bfb61dcd38f695469b5beb14927ab1ce429d))
* **site:** 评审回灌——被禁隐私口径清零、守卫补牙与注释订正 ([8073a53](https://github.com/liaolongdong/account-password-helper/commit/8073a53933063edfd949039d7d97f13ff5922113))
* **tests:** 动态正则的转义补全为全量控制字符 ([07fa41b](https://github.com/liaolongdong/account-password-helper/commit/07fa41b89331768ecdc5d043ad2e49946f8ab8f3))
* **tests:** 动态正则的转义补全为全量控制字符 ([c0928ac](https://github.com/liaolongdong/account-password-helper/commit/c0928acbbee096d9a2476e5dd963a90ce07e4d5f))
* **update:** 更新跳转地址在写入与出口两处过协议闸门，杜绝非 http(s) scheme ([c3554f9](https://github.com/liaolongdong/account-password-helper/commit/c3554f9bf59dbefb9ddc836f025615e1ea7254ba))


### Performance Improvements

* **render-window:** 每帧批次改由单帧预算反推，触底到达量拆成独立常量 ([b10f20a](https://github.com/liaolongdong/account-password-helper/commit/b10f20a4458494e7814cd9e3da3a2ea74c9bb8f5))
* **sidepanel:** 列表落定态收进 100 行有界渲染窗口，2000 条击键不再重渲整库 ([d504f13](https://github.com/liaolongdong/account-password-helper/commit/d504f13fe70d59633386595e109cc3dc6c984842))

## [3.13.1](https://github.com/liaolongdong/account-password-helper/compare/v3.13.0...v3.13.1) (2026-09-29)


### Bug Fixes

* **options:** 操作列提示浮层对指针透明，紧凑行距下不再吃掉上一行的点击 ([46d1482](https://github.com/liaolongdong/account-password-helper/commit/46d14822aa05d1e30fcf38b5a5696b0768629e5a))
* **options:** 操作列提示的浮层对指针透明，紧凑行距下不再吃掉上一行的点击 ([93c58c5](https://github.com/liaolongdong/account-password-helper/commit/93c58c5dd97ecc3dc1b82a5433f54bd0fc6a2744))

## [3.13.0](https://github.com/liaolongdong/account-password-helper/compare/v3.12.0...v3.13.0) (2026-09-28)


### Features

* **landing:** FAQ 拆两栏，右侧新增由 FAQS 生成的「分类直达」 ([ac47805](https://github.com/liaolongdong/account-password-helper/commit/ac47805ba79c25f218e1462d221cf5feb1116d10))
* **landing:** FAQ 静态化与守卫测试 ([e9be846](https://github.com/liaolongdong/account-password-helper/commit/e9be846b046eed40e13d76bf7ef3b640df5ecd0b))
* **landing:** 数据带六个数字滚动到源码写死的终值，无 JS 与 reduce 仍显示终值 ([85fd976](https://github.com/liaolongdong/account-password-helper/commit/85fd976ff6fa2abd8b36bd5c0a7c35c564d71646))
* **landing:** 页头下沿新增阅读进度条并配三档降级 ([b62ec1b](https://github.com/liaolongdong/account-password-helper/commit/b62ec1bbc0840ce690180d95353ea3641da21871))
* **landing:** 页头减负提可读性，图标水波纹 / CTA 脉冲与 FAQ 出口卡 ([12a0f61](https://github.com/liaolongdong/account-password-helper/commit/12a0f61c8dd7207d940fbcf4d496bcdb6e81aa41))
* **product-site:** 新增独立产品站源码与素材，收口 CI 产物守卫与评审报告 ([ca33c83](https://github.com/liaolongdong/account-password-helper/commit/ca33c83e73c32bc79f66955c4c6f44b340c9dfde))
* **site:** 同作者插件中文名全站同步 ([c1bb11b](https://github.com/liaolongdong/account-password-helper/commit/c1bb11bbb7736171bdc07fb67ae5e964f65d6b02))


### Bug Fixes

* **a11y:** 减弱动效收口到单一判据，命令面板补齐模态与组合框语义 ([5a41bfd](https://github.com/liaolongdong/account-password-helper/commit/5a41bfd6d013b2ae85583b2572e6ca9953a2de99))
* **backup:** .aph 导入失败提示不再外泄原始异常文本 ([43f867f](https://github.com/liaolongdong/account-password-helper/commit/43f867f9ff6f296c3d00f9ae193d4e607a602ba0))
* **backup:** 撤除 CSV 导出的公式中和，回到文档原有的「刻意不做」口径 ([876cf89](https://github.com/liaolongdong/account-password-helper/commit/876cf892d3db4b0efada84cf3bbe9e4d23932b54))
* **dialogs:** 弹窗的异步结果只允许落在仍然有效的打开态上 ([f060afd](https://github.com/liaolongdong/account-password-helper/commit/f060afd891a19aec255dd4f79d8fd596286bc1ac))
* **landing:** 修页头/轮播/流水线/对照表八处窄屏与键盘缺陷，README 演示图改单列 ([d596fb4](https://github.com/liaolongdong/account-password-helper/commit/d596fb4906531fb2a7bc65c2dd59fb345d67c4ba))
* **landing:** 灯箱接管焦点与轮播三处，删一条无消费者的揭示延迟规则 ([e8aeff1](https://github.com/liaolongdong/account-password-helper/commit/e8aeff1fd99072b32bc49d49e7ba0cbcd71fd669))
* **landing:** 页头右侧控件收组右对齐，语言键与源码图标等高同圆角 ([c15702b](https://github.com/liaolongdong/account-password-helper/commit/c15702b235c0a0abbd8e35d8a1b75623148b1013))
* **options:** 历史密码复制改走限时自动清除通道，回执文案收为单一来源 ([d499257](https://github.com/liaolongdong/account-password-helper/commit/d49925750c304843367d660323ccc32e92a785de))
* **options:** 邮箱备份默认档改「加密备份」，明文档加风险二次确认 ([56319dc](https://github.com/liaolongdong/account-password-helper/commit/56319dc899de3d50ddd93f6bf6e83527c3a29723))
* **security:** 共享托管后缀不再互认同主域，提示委托改由后台盖章转发 ([643f9c3](https://github.com/liaolongdong/account-password-helper/commit/643f9c33d0bc763a436705f41b52703a8581869b))
* **security:** 导出 CSV 中和公式前缀并保证往返还原，导入在读盘前施加字节上限 ([5f97a88](https://github.com/liaolongdong/account-password-helper/commit/5f97a8839d2c680d8ff1fb0a229ca15511765eba))
* **security:** 窗口与跳转类指令补 sender 归属闸门，编辑指令在路由边界收口条目 id ([e46a03a](https://github.com/liaolongdong/account-password-helper/commit/e46a03a175828642df84fe43df11076189a2578a))
* **sidepanel:** 3s 竞速超时不再把自己钉成「会话已失效」 ([212f21c](https://github.com/liaolongdong/account-password-helper/commit/212f21cf2833949430f67097c0dc96f017d502ee))
* **theme:** 补上影子树里永远取不到的中性令牌，并用闭包守卫盯住这类死链 ([ed447a9](https://github.com/liaolongdong/account-password-helper/commit/ed447a9382eb85b3750398982a7a88892c2d8336))


### Performance Improvements

* **search:** 拼音区间与主域缓存按 2000 条上限定容，当前主机归一加一格记忆 ([45948e9](https://github.com/liaolongdong/account-password-helper/commit/45948e933c13fc4c27d85220f722cbac57271ef5))
* **sidepanel:** 检索防抖收进 useKeywordDebounce 三处共用，批量改标签去掉逐条回查全库 ([43827fb](https://github.com/liaolongdong/account-password-helper/commit/43827fb44901d29defe4549ffd7b75818ef1f0f2))

## [3.12.0](https://github.com/liaolongdong/account-password-helper/compare/v3.11.0...v3.12.0) (2026-09-25)


### Features

* **domain:** 跨子域名匹配三档，两条填充路径共用分层判据 ([0b13bb3](https://github.com/liaolongdong/account-password-helper/commit/0b13bb377d7433dd55fe945e5f64e2b14733e93d))
* **formDetector:** 实现对 open shadow DOM 的递归表单字段收集能力 ([e8677e8](https://github.com/liaolongdong/account-password-helper/commit/e8677e88f81c8e939918be80db7b25af79f40f43))
* **help:** 跨子域匹配三档帮助词条，中英同步 ([548789c](https://github.com/liaolongdong/account-password-helper/commit/548789cf114bb06c5c807677cefd14fd4e67833c))
* **identity:** 增加身份信息库及作者其他插件展示功能 ([ccb1062](https://github.com/liaolongdong/account-password-helper/commit/ccb106297f1f419bf5deb008af847512388566f3))
* **identity:** 新增身份信息库功能及相关文档更新 ([e13393e](https://github.com/liaolongdong/account-password-helper/commit/e13393ec5ef77477a63fa21a40d2c05c0668c1d8))
* **identity:** 身份库批量折叠/展开 + 深度评审安全与规范修复 ([3847af0](https://github.com/liaolongdong/account-password-helper/commit/3847af0ca0dcdb1f43f18b0a1ebafa63b2194f89))
* **options:** 回收站按最近删除排在最前，并带关键词检索 ([33ce5c1](https://github.com/liaolongdong/account-password-helper/commit/33ce5c1b23fbc0fdd99380b1cf8e832ebeb7556f))
* **options:** 每页条数档位落盘，密码表与回收站弹窗共用同一份偏好 ([f88856b](https://github.com/liaolongdong/account-password-helper/commit/f88856b9313b825ac2fff90c1cbe7c859dc30e55))
* **options:** 添加命令面板及全局快捷键支持 ([5305ea3](https://github.com/liaolongdong/account-password-helper/commit/5305ea3d7cd7e08df42d9163570c632d0f2ff29c))
* **sidepanel:** 用户名/网址/备注截断时以 title 兜住全文，修正悬停区域 ([e8d3d1e](https://github.com/liaolongdong/account-password-helper/commit/e8d3d1e2b0a77d677c755aec5cb47172562131d3))
* **siteRules:** 站点规则支持明文 JSON 导出与按域名合并导入 ([f714944](https://github.com/liaolongdong/account-password-helper/commit/f7149449baaa4c9ce95c95526445baf7410fd078))


### Bug Fixes

* **background:** 提醒逐条隔离失败，角标重叠不再误快照，通知点击走选项页单例 ([ca8e5b1](https://github.com/liaolongdong/account-password-helper/commit/ca8e5b1debab6cb290e016ea8ca3e2f7e3c1753d))
* **content:** 保存弹窗迁入 Closed Shadow DOM，委托通知锁定顶层 origin ([b65baa2](https://github.com/liaolongdong/account-password-helper/commit/b65baa2d4a8819193cef945adb688677db97f7e6))
* **content:** 兜底勾选不再被合成 click 翻回未选中，拖拽与内联面板的页面副作用按快照回收 ([1acfdad](https://github.com/liaolongdong/account-password-helper/commit/1acfdadbb078a89bf1c576e08501fda485f002aa))
* **domain:** 通配标记活过 URL 解析，跨子域区间收进单点判据 ([aad474c](https://github.com/liaolongdong/account-password-helper/commit/aad474cbb85c3db3f00664846e6fd926ba6b45b4))
* **form:** 编辑超容量条目时按原长度放宽校验上限 ([7c3da6b](https://github.com/liaolongdong/account-password-helper/commit/7c3da6ba1c3f0f66dd9b1094ff7895bc77d231fb))
* **landing:** 动效地基三处——html.js 门控、轮播只动 transform、循环动效视口门控 ([288d4eb](https://github.com/liaolongdong/account-password-helper/commit/288d4eb816631953797e1f9a54b7225ac83c26d7))
* **options:** 导入超限给出可读提示，批量标签与表单保存不再静默/误报 ([53021d3](https://github.com/liaolongdong/account-password-helper/commit/53021d3f81d3e9d44caee450199f2fdcfa1b3850))
* **review:** 五轴评审四条缺陷收口——面板Enter归属/检索单一真源/加载代际/favicon明文键 ([cddbe3a](https://github.com/liaolongdong/account-password-helper/commit/cddbe3af91589db763a42fba608bc2df2d4a3c00))
* **review:** 收口存量缺陷并回退自动保存通道的标签静默截断 ([578ae8c](https://github.com/liaolongdong/account-password-helper/commit/578ae8cff55cf39c5af89e9ea6a31345275dba18))
* **session:** 收口锁定后的后台会话残留与回收站 at-rest 缺口 ([b1332f2](https://github.com/liaolongdong/account-password-helper/commit/b1332f25657f849191b1a454719efa8f0d967474))
* **session:** 旧版会话透明迁移补齐代际守卫 ([d00c108](https://github.com/liaolongdong/account-password-helper/commit/d00c10853d705f7bca9bdf304295d2deb68fca6c))
* **siteRules:** 修复站点规则链路缺陷并收口校验与回归测试 ([0470e87](https://github.com/liaolongdong/account-password-helper/commit/0470e87fe832aebad8fcfeb37906268a251c75ee))
* **storage:** rekey 保留旧钥不可解的历史记录 ([05b04ff](https://github.com/liaolongdong/account-password-helper/commit/05b04ff4d8816b006f8675e6ac4921b8624352c7))
* **storage:** 回收站恢复按 id 去重，避免交错产生重复条目 ([bf8b3fb](https://github.com/liaolongdong/account-password-helper/commit/bf8b3fb250b349d8ff8ff9cf192bd8211f30b789))


### Performance Improvements

* **options:** 空关键词那四处高亮改走纯文本出口，逐行文案收进一个 computed ([ea14c16](https://github.com/liaolongdong/account-password-helper/commit/ea14c16401ebedbf06d9b57c30824a3fbe4a00d5))
* **sidepanel:** 快照计入竞速裁决，切域名只改过滤条件 ([9d0008a](https://github.com/liaolongdong/account-password-helper/commit/9d0008a7381838500328f9998887179ba94e5474))

## [3.11.0](https://github.com/liaolongdong/account-password-helper/compare/v3.10.0...v3.11.0) (2026-09-15)


### Features

* **shareCard:** 添加一键复制分享卡片功能 ([5e14901](https://github.com/liaolongdong/account-password-helper/commit/5e149011b4573109c93b707faf125398d7814d7d))


### Bug Fixes

* **security:** 待确认凭据密钥移出页面存储，并修复四项自动保存与改密缺陷 ([c917d16](https://github.com/liaolongdong/account-password-helper/commit/c917d1645549d832887e70d93d617744f14a4ddf))

## [3.10.0](https://github.com/liaolongdong/account-password-helper/compare/v3.9.0...v3.10.0) (2026-09-13)


### Features

* **store-shots:** 更新 README 首屏登录示范动图和截图素材 ([289b3d2](https://github.com/liaolongdong/account-password-helper/commit/289b3d2d586978de8cbe4da473a6a5d77d4be455))


### Bug Fixes

* **content:** 修复自动保存弹窗英文标签断词，并重制官网与商店截图素材 ([dbb7822](https://github.com/liaolongdong/account-password-helper/commit/dbb7822bb5c245bf13d6b6cdbd584a8a65f40fa4))

## [3.9.0](https://github.com/liaolongdong/account-password-helper/compare/v3.8.0...v3.9.0) (2026-09-11)

### Features

- **docs:** 更新商店截图并添加脚本化生成工具 ([1f55d57](https://github.com/liaolongdong/account-password-helper/commit/1f55d576102d0a9a80f84a38cea4f712d1471e2b))

## [3.8.0](https://github.com/liaolongdong/account-password-helper/compare/v3.7.0...v3.8.0) (2026-09-06)

### Features

- **blog:** 发布技术博客并更新至v3.7.0版本 ([3622eb1](https://github.com/liaolongdong/account-password-helper/commit/3622eb1e03ef71e141f3d67ac81ebfe35f049529))
- **blog:** 添加博客封面渲染脚本并更新封面设计 ([c852b1e](https://github.com/liaolongdong/account-password-helper/commit/c852b1e142ac89dc743798247b3a996e6a95b1e0))
- **context-menu:** 右键菜单填充功能与代码评审修复 ([4ac3467](https://github.com/liaolongdong/account-password-helper/commit/4ac3467d4e9baaa87144fcd346f79990362aaa3f))
- **features:** 更新自动保存登录凭证功能描述 ([698f2f5](https://github.com/liaolongdong/account-password-helper/commit/698f2f51fcfe5c3e8e00ddc3a48ad8d44f7a91f7))
- **options:** 添加 jsdom 依赖并优化密码表单对话框 ([0678653](https://github.com/liaolongdong/account-password-helper/commit/0678653ccbf0c911a1d9ca409a63f7a92910c038))
- **options:** 添加密码条目只读详情抽屉功能 ([1a21287](https://github.com/liaolongdong/account-password-helper/commit/1a21287f1021b79ce09e842a8c7286e95253c7a2))
- **sidepanel:** 优化搜索体验和面板定位 ([234e8b9](https://github.com/liaolongdong/account-password-helper/commit/234e8b9e134074ff4738b68d0310e8ff1196d46f))
- **sidepanel:** 快速添加条目、Caps Lock 提示、安全加固与无障碍增强 ([3aa71eb](https://github.com/liaolongdong/account-password-helper/commit/3aa71eb3cf7981978881cc80521517e75aae88e3))
- **sidepanel:** 添加侧边栏搜索范围切换功能 ([2b8b02d](https://github.com/liaolongdong/account-password-helper/commit/2b8b02de7170b24e839fa703d4e9c9f3b3bd2131))
- **ui:** 优化 Vue 组件规范与侧边栏功能 ([f0336fa](https://github.com/liaolongdong/account-password-helper/commit/f0336faa358ea58a29388ef0c51cd77f05fdd363))

### Bug Fixes

- **fill:** 优化右键菜单填充与解锁体验 ([edd84e4](https://github.com/liaolongdong/account-password-helper/commit/edd84e4192a99932aa1e214bb2ed93496bba2d7f))
- **i18n:** 精简网址校验提示文案，避免侧边栏快速添加弹窗内文字重叠 ([fe744e3](https://github.com/liaolongdong/account-password-helper/commit/fe744e3f69d49dd91389a6da3878f97816e27361))

## [3.7.0](https://github.com/liaolongdong/account-password-helper/compare/v3.6.0...v3.7.0) (2026-08-27)

### Features

- **web:** 添加完整英文主页及相关样式和SEO配置 ([4c8ace8](https://github.com/liaolongdong/account-password-helper/commit/4c8ace829997dc1b0762a3e87cf75d927cf78f9b))

## [3.6.0](https://github.com/liaolongdong/account-password-helper/compare/v3.5.0...v3.6.0) (2026-08-23)

### Features

- **ui:** 添加密码可见性切换功能 ([a2d9e32](https://github.com/liaolongdong/account-password-helper/commit/a2d9e328ea34607db27a52f2527d8a23dd16ae46))

## [3.5.0](https://github.com/liaolongdong/account-password-helper/compare/v3.4.0...v3.5.0) (2026-08-20)

### Features

- **i18n:** 添加语言切换实时刷新支持 ([06aa87b](https://github.com/liaolongdong/account-password-helper/commit/06aa87bd28cde0e93df0edf00fddc81e82e34d08))
- **inlineDropdown:** 添加空状态新增站点按钮及交互 ([f5148c3](https://github.com/liaolongdong/account-password-helper/commit/f5148c33b00adb85d94da5231c49a509f2930cf4))
- **sidepanel:** 实现标签筛选横向滚动及渐隐指示器 ([374cc23](https://github.com/liaolongdong/account-password-helper/commit/374cc235cbc9d564555ed9ae25ddae9e7b7eca7e))

### Bug Fixes

- **autoSave:** 支持自动保存规则和黑名单的端口号区分匹配 ([48765a2](https://github.com/liaolongdong/account-password-helper/commit/48765a2f0f135f4c4b52e14eacafd5135aa9bb5a))
- **chromeListeners:** 增加 Chrome API 存在性检查及异常捕获 ([f44880a](https://github.com/liaolongdong/account-password-helper/commit/f44880a5c6d5e6acda6968959c8517d15d1c508f))
- **content:** 处理 allFrames 注入时空文档 iframe 的 DOM 观察异常 ([48a2e23](https://github.com/liaolongdong/account-password-helper/commit/48a2e234da17f8be8e75a6fb1883f8809a0a1428))

## [3.4.0](https://github.com/liaolongdong/account-password-helper/compare/v3.3.0...v3.4.0) (2026-08-18)

### Features

- **auth:** 添加主密码验证弹窗组件及相关控制器 ([3ba1f0e](https://github.com/liaolongdong/account-password-helper/commit/3ba1f0ef612e7435a05689a64f6affcd91ff4c8e))
- **core:** 支持端口匹配与主密码设置指引优化 ([9aa60b2](https://github.com/liaolongdong/account-password-helper/commit/9aa60b269c47623e8ee06be87e4e2d251933f1e7))
- **inlineDropdown:** 增加透明点击热区扩展 ([6606015](https://github.com/liaolongdong/account-password-helper/commit/6606015a2ed04b9913319e5e8aaa2d7f7c2e1618))
- **sidePanel:** 增加 Service Worker 预热以优化唤醒性能 ([a5efcfc](https://github.com/liaolongdong/account-password-helper/commit/a5efcfc40d7072b27f23824c026f074357cf5caf))

### Bug Fixes

- **background:** 优化广播异常处理及错误日志降噪 ([f96efaa](https://github.com/liaolongdong/account-password-helper/commit/f96efaa427dbb05b66064cb13c0222f74903646a))
- **background:** 修复广播消息无监听者时报错的问题 ([18f28d9](https://github.com/liaolongdong/account-password-helper/commit/18f28d935deadabcfe5fef714ab41ef943df9314))

### Performance Improvements

- **sidepanel:** 优化密码条目排序和标签渲染性能 ([e19c435](https://github.com/liaolongdong/account-password-helper/commit/e19c4354923054adef4e0e9191416bfd33184979))
- **sidepanel:** 优化帮助弹窗动态chunk预热策略 ([44f9bc5](https://github.com/liaolongdong/account-password-helper/commit/44f9bc52533631351c78fe047c0d4438b24c9171))

## [3.3.0](https://github.com/liaolongdong/account-password-helper/compare/v3.2.0...v3.3.0) (2026-08-14)

### Features

- **background:** 实现非 Windows 会话失效后的宽限期保活机制 ([8381e48](https://github.com/liaolongdong/account-password-helper/commit/8381e4812d6006a04bf89d73948f76ef918a01b4))

### Performance Improvements

- **core:** 优化 Service Worker 全平台常驻保活体验 ([c47c7f0](https://github.com/liaolongdong/account-password-helper/commit/c47c7f036fb3a2193ba6c8c48956ed4d30cd8a4a))

## [3.2.0](https://github.com/liaolongdong/account-password-helper/compare/v3.1.0...v3.2.0) (2026-08-12)

### Features

- **searchFilterBar:** 优化批量操作按钮和标签筛选交互布局 ([7940429](https://github.com/liaolongdong/account-password-helper/commit/7940429844ff3b1054a64acc4bfc6182409ed3bc))

### Performance Improvements

- **session:** 优化会话锁定状态快速判定及预热机制 ([348992a](https://github.com/liaolongdong/account-password-helper/commit/348992a64c265966b5325b8f6f3bc3ccd85bb55e))

## [3.1.0](https://github.com/liaolongdong/account-password-helper/compare/v3.0.2...v3.1.0) (2026-08-11)

### Features

- **auth:** 实现 TOTP 两步登录活码胶囊与接力机制 ([fd1b8a6](https://github.com/liaolongdong/account-password-helper/commit/fd1b8a6df560221a3becd60311ad363e8ec9406d))
- **background:** 优化并实现系统闲置锁定功能 ([a7c02b5](https://github.com/liaolongdong/account-password-helper/commit/a7c02b5d9d6f7ccd152540b75586f90567e76cfd))
- **options:** 新增标签筛选与批量标签编辑功能 ([d15b62a](https://github.com/liaolongdong/account-password-helper/commit/d15b62a64e4909c0dacbb3151189292b36eb70dd))
- **sidepanel:** 优化侧边栏资源预热策略，支持跨平台轻量预热 ([f8be9c7](https://github.com/liaolongdong/account-password-helper/commit/f8be9c7d27104704c8541624a57ded37d8313023))
- **sidepanel:** 支持拼音智能搜索与命中高亮功能 ([6173205](https://github.com/liaolongdong/account-password-helper/commit/61732052c1a1801f1f571e1b967cd7ce36747911))

## [3.0.2](https://github.com/liaolongdong/account-password-helper/compare/v3.0.1...v3.0.2) (2026-08-06)

### Bug Fixes

- **inlineDropdown:** 修复面板事件冒泡及焦点泄漏问题 ([f9d831b](https://github.com/liaolongdong/account-password-helper/commit/f9d831b39fa329aba825f283a9c2f658185111f6))

## [3.0.1](https://github.com/liaolongdong/account-password-helper/compare/v3.0.0...v3.0.1) (2026-08-05)

### Bug Fixes

- **license:** LICENSE 还原为 GPL-3.0 官方全文以修复 GitHub 许可证识别 ([db03acd](https://github.com/liaolongdong/account-password-helper/commit/db03acd83a73e5ad3ef4f9d9855194da7a16bc07))
- **license:** LICENSE 还原为 GPL-3.0 官方全文以修复 GitHub 许可证识别 ([190cdf9](https://github.com/liaolongdong/account-password-helper/commit/190cdf9d866ae7919c668243e6037be8d7f55d6f))

## [3.0.0](https://github.com/liaolongdong/account-password-helper/compare/v2.18.0...v3.0.0) (2026-08-05)

### ⚠ BREAKING CHANGES

- **license:** 开源协议由 MIT 切换为 GPL-3.0-only

### Features

- **popup:** 添加闲置自动锁定时长设置及锁按钮提示文案 ([621f5b5](https://github.com/liaolongdong/account-password-helper/commit/621f5b50e502f21e3be8b6a05e2fae45e1437e56))

### Bug Fixes

- **FormDetector:** 改进失焦后等待 DOM 稳定机制并同步失焦处理 ([206a8e0](https://github.com/liaolongdong/account-password-helper/commit/206a8e060d05705f95118b37e72cdd2ef9809324))

### Miscellaneous Chores

- **license:** 开源协议由 MIT 切换为 GPL-3.0-only ([bedbbf2](https://github.com/liaolongdong/account-password-helper/commit/bedbbf2ffc817882654ed3ccfb1dcae57df11862))

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
