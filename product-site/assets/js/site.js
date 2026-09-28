/* ==========================================================================
   账号密码管理助手 · 产品页交互脚本
   四个模块全部在本地运行，不发起任何网络请求：
   1) 一键登录演示台   2) 跨子域匹配模拟器   3) 密码生成器   4) 导航 / 滚动 / 灯箱
   ========================================================================== */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 进场动画的隐藏态挂在这一个类上：脚本没跑起来时内容直接按最终态显示
  document.documentElement.classList.add('js');

  /* ---------------------------------------------------------------- 顶栏 */
  const topbar = $('#topbar');
  const nav = $('#nav');
  const navToggle = $('#navToggle');

  const onScroll = () => {
    if (topbar) topbar.classList.toggle('is-scrolled', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  navToggle?.addEventListener('click', () => {
    const open = nav?.classList.toggle('is-open') ?? false;
    navToggle.setAttribute('aria-expanded', String(open));
  });

  // 移动端点完锚点就收起目录
  nav?.addEventListener('click', e => {
    if (e.target instanceof HTMLAnchorElement) {
      nav.classList.remove('is-open');
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  /* ------------------------------------------------------- 进场淡入 */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !REDUCED) {
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('is-in'));
  }

  /* ------------------------------------------------ 锚点高亮当前小节 */
  const navLinks = $$('.nav a[href^="#"]');
  const linkFor = new Map();
  navLinks.forEach(a => {
    const target = $(a.getAttribute('href'));
    if (target) linkFor.set(target, a);
  });
  if (linkFor.size && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const link = linkFor.get(entry.target);
          if (!link) continue;
          if (entry.isIntersecting) {
            navLinks.forEach(l => l.classList.remove('is-active'));
            link.classList.add('is-active');
          }
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    linkFor.forEach((_link, target) => spy.observe(target));
  }

  /* ============================================ 1) 一键登录演示台 */
  const mock = $('#mock');
  const iUser = $('#iUser');
  const iPass = $('#iPass');
  const fUser = $('#fUser');
  const fPass = $('#fPass');
  const cRemember = $('#cRemember');
  const btnLogin = $('#btnLogin');
  const capStep = $('#capStep');
  const capText = $('#capText');
  const stepBars = $$('.demo__steps i');
  const panelHost = $('#panelHost');
  const panelTitle = $('#panelTitle');
  const panelFoot = $('#panelFoot');
  const demoUrl = $('#demoUrl');
  const accts = $$('#panelList .acct');

  const DEMO_USER = 'demo-admin@example.com';
  const DEMO_PASS_LEN = 14;

  /** 四种入口各自的旁白；填充与勾选的动作完全一致，差异只在「怎么触发」 */
  const ENTRIES = {
    inline: {
      url: 'https://admin.example.com/login',
      host: '登录框获焦后，钥匙图标就地展开',
      title: '选择账号',
      foot: '填充并登录',
      side: true,
      steps: [
        ['准备', '登录框获得焦点，输入框右侧出现钥匙图标（Closed Shadow DOM，不污染宿主页面）。'],
        ['展开', '点钥匙图标，迷你面板就地展开，列出本站匹配的 3 个账号。'],
        ['选中', '默认选中首条，回车即填：写入账号 → 写入密码 → 自动勾选「记住我」。'],
        ['提交', '走「填充并登录」时连登录按钮一起点掉；纯快捷键默认停在这一步之前。'],
      ],
    },
    side: {
      url: 'https://admin.example.com/login',
      host: 'Ctrl/Cmd + Shift + L 开关侧边栏',
      title: '快速填充',
      foot: '密码管理',
      side: true,
      steps: [
        ['准备', '点插件图标或按 Ctrl/Cmd + Shift + L 打开侧边栏，会话有效时取数约 20–50ms。'],
        ['展开', '顶栏写明「匹配 3 个账号」，多字段检索认拼音全拼与首字母缩写。'],
        ['选中', '条目上就地复制账号 / 密码 / 验证码，或点「填充并登录」。'],
        ['提交', '逐字段写入 + 勾选协议 + 可选点击登录，全程不离开当前标签页。'],
      ],
    },
    menu: {
      url: 'https://admin.example.com/login',
      host: '在输入框上点右键',
      title: '右键填充',
      foot: 'contextMenus',
      side: false,
      steps: [
        ['准备', '在任意账号或密码输入框上点右键，扩展注册的上下文菜单就位。'],
        ['展开', '选「填充用户名」/「填充密码」/「填入两步验证码」，也可选「生成并填充强密码」。'],
        ['选中', '生成并填充不读取任何已存凭证，会话锁定时同样可用。'],
        ['提交', '字段写入完成，勾选「记住我」；是否替你点登录取决于偏好设置。'],
      ],
    },
    key: {
      url: 'https://admin.example.com/login',
      host: 'Ctrl/Cmd + Shift + F',
      title: '一键填充',
      foot: 'quick_fill',
      side: false,
      steps: [
        ['准备', '光标落在登录页任意位置，按 Ctrl/Cmd + Shift + F。'],
        ['展开', '按当前站点的排序取最匹配的账号，无需先打开任何面板。'],
        ['选中', '填充账号 + 填充密码 + 勾选「记住我 / 已阅读并同意 / 接受条款」。'],
        ['提交', '默认停在这里；打开「自动触发登录」后，这一步才替你点 Sign in。'],
      ],
    },
  };

  let timers = [];
  const clearTimers = () => {
    timers.forEach(t => clearTimeout(t));
    timers = [];
  };
  const later = (ms, fn) => {
    timers.push(window.setTimeout(fn, ms));
  };

  const setCaption = (idx, text) => {
    if (capStep) capStep.textContent = `STEP ${idx}`;
    if (capText) capText.textContent = text;
    stepBars.forEach((b, i) => b.classList.toggle('on', i < idx));
  };

  const resetMock = () => {
    clearTimers();
    mock?.classList.remove('is-done');
    fUser?.classList.remove('is-filled');
    fPass?.classList.remove('is-filled');
    cRemember?.classList.remove('is-checked');
    btnLogin?.classList.remove('is-pressed');
    if (iUser) iUser.value = '';
    if (iPass) iPass.value = '';
    accts.forEach(a => a.classList.remove('is-active', 'is-dim'));
  };

  /** 逐字符写入，模拟真实填充节奏 */
  const typeInto = (input, fieldEl, text, startAt, speed, done) => {
    fieldEl?.classList.add('is-filled');
    let i = 0;
    const tick = () => {
      i += 1;
      input.value = text.slice(0, i);
      if (i < text.length) later(speed, tick);
      else later(120, done);
    };
    later(startAt, tick);
  };

  let current = 'inline';

  const runDemo = entry => {
    const cfg = ENTRIES[entry] ?? ENTRIES.inline;
    resetMock();
    if (demoUrl) demoUrl.textContent = cfg.url;
    if (panelHost) panelHost.textContent = cfg.host;
    if (panelTitle) panelTitle.textContent = cfg.title;
    if (panelFoot) panelFoot.textContent = cfg.foot;
    const panel = $('#demoPanel');
    if (panel) panel.style.display = cfg.side ? '' : 'none';

    setCaption(0, cfg.steps[0][1]);

    if (REDUCED) {
      // 关掉动效时直接给终态，不靠动画表达信息
      if (iUser) iUser.value = DEMO_USER;
      if (iPass) iPass.value = '•'.repeat(DEMO_PASS_LEN);
      fUser?.classList.add('is-filled');
      fPass?.classList.add('is-filled');
      cRemember?.classList.add('is-checked');
      accts[0]?.classList.add('is-active');
      mock?.classList.add('is-done');
      setCaption(4, cfg.steps[3][1]);
      return;
    }

    later(520, () => {
      setCaption(1, cfg.steps[1][1]);
      if (cfg.side) accts.forEach(a => a.classList.add('is-dim'));
    });

    later(1250, () => {
      setCaption(2, cfg.steps[2][1]);
      accts.forEach(a => a.classList.remove('is-dim'));
      accts[0]?.classList.add('is-active');
      typeInto(iUser, fUser, DEMO_USER, 0, 34, () => {
        typeInto(iPass, fPass, '•'.repeat(DEMO_PASS_LEN), 0, 46, () => {
          later(200, () => {
            cRemember?.classList.add('is-checked');
            later(700, () => {
              setCaption(3, cfg.steps[2][1]);
              later(900, () => {
                setCaption(4, cfg.steps[3][1]);
                btnLogin?.classList.add('is-pressed');
                later(260, () => {
                  btnLogin?.classList.remove('is-pressed');
                  mock?.classList.add('is-done');
                });
              });
            });
          });
        });
      });
    });
  };

  $$('.demo__tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.demo__tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      current = tab.dataset.entry ?? 'inline';
      const stage = $('#demoStage');
      stage?.setAttribute('aria-labelledby', tab.id);
      runDemo(current);
    });
  });

  $('#demoReplay')?.addEventListener('click', () => runDemo(current));

  // 进入视口后自动播一次，之后交给用户
  const demoEl = $('#demo');
  let played = false;
  const playOnce = () => {
    if (played) return;
    played = true;
    io?.disconnect();
    window.clearTimeout(guard);
    runDemo(current);
  };
  const io =
    demoEl && 'IntersectionObserver' in window
      ? new IntersectionObserver(
          entries => {
            if (entries.some(e => e.isIntersecting && e.intersectionRatio > 0.2)) playOnce();
          },
          { threshold: [0.2] },
        )
      : null;
  // 兜底：视口太矮导致交叉比例永远到不了阈值时，也要给一次自动播放
  const guard = demoEl ? window.setTimeout(playOnce, 1500) : 0;
  if (io && demoEl) io.observe(demoEl);
  if (!demoEl) playOnce();

  /* ============================================ 2) 跨子域匹配模拟器 */
  /** 演示夹具：host 写成 `*.x.com` 的条目即「通配条目」 */
  const VAULT = [
    { u: 'demo-admin@example.com', host: 'admin.example.com', tag: '生产', tone: 't-prod', n: '生产环境后台' },
    { u: 'auditor@example.com', host: 'admin.example.com', tag: '审计', tone: 't-test', n: '生产环境只读账号' },
    { u: 'support@example.com', host: 'admin.example.com', tag: '客服', tone: 't-test', n: '生产环境客服工单账号' },
    { u: 'dev-admin@example.com', host: 'dev-admin.example.com', tag: '开发', tone: 't-dev', n: '开发环境后台' },
    { u: 'qa-bot@example.com', host: 'qa.example.com', tag: '测试', tone: 't-test', n: '回归测试账号' },
    { u: 'ops@example.com', host: '*.example.com', tag: '通配', tone: 't-dev', n: '通配条目：整站任意子域可用' },
    { u: 'qq-openid@qq.com', host: '*.qq.com', tag: '通配', tone: 't-dev', n: '通配条目：*.qq.com' },
    { u: 'qq-master@qq.com', host: 'qq.com', tag: '主域', tone: 't-key', n: '主域账号' },
    { u: 'vqq-member@qq.com', host: 'v.qq.com', tag: '跨子域', tone: 't-key', n: '兄弟子域账号' },
    { u: 'dev@localhost', host: 'localhost:5173', tag: '本地', tone: 't-dev', n: 'Vite 本地环境' },
    { u: 'e2e@localhost', host: 'localhost:3000', tag: '本地', tone: 't-dev', n: '另一个端口，任何档位都不串号' },
  ];

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

  /** 把输入解析成 {host, port}；无端口时 port 为空串 */
  const parseHost = raw => {
    const s = (raw || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/\/.*$/, '');
    if (!s) return { host: '', port: '' };
    const m = /^(.*?)(?::(\d{1,5}))?$/.exec(s);
    return { host: m?.[1] ?? '', port: m?.[2] ?? '' };
  };

  /** 条目的可比主机串（localhost / 127.0.0.1 带端口） */
  const entryKey = e => {
    const { host, port } = parseHost(e.host);
    return LOCAL_HOSTS.has(host) && port ? `${host}:${port}` : host;
  };

  const currentKey = h => {
    const { host, port } = parseHost(h);
    return LOCAL_HOSTS.has(host) && port ? `${host}:${port}` : host;
  };

  /** 取「主域名」：末两段标签；IP / localhost 不参与 */
  const apexOf = host => {
    const labels = host.split('.');
    if (labels.length < 3) return null;
    if (/^\d+$/.test(labels.at(-1))) return null;
    return labels.slice(-2).join('.');
  };

  const KIND = {
    exact: { label: '精确匹配', cls: 'b-exact' },
    wildcard: { label: '通配条目', cls: 'b-wild' },
    apex: { label: '主域名', cls: 'b-cross' },
    sibling: { label: '跨子域', cls: 'b-cross' },
  };

  /**
   * 复刻扩展的三档口径：① 仅精确；② 精确 + 通配；③ 在 ② 之上，
   * 当前域名没有精确命中时才带出主域与兄弟子域。
   */
  const resolve = (rawHost, tier) => {
    const host = currentKey(rawHost);
    if (!host) return [];
    const out = [];
    const seen = new Set();
    const push = (e, kind) => {
      if (seen.has(e.u)) return;
      seen.add(e.u);
      out.push({ ...e, kind });
    };

    VAULT.filter(e => entryKey(e) === host).forEach(e => push(e, KIND.exact));
    const hasExact = out.length > 0;

    if (tier !== 'exact') {
      VAULT.filter(e => e.host.startsWith('*.')).forEach(e => {
        const suffix = e.host.slice(2);
        if (host === suffix || host.endsWith(`.${suffix}`)) push(e, KIND.wildcard);
      });
    }

    // ③ 同主域名：只在当前域名没有精确账号时兜底，localhost 系永不参与
    if (tier === 'apex' && !hasExact && !LOCAL_HOSTS.has(host.split(':')[0])) {
      const apex = apexOf(host);
      if (apex) {
        VAULT.filter(e => entryKey(e) === apex).forEach(e => push(e, KIND.apex));
        VAULT.filter(e => {
          const k = entryKey(e);
          return k !== host && k.endsWith(`.${apex}`) && !k.startsWith('*.');
        }).forEach(e => push(e, KIND.sibling));
      }
    }

    return out;
  };

  const RULE_TEXT = {
    exact: '档位 ①：只认与当前 host 完全一致的条目',
    wildcard: '档位 ②：精确命中 + 网址写成通配形的条目',
    apex: '档位 ③：② 的结果之上，无精确命中时带出主域与兄弟子域',
  };

  const simHost = $('#simHost');
  const simRows = $('#simRows');
  const simSummary = $('#simSummary');
  const simRule = $('#simRule');

  const renderSim = () => {
    if (!simRows) return;
    const tier = document.querySelector('input[name="tier"]:checked')?.value ?? 'exact';
    const host = simHost?.value ?? '';
    const hits = resolve(host, tier);

    simSummary.textContent = host.trim()
      ? `${currentKey(host)} · 命中 ${hits.length} / ${VAULT.length} 条`
      : '请输入一个主机名';
    simRule.textContent = RULE_TEXT[tier];

    if (!host.trim()) {
      simRows.innerHTML = '';
      return;
    }
    if (!hits.length) {
      simRows.innerHTML =
        '<p class="sim__empty">这一档下没有可用账号。<br />切到「同主域名」看看兜底，或在侧边栏顶栏点「+」就地建档。</p>';
      return;
    }

    simRows.textContent = '';
    hits.forEach(e => {
      const row = document.createElement('div');
      row.className = 'row';

      const av = document.createElement('span');
      av.className = 'row__av';
      av.textContent = e.u[0].toUpperCase();
      av.setAttribute('aria-hidden', 'true');

      const mid = document.createElement('div');
      const u = document.createElement('div');
      u.className = 'row__u';
      u.textContent = e.u;
      const w = document.createElement('div');
      w.className = 'row__w';
      w.textContent = `${e.host} · ${e.n}`;
      mid.append(u, w);

      const badge = document.createElement('span');
      badge.className = `row__badge ${e.kind.cls}`;
      badge.textContent = e.kind.label;

      row.append(av, mid, badge);
      simRows.append(row);
    });
  };

  $$('input[name="tier"]').forEach(r => r.addEventListener('change', renderSim));
  simHost?.addEventListener('input', renderSim);
  $$('#simQuick button').forEach(b =>
    b.addEventListener('click', () => {
      if (simHost) simHost.value = b.dataset.host ?? '';
      renderSim();
    }),
  );
  renderSim();

  /* ============================================ 3) 密码生成器 */
  const SETS = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    upperAll: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijkmnpqrstuvwxyz',
    lowerAll: 'abcdefghijklmnopqrstuvwxyz',
    digit: '23456789',
    digitAll: '0123456789',
    symbol: '!@#$%^&*()-_=+[]{};:,.?/',
  };

  /** 助记词词库节选：扩展内置完整 3080 词英文词库，页面只嵌这一份以保持零外部请求 */
  const RAW_WORDS = [
    'anchor',
    'atlas',
    'beacon',
    'bishop',
    'brisk',
    'cabin',
    'cinder',
    'cobalt',
    'coral',
    'copper',
    'crimson',
    'delta',
    'denim',
    'drift',
    'eagle',
    'ember',
    'engine',
    'fable',
    'faraday',
    'falcon',
    'fjord',
    'flint',
    'garnet',
    'glacier',
    'harbor',
    'hazel',
    'heron',
    'indigo',
    'ivory',
    'jasper',
    'juniper',
    'kestrel',
    'lagoon',
    'lantern',
    'laurel',
    'linen',
    'lotus',
    'lunar',
    'maple',
    'marble',
    'meadow',
    'nectar',
    'nimbus',
    'oasis',
    'onyx',
    'orchid',
    'osprey',
    'pepper',
    'pilot',
    'prism',
    'quartz',
    'quiver',
    'raven',
    'ribbon',
    'rocket',
    'saffron',
    'sable',
    'saffron',
    'sequoia',
    'shadow',
    'signal',
    'silver',
    'slate',
    'sonar',
    'sparrow',
    'summit',
    'tundra',
    'umber',
    'velvet',
    'violet',
    'walnut',
    'willow',
    'zenith',
    'amber',
    'aspen',
    'basalt',
    'beacon',
    'breeze',
    'cedar',
    'chrome',
    'clover',
    'comet',
    'cypress',
    'dapple',
    'dune',
    'echo',
    'elm',
    'fathom',
    'felix',
    'fern',
    'flume',
    'forest',
    'gale',
    'granite',
    'grove',
    'halcyon',
    'hollow',
    'island',
    'ivory',
    'lark',
    'lichen',
    'lucid',
    'magnet',
    'marsh',
    'mist',
    'noble',
    'nomad',
    'orbit',
    'pearl',
    'pine',
    'pixel',
    'pond',
    'prairie',
    'quill',
    'quartz',
    'reef',
    'ridge',
    'river',
    'saga',
  ];

  /** 去重后作为实际词库，避免重复词带来的分布偏置 */
  const WORDS = [...new Set(RAW_WORDS)];

  const genVal = $('#genVal');
  const genLen = $('#genLen');
  const genLenOut = $('#genLenOut');
  const genMeter = $('#genMeter');
  const genStrength = $('#genStrength');
  const modeBtns = $$('.gen__mode');

  let mode = 'random';

  /** 均匀取一个 [0, max) 整数：用 rejection sampling 去掉取模偏置 */
  const randInt = max => {
    if (max <= 0) return 0;
    const limit = Math.floor(0xffffffff / max) * max;
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % max;
  };

  const pick = pool => pool[randInt(pool.length)];

  const buildPool = () => {
    const similar = $('#cSimilar')?.checked;
    let pool = '';
    if ($('#cUpper')?.checked) pool += similar ? SETS.upper : SETS.upperAll;
    if ($('#cLower')?.checked) pool += similar ? SETS.lower : SETS.lowerAll;
    if ($('#cDigit')?.checked) pool += similar ? SETS.digit : SETS.digitAll;
    if ($('#cSymbol')?.checked) pool += SETS.symbol;
    return pool;
  };

  const scoreStrength = bits => {
    if (bits >= 100) return ['极强', 100];
    if (bits >= 80) return ['很强', 86];
    if (bits >= 60) return ['强', 68];
    if (bits >= 40) return ['中等', 46];
    return ['偏弱', 22];
  };

  const renderGen = () => {
    if (!genVal || !genLen) return;
    const len = Number(genLen.value);
    // 两条分支都会赋值；提前 return 的空池分支不会读到它们
    let text;
    let bits;

    if (mode === 'random') {
      const pool = buildPool();
      if (!pool) {
        genVal.textContent = '至少勾选一种字符集';
        genStrength.textContent = '—';
        if (genMeter) genMeter.style.setProperty('--fill', '4%');
        return;
      }
      text = Array.from({ length: len }, () => pick(pool)).join('');
      bits = len * Math.log2(pool.length);
    } else {
      const words = WORDS.slice();
      text = Array.from({ length: len }, () => pick(words)).join('-');
      bits = len * Math.log2(words.length);
      if (randInt(2) === 0) text += `-${10 + randInt(89)}`;
    }

    genVal.textContent = text;
    const [label, fill] = scoreStrength(bits);
    genStrength.textContent = `${label} · 约 ${Math.round(bits)} bit 熵`;
    if (genMeter) genMeter.style.setProperty('--fill', `${fill}%`);
    if (genLenOut) genLenOut.textContent = String(len);
  };

  const setMode = next => {
    mode = next;
    modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
    if (!genLen) return;
    if (next === 'random') {
      genLen.min = '6';
      genLen.max = '50';
      genLen.step = '1';
      genLen.value = '16';
    } else {
      genLen.min = '3';
      genLen.max = '8';
      genLen.step = '1';
      genLen.value = '4';
    }
    renderGen();
  };

  modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode ?? 'random')));
  genLen?.addEventListener('input', renderGen);
  $$('.chips input').forEach(c => c.addEventListener('change', renderGen));
  $('#genAgain')?.addEventListener('click', renderGen);

  $('#genCopy')?.addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    const text = genVal?.textContent ?? '';
    if (!text || text.includes('至少勾选')) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    if (btn) {
      btn.textContent = ok ? '已复制' : '请手动选中';
      window.setTimeout(() => {
        btn.textContent = '复制';
      }, 1800);
    }
  });

  renderGen();

  /* ============================================ 4) 截图灯箱 */
  const lb = $('#lb');
  const lbImg = $('#lbImg');
  const lbCap = $('#lbCap');
  let lastFocus = null;

  const openLb = (src, alt) => {
    if (!lb || !lbImg) return;
    lastFocus = document.activeElement;
    lbImg.src = src;
    lbImg.alt = alt;
    if (lbCap) lbCap.textContent = alt;
    lb.hidden = false;
    requestAnimationFrame(() => lb.classList.add('is-open'));
    $('#lbClose')?.focus();
  };

  const closeLb = () => {
    if (!lb) return;
    lb.classList.remove('is-open');
    window.setTimeout(() => {
      lb.hidden = true;
    }, 240);
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  };

  $$('.gcard').forEach(card => {
    card.addEventListener('click', () => {
      const img = $('img', card);
      openLb(card.dataset.full ?? img?.src ?? '', img?.alt ?? '截图预览');
    });
  });

  $('#lbClose')?.addEventListener('click', closeLb);
  lb?.addEventListener('click', e => {
    if (e.target === lb) closeLb();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lb?.classList.contains('is-open')) closeLb();
  });
})();
