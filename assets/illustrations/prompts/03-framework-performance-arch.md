---
type: framework
style: sketch-notes
palette: default
aspect: 16:9
---

A sketch-notes style architecture diagram showing the performance optimization system of a Chrome browser extension.

LAYOUT: Central architecture with 3 layers on warm cream paper background.

TOP LAYER: "Service Worker"

- Rounded box labeled "Background SW"
- Small clock icon with "保活闹钟 1min" annotation
- Arrow showing periodic wake-up cycle (circular arrow)

MIDDLE LAYER: "密码缓存"

- Cylinder icon labeled "PasswordCache (内存)"
- Two annotations: "SW 启动后 500ms 预热" and "20-50ms 命中"
- Green highlight showing "hot cache" status

BOTTOM LAYER: "侧边栏"

- Side panel UI sketch
- Arrow from cache to sidepanel labeled "GET_INITIAL_DATA"
- Speed indicator showing "~1ms 响应"

CONNECTIONS: Arrows showing data flow between layers. Dotted lines for alarm triggers.

SIDE ANNOTATION: Small note box: "会话过期 → 自动停止保活 → 节省电池"

STYLE: Hand-drawn black ink outlines, soft blue and green pastel fills, cream paper texture. Clean architectural diagram with clear hierarchy. Small decorative elements (lightning bolt for speed, battery icon for efficiency).

TITLE: "性能架构" at top in bold handwritten style.
