---
title: 让 Chrome 侧边栏 1 秒内打开：MV3 Service Worker 保活与预热实战
description: Manifest V3 的 Service Worker 随时会被回收，侧边栏冷启动白屏是扩展开发的头号痛点。本文完整复盘 Account Password Helper 的秒开方案：双层保活、四层资源预热、三路数据竞速与非阻塞 CSS。
tags: Chrome扩展,Manifest V3,Service Worker,性能优化,前端工程化
date: 2026-08-28
author: liaolongdong
image: imgs/blog-cover-02-sub-second-sidepanel.png
---

# 让 Chrome 侧边栏 1 秒内打开：MV3 Service Worker 保活与预热实战

做过 Manifest V3 扩展的人，大概率都被同一个问题咬过：**侧边栏（Side Panel）冷启动白屏**。

用户点击图标，侧边栏框架是出来了，内容区白一片，两秒后才慢慢渲染。在桌面软件里，这叫不可用。更糟的是，MV3 把后台换成了 Service Worker——一个随时可能被浏览器回收的短命进程，你精心维护的内存缓存、连接状态，说没就没。

[Account Password Helper](https://github.com/liaolongdong/account-password-helper) 是一款本地密码管理器扩展，侧边栏是它的最高频入口（解锁、搜索、填充都在这）。我们给它定了一个硬性 SLA：**所有场景（会话有效/失效、浏览器冷启动、快速重启）侧边栏必须 1 秒内打开、无白屏**。最终结果：缓存快路径下加载耗时约 20–50ms。

这篇文章把整套方案的实现和踩坑完整公开，源码路径都会给出，可以直接抄。

## 先搞清楚白屏从哪来

侧边栏打开的链路拆开看，每一段都可能贡献白屏时间：

1. **Service Worker 冷启动**：SW 已被回收，消息没人接，扩展页初始化请求悬空；
2. **资源冷读盘**：HTML、JS chunk、CSS 第一次从磁盘加载，Windows 上还要叠加杀毒软件逐文件扫描，轻松多出 1–2 秒；
3. **数据加载**：密码库要解密（PBKDF2 派生密钥 + AES-256-GCM 解密），串行做就是白屏；
4. **CSS 阻塞**：`<link rel="stylesheet">` 默认阻塞渲染，样式文件没到位，页面就是不画。

四个问题，四套对策。

## 对策一：双层保活，让 SW 常驻

MV3 的 SW 空闲约 30 秒就会被回收。社区常见方案是定时给自己发消息续命，但这里有个细节：**SW 内部的 `setInterval` 本身也会随 SW 一起死掉**，只靠它不够稳。

我们的做法是双层结构（`entrypoints/background/backgroundServices.ts`）：

- **第一层：20 秒心跳。** 运行时用 `setInterval` 每 20 秒读写一次 `chrome.storage.session`，重置空闲计时；
- **第二层：0.5 分钟复活闹钟。** `chrome.alarms` 创建一个 30 秒周期的 `sw-keepalive` 闹钟。就算心跳所在的 SW 被意外回收，闹钟事件会立刻把 SW 唤醒，心跳随之恢复。

两层互为兜底：心跳保证常态常驻，闹钟保证"死而复生"。这个策略是全平台无条件开启的——哪怕会话已锁定。因为保活买的不是"密码在内存里"，而是**下一次打开侧边栏时不用付冷启动成本**。

顺带两个必须知道的限制：

- `chrome.alarms` 对打包扩展的最小周期限制为 **1 分钟**，别指望秒级精度——秒级的连续性由 20 秒心跳层负责，闹钟层只兜"起死回生"；
- 保活闹钟里还挂了会话到期检查——到期立即锁定，不依赖页面存活。

## 对策二：四层资源预热，消灭冷读盘

SW 常驻之后，下一步是把"用户即将用到的文件"提前读进系统缓存。预热逻辑（`utils/warmSidePanelResources.ts`）分四层，由浅入深：

1. 侧边栏 HTML 本体；
2. `modulepreload` 预声明 + CSS；
3. 动态 import 的二级 chunk；
4. 二级 chunk 再引用的静态依赖。

预热不是无脑全量，有两个工程约束：

**平台差异化。** Windows 的主要瓶颈是 Defender 对扩展目录的逐文件扫描，文件读得越多、扫得越久，所以 Windows 走全量预热（约 25 个文件），把扫描成本提前摊掉；Mac 等 Unix 平台没有这个问题，只预热白名单里的约 15 个核心文件。**触发时机**：扩展安装/更新、浏览器启动、窗口聚焦、Tab 激活、保活闹钟 tick、侧边栏打开 5 秒后——都是"用户可能要打开侧边栏"的前置信号。

**节流与去重。** 持久化 5 分钟节流窗口 + in-flight 互斥锁，防止多个触发点同时触发时把磁盘打满。

另外还有一层 SW 预唤醒（`utils/preWarmSw.ts`，8 秒节流）：用户在 Popup 上的任何交互都顺手戳一下后台，保证点"打开侧边栏"时 SW 一定是在线的。

## 对策三：三路数据竞速，谁快用谁

密码数据有三条可走的路（`composables/useSidepanelData.ts`）：

1. **`storage.session` 加密快照直读**：会话有效期内，后台把解密后的快照以 AES-256-GCM 加密形态放在 `storage.session`，侧边栏直接读，不经过消息通道；
2. **后台 `GET_INITIAL_DATA` 内存缓存**：后台在 SW 启动 500ms 后就把密码缓存回温，走消息通道拿；
3. **本地 storage 直读兜底**：前两条都不可用时，侧边栏自己读 `storage.local` 解密，设 3000ms 超时。

三路并发出发，**任一路先返回就先渲染，任一路失败不影响其他路径**。所有异步提交都带会话代际和请求序号保护——万一用户中途锁定或换钥，过期结果不会写回 UI。

这个设计的核心思想是：**把"数据在哪"变成运行时决策，而不是架构假设**。SW 活着走快路径，SW 死了走兜底，用户无感。

## 对策四：非阻塞 CSS，先画出来再说

最后一段白屏来自样式阻塞。我们的处理（`wxt.config.ts` 里的自定义 Vite 插件）：给侧边栏的 `<link rel="stylesheet">` 先写 `media="print"`（浏览器不会为 print 媒体阻塞渲染），加载完成后再改回 `media="all"`。

效果：HTML 解析完立刻渲染骨架，样式异步到位。配合主题令牌的 CSS 变量，切换成本几乎为零。这是浏览器圈的经典技巧，用在扩展侧边栏上刚刚好。

## 还有一条铁律：手势链不能被 await 打断

`chrome.sidePanel.open()` 必须由用户手势触发，且**调用前禁止 `await`**——一旦中间插入任何异步等待，手势上下文就失效，侧边栏直接打不开。所以打开动作本身永远是同步发出的，tabId 也用同步接口获取。所有"打开前的准备工作"全部前置到保活和预热阶段完成，而不是在点击之后临时抱佛脚。

## 验证：秒开不是感觉，是测出来的

方案落地的同时，配套测试也进了 CI（vitest）：

- `swKeepalive`：心跳与闹钟的注册、续命、清理；
- `warmSidePanelResources`：节流窗口、平台分支、文件清单；
- `passwordCache` / `startupRelock` / `idleLock`：缓存回温与各类锁定路径；
- `sidePanelManager`：打开时序。

目前全仓库 364 项自动化测试。性能结论：**缓存快路径 20–50ms**；即使会话失效需要重新输主密码，界面也是先出来、再等解锁，没有白屏。

## 复盘：三条经验

1. **别和 MV3 的生命周期对抗，要顺着它设计。** SW 一定会被回收，那就假设它随时不在，把状态放进 `chrome.storage`，把唤醒交给闹钟，把成本提前到预热阶段。
2. **快是分层买来的。** 保活买"进程在"，预热买"文件热"，竞速买"数据快"，非阻塞 CSS 买"先渲染"。每层独立生效，叠加起来才是秒开。
3. **平台差异要正面处理。** Windows 杀毒扫描这种"非技术问题"真实存在，全量预热 + 引导用户加排除目录，比假装看不见有效得多。

完整源码在 [GitHub](https://github.com/liaolongdong/account-password-helper)，欢迎 Star、拍砖、提 Issue。如果你也在做侧边栏类扩展，希望这套方案能帮你少走几个月的弯路。

---

_本文涉及的关键文件：`entrypoints/background/backgroundServices.ts`（保活）、`utils/warmSidePanelResources.ts`（预热）、`composables/useSidepanelData.ts`（三路竞速）、`wxt.config.ts`（非阻塞 CSS）。_
