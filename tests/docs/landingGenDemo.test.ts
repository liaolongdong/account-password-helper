/**
 * f8 生成器演示的守卫：页面上那台可点的生成器，必须与扩展里那台说的是同一件事。
 *
 * 这个演示的全部可信度都压在「复刻」二字上：四个字符集字面量、16 位默认长度、
 * 「每类先各出一枚 → 剩余位从合并池补齐 → Fisher-Yates 打乱」的组装顺序、
 * 四条强度谓词与等级映射、三个等级色，以及「词库是 3080 词里的 96 词节选」这句话。
 * 任何一项与 utils/ 下的真源漂开，页面就不再是演示，而是拿装饰冒充产品行为——
 * 而且这类漂移静默无声：控制台干净，样式照常，只是分数与口令悄悄变成了另一套规则算的。
 *
 * 所以这里逐条与真源对账。谓词、色值、默认档位数、词库成员、文案里的两个数字全部
 * 从被读的文件现取，测试里没有第二份副本；每条对账各配一个注入式自检（见最后一个 describe）。
 *
 * @module tests/docs/landingGenDemo
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { hasReducedMotionRule, reducedMotionRules } from '../helpers/landingCss';
import { i18nEntry } from '../helpers/landingI18n';

const ROOT = process.cwd();

/** 演示里的常量名 → utils/passwordGenerator.ts 里的常量名 */
const CHARSET_PAIRS: Array<[demo: string, source: string]> = [
  ['GEN_UPPER', 'UPPERCASE_CHARS'],
  ['GEN_LOWER', 'LOWERCASE_CHARS'],
  ['GEN_NUMBER', 'NUMBER_CHARS'],
  ['GEN_SYMBOL', 'SYMBOL_CHARS'],
];

/** 等级色只查这三档：`none` 档对应空密码，演示里不存在输入为空的时刻 */
const LEVELS = ['weak', 'medium', 'strong'] as const;

/** 组装的五个语句阶段，数组顺序就是演示与生成器共同要求的出现次序 */
const ASSEMBLY_STAGES = ['merged', 'each', 'fill', 'shuffle', 'join'] as const;
type AssemblyStage = (typeof ASSEMBLY_STAGES)[number];

/** 被 html.gen-live 打开的控件排：一条「默认不可见」加一条「打开」，两条都必须在场 */
const GATED_BLOCKS: Array<[base: RegExp, open: RegExp, label: string]> = [
  [/\.gen-again \{[^}]*display: none;/, /html\.gen-live \.gen-again \{[^}]*display: inline-block;/, '「换一枚」按钮'],
  [
    /\.gen-modes,\s*\.gen-sets \{[^}]*display: none;/,
    /html\.gen-live \.gen-modes,\s*html\.gen-live \.gen-sets \{[^}]*display: flex;/,
    '模式与字符集两排 chip',
  ],
];

/** 演示用到的全部字典 key：3 个等级词 + 2 个模式 + 按钮 + 说明 + 6 个无障碍标签 */
const DEMO_KEYS = [
  'features.f8.demo.again',
  'features.f8.demo.mode.random',
  'features.f8.demo.mode.passphrase',
  'features.f8.demo.level.strong',
  'features.f8.demo.level.medium',
  'features.f8.demo.level.weak',
  'features.f8.demo.aria.modes',
  'features.f8.demo.aria.sets',
  'features.f8.demo.aria.upper',
  'features.f8.demo.aria.lower',
  'features.f8.demo.aria.number',
  'features.f8.demo.aria.symbol',
  'features.f8.demo.note',
];

/** markup 里以静态中文兜底的那几个 key，默认文本必须逐字等于字典 zh 值 */
const MARKED_KEYS = [
  'features.f8.demo.again',
  'features.f8.demo.mode.random',
  'features.f8.demo.mode.passphrase',
  'features.f8.demo.level.strong',
  'features.f8.demo.note',
];

/**
 * 取 f8 演示的脚本段。
 *
 * 边界用两处分节注释，不用花括号配平：本节的收尾 `}` 与内部若干 `}` 同级，
 * 按配平切会在第一个内层块就截断。分节注释是本文件既有的结构标记，挪动它的人
 * 本来就要改这一带。
 *
 * @param source 页面源码
 * @returns 从本节注释到下一节「卡片追光」之间的脚本
 */
