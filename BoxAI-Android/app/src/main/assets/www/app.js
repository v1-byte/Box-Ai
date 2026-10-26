(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ic = (n, cls = '') => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
  const NATIVE = window.BoxNative || null;
  const APP_VERSION = '2.2.26';
  const RELEASES_API = 'https://api.github.com/repos/v1-byte/Box-Ai/releases/latest';
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ================= DATA & STATE ================= */
  const MODELS = [];
  const DEFAULT_PALS = [
    { id: 'chat',     name: 'Default Chat', desc: 'Asisten umum', icon: 'chat',   prompt: 'Kamu asisten yang membantu, ringkas, dan jujur.' },
    { id: 'writer',   name: 'Writer',       desc: 'Draf, tulis ulang, atur nada', icon: 'pen', prompt: 'Kamu penulis profesional. Bantu menyusun dan memperbaiki tulisan.' },
    { id: 'coder',    name: 'Coder',        desc: 'Jelaskan dan refaktor kode offline', icon: 'code', prompt: 'Kamu insinyur perangkat lunak senior. Jawab dengan kode yang rapi.' },
    { id: 'research', name: 'Research',     desc: 'Ringkas catatan dan PDF panjang', icon: 'search', prompt: 'Kamu asisten riset. Ringkas dan tarik poin penting dari dokumen.' }
  ];
  const SEED_CHAT = [];
  const DEFAULTS = {
    theme: 'system', lang: 'id', haptics: true, onDevice: true,
    temp: 0.7, topp: 0.9, maxTok: 2048, ctx: 4096,
    active: '', dl: {}, pal: null, pals: [],
    cache: { kv: 0, tmp: 0, thumbs: 0, logs: 0 },
    chat: SEED_CHAT, typing: false, sort: 'default', talents: { calculate: true, datetime: true, render_html: true, web_search: false }, hfToken: '', ghRepo: 'v1-byte/Box-Ai', ghToken: '', cfUrl: '', cfToken: '', r2Url: '', metaToken: '', ghPath: 'boxai/', bench: [], web: false, webAck: false, sysPrompt: 'Kamu asisten yang membantu, ringkas, dan jujur. Jawab dalam bahasa yang dipakai pengguna.'
  };
  let S;
  try { S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('boxai.v3') || '{}')); } catch (e) { S = Object.assign({}, DEFAULTS); }
  const SECRET_FIELDS = { hfToken: 'hf', ghToken: 'gh', cfToken: 'cf', metaToken: 'meta' };
  function loadSecureSecrets() {
    if (!NATIVE || !NATIVE.getSecret) return;
    Object.entries(SECRET_FIELDS).forEach(([field, key]) => {
      try {
        const nativeValue = NATIVE.getSecret(key) || '';
        if (nativeValue) S[field] = nativeValue;
        else if (S[field]) NATIVE.setSecret(key, S[field]); // one-time legacy migration
      } catch (_) {}
    });
  }
  loadSecureSecrets();
  const save = () => {
    try {
      Object.entries(SECRET_FIELDS).forEach(([field, key]) => {
        if (NATIVE && NATIVE.setSecret) NATIVE.setSecret(key, S[field] || '');
      });
      const copy = JSON.parse(JSON.stringify(S));
      Object.keys(SECRET_FIELDS).forEach(field => { delete copy[field]; });
      if (copy.chat) copy.chat.forEach(m => {
        if (m.img && String(m.img).length > 200000) m.img = undefined; // hemat storage
        if (m.fileText && String(m.fileText).length > 50000) m.fileText = String(m.fileText).slice(0, 50000);
      });
      localStorage.setItem('boxai.v3', JSON.stringify(copy));
    } catch (e) {}
  };
  save();
  const NONE = { id: '', name: 'Belum ada model', short: 'Belum ada model', meta: '', gb: 0, src: '', file: '' };
  const model = id => MODELS.find(m => m.id === id) || NONE;
  const fmtMB = mb => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB').replace('.', ',');
  const fmtGB = gb => (gb.toFixed(1) + ' GB').replace('.', ',');
  const allPals = () => DEFAULT_PALS.concat(S.pals);

  /* ================= SISTEM FILE VIRTUAL ================= */
  const ROOT = '/pencari';
  const TPL = {
    gemma: '<start_of_turn>user\n{{prompt}}<end_of_turn>\n<start_of_turn>model\n',
    llama3: '<|start_header_id|>user<|end_header_id|>\n\n{{prompt}}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
    chatml: '<|im_start|>user\n{{prompt}}<|im_end|>\n<|im_start|>assistant\n',
    mistral: '[INST] {{prompt}} [/INST]',
    phi3: '<|user|>\n{{prompt}}<|end|>\n<|assistant|>\n'
  };
  const MMETA_DEF = {};
  function seedFs() {
    const t = Date.now();
    return {
      dirs: [ROOT, ROOT + '/models', ROOT + '/prompts', ROOT + '/catatan'],
      files: {
        [ROOT + '/prompts/default.txt']: { c: 'Kamu asisten yang membantu, ringkas, dan jujur.\nJawab dalam bahasa yang dipakai pengguna.\n', m: t },
        [ROOT + '/prompts/penulis.txt']: { c: 'Kamu penulis profesional.\nPerbaiki tata bahasa, jaga nada asli penulis, dan jelaskan perubahan penting secara singkat.\n', m: t },
        [ROOT + '/catatan/catatan-model.md']: { c: '# Catatan model\n\n- Catat model favoritmu di sini.\n- Tambahkan catatanmu di sini.\n', m: t }
      }
    };
  }
  if (!S.fsx || !S.fsx.dirs) S.fsx = seedFs();
  if (!S.mmeta) S.mmeta = {};
  if (!S.installAt) S.installAt = Date.now();
  function meta(id) {
    if (!S.mmeta[id]) {
      const d = MMETA_DEF[id];
      S.mmeta[id] = { name: model(id).name, file: d.file, ctx: d.ctx, tpl: TPL[d.tpl], sys: 'Kamu asisten yang membantu dan jujur.' };
    }
    return S.mmeta[id];
  }
  const mname = m => (S.mmeta[m.id] && S.mmeta[m.id].name) || m.name;

  /* ================= TOAST, HAPTIC ================= */
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }
  document.addEventListener('click', e => {
    if (S.haptics && e.target.closest('button, .li.link, .c-row, .opt, .model-card, .pal-card') && navigator.vibrate) navigator.vibrate(8);
  }, true);

  /* ================= TEMA ================= */
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const t = S.theme === 'system' ? (mq && mq.matches ? 'light' : 'dark') : S.theme;
    document.documentElement.dataset.theme = t;
    const m = $('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f6f5f1' : '#08090c';
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  applyTheme();

  /* ================= SHEET & DIALOG ================= */
  const overlay = $('#overlay'), sheet = $('#sheet');
  let sheetClose = null, sheetTok = 0;
  function openSheet(html, mount) {
    return new Promise(resolve => {
      const tok = ++sheetTok;
      sheet.innerHTML = html; overlay.hidden = false; sheet.hidden = false;
      requestAnimationFrame(() => { if (tok === sheetTok) { overlay.classList.add('show'); sheet.classList.add('show'); } });
      sheetClose = v => {
        overlay.classList.remove('show'); sheet.classList.remove('show');
        setTimeout(() => { if (tok === sheetTok) { overlay.hidden = true; sheet.hidden = true; sheet.innerHTML = ''; } }, 380);
        sheetClose = null; resolve(v);
      };
      mount && mount(sheet, sheetClose);
      $$('[data-close]', sheet).forEach(b => b.addEventListener('click', () => sheetClose(undefined)));
    });
  }
  overlay.addEventListener('click', () => sheetClose && sheetClose(undefined));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetClose) sheetClose(undefined); });

  function confirmBox(title, msg, okLabel, danger) {
    return openSheet(`<h2>${esc(title)}</h2><p class="sub">${esc(msg)}</p>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
      <button class="btn ghost" data-close>Batal</button>`,
      (el, close) => $('[data-ok]', el).addEventListener('click', () => close(true))).then(v => !!v);
  }
  function choose(title, options, current, sub) {
    return openSheet(`<h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : '<div style="height:8px"></div>'}` +
      options.map(o => `<button class="opt ${o.v === current ? 'on' : ''}" data-v="${esc(o.v)}"><span class="o-txt">${esc(o.l)}${o.s ? `<small>${esc(o.s)}</small>` : ''}</span><i class="radio"></i></button>`).join(''),
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
  }
  function slider(title, sub, min, max, step, value, fmt) {
    return openSheet(`<h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p>
      <div class="val-big" id="sv">${fmt(value)}</div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" id="sr" />
      <button class="btn primary" data-ok>Simpan</button><button class="btn ghost" data-close>Batal</button>`,
      (el, close) => {
        const r = $('#sr', el), v = $('#sv', el);
        r.addEventListener('input', () => v.textContent = fmt(+r.value));
        $('[data-ok]', el).addEventListener('click', () => close(+r.value));
      });
  }

  /* ================= NAVIGASI ================= */
  const screens = {};
  $$('.screen').forEach(s => { screens[s.id.replace('screen-', '')] = s; });
  const mainTabs = ['chat', 'models', 'pals', 'settings'];
  const tabbar = $('#tabbar');
  const seen = new Set(['chat']);
  let prevScreen = 'settings';
  function skeleton(el) {
    el.classList.add('loading');
    setTimeout(() => { el.classList.remove('loading'); el.classList.add('revealed'); }, 900);
  }
  function go(name) {
    Object.keys(screens).forEach(k => screens[k].classList.toggle('active', k === name));
    const isMain = mainTabs.includes(name);
    tabbar.classList.toggle('hidden', !isMain);
    $$('.tab', tabbar).forEach(t => t.classList.toggle('active', t.dataset.go === name));
    if (isMain) tabbar.style.setProperty('--i', mainTabs.indexOf(name));
    const el = screens[name];
    if (el && el.hasAttribute('data-skeleton') && !seen.has(name)) skeleton(el);
    seen.add(name);
    if (name === 'settings') renderSettings();
    if (name === 'clean') enterCleaner();
    if (name === 'finder') renderFinder();
    if (name === 'bench') renderBench();
  }
  $$('[data-go]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); go(el.dataset.go); }));
  $('#btnMenu').addEventListener('click', () => go('settings'));

  /* ================= SPLASH ================= */
  const splash = $('#splash'), bar = $('#bootBar'), bootText = $('#bootText');
  function finishSplash() {
    try {
      if (!splash || !splash.parentNode) return;
      splash.classList.add('out');
      setTimeout(() => { try { splash.remove(); } catch (e) {} }, 500);
      const m = $('#messages'); if (m) m.scrollTop = m.scrollHeight;
    } catch (e) {}
  }
  // Progress labels (cosmetic only) — splash MUST end even if native is slow
  [[30, 'Menyiapkan mesin on-device'], [55, 'Memeriksa model lokal'], [80, 'Hampir siap'], [100, 'Siap']]
    .forEach(([w, t], i) => setTimeout(() => {
      try { if (bar) bar.style.width = w + '%'; if (bootText) bootText.textContent = t; } catch (e) {}
    }, 400 + i * 350));
  setTimeout(finishSplash, 1800);
  // Hard fallback if something blocks earlier timers
  setTimeout(finishSplash, 4000);

  /* ================= CHAT ================= */
  const messages = $('#messages'), input = $('#composerInput'), sendBtn = $('#btnSend');
  let attachment = null;
  const subText = () => (S.pal ? (allPals().find(p => p.id === S.pal) || {}).name + ' · ' : '') + model(S.active).short + ' · ' + (S.onDevice ? 'On-device' : 'Online') + (S.web ? ' + Web' : '');
  function updateTop() { $('#chatSub').textContent = subText(); }
  function aiRow(inner) {
    return `<div class="row ai"><img src="assets/logo-64.webp" class="av" alt="" width="30" height="30" /><div class="bubble">${inner}</div></div>`;
  }
  function renderChat() {
    let h = '<div class="day-sep"><span>Hari ini</span></div>';
    if (!S.chat.length) {
      const pal = allPals().find(p => p.id === S.pal);
      h += aiRow(`<p>${pal ? `Halo, saya <strong>${esc(pal.name)}</strong>. ${esc(pal.desc || '')}.` : 'Chat baru dimulai. Apa yang ingin kamu kerjakan?'}</p>`);
      h += '<div class="suggest">' + ['Ringkas teks ini', 'Tulis email singkat', 'Jelaskan kode ini', 'Beri ide proyek'].map(t => `<button type="button">${t}</button>`).join('') + '</div>';
    } else {
      S.chat.forEach(m => {
        if (m.r === 'ai') h += aiRow(m.h);
        else {
          let extra = '';
          if (m.img) extra += `<div class="file-bubble img"><img src="${m.img}" alt="${esc(m.f || '')}" /></div>`;
          else if (m.f) extra += `<div class="file-bubble">${ic('file')}${esc(m.f)}</div>`;
          h += `<div class="row user"><div class="bubble">${extra}${esc(m.t)}</div></div>`;
        }
      });
    }
    if (S.typing && S.chat.length) h += `<div class="row ai" id="typingRow"><img src="assets/logo-64.webp" class="av" alt="" width="30" height="30" /><div class="bubble typing" aria-label="Sedang mengetik"><i></i><i></i><i></i></div></div>`;
    messages.innerHTML = h;
    $$('.suggest button', messages).forEach(b => b.addEventListener('click', () => { input.value = b.textContent + ': '; input.focus(); sendBtn.classList.add('ready'); }));
    messages.scrollTop = messages.scrollHeight;
  }

  /* ================= TALENTS, MARKDOWN, ENGINE ================= */
  const searchCbs = {}; let searchN = 0;
  window.BoxSearch = { cb: (id, r) => { const f = searchCbs[id]; if (f) { delete searchCbs[id]; f(r); } } };
  function webSearch(q) {
    return new Promise((res, rej) => {
      if (!NATIVE || !NATIVE.webSearch) return rej(new Error('Pencarian web hanya tersedia di aplikasi Android'));
      if (!q.trim()) return rej(new Error('Kueri kosong'));
      const id = ++searchN, t = setTimeout(() => { delete searchCbs[id]; rej(new Error('Pencarian kehabisan waktu')); }, 20000);
      searchCbs[id] = r => { clearTimeout(t); r.error ? rej(new Error(r.error)) : res(r.results || []); };
      NATIVE.webSearch(id, q);
    });
  }
  const TALENTS = {
    calculate: { desc: 'Hitung ekspresi matematika', run: a => { const e = String(a.expression || ''); if (!/^[0-9+\-*\/%^().,\s]+$/.test(e)) throw new Error('Ekspresi tidak valid'); const v = Function('"use strict";return (' + e.replace(/\^/g, '**').replace(/,/g, '.') + ')')(); if (!Number.isFinite(v)) throw new Error('Hasil tidak terhingga'); return String(v); } },
    datetime: { desc: 'Tanggal dan waktu saat ini', run: () => new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'long' }) },
    web_search: { desc: 'Cari informasi di web lewat DuckDuckGo (kueri dikirim ke internet)', run: async a => { const r = await webSearch(String(a.query || '')); return r.length ? r.map((x, i) => (i + 1) + '. ' + x.title + '\n' + x.url + '\n' + x.snippet).join('\n\n') : 'Tidak ada hasil.'; } },
    render_html: { desc: 'Tampilkan HTML di dalam chat', run: a => String(a.html || '') }
  };
  function runTalent(name, args) {
    if (!TALENTS[name]) throw new Error('Talent tidak dikenal: ' + name);
    if (name === 'web_search' ? !S.web : !S.talents[name]) throw new Error(name === 'web_search' ? 'Pencarian web mati. Nyalakan tombol globe di samping kolom pesan.' : 'Talent ' + name + ' dimatikan di Settings');
    return TALENTS[name].run(args || {});
  }
  const htmlFrame = code => S.talents.render_html ? `<iframe class="html-frame" sandbox="" srcdoc="${esc(code)}"></iframe>` : `<pre><code>${esc(code)}</code></pre>`;
  function md(t) {
    const parts = String(t).split(/```/);
    return parts.map((p, i) => {
      if (i % 2) {
        const nl = p.indexOf('\n'), lang = nl > -1 ? p.slice(0, nl).trim().toLowerCase() : '', code = nl > -1 ? p.slice(nl + 1) : p;
        return lang === 'html' && S.talents.render_html ? htmlFrame(code) : `<pre><button type="button" class="cp">Salin</button><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
      }
      return esc(p).split(/\n{2,}/).filter(x => x.trim()).map(x => '<p>' + x.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>').join('');
    }).join('');
  }
  messages.addEventListener('click', e => {
    const b = e.target.closest('.cp'); if (!b) return;
    const code = $('code', b.parentNode).textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Kode disalin'), () => toast('Gagal menyalin'));
  });
  const Engine = {
    ok: () => !!(NATIVE && NATIVE.engineAvailable && NATIVE.engineAvailable()),
    generate(msgs) {
      return new Promise((res, rej) => {
        let buf = '';
        window.BoxEngine = { token: t => { buf += t; live(buf); }, done: () => res(buf), error: m => rej(new Error(m)) };
        NATIVE.generate(JSON.stringify({ model: meta(S.active).file, messages: msgs, temp: S.temp, top_p: S.topp, max_tokens: S.maxTok, n_ctx: S.ctx }));
      });
    }
  };
  function live(t) {
    let r = $('#liveRow');
    if (!r) { messages.insertAdjacentHTML('beforeend', aiRow('').replace('class="row ai"', 'class="row ai" id="liveRow"')); r = $('#liveRow'); }
    $('.bubble', r).innerHTML = md(t); messages.scrollTop = messages.scrollHeight;
  }
  const pushAi = (h, raw) => { S.chat.push({ r: 'ai', h, raw }); save(); renderChat(); };
  function sysPrompt() {
    const pal = allPals().find(p => p.id === S.pal), tools = Object.keys(TALENTS).filter(k => (k === 'web_search' ? S.web : S.talents[k]) && k !== 'render_html');
    return (pal ? pal.prompt : (S.sysPrompt || meta(S.active).sys)) + (tools.length ? '\nTools: ' + tools.map(k => k + ' (' + TALENTS[k].desc + ')').join(', ') + '. Panggil dengan <tool>{"name":"...","args":{...}}</tool>.' : '');
  }
  async function agentTurn(depth) {
    const msgs = [{ role: 'system', content: sysPrompt() }].concat(S.chat.map(m => {
      if (m.r === 'ai') return { role: 'assistant', content: m.raw || String(m.h || '').replace(/<[^>]+>/g, '') };
      let c = m.t || '';
      if (m.fileText) c += (c ? '\n\n' : '') + '--- Lampiran: ' + (m.f || 'file') + ' ---\n' + m.fileText;
      else if (m.img) c += (c ? '\n' : '') + '[Pengguna melampirkan gambar: ' + (m.f || 'image') + '. Model teks ini tidak melihat piksel; jawab berdasarkan deskripsi/teks pengguna.]';
      else if (m.f) c += (c ? '\n' : '') + '[Lampiran: ' + m.f + ']';
      return { role: 'user', content: c };
    }));
    let srcs = [];
    if (S.web && depth === 0) {
      const lastU = S.chat.slice().reverse().find(m => m.r === 'user');
      if (lastU) {
        live('Mencari di web…');
        try { srcs = await webSearch(lastU.t.slice(0, 200)); } catch (e) { srcs = []; toast(e.message); }
        const lr = $('#liveRow'); lr && lr.remove();
      }
      if (srcs.length) msgs[0].content += '\n\nHasil pencarian web terbaru (gunakan bila relevan dan sebutkan sumbernya):\n' + srcs.map((x, i) => '[' + (i + 1) + '] ' + x.title + ' — ' + x.snippet + ' (' + x.url + ')').join('\n');
    }
    let out;
    try { out = await Engine.generate(msgs); } catch (e) { const r = $('#liveRow'); r && r.remove(); return pushAi('<p>Gagal membuat jawaban: ' + esc(e.message) + '</p>'); }
    const r = $('#liveRow'); r && r.remove();
    const tc = out.match(/<tool>([\s\S]*?)<\/tool>/);
    if (tc && depth < 3) {
      let res;
      try { const c = JSON.parse(tc[1]); res = await runTalent(c.name, c.args); pushAi('<p class="muted-line">Talent ' + esc(c.name) + ' → ' + esc(String(res).slice(0, 200)) + '</p>', out + '\n[hasil tool: ' + res + ']'); }
      catch (e) { pushAi('<p class="muted-line">Talent gagal: ' + esc(e.message) + '</p>', out + '\n[tool error]'); }
      return agentTurn(depth + 1);
    }
    pushAi(md(out) + (srcs.length ? '<p class="muted-line">Sumber: ' + srcs.map((x, i) => '<a href="' + esc(x.url) + '">[' + (i + 1) + '] ' + esc(x.title.slice(0, 40)) + '</a>').join(' · ') + '</p>' : ''), out);
  }
  async function reply(text) {
    if (await handleConnectorCommand(text)) return;
    let m;
    if ((m = text.match(/^\/calc\s+(.+)/i))) { try { return pushAi('<p>' + esc(m[1]) + ' = <strong>' + esc(runTalent('calculate', { expression: m[1] })) + '</strong></p>'); } catch (e) { return pushAi('<p>' + esc(e.message) + '</p>'); } }
    if (/^\/waktu/i.test(text)) { try { return pushAi('<p>' + esc(runTalent('datetime')) + '</p>'); } catch (e) { return pushAi('<p>' + esc(e.message) + '</p>'); } }
    if ((m = text.match(/^\/cari\s+(.+)/i))) {
      try {
        const r = await runTalent('web_search', { query: m[1] });
        return pushAi('<p><strong>Hasil untuk “' + esc(m[1]) + '”</strong></p>' + r.split('\n\n').map(b => { const [t, u, ...s] = b.split('\n'); return u ? '<p><a href="' + esc(u) + '">' + esc(t.replace(/^\d+\.\s/, '')) + '</a><br><span class="muted-line">' + esc(s.join(' ')) + '</span></p>' : '<p>' + esc(t) + '</p>'; }).join(''));
      } catch (e) { return pushAi('<p>' + esc(e.message) + '</p>'); }
    }
    if ((m = text.match(/^\/html\s+([\s\S]+)/i))) return pushAi(htmlFrame(m[1]));
    if (!Engine.ok()) return pushAi('<p>Mesin inferensi on-device belum terpasang di build ini, jadi belum ada jawaban AI.</p><p class="muted-line">Perintah lokal tetap jalan: /calc 2+2, /waktu, /cari &lt;kata&gt;, /html &lt;kode&gt;.</p>');
    if (!S.active) return pushAi('<p>Belum ada model aktif. Unduh atau pilih model di tab Models.</p>');
    await agentTurn(0);
  }

  function send() {
    const text = (input.value || '').trim();
    if (!text && !attachment) return;
    if (attachment && !attachment.kind) return toast('File masih dibaca, tunggu sebentar…');
    S.typing = false;
    const att = attachment;
    const msg = { r: 'user', t: text || (att ? ('Lampiran: ' + att.name) : '(lampiran)') };
    if (att) {
      msg.f = att.name;
      if (att.kind === 'image' && att.dataUrl) msg.img = att.dataUrl;
      if (att.text) msg.fileText = att.text;
    }
    S.chat.push(msg);
    input.value = ''; sendBtn.classList.remove('ready'); clearAttachment();
    save(); renderChat();
    const us = $$('.row.user', messages), last = us[us.length - 1]; last && last.classList.add('pop');
    reply(text || msg.t);
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  input.addEventListener('input', () => sendBtn.classList.toggle('ready', input.value.trim().length > 0 || !!attachment));

  function newChat(silent) {
    S.chat = []; S.typing = false; save(); renderChat(); clearAttachment();
    if (!silent) toast('Chat baru dimulai');
  }
  $('#btnNew').addEventListener('click', async () => {
    if (S.chat.length && !(await confirmBox('Mulai chat baru?', 'Percakapan saat ini akan dihapus dari layar dan riwayat.', 'Chat baru', false))) return;
    newChat();
  });

  /* tombol pencarian web */
  const btnWeb = $('#btnWeb');
  function applyWeb() { btnWeb.classList.toggle('on', !!S.web); btnWeb.setAttribute('aria-pressed', String(!!S.web)); updateTop(); }
  btnWeb.addEventListener('click', async () => {
    if (!S.web && !S.webAck) {
      if (!(await confirmBox('Nyalakan pencarian web?', 'Kata kunci dari pesanmu dikirim ke DuckDuckGo agar jawaban lebih akurat. Model tetap berjalan di perangkat. Matikan kapan saja lewat tombol globe.', 'Nyalakan', false))) return;
      S.webAck = true;
    }
    S.web = !S.web; save(); applyWeb(); toast(S.web ? 'Pencarian web aktif' : 'Pencarian web mati');
  });

  /* lampiran — baca isi file/gambar agar bisa dipakai di chat */
  const fileInput = $('#fileInput'), chip = $('#attachChip');
  // attachment shape: { name, size, kind, text?, dataUrl?, mime }
  function clearAttachment() {
    attachment = null;
    chip.hidden = true;
    chip.innerHTML = '';
    fileInput.value = '';
  }
  function isTextish(file) {
    const n = (file.name || '').toLowerCase();
    const t = (file.type || '').toLowerCase();
    if (t.startsWith('text/') || t === 'application/json' || t === 'application/javascript') return true;
    return /\.(txt|md|markdown|json|csv|tsv|log|js|ts|tsx|jsx|py|kt|java|c|cpp|h|hpp|xml|html|htm|css|scss|yml|yaml|toml|ini|cfg|sh|bash|sql|r|go|rs|swift|php|rb)$/i.test(n);
  }
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('gagal baca file'));
      r.readAsDataURL(file);
    });
  }
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('gagal baca file'));
      r.readAsText(file);
    });
  }
  async function setAttachment(file) {
    if (!file) return;
    chip.hidden = false;
    chip.innerHTML = `${ic('file')}<span>Membaca ${esc(file.name)}…</span>`;
    try {
      const mime = file.type || '';
      const att = { name: file.name, size: file.size, mime: mime, kind: 'binary' };
      if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
        att.kind = 'image';
        // resize-ish: still full data url for preview (cap ~4MB raw)
        if (file.size > 6 * 1048576) throw new Error('Gambar terlalu besar (maks ~6 MB)');
        att.dataUrl = await readFileAsDataURL(file);
      } else if (isTextish(file) || file.size < 2 * 1048576) {
        const raw = await readFileAsText(file);
        att.kind = 'text';
        att.text = raw.slice(0, 120000);
        if (raw.length > 120000) att.text += '\n\n…[dipotong]';
      } else if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        att.kind = 'pdf';
        att.text = '[File PDF: ' + file.name + ' — konten biner, model tidak bisa membaca PDF langsung. Ringkas/tempel teksnya jika perlu.]';
      } else {
        att.text = '[File terlampir: ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB, tipe ' + (mime || 'unknown') + ')]';
      }
      attachment = att;
      const preview = att.kind === 'image'
        ? `<img class="attach-thumb" src="${att.dataUrl}" alt="" />`
        : ic('file');
      chip.innerHTML = `${preview}<span>${esc(att.name)} <small>${fmtMB(Math.max(att.size / 1048576, 0.1))}</small></span><button type="button" aria-label="Hapus lampiran">${ic('x')}</button>`;
      const xb = chip.querySelector('button');
      xb && xb.addEventListener('click', () => {
        clearAttachment();
        sendBtn.classList.toggle('ready', input.value.trim().length > 0);
      });
      sendBtn.classList.add('ready');
      S.cache.thumbs = (S.cache.thumbs || 0) + Math.max(att.size / 1048576, 0.5);
      save();
    } catch (e) {
      clearAttachment();
      toast('Gagal membaca file: ' + (e.message || e));
    }
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) setAttachment(f);
  });
    async function openConnectorSheet() {
    const v = await openSheet(
      `<h2>Connector</h2>
      <p class="sub">Token untuk GitHub / Cloudflare / Meta. Dipakai dari chat: <code>/gh</code>, <code>/cf</code>, <code>/connect</code>. Hanya tersimpan di perangkat.</p>
      <label class="lbl">GitHub token (ghp_… / github_pat_…)<input class="field" id="cGh" type="password" autocomplete="off" value="${esc(S.ghToken || '')}" placeholder="github_pat_…" /></label>
      <label class="lbl">GitHub repo (owner/name)<input class="field" id="cRepo" autocomplete="off" value="${esc(S.ghRepo || 'v1-byte/Box-Ai')}" placeholder="v1-byte/Box-Ai" /></label>
      <label class="lbl">Path default di repo<input class="field" id="cPath" autocomplete="off" value="${esc(S.ghPath || 'boxai/')}" placeholder="boxai/" /></label>
      <label class="lbl">Cloudflare tunnel / API URL<input class="field" id="cCf" type="url" autocomplete="off" value="${esc(S.cfUrl || '')}" placeholder="https://….trycloudflare.com" /></label>
      <label class="lbl">Cloudflare API token (opsional)<input class="field" id="cCfTok" type="password" autocomplete="off" value="${esc(S.cfToken || '')}" placeholder="opsional" /></label>
      <label class="lbl">Meta / HF token (opsional)<input class="field" id="cMeta" type="password" autocomplete="off" value="${esc(S.metaToken || S.hfToken || '')}" placeholder="hf_… atau token Meta" /></label>
      <button class="btn primary" data-ok>Simpan</button>
      <button class="btn ghost" data-v="testgh" style="margin-top:8px">Uji GitHub</button>
      <button class="btn ghost" data-close>Batal</button>`,
      (el, close) => {
        $('[data-ok]', el).addEventListener('click', () => close({
          gh: $('#cGh', el).value.trim(),
          repo: $('#cRepo', el).value.trim(),
          path: $('#cPath', el).value.trim(),
          cf: $('#cCf', el).value.trim(),
          cfTok: $('#cCfTok', el).value.trim(),
          meta: $('#cMeta', el).value.trim(),
          test: false
        }));
        const t = $('[data-v=testgh]', el);
        t && t.addEventListener('click', () => close({
          gh: $('#cGh', el).value.trim(),
          repo: $('#cRepo', el).value.trim(),
          path: $('#cPath', el).value.trim(),
          cf: $('#cCf', el).value.trim(),
          cfTok: $('#cCfTok', el).value.trim(),
          meta: $('#cMeta', el).value.trim(),
          test: true
        }));
      }
    );
    if (v == null) return;
    S.ghToken = v.gh || '';
    S.ghRepo = v.repo || 'v1-byte/Box-Ai';
    S.ghPath = v.path || 'boxai/';
    S.cfUrl = v.cf || '';
    S.cfToken = v.cfTok || '';
    if (v.meta) { S.metaToken = v.meta; if (v.meta.startsWith('hf_')) S.hfToken = v.meta; }
    save();
    renderSettings && renderSettings();
    toast('Connector disimpan');
    if (v.test) {
      const r = await ghApi('GET', '/user');
      if (r.ok) pushAi('<p>GitHub OK — login sebagai <strong>' + esc(r.data.login || '?') + '</strong>.</p>');
      else pushAi('<p>GitHub gagal: ' + esc(r.error || String(r.status)) + '</p>');
    }
  }

  async function ghApi(method, path, body) {
    if (!S.ghToken) return { ok: false, error: 'Token GitHub kosong — buka + → Connector' };
    try {
      const r = await fetch('https://api.github.com' + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + S.ghToken,
          'User-Agent': 'BoxAI-Connector',
          'Content-Type': 'application/json'
        },
        body: body != null ? JSON.stringify(body) : undefined
      });
      const text = await r.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      if (!r.ok) return { ok: false, status: r.status, error: (data && (data.message || data.error)) || text.slice(0, 200) };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function lastCodeFromChat() {
    for (let i = S.chat.length - 1; i >= 0; i--) {
      const m = S.chat[i];
      const raw = m.raw || m.t || '';
      const blocks = String(raw).match(/```[\s\S]*?```/g);
      if (blocks && blocks.length) {
        const b = blocks[blocks.length - 1];
        const inner = b.replace(/^```[a-z0-9]*\n?/i, '').replace(/```$/, '');
        return inner;
      }
      if (m.r === 'user' && m.t && m.t.length > 40 && /[{};=]|function |class |import /.test(m.t)) return m.t;
    }
    return '';
  }

  async function handleConnectorCommand(text) {
    const t = text.trim();
    if (/^\/connect\b/i.test(t)) { await openConnectorSheet(); return true; }
    if (/^\/gh\s+status\b/i.test(t) || /^\/gh\s*$/i.test(t)) {
      const r = await ghApi('GET', '/user');
      if (!r.ok) { pushAi('<p>GitHub: ' + esc(r.error) + '</p>'); return true; }
      pushAi('<p><strong>GitHub</strong> · @' + esc(r.data.login) + '<br>Repo: <code>' + esc(S.ghRepo || '-') + '</code><br>Path: <code>' + esc(S.ghPath || 'boxai/') + '</code></p>');
      return true;
    }
    if (/^\/gh\s+gist\b/i.test(t)) {
      const code = lastCodeFromChat();
      if (!code) { pushAi('<p>Tidak ada blok kode di chat untuk di-gist. Minta model tulis kode dulu, atau tempel kode lalu <code>/gh gist</code>.</p>'); return true; }
      const name = (t.replace(/^\/gh\s+gist\s*/i, '').trim() || 'boxai-snippet.txt');
      const r = await ghApi('POST', '/gists', {
        description: 'Box AI gist',
        public: false,
        files: { [name]: { content: code } }
      });
      if (!r.ok) { pushAi('<p>Gist gagal: ' + esc(r.error) + '</p>'); return true; }
      pushAi('<p>Gist dibuat: <a href="' + esc(r.data.html_url) + '">' + esc(r.data.html_url) + '</a></p>');
      return true;
    }
    if (/^\/gh\s+push\b/i.test(t)) {
      const rest = t.replace(/^\/gh\s+push\s*/i, '').trim();
      let path = rest.split(/\s+/)[0] || '';
      let code = lastCodeFromChat();
      if (!path || path === 'push') {
        path = (S.ghPath || 'boxai/') + 'snippet-' + Date.now() + '.txt';
      } else if (!code && rest.indexOf('\n') > -1) {
        code = rest.slice(rest.indexOf('\n') + 1);
      }
      if (!code) { pushAi('<p>Tidak ada konten untuk di-push. Sediakan blok kode di chat, lalu <code>/gh push path/file.ext</code>.</p>'); return true; }
      const repo = S.ghRepo || 'v1-byte/Box-Ai';
      const [owner, name] = repo.split('/');
      if (!owner || !name) { pushAi('<p>Repo tidak valid. Set di + → Connector.</p>'); return true; }
      path = path.replace(/^\//, '');
      // get sha if exists
      let sha;
      const existing = await ghApi('GET', '/repos/' + owner + '/' + name + '/contents/' + path);
      if (existing.ok && existing.data && existing.data.sha) sha = existing.data.sha;
      const body = {
        message: 'chore(boxai): update ' + path,
        content: btoa(unescape(encodeURIComponent(code))),
        branch: 'main'
      };
      if (sha) body.sha = sha;
      const r = await ghApi('PUT', '/repos/' + owner + '/' + name + '/contents/' + path, body);
      if (!r.ok) { pushAi('<p>Push gagal: ' + esc(r.error) + '</p>'); return true; }
      const url = (r.data && r.data.content && r.data.content.html_url) || ('https://github.com/' + repo + '/blob/main/' + path);
      pushAi('<p>Push OK → <a href="' + esc(url) + '"><code>' + esc(path) + '</code></a></p>');
      return true;
    }
    if (/^\/gh\s+issue\b/i.test(t)) {
      const title = t.replace(/^\/gh\s+issue\s*/i, '').trim() || 'Issue dari Box AI';
      const repo = S.ghRepo || 'v1-byte/Box-Ai';
      const [owner, name] = repo.split('/');
      const body = lastCodeFromChat() || 'Dilaporkan dari Box AI chat.';
      const r = await ghApi('POST', '/repos/' + owner + '/' + name + '/issues', { title, body });
      if (!r.ok) { pushAi('<p>Issue gagal: ' + esc(r.error) + '</p>'); return true; }
      pushAi('<p>Issue #' + esc(String(r.data.number)) + ': <a href="' + esc(r.data.html_url) + '">' + esc(r.data.title) + '</a></p>');
      return true;
    }
    if (/^\/cf\s+status\b/i.test(t) || /^\/cf\s*$/i.test(t)) {
      if (!S.cfUrl) { pushAi('<p>Cloudflare URL kosong — + → Connector.</p>'); return true; }
      try {
        const base = S.cfUrl.replace(/\/$/, '');
        const r = await fetch(base + '/manifest.json', { method: 'GET' });
        pushAi('<p>Cloudflare <code>' + esc(base) + '</code> → HTTP ' + r.status + (r.ok ? ' (manifest OK)' : '') + '</p>');
      } catch (e) {
        pushAi('<p>Cloudflare gagal: ' + esc(e.message) + '</p>');
      }
      return true;
    }
    return false;
  }

  $('#btnAttach').addEventListener('click', async () => {
    const v = await openSheet(`<h2>Lampirkan & Connector</h2><div style="height:6px"></div>
      <button class="opt" data-v="conn"><span class="o-txt">Connector<small>Token GitHub · Cloudflare · Meta · push/gist</small></span></button>
      <button class="opt" data-v="photo"><span class="o-txt">Foto / galeri<small>Gambar untuk dibahas di chat</small></span></button>
      <button class="opt" data-v="camera"><span class="o-txt">Kamera<small>Ambil foto baru</small></span></button>
      <button class="opt" data-v="file"><span class="o-txt">File<small>PDF, TXT, dan lainnya</small></span></button>`,
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (!v) return;
    if (v === 'conn') { await openConnectorSheet(); return; }
    fileInput.accept = v === 'file' ? '' : 'image/*';
    if (v === 'camera') fileInput.setAttribute('capture', 'environment'); else fileInput.removeAttribute('capture');
    fileInput.click();
  });

  /* ================= MODELS ================= */
  let filter = 'all';
  const dlProg = {}; const dlIds = {}; const dlState = {}; // run|pause|done
  function renderDlPanel() {
    let panel = $('#dlPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'dlPanel';
      panel.className = 'dl-panel';
      const host = document.querySelector('#screen-models .scroll') || document.body;
      host.insertBefore(panel, host.firstChild);
    }
    const ids = Object.keys(dlState).filter(id => dlState[id] === 'run' || dlState[id] === 'pause');
    if (!ids.length) { panel.hidden = true; panel.innerHTML = ''; return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="dl-panel-title">Unduhan aktif</div>' + ids.map(id => {
      const m = model(id);
      const st = dlState[id];
      const p = Math.max(0, Math.min(100, Math.round(dlProg[id] || 0)));
      const name = (m && m.short) ? m.short : id;
      const controls = st === 'pause'
        ? `<button type="button" class="btn-dl-ctrl play" data-dl="${esc(id)}" data-act="resume">▶ Lanjut</button>
           <button type="button" class="btn-dl-ctrl danger" data-dl="${esc(id)}" data-act="cancel">✕</button>`
        : `<button type="button" class="btn-dl-ctrl" data-dl="${esc(id)}" data-act="pause">⏸ Jeda</button>
           <button type="button" class="btn-dl-ctrl danger" data-dl="${esc(id)}" data-act="cancel">✕</button>`;
      return `<div class="dl-panel-row" data-id="${esc(id)}">
        <div class="dl-panel-meta"><strong>${esc(name)}</strong>
          <div class="dl-bar ${st === 'pause' ? 'paused' : ''}"><i style="width:${p}%"></i></div>
          <span class="dl-pct">${p}%${st === 'pause' ? ' · dijeda' : ' · mengunduh'}</span>
        </div>
        <div class="dl-actions">${controls}</div>
      </div>`;
    }).join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#dlPanel [data-act]');
    if (!b) return;
    const id = b.getAttribute('data-dl');
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.act === 'pause') pauseDownload(id);
    else if (b.dataset.act === 'resume') resumeDownload(id);
    else if (b.dataset.act === 'cancel') cancelDownload(id);
  }, true);
  const QRE = /(IQ\d_[A-Z0-9_]+|Q\d_[A-Z0-9_]+|BF16|F16|F32)/i;
  const modelId = f => 'm_' + f.replace(/[^a-z0-9]/gi, '_');
  const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' jt' : n >= 1e3 ? Math.round(n / 1e3) + ' rb' : String(n || 0);
  function reg(file, size, src, url) {
    const id = modelId(file); let m = MODELS.find(x => x.id === id);
    if (!m) {
      const q = (file.match(QRE) || ['GGUF'])[0].toUpperCase(), stem = file.replace(/\.gguf$/i, '');
      m = { id, name: stem, short: stem.length > 22 ? stem.slice(0, 21) + '…' : stem, meta: q, gb: size / 1073741824, src, url, file };
      MMETA_DEF[id] = { file, arch: 'GGUF', quant: q, ctx: 4096, tpl: 'chatml' };
      MODELS.push(m);
    } else { if (size) m.gb = size / 1073741824; if (url && !m.url) m.url = url; }
    return m;
  }
  function applyModelList(a, srcDefault) {
    if (!Array.isArray(a)) a = [];
    const have = new Set();
    a.forEach(f => {
      if (!f || !f.name) return;
      if ((f.size || 0) > 0 && f.size < 5 * 1048576) return; // skip < 5MB
      const id = modelId(f.name);
      have.add(id);
      const src = f.source || srcDefault || 'local';
      reg(f.name, f.size || 0, src);
      S.dl[id] = true;
      // Prefer absolute path so generate can load external / Pocket AI files
      const fileRef = (f.path && String(f.path).charAt(0) === '/') ? f.path : (f.path || f.name);
      if (MMETA_DEF[id]) { MMETA_DEF[id].file = fileRef; MMETA_DEF[id].path = f.path || fileRef; MMETA_DEF[id].source = src; }
      else MMETA_DEF[id] = { file: fileRef, path: f.path || fileRef, source: src, arch: 'GGUF', quant: 'GGUF', ctx: 2048, tpl: 'chatml' };
    });
    for (let i = MODELS.length - 1; i >= 0; i--) {
      const m = MODELS[i];
      if (!have.has(m.id) && dlProg[m.id] == null) {
        delete S.dl[m.id];
        if (m.src === 'local' || m.src === 'pocketai' || m.src === 'download' || m.src === 'external' || m.src === 'other_app') MODELS.splice(i, 1);
      }
    }
    if (S.active && !have.has(S.active)) S.active = '';
    if (!S.active && have.size) S.active = [...have][0];
    save();
    updateTop();
    return have.size;
  }
  function syncLocal() {
    if (!NATIVE) return 0;
    let a = [];
    try { a = JSON.parse(NATIVE.listModels() || '[]'); } catch (e) { a = []; }
    return applyModelList(a, 'local');
  }
  /** Scan semua lokasi (Pocket AI, Download, model ai, APK lain) — untuk tombol Terunduh / Pindai */
  function syncLocalDeep() {
    if (!NATIVE) return 0;
    let a = [];
    try {
      if (NATIVE.listModelsDeep) a = JSON.parse(NATIVE.listModelsDeep() || '[]');
      else a = JSON.parse(NATIVE.listModels() || '[]');
    } catch (e) { a = []; }
    return applyModelList(a, 'external');
  }
  const nativeInfo = () => { try { return JSON.parse(NATIVE.info()); } catch (e) { return {}; } };
  const cacheMB = () => (nativeInfo().cache || 0) / 1048576;
  /* ---- Hugging Face Hub ---- */
  let hubLoaded = false, hubT;
  const hfHead = () => S.hfToken ? { Authorization: 'Bearer ' + S.hfToken } : {};
  async function hfSearch(q) {
    hubLoaded = true; const L = $('#hubList'); L.innerHTML = '<p class="empty">Mencari…</p>';
    try {
      const r = await fetch('https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=20&search=' + encodeURIComponent(q), { headers: hfHead() });
      if (!r.ok) throw new Error(r.status);
      const a = await r.json();
      L.innerHTML = a.length ? a.map(x => `<article class="model-card" data-repo="${esc(x.id)}"><div class="m-ico">${ic('cube')}</div><div class="model-info"><strong>${esc(x.id.split('/')[1] || x.id)}</strong><span>${esc(x.id.split('/')[0])} · ${fmtN(x.downloads)} unduhan · ${fmtN(x.likes)} suka</span></div>${ic('chev', 'chev')}</article>`).join('') : '<p class="empty">Tidak ada hasil.</p>';
    } catch (e) { hubLoaded = false; L.innerHTML = '<p class="empty">Gagal memuat Hugging Face. Periksa koneksi internet.</p>'; }
  }
  async function hfRepo(repo) {
    let files;
    try {
      const r = await fetch('https://huggingface.co/api/models/' + repo + '/tree/main', { headers: hfHead() });
      if (r.status === 401 || r.status === 403) return toast('Model gated. Isi token Hugging Face di Settings.');
      if (!r.ok) throw new Error(r.status);
      files = (await r.json()).filter(f => f.type === 'file' && /\.gguf$/i.test(f.path)).sort((a, b) => a.size - b.size);
    } catch (e) { return toast('Gagal membaca daftar file'); }
    if (!files.length) return toast('Repo ini tidak punya file GGUF');
    const v = await openSheet(`<h2>${esc(repo.split('/')[1] || repo)}</h2><p class="sub">Pilih kuantisasi. Q4_K_M biasanya seimbang.</p>` +
      files.map((f, i) => `<button class="opt" data-v="${i}"><span class="o-txt">${esc(f.path.split('/').pop())}<small>${fmtGB(f.size / 1073741824)}</small></span>${ic('down')}</button>`).join('') + '<button class="btn ghost" data-close>Tutup</button>',
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (v == null) return;
    const f = files[+v], name = f.path.split('/').pop(), m = reg(name, f.size, 'hub', 'https://huggingface.co/' + repo + '/resolve/main/' + encodeURI(f.path));
    if (S.dl[m.id]) return toast('Model ini sudah ada di perangkat');
    startDownload(m.id);
  }
  $('#hubList').addEventListener('click', e => { const c = e.target.closest('.model-card[data-repo]'); if (c && c.dataset.repo) hfRepo(c.dataset.repo); });
  $('#hfq').addEventListener('input', e => { clearTimeout(hubT); hubT = setTimeout(() => hfSearch(e.target.value.trim()), 450); });

  /* ================= CONNECTORS (GitHub / Cloudflared / R2) ================= */
  let connCache = { gh: null, cf: null, r2: null };
  function remoteCard(m) {
    const local = MODELS.find(x => x.file === m.name || x.name === m.name.replace(/\.gguf$/i, ''));
    const id = local ? local.id : modelId(m.name);
    const has = !!(local && S.dl[id]);
    const size = m.size ? fmtGB(m.size / 1073741824) : '—';
    const src = m.source || 'remote';
    const st = dlState[id];
    const prog = dlProg[id];
    let actions;
    let bar = '';
    if (has) {
      actions = `<button type="button" class="btn-use" data-act="use">Gunakan</button>`;
    } else if (st === 'run' || (prog != null && st !== 'pause')) {
      const p = Math.max(0, Math.min(100, Math.round(prog || 0)));
      bar = `<div class="dl-bar"><i style="width:${p}%"></i><span>${p}%</span></div>`;
      actions = `<div class="dl-actions">
        <button type="button" class="btn-dl-ctrl" data-act="pause">⏸</button>
        <button type="button" class="btn-dl-ctrl danger" data-act="cancel">✕</button></div>`;
    } else if (st === 'pause') {
      const p = Math.max(0, Math.min(100, Math.round(prog || 0)));
      bar = `<div class="dl-bar paused"><i style="width:${p}%"></i><span>${p}% · jeda</span></div>`;
      actions = `<div class="dl-actions">
        <button type="button" class="btn-dl-ctrl play" data-act="resume">▶</button>
        <button type="button" class="btn-dl-ctrl danger" data-act="cancel">✕</button></div>`;
    } else {
      actions = `<button type="button" class="btn-dl" data-act="rdl" title="Unduh">▶ Unduh</button>`;
    }
    return `<article class="model-card" data-id="${esc(id)}" data-remote="1" data-url="${esc(m.url)}" data-file="${esc(m.name)}" data-size="${m.size || 0}" data-src="${esc(src)}">
      <div class="m-ico">${ic('cube')}</div>
      <div class="model-info"><strong>${esc(m.name)}</strong><span>${esc(src)} · ${size}</span>${bar}</div>
      ${actions}</article>`;
  }
  function renderRemoteList(list, emptyMsg) {
    const L = $('#hubList');
    if (!list || !list.length) {
      L.innerHTML = '<p class="empty">' + esc(emptyMsg || 'Tidak ada model .gguf') + '</p>';
      return;
    }
    // Dedup by name+size
    const map = new Map();
    list.forEach(m => {
      if (!m || !m.name || !/\.gguf$/i.test(m.name)) return;
      const k = m.name.toLowerCase() + '-' + (m.size || 0);
      if (!map.has(k)) map.set(k, m);
    });
    const arr = Array.from(map.values());
    L.innerHTML = '<p class="muted-line" style="margin:8px 12px">' + arr.length + ' model remote · unduh dicek agar tidak dobel dengan Terunduh</p>' +
      arr.map(remoteCard).join('');
  }
  async function loadGithubModels() {
    const L = $('#hubList');
    L.innerHTML = '<p class="empty">Memuat GitHub Releases…</p>';
    const repo = (S.ghRepo || 'v1-byte/Box-Ai').trim();
    try {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'BoxAI-Connector' };
      if (S.ghToken) headers.Authorization = 'Bearer ' + S.ghToken;
      const r = await fetch('https://api.github.com/repos/' + encodeURI(repo) + '/releases?per_page=20', { headers });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const models = [];
      (data || []).forEach(rel => {
        (rel.assets || []).forEach(a => {
          if (a.name && /\.gguf$/i.test(a.name)) {
            models.push({ name: a.name, url: a.browser_download_url, size: a.size || 0, source: 'github' });
          }
        });
      });
      connCache.gh = models;
      renderRemoteList(models, 'Tidak ada aset .gguf di releases repo ' + repo);
    } catch (e) {
      L.innerHTML = '<p class="empty">Gagal GitHub: ' + esc(e.message) + '. Atur repo/token di Settings.</p>';
    }
  }
  async function loadManifestModels(kind) {
    const L = $('#hubList');
    const base = (kind === 'cf' ? S.cfUrl : S.r2Url) || '';
    const typed = ($('#connUrl') && $('#connUrl').value.trim()) || '';
    let url = (typed || base || '').replace(/\/$/, '');
    if (!url) {
      L.innerHTML = '<p class="empty">Isi URL ' + (kind === 'cf' ? 'Cloudflare Tunnel' : 'R2') + ' di kolom atas atau Settings, contoh: https://xxx.trycloudflare.com</p>';
      return;
    }
    if (typed) {
      if (kind === 'cf') S.cfUrl = typed; else S.r2Url = typed;
      save();
    }
    L.innerHTML = '<p class="empty">Memuat manifest…</p>';
    try {
      let listUrl = url;
      if (!/manifest\.json$/i.test(listUrl)) listUrl = url + '/manifest.json';
      const r = await fetch(listUrl, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('manifest HTTP ' + r.status);
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error('manifest harus array JSON');
      const models = list.map(m => ({
        name: m.name,
        url: m.url || (url + '/' + m.name),
        size: m.size || 0,
        source: kind === 'cf' ? 'cloudflared' : 'r2'
      })).filter(m => m.name && /\.gguf$/i.test(m.name));
      connCache[kind] = models;
      renderRemoteList(models, 'Manifest kosong / tanpa .gguf');
    } catch (e) {
      L.innerHTML = '<p class="empty">Gagal ' + kind + ': ' + esc(e.message) + '</p>';
    }
  }
  function startRemoteDownload(file, url, size, source) {
    if (!NATIVE) return toast('Hanya di aplikasi Android');
    // Anti-dobel: sudah ada lokal dengan nama sama
    const existing = MODELS.find(x => (x.file || '').toLowerCase() === file.toLowerCase() || x.name.toLowerCase() === file.replace(/\.gguf$/i, '').toLowerCase());
    if (existing && S.dl[existing.id]) return toast('Sudah ada di perangkat — tidak unduh ulang');
    const m = reg(file, size || 0, source || 'remote', url);
    if (S.dl[m.id]) return toast('Sudah terunduh');
    startDownload(m.id);
  }
  $('#hubList').addEventListener('click', e => {
    const card = e.target.closest('.model-card[data-remote]');
    if (!card) return;
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = card.dataset.id;
    if (act.dataset.act === 'rdl') {
      startRemoteDownload(card.dataset.file, card.dataset.url, +card.dataset.size || 0, card.dataset.src);
      renderDlPanel();
    } else if (act.dataset.act === 'use') {
      if (S.dl[id]) useModel(id);
    } else if (act.dataset.act === 'pause') pauseDownload(id);
    else if (act.dataset.act === 'resume') resumeDownload(id);
    else if (act.dataset.act === 'cancel') cancelDownload(id);
  });
  $('#connUrl') && $('#connUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (filter === 'cf') loadManifestModels('cf');
      else if (filter === 'r2') loadManifestModels('r2');
    }
  });


  function modelCard(m) {
    const has = !!S.dl[m.id], act = S.active === m.id, prog = dlProg[m.id];
    const st = dlState[m.id] || (prog != null ? 'run' : '');
    let right = '';
    let bar = '';
    if (act) {
      right = '<span class="tag ok"><i></i>Aktif</span>';
    } else if (has) {
      right = '<button type="button" class="btn-use" data-act="use" title="Gunakan model ini">Gunakan</button>';
    } else if (st === 'run' || (prog != null && st !== 'pause')) {
      const p = Math.max(0, Math.min(100, Math.round(prog || 0)));
      bar = `<div class="dl-bar"><i style="width:${p}%"></i><span>${p}%</span></div>`;
      right = `<div class="dl-actions">
        <button type="button" class="btn-dl-ctrl" data-act="pause" title="Jeda">⏸</button>
        <button type="button" class="btn-dl-ctrl danger" data-act="cancel" title="Batal">✕</button>
      </div>`;
    } else if (st === 'pause') {
      const p = Math.max(0, Math.min(100, Math.round(prog || 0)));
      bar = `<div class="dl-bar paused"><i style="width:${p}%"></i><span>${p}% · jeda</span></div>`;
      right = `<div class="dl-actions">
        <button type="button" class="btn-dl-ctrl play" data-act="resume" title="Lanjutkan">▶</button>
        <button type="button" class="btn-dl-ctrl danger" data-act="cancel" title="Batal">✕</button>
      </div>`;
    } else if (m.url) {
      right = `<button type="button" class="btn-dl" data-act="dl" title="Unduh">▶</button>`;
    }
    return `<article class="model-card ${act ? 'installed' : ''} ${has ? 'ready' : ''}" data-id="${m.id}">
      <div class="m-ico">${ic('cube')}</div>
      <div class="model-info"><strong>${esc(mname(m))}</strong><span>${m.meta || 'GGUF'} · ${fmtGB(m.gb)}</span>${bar}</div>${right}</article>`;
  }
  function renderModels() {
    const remote = filter === 'hub' || filter === 'gh' || filter === 'cf' || filter === 'r2';
    $('#hfBox').hidden = filter !== 'hub';
    if ($('#connBox')) $('#connBox').hidden = !(filter === 'cf' || filter === 'r2');
    $('#hubList').hidden = !remote; $('#modelList').hidden = remote;
    if (filter === 'hub') { if (!hubLoaded) hfSearch(''); return; }
    if (filter === 'gh') { loadGithubModels(); return; }
    if (filter === 'cf') { loadManifestModels('cf'); return; }
    if (filter === 'r2') { loadManifestModels('r2'); return; }
    let list = MODELS.slice();
    if (S.sort === 'size') list.sort((a, b) => a.gb - b.gb); else if (S.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (filter === 'dl') list = list.filter(m => S.dl[m.id]);
        const ready = list.filter(m => S.dl[m.id]), avail = list.filter(m => !S.dl[m.id]);
    let h = '';
    if (ready.length) h += '<h3 class="section-h">Siap di perangkat</h3>' + ready.map(modelCard).join('');
    if (avail.length) h += '<h3 class="section-h">Tersedia</h3>' + avail.map(modelCard).join('');
    if (!h) h = '<p class="empty">Belum ada model. Buka HF Hub untuk mencari dan mengunduh model GGUF.</p>';
    $('#modelList').innerHTML = h;
  }
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    $$('.chip').forEach(x => x.classList.remove('active')); c.classList.add('active');
    filter = c.dataset.f;
    if (filter === 'dl' && NATIVE && NATIVE.listModelsDeep) {
      toast('Memuat model terunduh dari seluruh perangkat…');
      setTimeout(() => {
        try { syncLocalDeep(); renderModels(); updateTop(); } catch (e) {}
      }, 50);
    } else renderModels();
  }));
  function trackDownload(id, did) {
    dlIds[id] = did;
    dlState[id] = 'run';
    const m = model(id);
    const tick = setInterval(() => {
      if (dlState[id] === 'pause') { renderDlPanel(); return; }
      let s = {}; try { s = JSON.parse(NATIVE.status(did)); } catch (e) { }
      if (s.s === 4) { // paused native
        dlState[id] = 'pause';
        if (s.t > 0) dlProg[id] = s.b / s.t * 100;
        renderDlPanel(); renderModels();
        return;
      }
      if (s.s === 8) {
        clearInterval(tick);
        delete dlProg[id]; delete dlIds[id]; dlState[id] = 'done';
        const finish = () => { syncLocal(); renderModels(); renderSettings(); updateTop(); };
        finish();
        setTimeout(finish, 400);
        setTimeout(() => { finish(); renderDlPanel(); toast(m.short + ' siap — ketuk Gunakan'); }, 900);
      } else if (s.s === 16) {
        clearInterval(tick);
        delete dlProg[id]; delete dlIds[id]; delete dlState[id];
        renderDlPanel(); renderModels();
        let err = (s.err || '');
        try { if (!err && NATIVE.lastDownloadError) err = NATIVE.lastDownloadError(); } catch (e) {}
        toast(err ? ('Unduhan gagal: ' + err) : 'Unduhan gagal / dibatalkan');
      } else {
        dlState[id] = 'run';
        dlProg[id] = s.t > 0 ? (s.b / s.t * 100) : Math.min(99, (dlProg[id] || 0) + 0.5);
        renderDlPanel();
        const card = document.querySelector(`.model-card[data-id="${id}"]`);
        if (card) {
          const p = Math.round(dlProg[id]);
          const bar = card.querySelector('.dl-bar i');
          const sp = card.querySelector('.dl-bar span');
          if (bar) bar.style.width = p + '%';
          if (sp) sp.textContent = p + '%';
        }
        // Update panel pct text live
        const row = document.querySelector(`#dlPanel .dl-panel-row[data-id="${id}"]`);
        if (row) {
          const p = Math.round(dlProg[id] || 0);
          const bi = row.querySelector('.dl-bar i');
          const pct = row.querySelector('.dl-pct');
          if (bi) bi.style.width = p + '%';
          if (pct) pct.textContent = p + '% · mengunduh';
        }
      }
    }, 500);
    // store interval id lightly
    dlIds['t_' + id] = tick;
  }
  function startDownload(id) {
    const m = model(id);
    if (!NATIVE) return toast('Unduhan hanya di aplikasi Android (bukan browser)');
    if (S.dl[id]) return toast('Model sudah ada di perangkat');
    if (!m.url) return toast('URL unduhan tidak ada untuk model ini');
    if (dlState[id] === 'run') return toast('Sedang mengunduh…');
    const fileName = String(m.file || (m.name + '.gguf')).split('/').pop();
    const tok = (m.url && m.url.indexOf('github') >= 0 && S.ghToken) ? S.ghToken : (S.hfToken || '');
    // Tampilkan panel dulu (sebelum native) agar user langsung lihat proses
    dlProg[id] = 0;
    dlState[id] = 'run';
    renderDlPanel();
    renderModels();
    toast('Unduhan cepat dimulai · multi-koneksi · notifikasi sistem');
    let did = -1;
    try {
      did = NATIVE.startDownload(m.url, fileName, tok);
    } catch (e) {
      delete dlProg[id]; delete dlState[id];
      renderDlPanel();
      return toast('Gagal mulai unduhan: ' + (e.message || e));
    }
    if (did < 0) {
      let err = '';
      try { err = NATIVE.lastDownloadError ? NATIVE.lastDownloadError() : ''; } catch (e) {}
      delete dlProg[id]; delete dlState[id];
      renderDlPanel();
      return toast(err || 'Nama file / URL tidak valid');
    }
    trackDownload(id, did);
  }
  function pauseDownload(id) {
    const did = dlIds[id];
    if (did == null || !NATIVE.pauseDownload) return;
    NATIVE.pauseDownload(did);
    dlState[id] = 'pause';
    clearInterval(dlIds['t_' + id]);
    renderDlPanel(); renderModels(); toast('Unduhan dijeda');
  }
  function resumeDownload(id) {
    const m = model(id);
    if (!NATIVE) return;
    // DownloadManager: lanjut = enqueue ulang (sistem background)
    delete dlProg[id]; delete dlIds[id]; delete dlState[id];
    if (m && m.url) {
      toast('Melanjutkan unduhan di background…');
      startDownload(id);
    } else toast('URL model hilang — pilih unduh ulang dari Hub');
  }
  function cancelDownload(id) {
    const did = dlIds[id];
    if (did != null) try { NATIVE.cancel(did); } catch (e) {}
    clearInterval(dlIds['t_' + id]);
    delete dlProg[id]; delete dlIds[id]; delete dlState[id]; delete dlIds['t_' + id];
    renderDlPanel(); renderModels(); toast('Unduhan dibatalkan');
  }
  function useModel(id) {
    if (!S.dl[id]) return toast('Model belum terunduh');
    S.active = id; save(); updateTop(); renderModels(); renderSettings();
    toast(model(id).short + ' dipakai');
    try { go('chat'); } catch (e) {}
  }
  async function modelSheet(id) {
    const m = model(id), has = !!S.dl[id], act = S.active === id;
    const v = await openSheet(`<h2>${esc(mname(m))}</h2><p class="sub">Model bahasa lokal berformat GGUF.</p>
      <div class="kv"><span>Parameter</span><span>${m.meta}</span></div>
      <div class="kv"><span>Ukuran file</span><span>${fmtGB(m.gb)}</span></div>
      <div class="kv"><span>Sumber</span><span>${m.src === 'hub' ? 'HF Hub' : 'Perangkat'}</span></div>
      <div class="kv"><span>Status</span><span>${act ? 'Aktif' : has ? ('Terunduh' + (m.src && m.src !== 'local' && m.src !== 'hub' ? ' · ' + m.src : '')) : dlProg[id] != null ? 'Mengunduh' : 'Belum diunduh'}</span></div>
      ${!has ? '<button class="btn primary" data-v="dl">Unduh ' + fmtGB(m.gb) + '</button>' : ''}
      ${has && !act ? '<button class="btn primary" data-v="use">Gunakan model ini</button><button class="btn danger" data-v="del" style="margin-top:8px">Hapus dari perangkat</button>' : ''}
      ${act ? '<button class="btn ghost" data-v="del">Hapus dari perangkat</button>' : ''}
      ${has ? '<button class="btn ghost" data-v="files">Lihat file di Pencari</button>' : ''}
      <button class="btn ghost" data-close>Tutup</button>`,
      (el, close) => $$('[data-v]', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (v === 'dl') startDownload(id);
    else if (v === 'files') { prevFinder = 'models'; cwd = ROOT + '/models'; go('finder'); }
    else if (v === 'use') useModel(id);
    else if (v === 'del') {
      if (act) { toast('Model aktif tidak bisa dihapus. Pilih model lain dulu.'); return; }
      if (await confirmBox('Hapus ' + m.short + '?', 'File model ' + fmtGB(m.gb) + ' dihapus dari perangkat. Kamu bisa mengunduhnya lagi.', 'Hapus', true)) {
        NATIVE && NATIVE.deleteModel(meta(id).file); syncLocal(); renderModels(); renderSettings(); toast(m.short + ' dihapus');
      }
    }
  }
  $('#modelList').addEventListener('click', e => {
    const card = e.target.closest('.model-card'); if (!card) return;
    const id = card.dataset.id, a = e.target.closest('[data-act]');
    if (!a) { modelSheet(id); return; }
    if (a.dataset.act === 'dl') return startDownload(id);
    if (a.dataset.act === 'pause') return pauseDownload(id);
    if (a.dataset.act === 'resume') return resumeDownload(id);
    if (a.dataset.act === 'cancel') return cancelDownload(id);
    if (a.dataset.act === 'use') return useModel(id);
  });
  $('#btnModelMenu').addEventListener('click', async () => {
    const v = await openSheet(`<h2>Opsi model</h2><div style="height:6px"></div>
      <button class="opt" data-v="sort">${ic('sort')}<span class="o-txt">Urutkan<small>Saat ini: ${{ default: 'bawaan', size: 'ukuran', name: 'nama' }[S.sort]}</small></span></button>
      <button class="opt" data-v="refresh">${ic('refresh')}<span class="o-txt">Segarkan daftar</span></button>
      <button class="opt" data-v="files">${ic('folder')}<span class="o-txt">Buka folder model<small>/pencari/models</small></span></button>
      <button class="opt" data-v="clean">${ic('clean')}<span class="o-txt">Pembersih penyimpanan<small>Hapus cache dan model yang tidak dipakai</small></span></button>`,
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (v === 'sort') {
      const s = await choose('Urutkan model', [{ v: 'default', l: 'Bawaan' }, { v: 'size', l: 'Ukuran terkecil dulu' }, { v: 'name', l: 'Nama A–Z' }], S.sort);
      if (s) { S.sort = s; save(); renderModels(); }
    } else if (v === 'refresh') { const el = screens.models; $('#modelList').innerHTML = ''; el.classList.remove('revealed'); skeleton(el); setTimeout(renderModels, 0); }
    else if (v === 'clean') { prevScreen = 'models'; go('clean'); }
    else if (v === 'files') { prevFinder = 'models'; cwd = ROOT + '/models'; go('finder'); }
  });

  /* ================= PALS ================= */
  function renderPals() {
    $('#palList').innerHTML = allPals().map(p => `<article class="pal-card" data-id="${p.id}">
      <div class="pal-icon">${ic(p.icon)}</div>
      <div class="model-info"><strong>${esc(p.name)}</strong><span>${esc(p.desc || 'Pal buatan sendiri')}${S.pal === p.id ? ' · Dipakai' : ''}</span></div>${ic('chev', 'chev')}</article>`).join('');
  }
  $('#palList').addEventListener('click', async e => {
    const card = e.target.closest('.pal-card'); if (!card) return;
    const p = allPals().find(x => x.id === card.dataset.id), custom = S.pals.some(x => x.id === p.id);
    const v = await openSheet(`<h2>${esc(p.name)}</h2><p class="sub">${esc(p.prompt)}</p>
      <button class="btn primary" data-v="start">Mulai chat dengan ${esc(p.name)}</button>
      ${custom ? '<button class="btn danger" data-v="del" style="margin-top:8px">Hapus Pal</button>' : ''}
      <button class="btn ghost" data-close>Tutup</button>`,
      (el, close) => $$('[data-v]', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (v === 'start') { S.pal = p.id === 'chat' ? null : p.id; save(); newChat(true); updateTop(); renderPals(); go('chat'); toast(p.name + ' siap membantu'); }
    if (v === 'del' && await confirmBox('Hapus ' + p.name + '?', 'Pal ini akan dihapus permanen.', 'Hapus', true)) {
      S.pals = S.pals.filter(x => x.id !== p.id); if (S.pal === p.id) { S.pal = null; updateTop(); } save(); renderPals(); toast('Pal dihapus');
    }
  });
  $('#btnAddPal').addEventListener('click', async () => {
    const v = await openSheet(`<h2>Pal baru</h2><p class="sub">Beri nama dan arahan singkat untuk asistenmu.</p>
      <input class="field" id="pn" maxlength="24" placeholder="Nama, misalnya Penerjemah" />
      <textarea class="field" id="pp" rows="3" maxlength="240" placeholder="Arahan: kamu penerjemah Indonesia–Inggris yang akurat."></textarea>
      <button class="btn primary" data-ok>Simpan Pal</button><button class="btn ghost" data-close>Batal</button>`,
      (el, close) => $('[data-ok]', el).addEventListener('click', () => {
        const n = $('#pn', el).value.trim(), pr = $('#pp', el).value.trim();
        if (!n) { $('#pn', el).focus(); toast('Isi nama Pal dulu'); return; }
        close({ n, pr });
      }));
    if (!v) return;
    const icons = ['spark', 'bolt', 'cube', 'chat'];
    S.pals.push({ id: 'p' + Date.now(), name: v.n, desc: '', icon: icons[S.pals.length % icons.length], prompt: v.pr || 'Asisten khusus buatanmu.' });
    save(); renderPals(); toast('Pal ' + v.n + ' disimpan');
  });

  /* ================= SETTINGS ================= */
  const THEME_L = { system: 'Sistem', dark: 'Gelap', light: 'Terang' };
  const LANG_L = { id: 'Indonesia', en: 'English' };
  function cleanableSafe() { const c = S.cache; return c.kv + c.tmp + c.thumbs + c.logs; }
  function renderSettings() {
    $('#v-theme').textContent = THEME_L[S.theme];
    $('#v-lang').textContent = LANG_L[S.lang];
    $('#swHaptics').checked = S.haptics;
    $('#v-model').textContent = model(S.active).short;
    $('#v-temp').textContent = String(S.temp).replace('.', ',');
    $('#v-topp').textContent = String(S.topp).replace('.', ',');
    $('#v-maxTok').textContent = S.maxTok;
    $('#v-ctx').textContent = S.ctx;
    $('#v-sys').textContent = S.sysPrompt ? (S.sysPrompt.length > 16 ? S.sysPrompt.slice(0, 16) + '…' : S.sysPrompt) : 'Kosong';
    $('#v-hf').textContent = S.hfToken ? 'Tersimpan' : 'Belum diatur';
    const vgh = $('#v-gh'); if (vgh) vgh.textContent = S.ghRepo || 'v1-byte/Box-Ai';
    const vght = $('#v-ght'); if (vght) vght.textContent = S.ghToken ? 'Tersimpan' : 'Opsional';
    const vcf = $('#v-cf'); if (vcf) vcf.textContent = S.cfUrl ? S.cfUrl.slice(0, 28) + (S.cfUrl.length > 28 ? '…' : '') : 'Belum diatur';
    const vr2 = $('#v-r2'); if (vr2) vr2.textContent = S.r2Url ? S.r2Url.slice(0, 28) + (S.r2Url.length > 28 ? '…' : '') : 'Belum diatur';
    const b = $('#v-onDevice'); b.textContent = S.onDevice ? 'ON' : 'OFF';
    b.style.color = S.onDevice ? '' : 'var(--bad)'; b.style.background = S.onDevice ? '' : 'rgba(255,93,108,.12)';
    $('#finderHint').textContent = MODELS.filter(m => S.dl[m.id]).length + ' model terunduh · ' + ROOT;
    $('#cleanHint').textContent = cleanableSafe() > 1 ? fmtMB(cleanableSafe()) + ' cache bisa dibersihkan' : 'Penyimpanan sudah bersih';
    const verEl = document.getElementById('v-appVer');
    if (verEl) verEl.textContent = APP_VERSION;
  }
  $('#swHaptics').addEventListener('change', e => { S.haptics = e.target.checked; save(); if (S.haptics && navigator.vibrate) navigator.vibrate(15); toast(S.haptics ? 'Haptics aktif' : 'Haptics mati'); });
  $('#goClean').addEventListener('click', () => { prevScreen = 'settings'; go('clean'); });

  const ACTIONS = {
    async theme() {
      const v = await choose('Tema', [{ v: 'system', l: 'Ikuti sistem' }, { v: 'dark', l: 'Gelap' }, { v: 'light', l: 'Terang' }], S.theme);
      if (v) { S.theme = v; save(); applyTheme(); renderSettings(); }
    },
    async lang() {
      const v = await choose('Bahasa', [{ v: 'id', l: 'Indonesia' }, { v: 'en', l: 'English' }], S.lang);
      if (v) { S.lang = v; save(); renderSettings(); if (v === 'en') toast('Pilihan disimpan.'); }
    },
    async model() {
      const opts = MODELS.filter(m => S.dl[m.id]).map(m => ({ v: m.id, l: m.name, s: fmtGB(m.gb) }));
      if (!opts.length) return toast('Belum ada model terunduh');
      const v = await choose('Model default', opts, S.active, 'Hanya model yang sudah diunduh.');
      if (v) useModel(v);
    },
    async temp() { const v = await slider('Temperature', 'Nilai rendah lebih konsisten, nilai tinggi lebih kreatif.', 0, 2, 0.1, S.temp, x => x.toFixed(1).replace('.', ',')); if (v != null) { S.temp = +v.toFixed(1); save(); renderSettings(); } },
    async topp() { const v = await slider('Top-p', 'Batas probabilitas kumulatif saat memilih kata berikutnya.', 0, 1, 0.05, S.topp, x => x.toFixed(2).replace('.', ',')); if (v != null) { S.topp = +v.toFixed(2); save(); renderSettings(); } },
    async maxTok() { const v = await slider('Max tokens', 'Panjang maksimum satu jawaban.', 256, 4096, 128, S.maxTok, x => String(x)); if (v != null) { S.maxTok = v; save(); renderSettings(); } },
    async ctx() { const v = await slider('Ukuran konteks', 'Konteks besar memakai lebih banyak RAM.', 1024, 8192, 1024, S.ctx, x => String(x)); if (v != null) { S.ctx = v; save(); renderSettings(); } },
    async sysPrompt() {
      const PRE = { Umum: 'Kamu asisten yang membantu, ringkas, dan jujur. Jawab dalam bahasa yang dipakai pengguna.', Penulis: 'Kamu penulis profesional. Perbaiki tata bahasa, jaga nada asli, dan jelaskan perubahan penting secara singkat.', Coder: 'Kamu insinyur perangkat lunak senior. Jawab dengan kode yang rapi dan penjelasan singkat.', Penerjemah: 'Kamu penerjemah Indonesia dan Inggris yang akurat. Terjemahkan tanpa menambah komentar.' };
      const v = await openSheet(`<h2>System prompt</h2><p class="sub">Arahan dasar untuk semua chat. Pal yang dipilih akan memakai prompt-nya sendiri.</p>
        <div class="chips" style="padding:0 0 10px">${Object.keys(PRE).map(k => `<button type="button" class="chip" data-pre="${k}">${k}</button>`).join('')}</div>
        <textarea class="field" id="spt" rows="6" maxlength="2000" placeholder="Tulis arahan untuk asistenmu">${esc(S.sysPrompt || '')}</textarea>
        <div class="kv" style="padding:6px 2px"><span>Panjang</span><span id="spn"></span></div>
        <button class="btn primary" data-ok>Simpan</button><button class="btn ghost" data-v="rst">Kembalikan bawaan</button><button class="btn ghost" data-close>Batal</button>`,
        (el, close) => {
          const t = $('#spt', el), n = $('#spn', el), up = () => { n.textContent = t.value.length + ' / 2000'; }; up(); t.addEventListener('input', up);
          $$('[data-pre]', el).forEach(b => b.addEventListener('click', () => { t.value = PRE[b.dataset.pre]; up(); }));
          $('[data-ok]', el).addEventListener('click', () => close(t.value.trim()));
          $('[data-v=rst]', el).addEventListener('click', () => close(PRE.Umum));
        });
      if (v == null) return; S.sysPrompt = v; save(); renderSettings(); toast(v ? 'System prompt disimpan' : 'System prompt dikosongkan');
    },
    async hfToken() {
      const v = await openSheet(`<h2>Token Hugging Face</h2><p class="sub">Dipakai untuk model gated. Disimpan hanya di perangkat ini.</p>
        <input class="field" id="hft" type="password" autocomplete="off" spellcheck="false" placeholder="hf_..." value="${esc(S.hfToken || '')}" />
        <button class="btn primary" data-ok>Simpan</button>${S.hfToken ? '<button class="btn danger" data-v="rm" style="margin-top:8px">Hapus token</button>' : ''}<button class="btn ghost" data-close>Batal</button>`,
        (el, close) => { $('[data-ok]', el).addEventListener('click', () => close($('#hft', el).value.trim())); const r = $('[data-v=rm]', el); r && r.addEventListener('click', () => close('')); });
      if (v == null) return; S.hfToken = v; save(); renderSettings(); hubLoaded = false; toast(v ? 'Token disimpan' : 'Token dihapus');
    },
    async ghRepo() {
      const v = await openSheet(`<h2>GitHub repo model</h2><p class="sub">Format owner/repo — Releases yang berisi aset .gguf akan ditampilkan di chip GitHub.</p>
        <input class="field" id="ghr" autocomplete="off" placeholder="v1-byte/Box-Ai" value="${esc(S.ghRepo || 'v1-byte/Box-Ai')}" />
        <button class="btn primary" data-ok>Simpan</button><button class="btn ghost" data-close>Batal</button>`,
        (el, close) => { $('[data-ok]', el).addEventListener('click', () => close($('#ghr', el).value.trim())); });
      if (v == null) return; S.ghRepo = v || 'v1-byte/Box-Ai'; save(); renderSettings(); connCache.gh = null; toast('Repo: ' + S.ghRepo);
    },
    async ghToken() {
      const v = await openSheet(`<h2>GitHub token</h2><p class="sub">Opsional — untuk repo privat / rate limit. Hanya di perangkat ini.</p>
        <input class="field" id="ght" type="password" autocomplete="off" placeholder="ghp_..." value="${esc(S.ghToken || '')}" />
        <button class="btn primary" data-ok>Simpan</button>${S.ghToken ? '<button class="btn danger" data-v="rm" style="margin-top:8px">Hapus</button>' : ''}<button class="btn ghost" data-close>Batal</button>`,
        (el, close) => { $('[data-ok]', el).addEventListener('click', () => close($('#ght', el).value.trim())); const r = $('[data-v=rm]', el); r && r.addEventListener('click', () => close('')); });
      if (v == null) return; S.ghToken = v; save(); renderSettings(); connCache.gh = null; toast(v ? 'Token GitHub disimpan' : 'Token dihapus');
    },
    async cfUrl() {
      const v = await openSheet(`<h2>Cloudflare Tunnel URL</h2><p class="sub">Base URL yang menyajikan <code>manifest.json</code> berisi daftar model.</p>
        <input class="field" id="cfu" type="url" autocomplete="off" placeholder="https://xxx.trycloudflare.com" value="${esc(S.cfUrl || '')}" />
        <button class="btn primary" data-ok>Simpan</button><button class="btn ghost" data-close>Batal</button>`,
        (el, close) => { $('[data-ok]', el).addEventListener('click', () => close($('#cfu', el).value.trim())); });
      if (v == null) return; S.cfUrl = v; save(); renderSettings(); connCache.cf = null; toast(v ? 'URL Cloudflare disimpan' : 'URL dikosongkan');
    },
    async r2Url() {
      const v = await openSheet(`<h2>R2 / public URL</h2><p class="sub">URL publik bucket atau CDN dengan <code>manifest.json</code>.</p>
        <input class="field" id="r2u" type="url" autocomplete="off" placeholder="https://pub-xxx.r2.dev" value="${esc(S.r2Url || '')}" />
        <button class="btn primary" data-ok>Simpan</button><button class="btn ghost" data-close>Batal</button>`,
        (el, close) => { $('[data-ok]', el).addEventListener('click', () => close($('#r2u', el).value.trim())); });
      if (v == null) return; S.r2Url = v; save(); renderSettings(); connCache.r2 = null; toast(v ? 'URL R2 disimpan' : 'URL dikosongkan');
    },
    async talents() {
      const row = k => `<button class="opt ${S.talents[k] ? 'on' : ''}" data-v="${k}"><span class="o-txt">${k}<small>${esc(TALENTS[k].desc)}</small></span><i class="radio"></i></button>`;
      await openSheet(`<h2>Talents</h2><p class="sub">Tool yang boleh dipanggil model. Di chat juga bisa lewat /calc, /waktu, /html. Pencarian web diatur lewat tombol globe di chat.</p>${Object.keys(TALENTS).filter(k => k !== 'web_search').map(row).join('')}<button class="btn ghost" data-close>Selesai</button>`,
        el => $$('.opt', el).forEach(b => b.addEventListener('click', () => { S.talents[b.dataset.v] = !S.talents[b.dataset.v]; b.classList.toggle('on', S.talents[b.dataset.v]); save(); })));
    },
    async onDevice() {
      if (S.onDevice) {
        if (!(await confirmBox('Matikan mode on-device?', 'Model online mungkin mengirim percakapan ke server. Nonaktifkan hanya jika kamu paham risikonya.', 'Matikan', true))) return;
        S.onDevice = false; toast('Mode online aktif');
      } else { S.onDevice = true; toast('Hanya on-device'); }
      save(); renderSettings(); updateTop();
    },
    async clearChat() {
      if (await confirmBox('Hapus riwayat chat?', 'Semua percakapan dihapus permanen dari perangkat ini.', 'Hapus riwayat', true)) { newChat(true); toast('Riwayat chat dihapus'); }
    },
    clearCache() { prevScreen = 'settings'; go('clean'); },
    license() {
      openSheet(`<h2>Lisensi</h2><div class="info-list">
        <p><b>Box AI UI</b><br>Antarmuka Android Box AI.</p>
        <p><b>Box AI</b><br>github.com/v1-byte/Box-Ai, lisensi MIT.</p><p><b>PocketPal AI</b><br>Arsitektur dasar, lisensi MIT.</p>
        <p><b>llama.cpp</b><br>Mesin inferensi, lisensi MIT.</p>
        <p><b>Model</b><br>Gemma: Gemma Terms of Use. Llama 3.2: Llama Community License. Phi-3: MIT. Mistral Nemo dan Qwen2.5: Apache 2.0.</p></div>
        <button class="btn ghost" data-close>Tutup</button>`);
    },
    async version() {
      startInAppUpdate(true);
    },
    async requestTree() {
      if (!NATIVE || !NATIVE.requestTreeAccess) return toast('Hanya di aplikasi Android');
      toast('Pilih folder — saran: Internal storage atau Download / model ai');
      window.onBoxTreeGranted = function (ok) {
        if (!ok) return toast('Dibatalkan');
        listDir.externalCacheAt = 0;
        toast('Akses folder tersimpan — memindai model…');
        setTimeout(() => ACTIONS.scanModels(), 400);
      };
      NATIVE.requestTreeAccess();
    },
    async scanModels() {
      if (!NATIVE) return toast('Hanya di aplikasi Android');
      // 1) SAF folder access (least privilege)
      if (NATIVE.hasStoragePermission && !NATIVE.hasStoragePermission() && NATIVE.requestStoragePermission) {
        toast('Pilih folder penyimpanan, lalu pindai lagi');
        NATIVE.requestStoragePermission();
        return;
      }
      // 2) Acode-style: folder picker if belum pernah grant tree / hasil 0
      let trees = 0;
      try { trees = NATIVE.treeAccessCount ? NATIVE.treeAccessCount() : 0; } catch (e) {}
      if (trees === 0 && NATIVE.requestTreeAccess) {
        toast('Pilih folder penyimpanan (seperti Acode) — pilih Internal storage atau Download');
          window.onBoxTreeGranted = function (ok) {
            if (!ok) return toast('Akses folder dibatalkan');
            listDir.externalCacheAt = 0;
            toast('Folder diizinkan — memindai…');
          setTimeout(() => ACTIONS.scanModels(), 400);
        };
        NATIVE.requestTreeAccess();
        return;
      }
      toast('Memindai semua model di perangkat…');
      await sleep(80);
      let dbg = {};
      try { dbg = JSON.parse(NATIVE.scanDebug ? NATIVE.scanDebug() : '{}'); } catch (e) {}
      const n = syncLocalDeep();
      renderModels();
      renderSettings();
      updateTop();
      if (n) {
        toast(n + ' model ditemukan');
      } else {
        const tips = [];
        if ((dbg.treeAccess || 0) === 0) tips.push('belum pilih folder SAF');
        if (dbg.mediaStoreGguf === 0) tips.push('MediaStore 0 .gguf');
        tips.push('Settings → Pindai lagi, atau pilih folder Download/model ai');
        toast('Tidak ketemu. ' + tips.join(' · '));
        // Offer tree picker again
        if (NATIVE.requestTreeAccess) {
          setTimeout(() => {
            window.onBoxTreeGranted = function (ok) {
              if (ok) setTimeout(() => ACTIONS.scanModels(), 400);
            };
            NATIVE.requestTreeAccess();
          }, 600);
        }
      }
    }
  };
  $$('[data-set]').forEach(el => el.addEventListener('click', () => ACTIONS[el.dataset.set] && ACTIONS[el.dataset.set]()));

  /* ================= PEMBERSIH ================= */
  const CATS = [
    { id: 'kv',     icon: 'bolt',   name: 'Cache konteks',      desc: 'KV cache dan sesi inferensi sementara', def: true },
    { id: 'tmp',    icon: 'down',   name: 'Unduhan sementara',  desc: 'Potongan file yang tidak selesai',      def: true },
    { id: 'thumbs', icon: 'image',  name: 'Lampiran dan thumbnail', desc: 'Pratinjau foto dan dokumen',        def: true },
    { id: 'logs',   icon: 'file',   name: 'Log dan benchmark',  desc: 'Catatan performa dan error',            def: true },
    { id: 'chat',   icon: 'chat',   name: 'Riwayat chat',       desc: 'Percakapan tersimpan. Tidak bisa dipulihkan', def: false },
    { id: 'models', icon: 'cube',   name: 'Model tidak aktif',  desc: 'Model terunduh selain yang sedang dipakai',   def: false }
  ];
  let phase = 'idle', sel = {}, sizes = {};
  const gauge = $('#gauge'), gBar = $('#gBar'), gNum = $('#gNum'), gUnit = $('#gUnit'), gLbl = $('#gLbl');
  const btnClean = $('#btnClean'), btnSecond = $('#btnCleanSecond'), statusEl = $('#cleanStatus');

  function calcSizes() {
    const idle = MODELS.filter(m => S.dl[m.id] && m.id !== S.active);
    return {
      kv: cacheMB(), tmp: 0, thumbs: 0, logs: 0,
      chat: S.chat.length ? 8 + S.chat.length * 0.6 : 0,
      models: idle.reduce((a, m) => a + m.gb * 1024, 0)
    };
  }
  const selTotal = () => CATS.reduce((a, c) => a + (sel[c.id] ? sizes[c.id] : 0), 0);
  const allTotal = () => CATS.reduce((a, c) => a + sizes[c.id], 0);
  function setGauge(mb, ratio, label) {
    const txt = fmtMB(mb).split(' ');
    gNum.textContent = txt[0]; gUnit.textContent = txt[1]; gLbl.textContent = label;
    gBar.style.strokeDashoffset = 100 - Math.max(0, Math.min(1, ratio)) * 100;
  }
  function renderCleanList() {
    $('#cleanList').innerHTML = CATS.map(c => {
      const has = phase !== 'idle' && sizes[c.id] > 0.05;
      const cls = ['c-row', sel[c.id] ? 'sel' : '', phase === 'scanning' ? 'scan' : '', phase !== 'idle' && !has && phase !== 'scanning' ? 'off' : ''].join(' ');
      const sz = phase === 'idle' ? '—' : phase === 'scanning' ? '000 MB' : (has ? fmtMB(sizes[c.id]) : 'Bersih');
      return `<div class="${cls}" data-c="${c.id}"><div class="c-ico">${ic(c.icon)}</div>
        <div class="c-txt"><strong>${c.name}</strong><span>${c.desc}</span></div>
        <div class="c-size">${sz}</div><div class="chk">${ic('check')}</div></div>`;
    }).join('');
  }
  function enterCleaner() {
    if (phase === 'scanning' || phase === 'cleaning') return;
    phase = 'idle'; sizes = calcSizes(); sel = {};
    CATS.forEach(c => sel[c.id] = c.def);
    gauge.className = 'gauge'; setGauge(0, 0, 'Belum dipindai');
    statusEl.textContent = 'Pindai untuk melihat apa yang bisa dibersihkan.';
    btnClean.textContent = 'Pindai sekarang'; btnClean.disabled = false; btnSecond.hidden = true;
    renderCleanList(); realStorage();
  }
  function realStorage() {
    const el = $('#realStore');
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(e => {
        el.textContent = 'Penyimpanan aplikasi web ini (nyata): ' + fmtMB((e.usage || 0) / 1048576) + ' dari ' + fmtMB((e.quota || 0) / 1048576) + '. ';
      }).catch(() => { el.textContent = ''; });
    } else el.textContent = '';
  }
  async function scan() {
    phase = 'scanning'; sizes = calcSizes();
    gauge.className = 'gauge scanning'; btnClean.disabled = true; btnSecond.hidden = true;
    setGauge(0, 0, 'Memindai'); renderCleanList();
    const msgs = ['Memeriksa cache konteks…', 'Mencari file sementara…', 'Menghitung lampiran…', 'Membaca riwayat dan model…'];
    for (let i = 0; i < msgs.length; i++) { statusEl.textContent = msgs[i]; await sleep(560); }
    phase = 'ready'; gauge.className = 'gauge';
    CATS.forEach(c => { if (sizes[c.id] <= 0.05) sel[c.id] = false; });
    renderCleanList(); refreshReady();
    statusEl.textContent = selTotal() > 0 ? 'Pilih yang ingin dibersihkan. Riwayat chat dan model tidak dipilih secara bawaan.' : 'Tidak ada yang perlu dibersihkan. Penyimpanan sudah rapi.';
  }
  function refreshReady() {
    const tot = allTotal(), s = selTotal();
    setGauge(s, tot > 0 ? s / tot : 0, s > 0 ? 'siap dibersihkan' : 'tidak ada pilihan');
    btnClean.textContent = s > 0 ? 'Bersihkan ' + fmtMB(s) : 'Pilih yang dibersihkan';
    btnClean.disabled = s <= 0;
  }
  $('#cleanList').addEventListener('click', e => {
    const row = e.target.closest('.c-row'); if (!row || phase !== 'ready') return;
    const id = row.dataset.c; if (sizes[id] <= 0.05) return;
    sel[id] = !sel[id]; row.classList.toggle('sel', sel[id]); refreshReady();
  });
  async function clean() {
    if (sel.chat || sel.models) {
      const parts = [sel.chat ? 'riwayat chat' : '', sel.models ? 'model tidak aktif' : ''].filter(Boolean).join(' dan ');
      if (!(await confirmBox('Hapus ' + parts + '?', 'Item ini tidak bisa dipulihkan. Model bisa diunduh ulang, riwayat chat tidak.', 'Ya, bersihkan', true))) return;
    }
    phase = 'cleaning'; btnClean.disabled = true; gauge.className = 'gauge scanning';
    const startTotal = selTotal(); let freed = 0;
    const order = CATS.filter(c => sel[c.id] && sizes[c.id] > 0.05);
    for (const c of order) {
      const row = $(`.c-row[data-c="${c.id}"]`); row.classList.add('busy');
      statusEl.textContent = 'Membersihkan ' + c.name.toLowerCase() + '…';
      const from = freed, to = freed + sizes[c.id], steps = 12;
      for (let i = 1; i <= steps; i++) {
        const cur = from + (to - from) * i / steps;
        setGauge(startTotal - cur, (startTotal - cur) / (allTotal() || 1), 'dibersihkan');
        await sleep(45);
      }
      freed = to; row.classList.remove('busy', 'sel'); row.classList.add('cleaned');
      $('.c-size', row).textContent = '0 MB';
    }
    // terapkan ke data
    if (sel.kv && NATIVE) NATIVE.clearCache(); if (sel.kv) S.cache.kv = 0; if (sel.tmp) S.cache.tmp = 0; if (sel.thumbs) S.cache.thumbs = 0; if (sel.logs) S.cache.logs = 0;
    if (sel.chat) { S.chat = []; S.typing = false; renderChat(); clearAttachment(); }
    if (sel.models) { MODELS.slice().forEach(m => { if (m.id !== S.active && S.dl[m.id] && NATIVE) NATIVE.deleteModel(meta(m.id).file); }); syncLocal(); }
    save(); renderModels(); renderSettings();
    phase = 'done'; gauge.className = 'gauge done';
    setGauge(freed, 1, 'dibebaskan');
    gBar.style.strokeDashoffset = 0;
    statusEl.textContent = 'Selesai. ' + fmtMB(freed) + ' ruang berhasil dibebaskan.';
    btnClean.textContent = 'Selesai'; btnClean.disabled = false; btnSecond.hidden = false;
    toast(fmtMB(freed) + ' dibebaskan');
    realStorage();
  }
  btnClean.addEventListener('click', () => {
    if (phase === 'idle') scan();
    else if (phase === 'ready') clean();
    else if (phase === 'done') go(prevScreen);
  });
  btnSecond.addEventListener('click', () => { phase = 'idle'; sizes = calcSizes(); scan(); });
  $('#btnCleanBack').addEventListener('click', () => { if (phase === 'scanning' || phase === 'cleaning') return toast('Tunggu proses selesai'); go(prevScreen); });


  /* ================= PENCARI FILE ================= */
  let cwd = ROOT, query = '', prevFinder = 'settings';
  const base = p => p.slice(p.lastIndexOf('/') + 1);
  const parent = p => p.slice(0, p.lastIndexOf('/')) || '/';
  const extOf = n => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : '');
  const kindOf = p => { const e = extOf(p); return e === 'gguf' ? 'gguf' : e === 'json' ? 'json' : e === 'md' ? 'md' : 'txt'; };
  const KICON = { dir: 'folder', gguf: 'cube', json: 'code', md: 'pen', txt: 'file' };
  const fmtBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
  const fmtDate = t => new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const bytesOf = str => new Blob([str]).size;

  function sidecarObj(id) {
    const mt = meta(id), d = MMETA_DEF[id], m = model(id);
    return { name: mt.name, file: mt.file, architecture: d.arch, parameters: m.meta.split(' · ')[0], quantization: d.quant, context_length: mt.ctx, chat_template: mt.tpl, system_prompt: mt.sys };
  }
  const sidecarText = id => JSON.stringify(sidecarObj(id), null, 2) + '\n';
  const stemOf = f => f.replace(/\.gguf$/i, '');

  function modelFiles() {
    const out = [];
    MODELS.forEach(m => {
      if (!S.dl[m.id]) return;
      const mt = meta(m.id);
      out.push({ path: ROOT + '/models/' + mt.file, name: mt.file, type: 'file', kind: 'gguf', size: m.gb * 1073741824, mod: mt.mod || S.installAt, mid: m.id });
      const js = stemOf(mt.file) + '.json';
      out.push({ path: ROOT + '/models/' + js, name: js, type: 'file', kind: 'json', size: bytesOf(sidecarText(m.id)), mod: mt.mod || S.installAt, mid: m.id });
    });
    return out;
  }
  function listDir(p) {
    const items = [];
    if (p === ROOT) items.push({ path: ROOT + '/perangkat', name: 'Perangkat', type: 'dir', kind: 'dir', external: true });
    if (p === ROOT + '/perangkat') {
      let ext = [];
      if (listDir.externalCache && Date.now() - listDir.externalCacheAt < 5000) ext = listDir.externalCache;
      else try {
        const raw = NATIVE && NATIVE.listWorkspaceFiles ? JSON.parse(NATIVE.listWorkspaceFiles() || '[]') : [];
        ext = Array.isArray(raw) ? raw : [];
        listDir.externalCache = ext; listDir.externalCacheAt = Date.now();
      } catch (_) { listDir.externalCache = []; listDir.externalCacheAt = Date.now(); }
      ext.forEach((f, i) => items.push({ path: ROOT + '/perangkat/file-' + i, name: f.name, type: 'file', kind: f.text ? kindOf(f.name) : 'file', size: +f.size || 0, mod: +f.mod || 0, external: true, uri: f.uri, text: !!f.text }));
      return items.sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
    }
    S.fsx.dirs.forEach(d => { if (d !== p && parent(d) === p) items.push({ path: d, name: base(d), type: 'dir', kind: 'dir' }); });
    Object.keys(S.fsx.files).forEach(f => {
      if (parent(f) === p) { const o = S.fsx.files[f]; items.push({ path: f, name: base(f), type: 'file', kind: kindOf(f), size: bytesOf(o.c), mod: o.m }); }
    });
    if (p === ROOT + '/models') items.push(...modelFiles());
    return items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'id', { numeric: true }) : a.type === 'dir' ? -1 : 1));
  }
  function walk(p, cb) { listDir(p).forEach(e => { cb(e); if (e.type === 'dir') walk(e.path, cb); }); }
  const isProtected = e => e.path === ROOT || e.path === ROOT + '/models';
  const nameOk = n => n && n.length <= 80 && !/[\/\\]/.test(n) && n !== '.' && n !== '..';

  function renderFinder() {
    const q = query.trim().toLowerCase();
    // breadcrumb
    const parts = cwd.split('/').filter(Boolean);
    let acc = '', cr = '';
    parts.forEach((p, i) => {
      acc += '/' + p;
      cr += (i ? ic('chev') : '') + `<button type="button" data-p="${esc(acc)}">${esc(p)}</button>`;
    });
    $('#crumbs').innerHTML = cr; $('#crumbs').hidden = !!q;
    let items;
    if (q) { items = []; walk(ROOT, e => { if (e.name.toLowerCase().includes(q)) items.push(e); }); }
    else items = listDir(cwd);
    $('#fList').innerHTML = items.length ? items.map(e => {
      let sub;
      if (e.type === 'dir') sub = listDir(e.path).length + ' item';
      else sub = fmtBytes(e.size) + ' · ' + fmtDate(e.mod);
      if (q) sub = parent(e.path) + ' · ' + sub;
      return `<div class="f-row" data-p="${esc(e.path)}"><div class="f-ico k-${e.kind}">${ic(KICON[e.kind])}</div>
        <div class="f-txt"><strong>${esc(e.name)}</strong><span>${esc(sub)}</span></div>
        <button type="button" class="f-more" aria-label="Aksi">${ic('more')}</button></div>`;
    }).join('') : `<p class="empty">${q ? 'Tidak ada hasil untuk "' + esc(query) + '".' : 'Folder ini kosong. Tekan + untuk membuat file atau folder.'}</p>`;
    $('#fCount').textContent = q ? items.length + ' hasil' : items.length + ' item di ' + cwd;
  }
  function entryAt(p) {
    let found = null;
    if (p === ROOT) return { path: ROOT, name: base(ROOT), type: 'dir', kind: 'dir' };
    walk(ROOT, e => { if (e.path === p) found = e; });
    return found;
  }
  $('#crumbs').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) { cwd = b.dataset.p; renderFinder(); } });
  $('#fSearch').addEventListener('input', e => { query = e.target.value; renderFinder(); });
  $('#fList').addEventListener('click', e => {
    const row = e.target.closest('.f-row'); if (!row) return;
    const ent = entryAt(row.dataset.p); if (!ent) return;
    if (e.target.closest('.f-more')) return entryMenu(ent);
    openEntry(ent);
  });
  $('#fBack').addEventListener('click', () => {
    if (query) { $('#fSearch').value = ''; query = ''; return renderFinder(); }
    if (cwd !== ROOT) { cwd = parent(cwd); renderFinder(); } else go(prevFinder);
  });
  $('#goFinder').addEventListener('click', () => { prevFinder = 'settings'; cwd = ROOT; go('finder'); });

  function openEntry(ent) {
    if (ent.type === 'dir') { cwd = ent.path; $('#fSearch').value = ''; query = ''; renderFinder(); }
    else if (ent.kind === 'gguf') openGguf(ent.mid);
    else if (ent.external) openExternalEditor(ent);
    else openEditor(ent);
  }

  function openExternalEditor(ent) {
    if (!ent.text || !NATIVE || !NATIVE.readWorkspaceText) return toast('File biner tidak dapat diedit di editor teks');
    let text = '';
    try { text = NATIVE.readWorkspaceText(ent.uri) || ''; } catch (_) {}
    if (!text && ent.size > 0) return toast('File tidak dapat dibaca atau terlalu besar');
    ed = { path: ent.path, uri: ent.uri, external: true, orig: text, kind: ent.kind };
    edText.value = text; $('#edTitle').textContent = ent.name; $('#edPath').textContent = 'Perangkat · ' + parent(ent.name);
    $('#edFmt').hidden = ent.kind !== 'json'; edUpdate(); go('editor'); edText.scrollTop = 0;
  }

  function promptName(title, placeholder, value, okLabel) {
    return openSheet(`<h2>${esc(title)}</h2><input class="field" id="pnm" maxlength="80" placeholder="${esc(placeholder)}" value="${esc(value || '')}" autocomplete="off" spellcheck="false" />
      <button class="btn primary" data-ok>${esc(okLabel || 'Simpan')}</button><button class="btn ghost" data-close>Batal</button>`,
      (el, close) => {
        const f = $('#pnm', el); setTimeout(() => { f.focus(); f.select(); }, 350);
        const done = () => close(f.value.trim());
        $('[data-ok]', el).addEventListener('click', done);
        f.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(); });
      });
  }
  const nameTaken = (dir, name, exceptPath) => listDir(dir).some(e => e.name.toLowerCase() === name.toLowerCase() && e.path !== exceptPath);

  $('#fNew').addEventListener('click', async () => {
    if (query) { $('#fSearch').value = ''; query = ''; renderFinder(); }
    if (cwd === ROOT + '/models') return toast('Folder model hanya berisi file model hasil unduhan');
    const v = await openSheet(`<h2>Buat baru</h2><p class="sub">Di ${esc(cwd)}</p>
      <button class="opt" data-v="file">${ic('file')}<span class="o-txt">File teks<small>.txt, .md, atau .json</small></span></button>
      <button class="opt" data-v="dir">${ic('folder')}<span class="o-txt">Folder</span></button>`,
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (!v) return;
    let name = await promptName(v === 'dir' ? 'Nama folder' : 'Nama file', v === 'dir' ? 'misalnya proyek' : 'misalnya prompt-baru.txt', '', 'Buat');
    if (!name) return;
    if (v === 'file' && !extOf(name)) name += '.txt';
    if (!nameOk(name)) return toast('Nama tidak valid. Hindari tanda / dan \\');
    if (nameTaken(cwd, name)) return toast('Nama itu sudah dipakai di folder ini');
    const path = cwd + '/' + name;
    if (v === 'dir') S.fsx.dirs.push(path); else S.fsx.files[path] = { c: '', m: Date.now() };
    save(); renderFinder(); toast((v === 'dir' ? 'Folder' : 'File') + ' dibuat');
    if (v === 'file') openEditor(entryAt(path));
  });

  async function entryMenu(ent) {
    const prot = isProtected(ent), virtJson = ent.mid && ent.kind === 'json', real = !ent.mid && ent.type === 'file';
    const opts = [`<button class="opt" data-v="open">${ic('open')}<span class="o-txt">Buka${ent.kind === 'gguf' ? ' dan edit metadata' : ent.type === 'file' ? ' dan edit' : ''}</span></button>`];
    if (!prot && !virtJson) opts.push(`<button class="opt" data-v="rename">${ic('edit')}<span class="o-txt">Ganti nama</span></button>`);
    if (real) opts.push(`<button class="opt" data-v="dup">${ic('copy')}<span class="o-txt">Duplikat</span></button>`);
    if (!prot) opts.push(`<button class="opt" data-v="del">${ic('trash')}<span class="o-txt" style="color:var(--bad)">${virtJson ? 'Reset konfigurasi ke bawaan' : 'Hapus'}</span></button>`);
    const v = await openSheet(`<h2 style="word-break:break-all">${esc(ent.name)}</h2><p class="sub">${esc(parent(ent.path))}${ent.type === 'file' ? ' · ' + fmtBytes(ent.size) : ''}</p>${opts.join('')}`,
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (v === 'open') openEntry(ent);
    else if (v === 'rename') renameEntry(ent);
    else if (v === 'dup') {
      let n = ent.name.replace(/(\.[^.]+)?$/, ' salinan$1'), i = 2;
      while (nameTaken(parent(ent.path), n)) n = ent.name.replace(/(\.[^.]+)?$/, ' salinan ' + i++ + '$1');
      S.fsx.files[parent(ent.path) + '/' + n] = { c: S.fsx.files[ent.path].c, m: Date.now() };
      save(); renderFinder(); toast('Disalin ke ' + n);
    } else if (v === 'del') deleteEntry(ent);
  }
  async function renameEntry(ent) {
    let name = await promptName('Ganti nama', ent.name, ent.name, 'Simpan');
    if (!name || name === ent.name) return;
    if (ent.kind === 'gguf') { if (!/\.gguf$/i.test(name)) name += '.gguf'; }
    else if (ent.type === 'file' && !extOf(name)) name += '.' + (extOf(ent.name) || 'txt');
    if (!nameOk(name)) return toast('Nama tidak valid. Hindari tanda / dan \\');
    if (nameTaken(parent(ent.path), name, ent.path)) return toast('Nama itu sudah dipakai');
    const np = parent(ent.path) + '/' + name;
    if (ent.mid) { if (!NATIVE || !NATIVE.renameModel(ent.name, name)) return toast('Gagal mengganti nama'); syncLocal(); renderFinder(); renderModels(); return toast('Nama diganti'); }
    else if (ent.type === 'dir') {
      S.fsx.dirs = S.fsx.dirs.map(d => d === ent.path || d.startsWith(ent.path + '/') ? np + d.slice(ent.path.length) : d);
      const nf = {}; Object.keys(S.fsx.files).forEach(k => { nf[k === ent.path || k.startsWith(ent.path + '/') ? np + k.slice(ent.path.length) : k] = S.fsx.files[k]; });
      S.fsx.files = nf; if (cwd === ent.path || cwd.startsWith(ent.path + '/')) cwd = np + cwd.slice(ent.path.length);
    } else { S.fsx.files[np] = S.fsx.files[ent.path]; delete S.fsx.files[ent.path]; }
    save(); renderFinder(); toast('Nama diganti');
  }
  async function deleteEntry(ent) {
    if (ent.mid && ent.kind === 'json') {
      if (await confirmBox('Reset konfigurasi?', 'Nama, template, dan system prompt model kembali ke nilai bawaan.', 'Reset', true)) {
        const f = S.mmeta[ent.mid] && S.mmeta[ent.mid].file; delete S.mmeta[ent.mid]; meta(ent.mid); void f;
        save(); renderFinder(); renderModels(); toast('Konfigurasi direset');
      }
      return;
    }
    if (ent.kind === 'gguf') {
      if (S.active === ent.mid) return toast('Model aktif tidak bisa dihapus. Pilih model lain dulu.');
      if (await confirmBox('Hapus ' + ent.name + '?', 'File model ' + fmtBytes(ent.size) + ' dihapus dari perangkat. Kamu bisa mengunduhnya lagi dari tab Models.', 'Hapus', true)) {
        NATIVE && NATIVE.deleteModel(ent.name); syncLocal(); renderFinder(); renderModels(); renderSettings(); toast('Model dihapus');
      }
      return;
    }
    const n = ent.type === 'dir' ? listDir(ent.path).length : 0;
    if (await confirmBox('Hapus ' + ent.name + '?', ent.type === 'dir' ? (n ? 'Folder dan ' + n + ' isinya dihapus permanen.' : 'Folder kosong ini dihapus.') : 'File dihapus permanen.', 'Hapus', true)) {
      S.fsx.dirs = S.fsx.dirs.filter(d => !(d === ent.path || d.startsWith(ent.path + '/')));
      Object.keys(S.fsx.files).forEach(k => { if (k === ent.path || k.startsWith(ent.path + '/')) delete S.fsx.files[k]; });
      save(); renderFinder(); toast('Dihapus');
    }
  }

  /* ---------- Editor teks ---------- */
  let ed = null;
  const edText = $('#edText');
  function edDirty() { return ed && edText.value !== ed.orig; }
  function edUpdate() {
    const v = edText.value, d = edDirty();
    $('#edSave').disabled = !d;
    $('.ed-title', screens.editor).classList.toggle('dirty', !!d);
    $('#edFoot').innerHTML = `<span>${v ? v.split('\n').length : 0} baris · ${v.length} karakter</span><span>${d ? 'Belum disimpan' : 'Tersimpan'}</span>`;
  }
  function openEditor(ent) {
    const text = ent.mid ? sidecarText(ent.mid) : S.fsx.files[ent.path].c;
    ed = { path: ent.path, mid: ent.mid, orig: text, kind: ent.kind };
    edText.value = text;
    $('#edTitle').textContent = ent.name; $('#edPath').textContent = parent(ent.path) + (ent.mid ? ' · konfigurasi model' : '');
    $('#edFmt').hidden = ent.kind !== 'json';
    edUpdate(); go('editor'); edText.scrollTop = 0;
  }
  edText.addEventListener('input', edUpdate);
  edText.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = edText.selectionStart; edText.setRangeText('  ', s, edText.selectionEnd, 'end'); edUpdate(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); edSave(); }
  });
  $('#edFmt').addEventListener('click', () => {
    try { edText.value = JSON.stringify(JSON.parse(edText.value), null, 2) + '\n'; edUpdate(); toast('JSON dirapikan'); }
    catch (err) { toast('JSON tidak valid: ' + String(err.message).slice(0, 60)); }
  });
  function edSave() {
    if (!edDirty()) return;
    if (ed.external) {
      if (!NATIVE || !NATIVE.writeWorkspaceText || !NATIVE.writeWorkspaceText(ed.uri, edText.value)) return toast('Gagal menyimpan file perangkat');
      ed.orig = edText.value;
    } else if (ed.mid) {
      let o;
      try { o = JSON.parse(edText.value); } catch (err) { return toast('JSON tidak valid: ' + String(err.message).slice(0, 60)); }
      const mt = meta(ed.mid);
      if (typeof o.name !== 'string' || !o.name.trim()) return toast('Field "name" tidak boleh kosong');
      if (!Number.isFinite(o.context_length) || o.context_length < 256) return toast('"context_length" harus angka minimal 256');
      if (typeof o.chat_template !== 'string' || typeof o.system_prompt !== 'string') return toast('"chat_template" dan "system_prompt" harus berupa teks');
      let file = mt.file;
      if (!/\.gguf$/i.test(file)) file += '.gguf';
      if (!nameOk(file)) return toast('Nama "file" tidak valid');
      if (MODELS.some(m => m.id !== ed.mid && S.dl[m.id] && meta(m.id).file.toLowerCase() === file.toLowerCase())) return toast('Nama file itu sudah dipakai model lain');
      Object.assign(mt, { name: o.name.trim(), file, ctx: Math.round(o.context_length), tpl: o.chat_template, sys: o.system_prompt, mod: Date.now() });
      ed.orig = sidecarText(ed.mid); edText.value = ed.orig;
      $('#edTitle').textContent = stemOf(file) + '.json'; ed.path = ROOT + '/models/' + stemOf(file) + '.json';
      renderModels();
    } else {
      S.fsx.files[ed.path] = { c: edText.value, m: Date.now() }; ed.orig = edText.value;
    }
    save(); edUpdate(); toast('Tersimpan');
  }
  $('#edSave').addEventListener('click', edSave);
  $('#edBack').addEventListener('click', async () => {
    if (edDirty() && !(await confirmBox('Buang perubahan?', 'Perubahan di file ini belum disimpan.', 'Buang', true))) return;
    go('finder');
  });

  /* ---------- Penampil & editor metadata GGUF ---------- */
  let gg = null;
  function ggufBytes(id) {
    try { return (NATIVE.head(meta(id).file).match(/../g) || []).map(x => parseInt(x, 16)); } catch (e) { return []; }
  }
  function hexdump(b) {
    const a = new Array(128).fill(0); b.slice(0, 128).forEach((x, i) => { a[i] = x; });
    const rows = [];
    for (let i = 0; i < 128; i += 16) {
      const sl = a.slice(i, i + 16);
      const hex = sl.map(x => x.toString(16).padStart(2, '0')).join(' ');
      const asc = sl.map(x => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
      rows.push(i.toString(16).padStart(4, '0') + '  ' + hex + '  ' + asc);
    }
    return rows.join('\n');
  }
  const ggFields = () => ({ file: $('#ggFile').value.trim(), name: $('#ggName').value.trim(), ctx: $('#ggCtx').value, tpl: $('#ggTpl').value, sys: $('#ggSys').value });
  function ggDirty() {
    if (!gg) return false; const f = ggFields(), mt = meta(gg.mid);
    return f.file !== mt.file || f.name !== mt.name || String(f.ctx) !== String(mt.ctx) || f.tpl !== mt.tpl || f.sys !== mt.sys;
  }
  function ggUpdate() { const d = ggDirty(); $('#ggSave').disabled = !d; $('.ed-title', screens.gguf).classList.toggle('dirty', d); }
  function openGguf(id) {
    gg = { mid: id }; const m = model(id), mt = meta(id), d = MMETA_DEF[id], hb = ggufBytes(id), u = o => (hb[o] || 0) + ((hb[o + 1] || 0) << 8) + ((hb[o + 2] || 0) << 16) + (hb[o + 3] || 0) * 16777216;
    $('#ggTitle').textContent = mt.file; $('#ggPath').textContent = ROOT + '/models';
    $('#ggSize').textContent = fmtBytes(m.gb * 1073741824);
    $('#ggInfo').innerHTML = [['Format', 'GGUF v' + (hb[4] || '?')], ['Kuantisasi', d.quant], ['Jumlah tensor', u(8)], ['Pasangan metadata', u(16)], ['Terakhir diubah', fmtDate(mt.mod || S.installAt)]]
      .map(r => `<div class="kv"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
    $('#ggFile').value = mt.file; $('#ggName').value = mt.name; $('#ggCtx').value = mt.ctx; $('#ggTpl').value = mt.tpl; $('#ggSys').value = mt.sys; $('#ggPreset').value = '';
    $('#ggHex').textContent = hexdump(ggufBytes(id));
    ggUpdate(); go('gguf'); screens.gguf.querySelector('.scroll').scrollTop = 0;
  }
  ['#ggFile', '#ggName', '#ggCtx', '#ggTpl', '#ggSys'].forEach(q => $(q).addEventListener('input', ggUpdate));
  $('#ggPreset').addEventListener('change', e => { if (e.target.value) { $('#ggTpl').value = TPL[e.target.value]; ggUpdate(); } });
  $('#ggSave').addEventListener('click', () => {
    const f = ggFields(), mt = meta(gg.mid);
    let file = mt.file;
    if (!nameOk(file)) return toast('Nama file tidak valid');
    if (MODELS.some(m => m.id !== gg.mid && S.dl[m.id] && meta(m.id).file.toLowerCase() === file.toLowerCase())) return toast('Nama file itu sudah dipakai model lain');
    if (!f.name) return toast('Nama model tidak boleh kosong');
    const ctx = Math.round(+f.ctx);
    if (!Number.isFinite(ctx) || ctx < 256) return toast('Panjang konteks minimal 256');
    Object.assign(mt, { file, name: f.name, ctx, tpl: f.tpl, sys: f.sys, mod: Date.now() });
    save(); $('#ggFile').value = file; $('#ggTitle').textContent = file; ggUpdate(); renderModels(); toast('Metadata tersimpan');
  });
  $('#ggBack').addEventListener('click', async () => {
    if (ggDirty() && !(await confirmBox('Buang perubahan?', 'Metadata model belum disimpan.', 'Buang', true))) return;
    go('finder');
  });
  $('#ggJson').addEventListener('click', async () => {
    if (ggDirty() && !(await confirmBox('Simpan dulu?', 'Perubahan belum disimpan dan akan hilang jika membuka file .json.', 'Buang dan buka', true))) return;
    openEditor(modelFiles().find(e => e.mid === gg.mid && e.kind === 'json'));
  });
  $('#ggDel').addEventListener('click', async () => {
    const ent = modelFiles().find(e => e.mid === gg.mid && e.kind === 'gguf');
    await deleteEntry(ent); if (!S.dl[gg.mid]) go('finder');
  });


  /* ================= BENCHMARK PERANGKAT ================= */
  function cpuBench() { const n = 1 << 16, a = new Float64Array(n).fill(1.0001); let x = 1, ops = 0; const t = performance.now(); while (performance.now() - t < 500) { for (let i = 0; i < n; i++) x = x * a[i] + 0.5; ops += n * 2; if (x > 1e9) x = 1; } return Math.round(ops / ((performance.now() - t) / 1000) / 1e6); }
  function memBench() { const a = new Uint8Array(32 << 20), b = new Uint8Array(32 << 20); let c = 0; const t = performance.now(); while (performance.now() - t < 500) { b.set(a); c++; } return Math.round(c * 32 / ((performance.now() - t) / 1000)); }
  function gpuName() { try { const g = document.createElement('canvas').getContext('webgl'), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'WebGL'; } catch (e) { return 'Tidak tersedia'; } }
  function renderBench() {
    const inf = nativeInfo(), last = S.bench[0], kv = (a, b) => `<div class="kv"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    const gb = inf.ram ? inf.ram / 1073741824 : 0;
    const fit = MODELS.filter(m => S.dl[m.id]).map(m => { const r = gb ? m.gb * 1.25 / gb : 0; return kv(mname(m), !gb ? '—' : r <= .5 ? 'Nyaman' : r <= .75 ? 'Berat' : 'Tidak muat'); }).join('') || '<p class="empty">Belum ada model terunduh.</p>';
    const hist = S.bench.map(b => kv(new Date(b.t).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), 'CPU ' + b.cpu + ' · Mem ' + b.mem)).join('') || '<p class="empty">Belum ada hasil.</p>';
    $('#benchBody').innerHTML = `<div class="big-stat"><div><b>${last ? last.cpu : '—'}</b><span>CPU (MFLOPS, 1 thread)</span></div><div><b>${last ? last.mem : '—'}</b><span>Memori (MB/s salin)</span></div></div>
      <h3 class="section-h">Perangkat</h3><div class="list">${kv('Perangkat', inf.device || 'Browser')}${kv('Core CPU', inf.cores || navigator.hardwareConcurrency || '—')}${kv('RAM', gb ? fmtBytes(inf.ram) : '—')}${kv('Penyimpanan bebas', inf.free ? fmtBytes(inf.free) : '—')}${kv('GPU', gpuName())}${kv('Android SDK', inf.sdk || '—')}${kv('Mesin LLM', Engine.ok() ? 'Siap' : 'Belum terpasang')}${kv('Token per detik', '— (butuh mesin LLM)')}</div>
      <h3 class="section-h">Kecocokan model</h3><div class="list">${fit}</div>
      <h3 class="section-h">Riwayat</h3><div class="list">${hist}</div>`;
  }
  $('#btnBench').addEventListener('click', async () => {
    const b = $('#btnBench'); b.disabled = true; b.textContent = 'Menguji CPU…'; await sleep(60);
    const cpu = cpuBench(); b.textContent = 'Menguji memori…'; await sleep(60);
    const mem = memBench(); S.bench.unshift({ t: Date.now(), cpu, mem }); S.bench = S.bench.slice(0, 8); save();
    b.disabled = false; b.textContent = 'Jalankan lagi'; renderBench(); toast('Benchmark selesai');
  });
  /* ripple */
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn,.chip,.btn-use,.opt,.tab,.icon-btn,.send'); if (!b) return;
    const r = b.getBoundingClientRect(), s = document.createElement('i');
    s.className = 'rip'; s.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
    b.appendChild(s); setTimeout(() => s.remove(), 650);
  });
  /* ================= KEYBOARD / SAFE AREA (anti bentrok HP) ================= */
  (function setupKeyboard() {
    const app = document.getElementById('app');
    if (!app) return;
    function applyKb() {
      const h = typeof window.__kbHeight === 'number' ? window.__kbHeight : 0;
      document.documentElement.style.setProperty('--kb', (h > 0 ? h : 0) + 'px');
      if (h > 40) app.classList.add('kb-open');
      else app.classList.remove('kb-open');
      // Scroll pesan ke bawah saat keyboard buka
      const msgs = document.querySelector('.messages');
      if (msgs && h > 40) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 80);
    }
    window.addEventListener('boxkb', applyKb);
    // Fallback visualViewport (beberapa WebView)
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const onVV = () => {
        const diff = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        if (typeof window.__kbHeight !== 'number' || window.__kbHeight < 10) {
          window.__kbHeight = Math.round(diff);
          applyKb();
        }
      };
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
    }
    // Focus input → pastikan terlihat
    document.addEventListener('focusin', e => {
      if (e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)) {
        setTimeout(() => {
          try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        }, 300);
      }
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!document.activeElement || !document.activeElement.matches('input, textarea')) {
          window.__kbHeight = 0;
          applyKb();
        }
      }, 120);
    });
  })();

  /* ================= INIT ================= */

  /* ---- In-app update (unduh + install di dalam app) ---- */
  function cmpVer(a, b) {
    const pa = String(a).replace(/^v/i,'').split('.').map(Number);
    const pb = String(b).replace(/^v/i,'').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }
  function showUpd(title, sub, pct, showInstall, showLater) {
    const ov = document.getElementById('updOverlay');
    if (!ov) return;
    ov.hidden = false;
    document.getElementById('updTitle').textContent = title;
    document.getElementById('updSub').textContent = sub;
    const fill = document.getElementById('updFill');
    const pctEl = document.getElementById('updPct');
    if (pct == null) {
      fill.style.width = '30%';
      fill.style.animation = 'updPulse 1.2s ease-in-out infinite';
      pctEl.textContent = '…';
    } else {
      fill.style.animation = 'none';
      fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      pctEl.textContent = Math.round(pct) + '%';
    }
    document.getElementById('updBtn').hidden = !showInstall;
    document.getElementById('updLater').hidden = !showLater;
  }
  function hideUpd() {
    const ov = document.getElementById('updOverlay');
    if (ov) ov.hidden = true;
  }
  let _updApkName = 'BoxAI-update.apk';
  let _updDlId = -1;
  async function startInAppUpdate(manual) {
    if (!NATIVE) {
      if (manual) toast('Update in-app hanya di aplikasi Android');
      return;
    }
    try {
      showUpd('Memeriksa update', 'Menghubungi server…', null, false, false);
      const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const tag = (data.tag_name || '').replace(/^v/i, '');
      const cur = (NATIVE.appVersion && NATIVE.appVersion()) || APP_VERSION;
      const asset = (data.assets || []).find(a => /\.apk$/i.test(a.name));
      if (!tag || !asset) {
        hideUpd();
        if (manual) toast('Tidak ada paket update');
        return;
      }
      if (cmpVer(tag, cur) <= 0) {
        hideUpd();
        if (manual) toast('Box AI ' + cur + ' sudah versi terbaru');
        return;
      }
      _updApkName = asset.name || ('BoxAI-v' + tag + '.apk');
      const sizeMb = asset.size ? (asset.size / 1048576).toFixed(1) : '?';
      showUpd(
        'Update v' + tag,
        'Versi kamu: ' + cur + ' · ' + sizeMb + ' MB\nMengunduh di dalam aplikasi…',
        0, false, true
      );
      const did = NATIVE.downloadUpdate(asset.browser_download_url, _updApkName);
      if (did < 0) {
        hideUpd();
        toast('Gagal memulai unduhan');
        return;
      }
      _updDlId = did;
      const t = setInterval(() => {
        let s = {};
        try { s = JSON.parse(NATIVE.updateStatus(did)); } catch (e) {}
        if (s.s === 8) {
          clearInterval(t);
          showUpd('Siap diinstall', 'Unduhan selesai. Ketuk Install untuk memasang v' + tag + '.', 100, true, true);
        } else if (s.s === 16 || s.s === 0) {
          clearInterval(t);
          hideUpd();
          toast('Unduhan update gagal');
        } else {
          const pct = s.t > 0 ? (s.b / s.t) * 100 : 5;
          showUpd('Mengunduh v' + tag, 'Jangan tutup aplikasi…', pct, false, true);
        }
      }, 400);
    } catch (e) {
      hideUpd();
      if (manual) toast('Gagal cek update: ' + (e.message || 'offline'));
    }
  }
  document.getElementById('updBtn') && document.getElementById('updBtn').addEventListener('click', () => {
    if (!NATIVE) return;
    const res = JSON.parse(NATIVE.installUpdate(_updApkName) || '{}');
    if (res.ok) {
      toast('Membuka installer…');
    } else if (res.error === 'need_permission') {
      toast(res.msg || 'Izinkan instalasi dari sumber ini');
    } else {
      toast('Install gagal: ' + (res.error || 'unknown'));
    }
  });
  document.getElementById('updLater') && document.getElementById('updLater').addEventListener('click', () => {
    if (_updDlId >= 0 && NATIVE && NATIVE.cancelUpdate) NATIVE.cancelUpdate(_updDlId);
    hideUpd();
  });
  async function checkUpdateSilent() {
    try {
      const key = 'box_last_update_check';
      const last = +(localStorage.getItem(key) || 0);
      if (Date.now() - last < 12 * 3600 * 1000) return;
      localStorage.setItem(key, String(Date.now()));
      if (!NATIVE) return;
      const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const data = await r.json();
      const tag = (data.tag_name || '').replace(/^v/i, '');
      const cur = (NATIVE.appVersion && NATIVE.appVersion()) || APP_VERSION;
      if (tag && cmpVer(tag, cur) > 0) startInAppUpdate(false);
    } catch (e) {}
  }
  setTimeout(checkUpdateSilent, 2800);
  // Minta izin storage + rescan model (Download / app lain)
  setTimeout(() => {
    try {
      if (!NATIVE) return;
      const n = JSON.parse(NATIVE.listModels() || '[]');
      if ((!n || !n.length) && NATIVE.requestStoragePermission) {
        // Jika belum ada model, minta akses folder agar scan lebih luas
        if (NATIVE.hasStoragePermission && !NATIVE.hasStoragePermission()) {
          toast('Izinkan akses file agar model di Download / app lain terdeteksi');
          NATIVE.requestStoragePermission();
        }
      }
      setTimeout(() => { syncLocal(); renderModels(); renderSettings(); updateTop(); }, 1500);
    } catch (e) {}
  }, 3500);

  // Jangan panggil listModels (native) sebelum splash hilang — scan bisa memblokir WebView
  applyWeb(); renderChat(); renderModels(); renderPals(); renderSettings(); updateTop();
  setTimeout(() => {
    try { syncLocal(); renderModels(); renderSettings(); updateTop(); } catch (e) {}
  }, 2200);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncLocal(); renderModels(); renderSettings(); updateTop(); } });
  // Refresh daftar model tiap kali buka tab Models
  const _go = typeof go === 'function' ? go : null;
  document.querySelectorAll('.tab[data-go="models"]').forEach(t => {
    t.addEventListener('click', () => setTimeout(() => { syncLocal(); renderModels(); }, 80));
  });
  // Periodik ringan saat di tab models
  setInterval(() => {
    if (document.hidden) return;
    const modelsScreen = document.getElementById('screen-models') || document.querySelector('.screen[data-name="models"]');
    if (modelsScreen && modelsScreen.classList.contains('active')) { syncLocal(); renderModels(); }
  }, 4000);
})();
