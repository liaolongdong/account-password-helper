/**
 * 本地开发环境族聚合纯函数
 *
 * 解决的是「本地页连的是哪个后端」这一问：`http://localhost:3000` 这个地址本身不含答案
 * （dev/fat/uat/prod 用的是同一个前端地址），但**库里的条目网址含**——存了 `fat.example.com`
 * 就说明 fat 环境真实存在，且它的账号已经在库里。于是环境候选集直接从条目网址派生，
 * 用户既不必为本地环境再维护一套账号，也不必在设置里手写映射表：点一下芯片即切换。
 *
 * 与 `utils/siteUtils.ts` 的分工：那里回答「全库按站点摊开成哪些桶」（管理页筛选候选集），
 * 这里回答「其中哪些桶是同一套系统的不同环境」（本地页的绑定候选集）。两者共用
 * `normalizeToHostname` 的归一口径，但环境族必须按注册域聚组，否则 `dev.example.com`
 * 与 `dev.other.com` 会被并成同一个「dev」。
 *
 * 环回主机不进候选集：`localhost:3000` 是本地端点本身，把它当「环境」绑到自己身上没有意义，
 * 只会让芯片多出一个点了没反应的选项。
 */
import type { PasswordEntry } from './types';
import { getMainDomain, isLoopbackHost, normalizeToHostname } from './domain';

/**
 * 环境词表（小写比对）
 *
 * 只用于**识别**条目网址里已经存在的环境标签，不用于生成主机名：库里没有 `uat.` 开头的
 * 条目，芯片上就不会出现 uat。这样候选集始终等于「用户真实维护过的环境」，
 * 而不是内置的一串猜想要素的集合。
 */
const ENVIRONMENT_LABELS: readonly string[] = [
  'dev',
  'develop',
  'development',
  'test',
  'testing',
  'sit',
  'uat',
  'fat',
  'bench',
  'stage',
  'staging',
  'pre',
  'gray',
  'grey',
  'canary',
  'demo',
  'sandbox',
  'perf',
  'qa',
  'prod',
  'production',
  'online',
  'live',
];

/** 视为「线上」的环境词——芯片要用警示色并要一次确认的那些 */
const PRODUCTION_LABELS: ReadonlySet<string> = new Set(['prod', 'production', 'online', 'live']);

/** 一个环境族：同一注册域下的同一个环境 */
export interface EnvFamily {
  /** 环境标签（条目里出现的那个标签原文，小写），如 `fat` */
  env: string;
  /** 绑定主机：该环境下条目最集中的那个主机，如 `fat.example.com`；绑定时按它精确判站 */
  host: string;
  /** 注册域（展示为 `fat · example.com`），如 `example.com` */
  mainDomain: string;
  /** 绑定主机上的条目数（不含同环境其他子主机），芯片与徽章上的计数以此为准 */
  count: number;
  /** 该族同环境其他子主机上的条目数，仅用于 title 说明「绑这一个主机，其他子主机要放宽档位才带得出来」 */
  siblingCount: number;
  /** 是否线上环境（含把注册域本体当线上的情形），决定芯片配色与是否需要一次确认 */
  production: boolean;
}

/**
 * 取主机名里的环境标签
 *
 * 从左往右取**第一个**命中的环境词标签：`api.fat.example.com` 的 `api` 不是环境词，
 * 继续右移到 `fat` 即答案。只认完整标签，不做前缀匹配——否则 `pre-fix.example.com`
 * 会被当成 pre 环境，`testbed.example.com` 会被当成 test 环境。
 *
 * @param host - 归一后的 hostname
 * @returns 环境标签（小写）；没有命中任何环境词时为 null
 */
export function envLabelOfHost(host: string): string | null {
  const labels = host.split('.');
  // 注册域本体（如 example.com / com.cn 的最后两段）不算环境标签：
  // 单标签域（localhost）与两段域都要留出的段数由 getMainDomain 给出，不自己数点分尾缀。
  const mainDomain = getMainDomain(host);
  const scopeLabelCount = mainDomain.split('.').length;
  for (let index = 0; index < labels.length - scopeLabelCount; index += 1) {
    const label = labels[index];
    if (ENVIRONMENT_LABELS.includes(label)) return label;
  }
  return null;
}

/**
 * 该环境标签是否按「线上」对待
 *
 * @param env - 环境标签（`envLabelOfHost` 的返回值，或注册域本体情形下的哨兵 `apex`）
 * @returns 是否需要警示色与一次确认
 */
export function isProductionEnv(env: string): boolean {
  return PRODUCTION_LABELS.has(env);
}

/** 注册域本体当线上时使用的标签（库里没有 `prod.` 前缀，但 `example.com` 就是那一套） */
export const APEX_ENV_LABEL = 'apex';

/**
 * 这个环境主机在本地页被绑定时，是否需要用户先确认一次
 *
 * 判据反着写：只有**明确带非线上环境标签**的主机（`fat.` / `dev.` / `uat.` …）才免确认，
 * 其余一律要确认。理由是把「认不出来」当作最坏情况——`example.com`、`www.example.com`
 * 这类没有环境标签的主机就是线上本体，而一次确认的代价远小于把生产账号悄悄填进
 * 一个本地页面。误判成需要确认只会多弹一次框，反向误判则是真泄漏。
 *
 * @param host - 拟绑定的环境主机
 * @returns 是否需要一次确认
 */
