/**
 * CSV 公式注入的中和与还原
 *
 * 电子表格（Excel / WPS / Google Sheets / Numbers）打开 CSV 时，会把以 `=`、`+`、`-`、`@`
 * 或 TAB / CR 开头的单元格当作**公式求值**，而不是按文本显示。本扩展的 CSV 有三个入口
 * 会把这种形状带进来：自动保存从登录表单抓来的用户名、第三方管理器导入的 CSV、
 * 用户自己填写的标签与备注。于是「导出 CSV → 用 Excel 打开 → 启用外部内容」
 * 成了一条把库内数据送出本机并执行第三方公式的路径，与「本地优先、零外传」的承诺冲突。
 *
 * 处理方式是电子表格的「强制文本」约定：危险前缀前补一个单引号。
 * 补在前缀**之前**（而不是替换引号转义），因为求值判定看的是单元格的首字符。
 *
 * 往返完整性：自家模板导出的 CSV 也能被自家导入器读回（灾难恢复流程），
 * 因此导入侧按同一条规则还原一个前导单引号——**仅限自家格式**，
 * 第三方文件不是本扩展写出的，不存在这层约定，多剥一个字符就是改用户数据。
 *
 * 已知且刻意接受的唯一碰撞：条目值本身以「单引号 + 危险字符」开头（如 `'=abc`）时，
 * 导出→导入会丢掉那个前导引号。选它而不是「所有以引号开头的值一律加标记」的双写方案，
 * 因为后者会在表格里给每个 `'Mary` 之类的首引号值显示成 `''Mary`。
 * 两种写法都比「不设防」差在可见性、好在没有执行路径，这里取更小的一面，
 * 并由测试钉住该形状，确保它是记录在案的取舍而非意外。
 */

/** 电子表格会当作公式求值的首字符（TAB / CR 是「前导空白后紧跟公式」的常见绕过形态） */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** 「强制文本」标记：电子表格约定用于把单元格按字面文本处理 */
const TEXT_MARKER = "'";

/**
 * 判定一个单元格值是否会被电子表格当作公式求值
 *
 * @param value - 单元格原始值
 */
function isFormulaDangerous(value: string): boolean {
  return value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]);
}

/**
 * 导出侧：给可能被求值的单元格补上「强制文本」前缀
 *
 * 对安全值零改动（不加引号、不去空白），因此普通条目的导出结果与修复前逐字节一致。
 *
 * @param value - 单元格原始值
 * @returns 需要中和时返回 `'` + 原值，否则原样返回
 */
export function neutralizeFormulaCell(value: string): string {
  return isFormulaDangerous(value) ? `${TEXT_MARKER}${value}` : value;
}

/**
 * 导入侧：还原 {@link neutralizeFormulaCell} 补上的前缀
 *
 * 只在「前导单引号之后紧跟一个危险字符」时剥离，即只剥离导出侧确实会加的那种标记；
 * 普通以引号开头的值（`'abc`）原样保留。
 *
 * @param value - 解析出的单元格值
 * @returns 命中标记形态时去掉前导单引号，否则原样返回
 */
export function restoreNeutralizedCell(value: string): string {
  if (value.startsWith(TEXT_MARKER) && isFormulaDangerous(value.slice(TEXT_MARKER.length))) {
    return value.slice(TEXT_MARKER.length);
  }
  return value;
}
