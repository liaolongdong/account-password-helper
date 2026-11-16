/** 导入格式类型 */
export type ImportFormat =
  'auto' | 'native' | 'chrome' | 'lastpass' | 'bitwarden' | '1password' | 'firefox' | 'keepassxc';

/** CSV 列映射配置 */
export interface CsvColumnMapping {
  username: string[];
  password: string[];
  url: string[];
  tag: string[];
  remark: string[];
  totp: string[];
}

/** 各格式列映射配置 */
export const FORMAT_COLUMN_MAP: Record<Exclude<ImportFormat, 'auto'>, CsvColumnMapping> = {
  native: {
    username: ['用户名(必填)', '用户名', '账号', 'Username (Required)', 'username', 'Username'],
    password: ['密码', 'password', 'Password'],
    url: ['网址', 'URL', 'url', '网站地址', '链接'],
    tag: ['标签', 'tag', 'Tag', '分类'],
    remark: ['备注', 'remark', 'Remark', '说明'],
    totp: ['两步验证', 'TOTP', 'totp', '密钥'],
  },
  // Edge 的密码导出与 Chrome 同形（name,url,username,password），共用这一套映射
  chrome: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL', 'origin'],
    tag: ['name', 'Name'],
    remark: ['note', 'Note'],
    totp: ['otpauth', 'otp_auth'],
  },
  lastpass: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL'],
    tag: ['grouping', 'Grouping'],
    remark: ['extra', 'Extra'],
    totp: ['totp', 'TOTP'],
  },
  bitwarden: {
    username: ['login_username', 'Login Username'],
    password: ['login_password', 'Login Password'],
    url: ['login_uri', 'Login URI'],
    tag: ['folder', 'Folder'],
    remark: ['notes', 'Notes'],
    totp: ['login_totp', 'Login TOTP'],
  },
  '1password': {
    username: ['Username', 'username'],
    password: ['Password', 'password'],
    url: ['Url', 'URL', 'url'],
    tag: ['Title', 'title'],
    remark: ['Notes', 'notes'],
    totp: ['OTPAuth', 'otpauth', 'totp'],
  },
  // Firefox（about:logins 导出）没有分组 / 备注 / TOTP 列，对应字段留空而非猜测映射
  firefox: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL'],
    tag: [],
    remark: [],
    totp: [],
  },
  // KeePassXC：Group 是文件夹路径（与 Bitwarden folder 同语义），为空时回退用条目标题当标签
  keepassxc: {
    username: ['Username', 'username'],
    password: ['Password', 'password'],
    url: ['URL', 'url'],
    tag: ['Group', 'group', 'Title', 'title'],
    remark: ['Notes', 'notes'],
    totp: ['TOTP', 'totp'],
  },
};
