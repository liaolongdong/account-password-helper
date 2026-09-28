<!-- 请先读一句：涉及密码、密钥、加密或数据丢失的安全问题，请走 .github/SECURITY.md 的私密渠道，不要开公开 PR / Issue。 -->

<!-- 标题请按约定式提交写：<type>(<scope>): <subject>。它不是文案，而是版本决策的输入——
     feat 推 minor、fix 推 patch、type 后带 ! 或描述里写 BREAKING CHANGE 会把版本号推到 major。
     `Conventional PR title` 检查会校验它。合入本 PR 也≠发布：改动会进 release-please 的下一班车，
     由维护者合并那条 release PR 并批准 `production` 环境后才提交商店审核。
     详见 docs/CONTRIBUTING.md「分支模型与发版流程」与 docs/PR_WORKFLOW_GUIDE.md。 -->

## 这个 PR 改了什么 / What does it do

<!-- 一句话说明动机和结果。行为变化请写清楚「之前 → 之后」。 -->

## 关联 issue / Related issues

Closes #

## 类型 / Type

- [ ] 功能 / Feature
- [ ] 缺陷修复 / Bug fix
- [ ] 文档 / Docs
- [ ] 重构（行为不变）/ Refactor (behavior-preserving)
- [ ] 构建、CI 或依赖 / Build, CI or dependencies

## 影响面 / Blast radius

- [ ] 不改变任何用户可见行为（纯内部改动，可证明行为等价）
- [ ] 改变功能、交互、默认值、存储结构、加密/备份格式、权限或隐私边界
      —— 若是，请先在 issue 里确认过方案（见 `AGENTS.md`「必须暂停并询问确认的情况」）
- [ ] 影响商店元数据或提审包（manifest 文案、权限、截图）

## 本地验证 / Verification

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm lint:style`（涉及 CSS/Vue 样式时）
- [ ] `pnpm test:run`
- [ ] `pnpm build`（涉及入口、manifest、WXT/Vite 配置、依赖或打包行为时；含 Firefox 时加 `pnpm build:firefox`）
- [ ] 改动过的文档已用 `pnpm exec prettier --check <files...>` 校验（只跑本次改动的文件）

<!-- 未跑或跑不通的项，请直接写明原因，不要勾掉。 -->

## 用户可见文案与文档同步 / Copy & docs sync

新增或修改用户可见功能时，需要同时落地的表面（缺项是本项目最常见的返工原因）：

- [ ] `utils/i18n/locales/zh-CN/**` 与 `en/**` 对应 namespace（Vue UI 文案）
- [ ] `utils/i18n-lite.ts` 的中英文条目（Content / Background 文案，与上面是两套独立词表）
- [ ] `public/_locales/zh_CN/messages.json` 与 `en/messages.json`（manifest 文案；摘要受 132 字符硬限制）
- [ ] `README.md` 与 `README.en.md`
- [ ] `index.html`（改中文源后跑 `pnpm gen:en` 重生 `en.html`；改 `FAQS` 再按顺序跑 `pnpm gen:faq` 与 `pnpm gen:faq-dom`）
- [ ] `components/sidepanel/HelpDialog.vue` 对应的 `help.json`（新增条目须同步提升 `helpItems('help.gx', N)` 的 N）
- [ ] `docs/ARCHITECTURE.md` 与 `.en.md`「功能实现详解」
- [ ] 涉及商店文案、权限或隐私时：`docs/CWS_FILL_CONTENT.md`、`docs/CWS_PUBLISHING_GUIDE.md`、`privacy.html`

## 安全自查 / Security checklist

- [ ] 没有把主密码、账号、密码、TOTP 密钥、解密后的条目或可推导它们的完整对象写进代码、测试、日志、截图或文档
- [ ] 日志走 `utils/logger.ts`，没有新增直接 `console.*` 调用
- [ ] 没有新增网络请求、遥测或远程资源；若新增了权限，已说明必要性并更新相应发布/隐私文档
- [ ] 不可信输入（DOM、导入文件、runtime message、storage）在边界处做了类型、长度、格式与来源校验
- [ ] 没有用 `v-html` / `innerHTML` / `eval` / `new Function` 渲染不可信内容

## 商店文案红线（改到 `CWS_FILL_CONTENT.md` 时必填）

- [ ] 名称 / 摘要 / 说明 / 权限说明里**没有任何竞品或浏览器品牌名**（2026-09-09 的 3.8.0 草稿正是被 `Chrome, LastPass, Bitwarden, and 1Password` 判为 keyword stuffing）
- [ ] 一个卖点只归一个小节，跨小节不留重复句；没有「零联网 / 100% offline / 军事级」这类无法自证的绝对化表述
- [ ] 已跑 `docs/CWS_PUBLISHING_GUIDE.md`「粘贴前自检脚本」，输出为 `banned hits: none` 且重复行为 `none`
