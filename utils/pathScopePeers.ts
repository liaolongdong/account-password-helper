/**
 * 「同一账号在其它路径下已有条目」的提示数据源
 *
 * pathScope 是账号身份的一部分：同一 host、同一用户名可以按路由存成多条。
 * 表单只需要回答一个问题——当前正在填的这条，是否与库里已有条目的路由不同，
 * 以便提示用户补填「限定路径」。纯函数、零依赖副作用，供 Options 表单与单测共用。
 */
import { normalizePathScope, normalizeToHostAndPort } from './domain';

/** 参与冲突判定的最小条目投影（App 侧从解密条目生成，绝不含密码） */
export interface PathScopePeer {
  /** 用户名 */
  username: string;
  /** 网址（完整 URL / host:port / 纯域名均可，内部按 hostname 归一） */
  url: string;
  /** 路径作用域（空串视为不限路径，不参与冲突） */
  pathScope: string;
}

/** 当前表单输入 */
export interface PathScopePeerQuery {
  /** 用户名 */
  username: string;
  /** 表单里填写的网址 */
  url: string;
  /** 表单里已填的路径作用域（空串 = 尚未限定路径） */
  pathScope: string;
}

/**
 * 找出与当前输入「同 host、同用户名、但路径作用域不同」的其它条目
 *
 * 用途是只读提示而非匹配判据：典型场景是用户给第二条账号填同样的用户名和网址，
 * 却忘了填限定路径——此时提示他库里已有一条绑定在别的路由上。
 * host 走 `normalizeToHostAndPort` 归一（origin 含端口：端口隔离下 `:8443` 与 `:9443`
 * 是两个站点，不能仅凭主机名相同就提示；条目常存完整 URL，表单输入可能只写域名）；
 * scope 走 `normalizePathScope` 归一（`desktop`、`/desktop/`、`/#/` 等写法视为同一作用域）。
 * 空 scope 的条目从不作为提示来源——它们是"全路径通用"的存量形态，不构成路由冲突；
 * 通配条目（`*.qq.com`）与具体主机归一后不相等，同样不会触发提示（跨主机族的提示没有意义）。
 *
 * @param peers 全库条目的脱敏投影（用户名 / 网址 / 路径作用域）
 * @param query 当前表单的账号、网址与路径输入
 * @returns 命中冲突的条目投影；无冲突为空数组，顺序与入参一致
 */
export function findOtherPathScopePeers(peers: readonly PathScopePeer[], query: PathScopePeerQuery): PathScopePeer[] {
  const host = normalizeToHostAndPort(query.url);
  const username = query.username.trim();
  if (!host || !username) return [];

  const currentScope = normalizePathScope(query.pathScope);
  return peers.filter(peer => {
    if (peer.username.trim() !== username) return false;
    if (normalizeToHostAndPort(peer.url) !== host) return false;
    const scope = normalizePathScope(peer.pathScope);
    return scope !== '' && scope !== currentScope;
  });
}
