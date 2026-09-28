/**
 * 商店截图演示站的域名清单。
 *
 * seed 写入的条目网址与 capture 访问/预热的地址必须同源一份，否则改了 CSV
 * 忘了改预热清单，截图里就会出现「图标没命中」的通用地球图标。
 *
 * 这些域名靠 Chrome 启动参数 `--host-resolver-rules="MAP *.example.com
 * 127.0.0.1:8443"` 指到本地 demo-server.mjs：解析层换端口，浏览器地址栏与
 * favicon 缓存 key 仍是干净的 `https://<host>`。
 */

/** 侧边栏「一键登录」用的管理后台域名。 */
export const HOST_ADMIN = 'admin.example.com';

/** TOTP 演示用的云控制台域名。 */
export const HOST_CONSOLE = 'console.example.com';

/** 演示条目涉及的全部域名，逐个预热 favicon 缓存。 */
export const DEMO_HOSTS = [
  HOST_ADMIN,
  HOST_CONSOLE,
  'dev-admin.example.com',
  'staging-admin.example.com',
  'qa.example.com',
  'design.example.com',
  'wiki.example.com',
  'sandbox.example.com',
];

/** 演示页地址（不带端口：端口由 --host-resolver-rules 在解析层替换）。 */
export const pageUrl = (host, page) => `https://${host}/${page}`;