function demoBlock(source: string): string {
  const start = source.indexOf('// =================== f8 生成器演示');
  expect(start, 'index.html 缺少 f8 生成器演示脚本段').toBeGreaterThan(-1);
  const end = source.indexOf('// =================== 卡片追光', start);
  expect(end, 'f8 演示脚本段后面找不到「卡片追光」，切片边界已失效').toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * 读 `const NAME = '…';` 形式的字符串常量（真源与演示用的是同一种写法）。
 *
 * @param source 待扫描源码
 * @param name 常量名
 * @returns 常量值；不存在时 undefined
 */
function stringConst(source: string, name: string): string | undefined {
  return new RegExp(`const ${name} = '([^']*)';`).exec(source)?.[1];
}

/**
 * 读 `const NAME = 12;` 形式的数字常量。
 *
 * @param source 待扫描源码
 * @param name 常量名
 * @returns 数值；不存在时 undefined
 */
function numberConst(source: string, name: string): number | undefined {
  const raw = new RegExp(`const ${name} = (\\d+);`).exec(source)?.[1];
  return raw === undefined ? undefined : Number(raw);
}

/**
 * 把演示里那段「多个字符串块拼接后按空格切开」的词库还原成数组。
 *
 * 词库没写成 96 行的数组字面量：prettier 会把超长数组一行一个地拆开，页面因此白胖 96 行。
 * 于是取回时也按这个形状拆——块与块之间靠尾随空格衔接，一旦手抖多出双空格，
 * split 就会产出空词条，由 findVocabularyViolations 判红。
 *
 * @param source 页面源码
 * @returns 节选词库数组
 */
function demoWords(source: string): string[] {
  const demo = demoBlock(source);
  const block = /const GEN_WORDS = \(\n([\s\S]*?)\n\s*\)\.split\(' '\)/.exec(demo)?.[1];
  expect(block, '演示词库不再是「字符串块拼接 + split」的形状，取词方式已失效').not.toBeUndefined();
  const joined = [...block!.matchAll(/'([^']*)'/g)].map(match => match[1]).join('');
  return joined.trim().split(' ');
}

/**
 * 从核心模块取四条强度谓词的源码文本（真源，不在测试里抄第二份）。
 *
 * @param coreSrc utils/passwordStrengthCore.ts 源码
 * @returns 按核心模块书写顺序排列的谓词表达式
 */
function corePredicates(coreSrc: string): string[] {
  return [...coreSrc.matchAll(/^\s+\w+: pwd => (.+),$/gm)].map(match => match[1]);
}

/**
 * 取带 data-i18n 的节点里那段静态兜底文本。
 *
 * 只取到下一个 `<` 为止：这五个 key 的内容都是纯文本，没有嵌套标签，
 * 而 prettier 会把长文本另起一行缩进，所以取回后压平空白再比对。
 *
 * @param source 页面源码
 * @param key data-i18n 的 key
 * @returns 压平空白后的文本；markup 里没有该 key 时 undefined
 */
function markedText(source: string, key: string): string | undefined {
  const pattern = new RegExp(`data-i18n="${key.replace(/\./g, '\\.')}[^>]*>([^<]*)`);
  const raw = pattern.exec(source)?.[1];
  return raw === undefined ? undefined : raw.replace(/\s+/g, ' ').trim();
}

/**
 * 字符集与默认长度是否与 utils/passwordGenerator.ts 一致。
 *
 * @param source 页面源码
 * @param generatorSrc 生成器模块源码
 * @returns 违规描述，一致时为空数组
 */
function findCharsetViolations(source: string, generatorSrc: string): string[] {
  const demo = demoBlock(source);
  const problems: string[] = [];
  CHARSET_PAIRS.forEach(([demoName, sourceName]) => {
    const inDemo = stringConst(demo, demoName);
    const inSource = stringConst(generatorSrc, sourceName);
    if (inDemo === undefined) problems.push(`演示里没有 const ${demoName}`);
    else if (inSource === undefined) problems.push(`生成器里没有 const ${sourceName}，对账对象丢失`);
    else if (inDemo !== inSource) problems.push(`${demoName} 与 ${sourceName} 的字符集字面量已漂开`);
  });
  const defaultLength = /length:\s*(\d+),/.exec(generatorSrc)?.[1];
  if (String(numberConst(demo, 'GEN_LENGTH')) !== defaultLength) {
    problems.push(`GEN_LENGTH 不是生成器默认档的 ${defaultLength} 位`);
  }
  return problems;
}

/**
 * 组装五阶段在各文件里的定位式。
 *
 * `each` 与 `fill` 都把外层循环一起写进定位式：两侧的「各出一枚」和「补齐」用的是同一种
 * `push(池[随机(池.length)])` 形状，只写这一句会先命中各出一枚那一处，补齐池就对错了对象。
 * `merged` 与 `fill` 各带一个捕获组，取的是「补齐位实际索引的那个池变量名」——
 * 两个名字必须相同，否则补齐位就不是从合并池取的，某些启用的字符集可能一枚都不出。
 * `randArg` 单独钉洗牌的取值上界：`rand(i + 1)` 才是「前 i+1 位里等概率抽一位」，
 * 写成 `rand(i)` 或 `rand(len)` 时长度与规则照旧说得过去，分布却已经偏了。
 */
const ASSEMBLY_SIDES: Array<{
  label: string;
  stages: Record<AssemblyStage, RegExp>;
  randArg: RegExp;
  pick: (source: string, generatorSrc: string) => string;
}> = [
  {
    label: '演示',
    stages: {
      merged: /const (\w+) = pools\.join\(''\);/,
      each: /const chars = pools\.map\(pool => pool\[genInt\(pool\.length\)\]\);/,
      fill: /while \(chars\.length < GEN_LENGTH\) chars\.push\((\w+)\[genInt\(\1\.length\)\]\);/,
      shuffle: /for \(let i = chars\.length - 1; i > 0; i -= 1\) \{/,
      join: /return chars\.join\(''\);/,
    },
    randArg: /const j = genInt\(i \+ 1\);/,
    pick: source => demoBlock(source),
  },
  {
    label: '生成器',
    stages: {
      merged: /const (\w+) = enabledCharsets\.join\(''\);/,
      each: /for \(const charset of enabledCharsets\) \{\n\s+result\.push\(charset\[secureRandomInt\(charset\.length\)\]\);/,
      fill: /for \(let i = 0; i < remaining; i\+\+\) \{\n\s+result\.push\((\w+)\[secureRandomInt\(\1\.length\)\]\);/,
      shuffle: /for \(let i = result\.length - 1; i > 0; i--\) \{/,
      join: /return result\.join\(''\);/,
    },
    randArg: /const j = secureRandomInt\(i \+ 1\);/,
    pick: (_source, generatorSrc) => generatorSrc,
  },
];

/**
 * 组装顺序是否与 utils/passwordGenerator.ts 同形。
 *
 * 光对字符集和谓词还不够：顺序本身承载一条分布承诺——「每个启用的字符集先各出一枚，
 * 剩余位从合并池补齐，最后整体洗牌」，所以每类至少一枚且落点随机。把洗牌挪到补齐之前、
 * 或让补齐位只从某一类字符集取，产出的口令仍在长度与规则上说得过去，分布却已换了算法。
 * 这里按语句在各自文件里出现的先后取五个下标，要求两侧同为「合并池 → 每类一枚 → 补齐 →
 * 洗牌 → 拼接」这一单调序，并确认补齐索引的就是合并池那个变量。
 *
 * @param source 页面源码
 * @param generatorSrc 生成器模块源码
 * @returns 违规描述，一致时为空数组
 */
function findAssemblyViolations(source: string, generatorSrc: string): string[] {
  const problems: string[] = [];
  ASSEMBLY_SIDES.forEach(side => {
    const code = side.pick(source, generatorSrc);
    const at = ASSEMBLY_STAGES.map(stage => code.search(side.stages[stage]));
    ASSEMBLY_STAGES.forEach((stage, i) => {
      if (at[i] < 0) problems.push(`${side.label}里认不出「${stage}」这一组装阶段，对账对象丢失`);
    });
    if (at.every(index => index >= 0) && at.some((index, i) => i > 0 && index <= at[i - 1])) {
      problems.push(`${side.label}的组装顺序不再是「合并池 → 每类一枚 → 补齐 → 洗牌 → 拼接」`);
    }
    const pool = side.stages.merged.exec(code)?.[1];
    const filled = side.stages.fill.exec(code)?.[1];
    if (pool !== undefined && filled !== undefined && pool !== filled) {
      problems.push(`${side.label}的补齐位取的是 ${filled}，不是合并后的 ${pool}`);
    }
    if (!side.randArg.test(code)) problems.push(`${side.label}的洗牌步不再以 rand(i + 1) 取值`);
  });
  return problems;
}

/**
 * 强度判定与等级色是否与 utils/passwordStrengthCore.ts 一致。
 *
 * @param source 页面源码
 * @param coreSrc 强度核心模块源码
 * @returns 违规描述，一致时为空数组
 */
function findStrengthViolations(source: string, coreSrc: string): string[] {
  const demo = demoBlock(source);
  const predicates = corePredicates(coreSrc);
  const problems: string[] = [];
  predicates.forEach(predicate => {
    if (!demo.includes(predicate)) problems.push(`四条强度谓词少了这一条逐字副本：${predicate}`);
  });
  if (numberConst(demo, 'GEN_RULES_TOTAL') !== predicates.length) {
    problems.push(`GEN_RULES_TOTAL 与核心模块的规则条数（${predicates.length}）不一致`);
  }
  if (/if \(passed === (\d+)\) level = 'strong';/.exec(demo)?.[1] !== String(predicates.length)) {
    problems.push('strong 档不再是「全部通过」');
  }
  if (/else if \(passed >= (\d+)\) level = 'medium';/.exec(demo)?.[1] !== /passedCount >= (\d+)/.exec(coreSrc)?.[1]) {
    problems.push('medium 档的通过条数门槛与核心模块不一致');
  }
  LEVELS.forEach(level => {
    const inCore = new RegExp(`${level}:\\s*'(#[0-9a-f]{6})'`).exec(coreSrc)?.[1];
    // prettier 会把属性选择器的双引号归一成单引号，两种都得认；只认一种的话，
    // 这条对账会在某个无关的格式化提交上莫名其妙地红一次
    const inDemo = new RegExp(`\\.gen\\[data-level=["']${level}["']\\] \\{\\s*--gen-color: (#[0-9a-f]{6});`).exec(
      source,
    )?.[1];
    if (!inDemo) problems.push(`演示里没有 .gen[data-level="${level}"] 的等级色`);
    else if (inDemo !== inCore) problems.push(`等级色 ${level} 与 STRENGTH_COLORS 不一致`);
  });
  return problems;
}

/**
 * 助记词组装形状是否与 utils/passphraseGenerator.ts 的默认档同参数。
 *
 * @param source 页面源码
 * @param passphraseSrc 助记词生成器源码
 * @returns 违规描述，一致时为空数组
 */
function findPassphraseViolations(source: string, passphraseSrc: string): string[] {
  const demo = demoBlock(source);
  const problems: string[] = [];
  const pairs: Array<[demoName: string, sourceRe: RegExp, label: string]> = [
    ['GEN_WORD_COUNT', /wordCount: (\d+),/, '单词数'],
    ['GEN_DIGITS', /numberDigits: (\d+),/, '末尾追加数字位数'],
  ];
  pairs.forEach(([demoName, sourceRe, label]) => {
    if (String(numberConst(demo, demoName)) !== sourceRe.exec(passphraseSrc)?.[1]) {
      problems.push(`${label}与助记词生成器的默认档不一致`);
    }
  });
  if (!demo.includes("words.join('-')")) problems.push('演示的分隔符不再是 -');
  if (!/charAt\(0\)\.toUpperCase\(\) \+ word\.slice\(1\)/.test(demo)) problems.push('演示里没有首字母大写这一步');
  if (!/for \(let i = 0; i < GEN_DIGITS;\s*i \+= 1\)\s*out \+= String\(genInt\(10\)\);/.test(demo)) {
    problems.push('演示末尾追加数字的循环形状变了，GEN_DIGITS 可能不再参与组装');
  }
  return problems;
}

/**
 * 节选词库的每一词是否真在扩展全量里，以及说明文案里的两个数字是否属实。
 *
 * @param source 页面源码
 * @param fullList utils/data/passphrase-words.json 解析结果
 * @returns 违规描述，属实则空数组
 */
function findVocabularyViolations(source: string, fullList: string[]): string[] {
  const words = demoWords(source);
  const problems: string[] = [];
  if (new Set(words).size !== words.length) problems.push('节选词库里有重复词条');
  words.forEach(word => {
    if (!word) problems.push('节选词库里有空词条（字符串块之间多出空格）');
    else if (!/^[a-z]+$/.test(word)) problems.push(`节选词 ${word} 不是全小写字母`);
    else if (!fullList.includes(word)) problems.push(`节选词 ${word} 不在扩展词库里`);
  });
  const note = i18nEntry(source, 'features.f8.demo.note');
  if (!note) return [...problems, '说明文案 features.f8.demo.note 缺中英文'];
  const digits = (value: string | undefined) => (value === undefined ? undefined : Number(value.replace(/,/g, '')));
  const statedExcerpt = [
    digits(/演示词库为 (\d+) 词节选/.exec(note.zh)?.[1]),
    digits(/a ([\d,]+)-word excerpt/.exec(note.en)?.[1]),
  ];
  if (statedExcerpt.some(value => value !== words.length)) {
    problems.push(`说明里写的节选词数与 GEN_WORDS 的实际条数（${words.length}）不一致`);
  }
  const statedFull = [
    digits(/扩展内置 ([\d,]+) 词全量/.exec(note.zh)?.[1]),
    digits(/full ([\d,]+)-word list/.exec(note.en)?.[1]),
  ];
  if (statedFull.some(value => value !== fullList.length)) {
    problems.push(`说明里写的词库全量与 passphrase-words.json 的 ${fullList.length} 词不一致`);
  }
  return problems;
}

/**
 * 无 JS 时留在页面上的那枚静态样例，必须是演示真能输出的一枚。
 *
 * 样例是禁 JS 的读者唯一能看到的形态：若它不是 `genPassphrase()` 在那个默认档下可能拼出的
 * 形状（4 词首字母大写 + '-' 连接 + 末尾 2 位数字，且每词都在节选词库里），或者它的得分与旁边
 * 写死的 `data-level` / `4/4` 不相称，页面就在展示一枚产品给不出的口令。
 *
 * @param source 页面源码
 * @param words 节选词库
 * @param coreSrc 强度核心模块源码
 * @returns 违规描述，合规时为空数组
 */
function findSampleViolations(source: string, words: string[], coreSrc: string): string[] {
  const demo = demoBlock(source);
  const sample = /id="genValue"\s*>([^<]+)<\/code/.exec(source)?.[1] ?? '';
  const split = /^([^\d]+)(\d+)$/.exec(sample);
  if (!split) return [`静态样例 ${sample} 不是「词组 + 末尾数字」的形状`];
  const [, wordPart, digits] = split;
  const tokens = wordPart.split('-');
  const problems: string[] = [];
  if (tokens.length !== numberConst(demo, 'GEN_WORD_COUNT')) problems.push('静态样例的单词数不是演示的默认档');
  if (digits.length !== numberConst(demo, 'GEN_DIGITS')) problems.push('静态样例末尾数字的位数不是演示的默认档');
  tokens.forEach(token => {
    if (!/^[A-Z][a-z]+$/.test(token)) problems.push(`静态样例的 ${token} 不是「首字母大写 + 其余小写」`);
    else if (!words.includes(token.charAt(0).toLowerCase() + token.slice(1))) {
      problems.push(`静态样例用了节选词库之外的词：${token}`);
    }
  });
  const symbolPredicate = corePredicates(coreSrc)[3] ?? '';
  if (sample.length < 8 || !/[a-zA-Z]/.test(sample) || !/\d/.test(sample)) {
    problems.push('静态样例不满足它自己标注的 4/4');
  }
  if (!symbolPredicate.includes('\\-')) {
    problems.push('核心模块的 hasSymbol 已不再把 - 计入符号，样例标注的 4/4 需要重算');
  }
  if (!/id="genDemo"\s+data-level="strong"/.test(source)) problems.push('静态样例的等级标注不再是 strong');
  if (!/data-i18n="features\.f8\.demo\.level\.strong"/.test(source))
    problems.push('静态样例的等级词没有指向 strong 档');
  if (!/>4\/4</.test(source)) problems.push('静态样例的规则数标注不再是 4/4');
  return problems;
}

/**
 * 控件可见性是否挂在 html.gen-live 上，且这一标记只在随机源探测通过时出现。
 *
 * @param source 页面源码
 * @returns 违规描述，合规时为空数组
 */
function findGateViolations(source: string): string[] {
  const demo = demoBlock(source);
  const problems: string[] = [];
  GATED_BLOCKS.forEach(([base, open, label]) => {
    if (!base.test(source)) problems.push(`${label}没有「默认不可见」的那条基础规则`);
    if (!open.test(source)) problems.push(`${label}没有由 html.gen-live 打开的那条规则`);
  });
  if (!/classList\.add\('gen-live'\)/.test(demo)) problems.push('脚本里没有挂 gen-live 的那一行');
  if (!/if \(typeof crypto !== 'undefined' && typeof crypto\.getRandomValues === 'function'\) \{/.test(demo)) {
    problems.push('gen-live 不再只由 crypto.getRandomValues 的探测结果决定');
  }
  const probe = demo.indexOf("typeof crypto !== 'undefined'");
  const armed = demo.indexOf("classList.add('gen-live')");
  if (!(probe >= 0 && armed > probe)) problems.push('gen-live 在随机源探测之前就挂上了');
  if (!/const genInt = max => \{[\s\S]*crypto\.getRandomValues\(buf\)/.test(demo)) {
    problems.push('演示的随机整数不再走 crypto.getRandomValues');
  }
  // 禁用词只查代码不查注释：这一带的注释本来就要解释「为什么不拿 Math.random 凑数」
  const code = demo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/\binnerHTML\b/.test(code)) problems.push('演示脚本用了 innerHTML');
  if (/Math\.random/.test(code)) problems.push('演示脚本用了 Math.random');
  return problems;
}

describe('f8 生成器演示必须与扩展那台同规则', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const generatorSrc = readFileSync(path.join(ROOT, 'utils/passwordGenerator.ts'), 'utf8');
  const coreSrc = readFileSync(path.join(ROOT, 'utils/passwordStrengthCore.ts'), 'utf8');
  const passphraseSrc = readFileSync(path.join(ROOT, 'utils/passphraseGenerator.ts'), 'utf8');
  const fullList = JSON.parse(readFileSync(path.join(ROOT, 'utils/data/passphrase-words.json'), 'utf8')) as string[];

  it('四个字符集与 16 位默认档逐字等于生成器模块', () => {
    expect(findCharsetViolations(source, generatorSrc)).toEqual([]);
  });

  it('组装顺序与补齐池同为「合并池 → 每类一枚 → 补齐 → 洗牌 → 拼接」', () => {
    expect(findAssemblyViolations(source, generatorSrc)).toEqual([]);
  });

  it('四条强度谓词、两个等级门槛与三档等级色逐字等于核心模块', () => {
    expect(findStrengthViolations(source, coreSrc)).toEqual([]);
  });

  it('助记词的单词数 / 位数 / 分隔符 / 首字母大写对齐助记词模块', () => {
    expect(findPassphraseViolations(source, passphraseSrc)).toEqual([]);
  });

  it('节选词库每一词都在扩展 3080 词全量里，文案两个数字属实', () => {
    expect(findVocabularyViolations(source, fullList)).toEqual([]);
  });

  it('没有 JS 时留下的静态样例是演示真能输出的一枚，且标注与得分相称', () => {
    expect(findSampleViolations(source, demoWords(source), coreSrc)).toEqual([]);
  });

  it('三排控件默认不可见，只有随机源探测通过才出场', () => {
    expect(findGateViolations(source)).toEqual([]);
  });

  it('十三个演示文案中英齐备，markup 兜底文本逐字等于字典中文值', () => {
    DEMO_KEYS.forEach(key => {
      const entry = i18nEntry(source, key);
      expect(entry, `I18N 字典缺少 ${key} 的中英两项`).not.toBeNull();
      expect(entry!.en.trim(), `${key} 英文不能为空`).not.toBe('');
    });
    MARKED_KEYS.forEach(key => {
      const text = markedText(source, key);
      expect(text, `markup 里找不到 ${key} 的兜底文本`).not.toBeUndefined();
      expect(text, `markup 兜底文本与字典 zh 不一致：${key}`).toBe(i18nEntry(source, key)!.zh);
    });
  });

  it('减弱动效档撤掉强度条与 chip 的过渡时长，但保留终态值', () => {
    const rules = reducedMotionRules(source);
    ['.gen-bar i', '.gen-chip', '.gen-again'].forEach(selector => {
      expect(
        hasReducedMotionRule(rules, selector, /transition:\s*none/),
        `reduce 块里没有 ${selector} { transition: none }`,
      ).toBe(true);
    });
  });

  it('生成的值只走 textContent，等级词靠改写 data-i18n 复用 applyLang', () => {
    const demo = demoBlock(source);
    expect(demo).toMatch(/genValue\.textContent = value;/);
    expect(demo).toMatch(/genLevelEl\.dataset\.i18n = key;/);
    expect(demo).toMatch(/genLevelEl\.textContent = I18N\[key\]\[lang\];/);
    expect(demo).toMatch(/setProperty\('--w'/);
    expect(demo).toMatch(/genDemo\.dataset\.level = level;/);
  });
});

describe('守卫自检：真源漂开时必须判红', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const generatorSrc = readFileSync(path.join(ROOT, 'utils/passwordGenerator.ts'), 'utf8');
  const coreSrc = readFileSync(path.join(ROOT, 'utils/passwordStrengthCore.ts'), 'utf8');
  const passphraseSrc = readFileSync(path.join(ROOT, 'utils/passphraseGenerator.ts'), 'utf8');
  const fullList = JSON.parse(readFileSync(path.join(ROOT, 'utils/data/passphrase-words.json'), 'utf8')) as string[];
  const words = demoWords(source);

  it('字符集少一个字符 → 对账红', () => {
    const broken = generatorSrc.replace("const SYMBOL_CHARS = '!@#", "const SYMBOL_CHARS = '!@%");
    expect(broken).not.toBe(generatorSrc);
    expect(findCharsetViolations(source, broken).join('\n')).toContain('字符集字面量已漂开');
  });

  it('生成器默认长度改动 → 对账红', () => {
    expect(findCharsetViolations(source, generatorSrc.replace('length: 16,', 'length: 14,')).join('\n')).toContain(
      'GEN_LENGTH',
    );
  });

  it('补齐位改从单一字符集取 → 组装顺序对账红', () => {
    const broken = source.replace(
      'while (chars.length < GEN_LENGTH) chars.push(merged[genInt(merged.length)]);',
      'while (chars.length < GEN_LENGTH) chars.push(GEN_UPPER[genInt(GEN_UPPER.length)]);',
    );
    expect(broken).not.toBe(source);
    expect(findAssemblyViolations(broken, generatorSrc).join('\n')).toContain('补齐位取的是 GEN_UPPER');
  });

  it('把洗牌挪到补齐之前 → 组装顺序对账红', () => {
    // 两段整体互换：单改循环边界只会改形状，不会让「洗牌晚于补齐」这条次序断言失效
    const fillLine = 'while (chars.length < GEN_LENGTH) chars.push(merged[genInt(merged.length)]);';
    const shuffleBlock = `for (let i = chars.length - 1; i > 0; i -= 1) {
            const j = genInt(i + 1);
            const keep = chars[i];
            chars[i] = chars[j];
            chars[j] = keep;
          }`;
    const broken = source.replace(fillLine, '@FILL@').replace(shuffleBlock, fillLine).replace('@FILL@', shuffleBlock);
    expect(broken).not.toBe(source);
    expect(findAssemblyViolations(broken, generatorSrc).join('\n')).toContain('演示的组装顺序不再是');
  });

  it('洗牌的取值上界少一 → 组装顺序对账红', () => {
    // rand(i + 1) → rand(i)：长度、字符集、四条规则全都照旧，只有「最后一位永远留在原位」
    // 这一条分布偏差，是这类对账里最容易静默溜过去的一种
    const broken = source.replace('const j = genInt(i + 1);', 'const j = genInt(i);');
    expect(broken).not.toBe(source);
    expect(findAssemblyViolations(broken, generatorSrc).join('\n')).toContain('演示的洗牌步不再以');
  });

  it('强度谓词换掉一条 → 对账红', () => {
    expect(findStrengthViolations(source, coreSrc.replace('pwd.length >= 8', 'pwd.length >= 10')).join('\n')).toContain(
      '四条强度谓词少了这一条逐字副本',
    );
  });

  it('等级色改一档 → 对账红', () => {
    expect(
      findStrengthViolations(source, coreSrc.replace("strong: '#67c23a'", "strong: '#67c23b'")).join('\n'),
    ).toContain('strong');
  });

  it('medium 门槛改动 → 对账红', () => {
    expect(
      findStrengthViolations(source, coreSrc.replace('passedCount >= 2', 'passedCount >= 3')).join('\n'),
    ).toContain('medium 档');
  });

  it('节选词库混进一个全量之外的词 → 成员检查红', () => {
    const broken = source.replace('beyond boat breed bunny', 'beyond zorb breed bunny');
    expect(broken).not.toBe(source);
    expect(findVocabularyViolations(broken, fullList).join('\n')).toContain('zorb');
  });

  it('说明里的节选词数与真实条数不符 → 红', () => {
    // 改字典值而不是 markup 兜底文本：数字的真源是字典，两个语言档都得跟着改
    const broken = source
      .replace("zh: '演示词库为 96 词节选", "zh: '演示词库为 97 词节选")
      .replace('a 96-word excerpt', 'a 97-word excerpt');
    expect(broken).not.toBe(source);
    expect(findVocabularyViolations(broken, fullList).join('\n')).toContain('节选词数');
  });

  it('说明里的词库全量与实际词条数不符 → 红', () => {
    const broken = source.replace('full 3,080-word list', 'full 3,000-word list');
    expect(broken).not.toBe(source);
    expect(findVocabularyViolations(broken, fullList).join('\n')).toContain('词库全量');
  });

  it('静态样例换成一枚演示给不出的口令 → 红', () => {
    const broken = source.replace('>Vector-Sunset-King-Ready73<', '>Zx9!Qb2-Lk4#Nm7&<');
    expect(broken).not.toBe(source);
    expect(findSampleViolations(broken, words, coreSrc).join('\n')).not.toBe('');
  });

  it('抽掉 html.gen-live 那条打开规则 → 门控红', () => {
    const broken = source.replace('html.gen-live .gen-again {', '.gen-gate-removed .gen-again {');
    expect(broken).not.toBe(source);
    expect(findGateViolations(broken).join('\n')).toContain('「换一枚」按钮');
  });

  it('探测条件被摘成恒真 → 门控红', () => {
    const broken = source.replace(
      "if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {",
      'if (true) {',
    );
    expect(broken).not.toBe(source);
    expect(findGateViolations(broken).join('\n')).toContain('crypto.getRandomValues');
  });

  it('减弱动效块漏掉一条选择器 → 认不出来', () => {
    const broken = source.replace('        .gen-bar i,\n        .gen-chip,\n', '        .gen-bar i,\n');
    expect(broken).not.toBe(source);
    expect(hasReducedMotionRule(reducedMotionRules(broken), '.gen-chip', /transition:\s*none/)).toBe(false);
  });

  it('助记词默认档的单词数改动 → 对账红', () => {
    const broken = passphraseSrc.replace('wordCount: 4,', 'wordCount: 5,');
    expect(broken).not.toBe(passphraseSrc);
    expect(findPassphraseViolations(source, broken).join('\n')).toContain('单词数');
  });

  it('markup 兜底文本与字典 zh 漂移 → 文案对账红', () => {
    const broken = source.replace('>随机密码</span>', '>随机口令</span>').replace("zh: '随机密码'", "zh: '随机密码X'");
    // 两个读取器各读各的一处：只改对一边，另一边就得留在原值，否则这条对账是空转的
    expect(markedText(broken, 'features.f8.demo.mode.random')).toBe('随机口令');
    expect(i18nEntry(broken, 'features.f8.demo.mode.random')!.zh).toBe('随机密码X');
  });
});
