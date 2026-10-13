/**
 * 表格「截断全文浮层」的共享 popper 配置
 *
 * 一句话：让 `show-overflow-tooltip` 弹出的那条浮层对指针透明，它就永远吃不掉别的控件的点击。
 *
 * 为什么需要它：Element Plus 的表格截断浮层是内部用 `createTablePopper()` 现建的
 * `el-tooltip`（`virtual-triggering` + `placement="top"` + `offset: 0` + `strategy: "fixed"`），
 * 默认参与指针命中测试。行高（实测 63～64 像素）小于两行浮层的高度，于是**下一行**那截断单元格的
 * 浮层正好压在**上一行**那排控件上方。真机实测（Chrome for Testing，1280×720 视口，两条条目，
 * 悬浮下一行的备注单元格，浮层 1280×52）：上一行的行首勾选框、显示密码、站点链接、查看详情、
 * 创建副本、编辑、收藏、删除**八处**的几何中心全部落进浮层，`elementFromPoint(中心)` 返回的
 * 就是浮层节点——这八处一次点击都收不到（在未绑定本配置的构建上逐条量得）。
 * 同一构建上悬浮 URL 单元格时浮层只有 520×32，比上一行控件中心低 1 像素，一处都没压住；
 * 用户名列在该长度下根本没截断、不出浮层。也就是说可达性随列宽与文本长度而变，
 * 备注列只是最稳定的一例，不能反推「别处安全」。
 * 用户侧表现为「指针明明停在删除键上，点了没反应」。
 *
 * 为什么只有这一条路：`appendTo: tableWrapper` 让浮层不在单元格子树里，scoped 样式管不到；
 * 它也没有可区分的类名（`.el-popper.is-dark.el-tooltip`，与下拉菜单同款），全局 CSS 无法只命中
 * 它而不牵连必须可点的下拉/选择器浮层。`el-table` 的 `tooltip-options` 会把键原样展开成内部
 * `el-tooltip` 的 props（`element-plus/es/components/table/src/util.js` 的 `createTablePopper`），
 * 因此 `popperStyle` 是唯一能落到这条浮层上的口子。
 *
 * 换来的代价（必须如实记录）：浮层文字今天可选中（实测 `user-select: auto`），改成对指针透明后
 * 无法再把光标移进气泡里选中复制全文。取舍理由是点击被吞的代价更高——被吞的可能是删除与收藏，
 * 而读全文的通道并没有关：详情抽屉与编辑弹窗里都是完整字段，行上还有「创建副本 / 复制」。
 * 与管理页操作列提示（`PasswordTable.vue` 的 `OPERATION_TIP_POPPER_STYLE`）是同一条性质、同一个取舍。
 */
/**
 * 截断浮层的文字规格：宽度上限 + 折行，标签气泡与表格气泡共用同一份
 *
 * 没有上限时，EP 的表格浮层按内容铺满可用宽度：实测一条 144 字的备注渲染成 1280×52，
 * 横穿整个视口、左右都读不完（用户反馈截图即此形）。500px 与 `PasswordTable.vue` 里
 * 标签气泡先前独立写死的那档同值——两处现在共享本常量，不再各写一份、各自漂移。
 * 只折行不截字：备注上限 1000 字，折到 500px 约 20 行，纵向由 EP 的 `placement` 自行翻面，
 * 不参与指针命中（见下），因此变高不会新增「吞点击」的面。
 * `boxSizing: 'border-box'` 不是装饰：EP 的 `.el-popper` 是 `padding: 5px 11px` 加 1px 边框
 * 的实心气泡，缺这一句时 `max-width` 只管内容盒，真机量到的整盒宽度是 524（500 + 2×11 + 2×1），
 * 常量说的「500」和用户看到的宽度差着一截。加上后常量与渲染值对齐，
 * `e2e/table-overflow-tooltip.spec.ts` 才敢直接拿常量当判据。
 */
export const OVERFLOW_TIP_TEXT_STYLE = Object.freeze({
  maxWidth: '500px',
  boxSizing: 'border-box',
  wordBreak: 'break-word',
});

/**
 * `el-table` 的 `tooltip-options` 绑定值：文字规格 + 对指针透明。
 *
 * 顶部那段长注释里 1280×52 的读数是**加宽度上限之前**的形状。并入 `OVERFLOW_TIP_TEXT_STYLE`
 * 之后浮层变窄变高，压住上一行的横向范围随之收窄；指针透明这一半没动，所以「点击不被吞」
 * 这条性质与当时的实测结论一样成立，而「今天压住几处控件」由 `e2e/table-overflow-tooltip.spec.ts`
 * 每次现量——不采信注释里的历史数字。
 *
 * 对象身份必须稳定：模板里现造对象会让每次渲染都把内部浮层判定为 props 变化，
 * 与管理页表格既有的实例身份守卫一致（`tests/architecture/optionsRenderIdentity.test.ts`）。
 * 与 `PasswordTable.vue` 里那两条同款常量一样用 `Object.freeze` 而不加 `as const`——
 * 后者会因 `Object.freeze(...)` 是调用表达式而被 `tsc` 判 TS1355。
 */
export const TABLE_OVERFLOW_TOOLTIP_OPTIONS = Object.freeze({
  popperStyle: Object.freeze({ ...OVERFLOW_TIP_TEXT_STYLE, pointerEvents: 'none' }),
});