export function requiresEnvConfirmation(host: string): boolean {
  const label = envLabelOfHost(host);
  return label === null || isProductionEnv(label);
}

/**
 * 芯片上的一个可点选项（由 `EnvFamily` 派生的展示形状）
 *
 * 与族对象分开是因为芯片要的是「一行一个按钮」的最小信息：绑定主机、读得懂的文案、
 * 条目数、要不要警示色。文案在这里拼（`fat · example.com` 是主机事实，不是需要翻译的句子），
 * 组件侧只负责渲染，避免 UI 里出现域名解析。
 */
export interface EnvChipOption {
  /** 绑定主机 */
  host: string;
  /** 芯片文案，如 `fat · example.com` */
  label: string;
  /** 该主机上的条目数 */
  count: number;
  /** 同环境其他子主机的条目数（>0 时写进 title，说明「还有 N 条要放宽档位才带得出来」） */
  siblingCount: number;
  /** 是否线上/无法识别的环境（红色强调 + 一次确认） */
  production: boolean;
}

/**
 * 把环境族转成芯片选项
 *
 * @param families - `collectEnvFamilies` 的结果
 * @returns 芯片选项，顺序与入参一致（条目数倒序）
 */
export const toEnvChipOptions = (families: readonly EnvFamily[]): EnvChipOption[] =>
  families.map(family => ({
    host: family.host,
    label: `${family.env} · ${family.mainDomain}`,
    count: family.count,
    siblingCount: family.siblingCount,
    production: requiresEnvConfirmation(family.host),
  }));

/**
 * 聚合全库条目，得到本地页可绑定的环境族候选集
 *
 * 收录两类主机：带环境标签的主机（`fat.example.com`），以及**已经有环境族的注册域**的
 * 本体主机（`example.com` 记作线上）。后一条限制很关键：不加限制的话库里每个站点
 * （`github.com`、`qq.com`）都会变成一个「prod 环境」候选，芯片会被陌生站点淹没。
 *
 * 排序为「条目数倒序 → 环境标签正序 → 主机正序」，同数量环境顺序稳定（不用
 * `localeCompare`，避免不同平台 locale 规则给出不同顺序）。
 *
 * @param entries - 密码条目（只读 `url` 字段）
 * @returns 环境族列表；库里没有可识别的环境时返回空数组（芯片不出现）
 */
export function collectEnvFamilies(entries: readonly Pick<PasswordEntry, 'url'>[]): EnvFamily[] {
  /** 归一主机 → 条目数 */
  const hostCounts = new Map<string, number>();
  for (const entry of entries) {
    const host = normalizeToHostname(entry.url ?? '');
    if (!host || isLoopbackHost(host)) continue;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }

  /** `env|mainDomain` → 该组的成员主机计数 */
  interface Group {
    env: string;
    mainDomain: string;
    counts: Map<string, number>;
    total: number;
  }
  const groups = new Map<string, Group>();
  /** 已出现环境标签的注册域：决定「哪些本体主机算线上」 */
  const scopedDomains = new Set<string>();

  const add = (host: string, env: string, mainDomain: string, count: number) => {
    const key = `${env}|${mainDomain}`;
    const current = groups.get(key);
    if (current) {
      current.counts.set(host, count);
      current.total += count;
      return;
    }
    groups.set(key, { env, mainDomain, counts: new Map([[host, count]]), total: count });
  };

  for (const [host, count] of hostCounts) {
    const env = envLabelOfHost(host);
    if (!env) continue;
    const mainDomain = getMainDomain(host);
    scopedDomains.add(mainDomain);
    add(host, env, mainDomain, count);
  }

  for (const [host, count] of hostCounts) {
    if (envLabelOfHost(host)) continue;
    if (getMainDomain(host) !== host) continue;
    if (!scopedDomains.has(host)) continue;
    add(host, APEX_ENV_LABEL, host, count);
  }

  return Array.from(groups.values())
    .map<EnvFamily>(group => {
      // 代表主机 = 该环境里条目最多的主机（同数取主机正序），绑定按它精确判站；
      // 其余同环境子主机只计数，不悄悄并入——并入的话「绑一个 fat 却带出 api.fat」
      // 就成了档位之外的隐式放宽，条目数也会和列表对不上。
      const members = Array.from(group.counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const [host, count] = members[0];
      return {
        env: group.env === APEX_ENV_LABEL ? 'prod' : group.env,
        host,
        mainDomain: group.mainDomain,
        count,
        siblingCount: group.total - count,
        production: group.env === APEX_ENV_LABEL || isProductionEnv(group.env),
      };
    })
    .sort((a, b) => b.count - a.count || (a.env < b.env ? -1 : a.env > b.env ? 1 : 0) || (a.host < b.host ? -1 : 0));
}
