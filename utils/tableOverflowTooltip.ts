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
 *
 * 对象身份必须稳定：模板里现造对象会让每次渲染都把内部浮层判定为 props 变化，
 * 与管理页表格既有的实例身份守卫一致（`tests/architecture/optionsRenderIdentity.test.ts`）。
 * 与 `PasswordTable.vue` 里那两条同款常量一样用 `Object.freeze` 而不加 `as const`——
 * 后者会因 `Object.freeze(...)` 是调用表达式而被 `tsc` 判 TS1355。
 */
export const TABLE_OVERFLOW_TOOLTIP_OPTIONS = Object.freeze({
  popperStyle: Object.freeze({ pointerEvents: 'none' }),
});
