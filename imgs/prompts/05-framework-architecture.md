---
illustration_id: 05
type: framework
style: sketch-notes
palette: macaron
---

Hand-drawn technical architecture diagram on warm cream paper. Black hand-drawn
lines with slight wobble, soft pastel color blocks. Diagram-style visuals ONLY
— no realistic or photographic images.

PALETTE: macaron — soft pastel blocks on warm cream
COLORS: Warm Cream background (#F5F0E8); Black (#1A1A1A) for ALL lines, text,
arrows, and doodles; component fills in Peach (#FFD5C2), Light Blue
(#A8D8EA), Mint Green (#B5E5CF), Lavender (#D5C6E0); Coral Red (#E8655A)
for the encryption pipeline emphasis.

TITLE (hand-lettered, top): "技术架构：给同行开发者一个交代"

LAYOUT: Three horizontal bands stacked vertically.

BAND 1 — TOP: "5 大入口点" (hand-lettered subtitle)

Five rounded cards arranged in a horizontal row:

- Card 1 (Peach #FFD5C2): Gear icon + "Background" label. Small annotation:
  "消息路由 · 密码缓存 · 会话管理 · 快捷键"
- Card 2 (Blue #A8D8EA): Script icon + "Content Script" label. Small annotation:
  "表单检测 · 填充引擎 · 悬浮按钮 · Shadow DOM"
- Card 3 (Mint #B5E5CF): Popup icon + "Popup" label. Small annotation:
  "快捷入口 · 版本更新提示"
- Card 4 (Lavender #D5C6E0): Grid icon + "Options" label. Small annotation:
  "密码管理主页 · CRUD · 导入导出 · 会话管理"
- Card 5 (Peach #FFD5C2): Sidebar icon + "SidePanel" label. Small annotation:
  "快速填充 · Port长连接 · 域名匹配 · 搜索排序"

BAND 2 — MIDDLE: "加密管道" (hand-lettered subtitle, Coral Red #E8655A border)

A horizontal pipeline flow drawn as connected boxes with arrows:

"主密码 + 盐值" → [PBKDF2 600K次] → "256-bit 密钥" → [AES-256-GCM] → "Base64(IV+密文)"

Below the pipeline, a small annotation: "Web Crypto API · 不依赖第三方加密库"

A second smaller flow below:
"内存主密码" → [HKDF + SHA-256] → "会话密钥" → [AES-256-GCM 二次加密] → "chrome.storage.local"

BAND 3 — BOTTOM: "通信架构" (hand-lettered subtitle)

A simple component relationship diagram:

- Center: "Background" hub (gear icon, larger card)
- Left: "SidePanel" connected via thick arrow labeled "Port 长连接"
- Right: "Content Script" connected via dashed arrow labeled "sendMessage"
- Far right: "Popup / Options" connected via dashed arrow labeled "sendMessage"
- Small annotation near Background: "WeakMap/WeakSet 缓存 · 避免内存泄漏"

Hand-drawn wavy arrows and connector lines between bands showing data flow.

BOTTOM: Hand-lettered takeaway: "WXT + Vue 3 + TypeScript + Element Plus · Manifest V3"

STYLE: Minimal, well-organized, airy. Color fills don't completely fill
outlines (slight "hand-painted" overshoot). ALL text hand-lettered in
Chinese — no computer fonts. Generous white space between sections.
Technical terms (PBKDF2, AES-256-GCM, WXT, Vue 3, TypeScript, etc.)
can use clean hand-lettered English text.

NO WATERMARKS, NO LOGOS, NO SIGNATURES anywhere in the image.

Color values (#hex) and color names are rendering guidance only — do NOT display
color names, hex codes, or palette labels as visible text in the image.
Clean composition with generous white space. Simple or no background.
Text should be large and prominent with handwritten-style fonts. Keep minimal,
focus on keywords.

ASPECT: 16:9
