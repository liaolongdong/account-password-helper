/**
 * `el-upload` 数量上限必须有可感知反馈守卫
 *
 * Element Plus 的 `upload-content` 在命中 `limit` 时直接 `onExceed(files, fileList); return;`，
 * 而 `onExceed` 的默认值是 `NOOP`（`upload.mjs` 的 `onExceed: NOOP`）。于是只写 `:limit`
 * 不写 `@exceed` 的上传区有一条完全静默的路径：
 * - 一次选/拖多个文件 → 一个都不进，界面无任何变化；
 * - 已选文件后换选 → 新文件被丢弃，文件信息区仍显示上一次的文件，
 *   用户以为换成功了，实际导入的是旧文件。
 *
 * 本守卫机械扫描组件源码里的每个 `<el-upload>` 块，要求带 `:limit` 的必须同时绑定 `@exceed`，
 * 并钉住抽取非空（正则失配会让守卫空跑——仓库其他静态守卫正是这样失效过一次）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** 递归收集待扫描的 Vue 组件文件（组件目录 + 三个入口目录） */
const collectVueFiles = (dir: string): string[] => {
  const entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  return entries.flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectVueFiles(relative);
    return entry.name.endsWith('.vue') ? [relative] : [];
  });
};

const SOURCES = [...collectVueFiles('components'), ...collectVueFiles('entrypoints')];

/** 取出源码中所有 `<el-upload ... >` 开标签文本（不含自闭合以外的模板内容） */
const uploadTags = (src: string): string[] => [...src.matchAll(/<el-upload\b[\s\S]*?>/g)].map(m => m[0]);

describe('el-upload 数量上限反馈', () => {
  const withLimit: Array<{ file: string; tag: string }> = [];
  const allUploads: Array<{ file: string; tag: string }> = [];

  for (const file of SOURCES) {
    for (const tag of uploadTags(readFileSync(path.join(ROOT, file), 'utf8'))) {
      allUploads.push({ file, tag });
      if (/:limit=/.test(tag)) withLimit.push({ file, tag });
    }
  }

  it('扫描到上传组件与带 :limit 的用法（防止正则失配导致守卫空跑）', () => {
    expect(allUploads.length).toBeGreaterThanOrEqual(2);
    expect(withLimit.length).toBeGreaterThanOrEqual(2);
  });

  it('每个配置了 :limit 的 el-upload 都绑定了 @exceed', () => {
    const silent = withLimit.filter(({ tag }) => !/@exceed=/.test(tag)).map(({ file }) => file);
    expect(silent, `以下上传区命中数量上限会静默丢弃文件：${silent.join(', ')}`).toEqual([]);
  });
});
