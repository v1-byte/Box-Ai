(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ic = (n, cls = '') => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ================= DATA & STATE ================= */
  const MODELS = [
    { id: 'gemma',   name: 'Gemma 2 2B Instruct',   short: 'Gemma 2 2B',   meta: '2,6B · Q4',  gb: 1.7, src: 'bundled' },
    { id: 'llama',   name: 'Llama 3.2 3B Instruct', short: 'Llama 3.2 3B', meta: '3,2B · Q4',  gb: 2.0, src: 'hub' },
    { id: 'phi',     name: 'Phi-3 Mini 4K',         short: 'Phi-3 Mini',   meta: '3,8B · Q4',  gb: 2.2, src: 'hub' },
    { id: 'mistral', name: 'Mistral Nemo 12B',      short: 'Mistral Nemo', meta: '12B · Q4',   gb: 7.1, src: 'hub' },
    { id: 'qwen',    name: 'Qwen2.5 7B Instruct',   short: 'Qwen2.5 7B',   meta: '7B · Q4',    gb: 4.4, src: 'hub' }
  ];
  const DEFAULT_PALS = [
    { id: 'chat',     name: 'Default Chat', desc: 'Asisten umum', icon: 'chat',   prompt: 'Kamu asisten yang membantu, ringkas, dan jujur.' },
    { id: 'writer',   name: 'Writer',       desc: 'Draf, tulis ulang, atur nada', icon: 'pen', prompt: 'Kamu penulis profesional. Bantu menyusun dan memperbaiki tulisan.' },
    { id: 'coder',    name: 'Coder',        desc: 'Jelaskan dan refaktor kode offline', icon: 'code', prompt: 'Kamu insinyur perangkat lunak senior. Jawab dengan kode yang rapi.' },
    { id: 'research', name: 'Research',     desc: 'Ringkas catatan dan PDF panjang', icon: 'search', prompt: 'Kamu asisten riset. Ringkas dan tarik poin penting dari dokumen.' }
  ];
  const SEED_CHAT = [
    { r: 'ai', h: '<p>Halo, saya <strong>Box AI</strong>. Semua berjalan di perangkatmu: tanpa cloud, tanpa akun untuk model lokal.</p><p class="muted-line">Tanya apa saja, lampirkan file, atau ganti model dari tab Models.</p>' },
    { r: 'user', t: 'Apa saja yang bisa kamu lakukan secara offline?' },
    { r: 'ai', h: '<ul><li>Chat dengan LLM yang sudah diunduh (Llama, Phi, Gemma, Mistral)</li><li>Pals multimodal: gambar dan suara di model yang mendukung</li><li>Konteks dokumen langsung di perangkat</li><li>Benchmark dan atur sampler</li></ul>' }
  ];
  const DEFAULTS = {
    theme: 'system', lang: 'id', haptics: true, onDevice: true,
    temp: 0.7, topp: 0.9, maxTok: 2048, ctx: 4096,
    active: 'gemma', dl: { gemma: true }, pal: null, pals: [],
    cache: { kv: 312, tmp: 148, thumbs: 86, logs: 24 },
    chat: SEED_CHAT, typing: true, sort: 'default'
  };
  let S;
  try { S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('boxai.v2') || '{}')); } catch (e) { S = Object.assign({}, DEFAULTS); }
  const save = () => { try { localStorage.setItem('boxai.v2', JSON.stringify(S)); } catch (e) {} };
  const model = id => MODELS.find(m => m.id === id);
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
  const MMETA_DEF = {
    gemma:   { file: 'gemma-2-2b-it-Q4_K_M.gguf',            arch: 'gemma2',  quant: 'Q4_K_M', ctx: 8192,   tpl: 'gemma',   tensors: 288, kv: 32 },
    llama:   { file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',    arch: 'llama',   quant: 'Q4_K_M', ctx: 131072, tpl: 'llama3',  tensors: 255, kv: 30 },
    phi:     { file: 'Phi-3-mini-4k-instruct-Q4_K_M.gguf',   arch: 'phi3',    quant: 'Q4_K_M', ctx: 4096,   tpl: 'phi3',    tensors: 195, kv: 28 },
    mistral: { file: 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf', arch: 'llama', quant: 'Q4_K_M', ctx: 131072, tpl: 'mistral', tensors: 363, kv: 34 },
    qwen:    { file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',      arch: 'qwen2',   quant: 'Q4_K_M', ctx: 32768,  tpl: 'chatml',  tensors: 339, kv: 33 }
  };
  function seedFs() {
    const t = Date.now();
    return {
      dirs: [ROOT, ROOT + '/models', ROOT + '/prompts', ROOT + '/catatan'],
      files: {
        [ROOT + '/prompts/default.txt']: { c: 'Kamu asisten yang membantu, ringkas, dan jujur.\nJawab dalam bahasa yang dipakai pengguna.\n', m: t },
        [ROOT + '/prompts/penulis.txt']: { c: 'Kamu penulis profesional.\nPerbaiki tata bahasa, jaga nada asli penulis, dan jelaskan perubahan penting secara singkat.\n', m: t },
        [ROOT + '/catatan/catatan-model.md']: { c: '# Catatan model\n\n- Gemma 2 2B: cepat untuk chat harian.\n- Tambahkan catatanmu di sini.\n', m: t }
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
  }
  $$('[data-go]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); go(el.dataset.go); }));
  $('#btnMenu').addEventListener('click', () => go('gallery'));

  /* ================= SPLASH ================= */
  const splash = $('#splash'), bar = $('#bootBar'), bootText = $('#bootText');
  [[25, 'Menyiapkan mesin on-device'], [60, 'Memeriksa model lokal'], [90, 'Hampir siap'], [100, 'Siap']]
    .forEach(([w, t], i) => setTimeout(() => { bar.style.width = w + '%'; bootText.textContent = t; }, 1300 + i * 380));
  setTimeout(() => {
    splash.classList.add('out'); setTimeout(() => splash.remove(), 700);
    const m = $('#messages'); m.scrollTop = m.scrollHeight;
  }, 3100);

  /* ================= CHAT ================= */
  const messages = $('#messages'), input = $('#composerInput'), sendBtn = $('#btnSend');
  let attachment = null;
  const subText = () => (S.pal ? (allPals().find(p => p.id === S.pal) || {}).name + ' · ' : '') + model(S.active).short + ' · ' + (S.onDevice ? 'On-device' : 'Online');
  function updateTop() { $('#chatSub').textContent = subText(); }
  function aiRow(inner) {
    return `<div class="row ai"><img src="assets/logo-64.png" class="av" alt="" width="30" height="30" /><div class="bubble">${inner}</div></div>`;
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
        else h += `<div class="row user"><div class="bubble">${m.f ? `<div class="file-bubble">${ic('file')}${esc(m.f)}</div>` : ''}${esc(m.t)}</div></div>`;
      });
    }
    if (S.typing && S.chat.length) h += `<div class="row ai" id="typingRow"><img src="assets/logo-64.png" class="av" alt="" width="30" height="30" /><div class="bubble typing" aria-label="Sedang mengetik"><i></i><i></i><i></i></div></div>`;
    messages.innerHTML = h;
    $$('.suggest button', messages).forEach(b => b.addEventListener('click', () => { input.value = b.textContent + ': '; input.focus(); sendBtn.classList.add('ready'); }));
    messages.scrollTop = messages.scrollHeight;
  }
  function send() {
    const text = (input.value || '').trim();
    if (!text && !attachment) return;
    S.typing = false;
    S.chat.push({ r: 'user', t: text || '(lampiran)', f: attachment ? attachment.name : undefined });
    S.cache.kv += 1.5;
    save(); renderChat();
    const us = $$('.row.user', messages), last = us[us.length - 1]; last && last.classList.add('pop');
    input.value = ''; sendBtn.classList.remove('ready'); clearAttachment();
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

  /* lampiran */
  const fileInput = $('#fileInput'), chip = $('#attachChip');
  function clearAttachment() { attachment = null; chip.hidden = true; chip.innerHTML = ''; fileInput.value = ''; }
  function setAttachment(f) {
    attachment = f;
    chip.hidden = false;
    chip.innerHTML = `${ic('file')}<span>${esc(f.name)} <small>${fmtMB(Math.max(f.size / 1048576, 0.1))}</small></span><button type="button" aria-label="Hapus lampiran">${ic('x')}</button>`;
    $('button', chip).addEventListener('click', () => { clearAttachment(); sendBtn.classList.toggle('ready', input.value.trim().length > 0); });
    sendBtn.classList.add('ready');
    S.cache.thumbs += Math.max(f.size / 1048576, 0.5); save();
  }
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setAttachment(fileInput.files[0]); });
  $('#btnAttach').addEventListener('click', async () => {
    const v = await openSheet(`<h2>Lampirkan</h2><div style="height:6px"></div>
      <button class="opt" data-v="image">${ic('image')}<span class="o-txt">Foto dari galeri<small>JPG, PNG, WebP</small></span></button>
      <button class="opt" data-v="camera">${ic('camera')}<span class="o-txt">Kamera<small>Ambil foto langsung</small></span></button>
      <button class="opt" data-v="file">${ic('file')}<span class="o-txt">File atau dokumen<small>PDF, TXT, dan lainnya</small></span></button>`,
      (el, close) => $$('.opt', el).forEach(b => b.addEventListener('click', () => close(b.dataset.v))));
    if (!v) return;
    fileInput.accept = v === 'file' ? '' : 'image/*';
    if (v === 'camera') fileInput.setAttribute('capture', 'environment'); else fileInput.removeAttribute('capture');
    fileInput.click();
  });

  /* ================= MODELS ================= */
  let filter = 'all';
  const dlProg = {};
  function modelCard(m) {
    const has = !!S.dl[m.id], act = S.active === m.id, prog = dlProg[m.id];
    let right;
    if (act) right = '<span class="tag ok"><i></i>Aktif</span>';
    else if (has) right = '<button type="button" class="btn-use" data-act="use">Pakai</button>';
    else right = `<button type="button" class="btn-dl ${prog != null ? 'loading' : ''}" style="--p:${prog || 0}" data-act="dl" aria-label="Unduh">${ic('down')}<em></em></button>`;
    return `<article class="model-card ${act ? 'installed' : ''}" data-id="${m.id}">
      <div class="m-ico">${ic('cube')}</div>
      <div class="model-info"><strong>${esc(mname(m))}</strong><span>${m.meta} · ${fmtGB(m.gb)}</span></div>${right}</article>`;
  }
  function renderModels() {
    let list = MODELS.slice();
    if (S.sort === 'size') list.sort((a, b) => a.gb - b.gb); else if (S.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (filter === 'dl') list = list.filter(m => S.dl[m.id]);
    if (filter === 'hub') list = list.filter(m => m.src === 'hub');
    const ready = list.filter(m => S.dl[m.id]), avail = list.filter(m => !S.dl[m.id]);
    let h = '';
    if (ready.length) h += '<h3 class="section-h">Siap di perangkat</h3>' + ready.map(modelCard).join('');
    if (avail.length) h += '<h3 class="section-h">Tersedia</h3>' + avail.map(modelCard).join('');
    if (!h) h = '<p class="empty">Belum ada model yang cocok dengan filter ini.</p>';
    $('#modelList').innerHTML = h;
  }
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    $$('.chip').forEach(x => x.classList.remove('active')); c.classList.add('active');
    filter = c.dataset.f; renderModels();
  }));
  function startDownload(id) {
    if (dlProg[id] != null || S.dl[id]) return;
    dlProg[id] = 0; renderModels(); toast('Mengunduh ' + model(id).short);
    const t = setInterval(() => {
      dlProg[id] += 2 + Math.random() * 5;
      if (dlProg[id] >= 100) {
        clearInterval(t); delete dlProg[id]; S.dl[id] = true; S.cache.tmp += 30; save();
        renderModels(); renderSettings(); toast(model(id).short + ' siap dipakai');
      } else { const b = $(`.model-card[data-id="${id}"] .btn-dl`); b && b.style.setProperty('--p', dlProg[id]); }
    }, 120);
  }
  function useModel(id) {
    S.active = id; save(); updateTop(); renderModels(); renderSettings(); toast(model(id).short + ' sekarang aktif');
  }
  async function modelSheet(id) {
    const m = model(id), has = !!S.dl[id], act = S.active === id;
    const v = await openSheet(`<h2>${esc(mname(m))}</h2><p class="sub">Model bahasa lokal berformat GGUF.</p>
      <div class="kv"><span>Parameter</span><span>${m.meta}</span></div>
      <div class="kv"><span>Ukuran file</span><span>${fmtGB(m.gb)}</span></div>
      <div class="kv"><span>Sumber</span><span>${m.src === 'hub' ? 'HF Hub' : 'Bawaan aplikasi'}</span></div>
      <div class="kv"><span>Status</span><span>${act ? 'Aktif' : has ? 'Terunduh' : dlProg[id] != null ? 'Mengunduh' : 'Belum diunduh'}</span></div>
      ${!has ? '<button class="btn primary" data-v="dl">Unduh ' + fmtGB(m.gb) + '</button>' : ''}
      ${has && !act ? '<button class="btn primary" data-v="use">Pakai model ini</button><button class="btn danger" data-v="del" style="margin-top:8px">Hapus dari perangkat</button>' : ''}
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
        delete S.dl[id]; save(); renderModels(); renderSettings(); toast(m.short + ' dihapus');
      }
    }
  }
  $('#modelList').addEventListener('click', e => {
    const card = e.target.closest('.model-card'); if (!card) return;
    const id = card.dataset.id, a = e.target.closest('[data-act]');
    if (a && a.dataset.act === 'dl') return startDownload(id);
    if (a && a.dataset.act === 'use') return useModel(id);
    modelSheet(id);
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
    const b = $('#v-onDevice'); b.textContent = S.onDevice ? 'ON' : 'OFF';
    b.style.color = S.onDevice ? '' : 'var(--bad)'; b.style.background = S.onDevice ? '' : 'rgba(255,93,108,.12)';
    $('#finderHint').textContent = MODELS.filter(m => S.dl[m.id]).length + ' model terunduh · ' + ROOT;
    $('#cleanHint').textContent = cleanableSafe() > 1 ? fmtMB(cleanableSafe()) + ' cache bisa dibersihkan' : 'Penyimpanan sudah bersih';
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
      if (v) { S.lang = v; save(); renderSettings(); if (v === 'en') toast('Pilihan disimpan. Terjemahan penuh belum tersedia di prototipe ini.'); }
    },
    async model() {
      const opts = MODELS.filter(m => S.dl[m.id]).map(m => ({ v: m.id, l: m.name, s: fmtGB(m.gb) }));
      const v = await choose('Model default', opts, S.active, 'Hanya model yang sudah diunduh.');
      if (v) useModel(v);
    },
    async temp() { const v = await slider('Temperature', 'Nilai rendah lebih konsisten, nilai tinggi lebih kreatif.', 0, 2, 0.1, S.temp, x => x.toFixed(1).replace('.', ',')); if (v != null) { S.temp = +v.toFixed(1); save(); renderSettings(); } },
    async topp() { const v = await slider('Top-p', 'Batas probabilitas kumulatif saat memilih kata berikutnya.', 0, 1, 0.05, S.topp, x => x.toFixed(2).replace('.', ',')); if (v != null) { S.topp = +v.toFixed(2); save(); renderSettings(); } },
    async maxTok() { const v = await slider('Max tokens', 'Panjang maksimum satu jawaban.', 256, 4096, 128, S.maxTok, x => String(x)); if (v != null) { S.maxTok = v; save(); renderSettings(); } },
    async ctx() { const v = await slider('Ukuran konteks', 'Konteks besar memakai lebih banyak RAM.', 1024, 8192, 1024, S.ctx, x => String(x)); if (v != null) { S.ctx = v; save(); renderSettings(); } },
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
        <p><b>Box AI UI</b><br>Prototipe antarmuka, build rebrand.</p>
        <p><b>PocketPal AI</b><br>Arsitektur dasar, lisensi MIT.</p>
        <p><b>llama.cpp</b><br>Mesin inferensi, lisensi MIT.</p>
        <p><b>Model</b><br>Gemma: Gemma Terms of Use. Llama 3.2: Llama Community License. Phi-3: MIT. Mistral Nemo dan Qwen2.5: Apache 2.0.</p></div>
        <button class="btn ghost" data-close>Tutup</button>`);
    },
    version() { toast('Box AI 1.0.0 adalah versi terbaru'); }
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
      kv: S.cache.kv, tmp: S.cache.tmp, thumbs: S.cache.thumbs, logs: S.cache.logs,
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
        el.textContent = 'Penyimpanan aplikasi web ini (nyata): ' + fmtMB((e.usage || 0) / 1048576) + ' dari ' + fmtMB((e.quota || 0) / 1048576) + '. Ukuran di atas adalah simulasi.';
      }).catch(() => { el.textContent = 'Ukuran di atas adalah simulasi.'; });
    } else el.textContent = 'Ukuran di atas adalah simulasi.';
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
    if (sel.kv) S.cache.kv = 0; if (sel.tmp) S.cache.tmp = 0; if (sel.thumbs) S.cache.thumbs = 0; if (sel.logs) S.cache.logs = 0;
    if (sel.chat) { S.chat = []; S.typing = false; renderChat(); clearAttachment(); }
    if (sel.models) MODELS.forEach(m => { if (m.id !== S.active) delete S.dl[m.id]; });
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
    else openEditor(ent);
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
    if (ent.mid) { meta(ent.mid).file = name; meta(ent.mid).mod = Date.now(); }
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
        delete S.dl[ent.mid]; save(); renderFinder(); renderModels(); renderSettings(); toast('Model dihapus');
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
    if (ed.mid) {
      let o;
      try { o = JSON.parse(edText.value); } catch (err) { return toast('JSON tidak valid: ' + String(err.message).slice(0, 60)); }
      const mt = meta(ed.mid);
      if (typeof o.name !== 'string' || !o.name.trim()) return toast('Field "name" tidak boleh kosong');
      if (!Number.isFinite(o.context_length) || o.context_length < 256) return toast('"context_length" harus angka minimal 256');
      if (typeof o.chat_template !== 'string' || typeof o.system_prompt !== 'string') return toast('"chat_template" dan "system_prompt" harus berupa teks');
      let file = typeof o.file === 'string' ? o.file.trim() : mt.file;
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
    const d = MMETA_DEF[id];
    const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const u64 = n => u32(n).concat([0, 0, 0, 0]);
    const str = t => u64(t.length).concat(Array.from(t).map(c => c.charCodeAt(0)));
    return [0x47, 0x47, 0x55, 0x46].concat(u32(3), u64(d.tensors), u64(d.kv), str('general.architecture'), u32(8), str(d.arch));
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
    gg = { mid: id }; const m = model(id), mt = meta(id), d = MMETA_DEF[id];
    $('#ggTitle').textContent = mt.file; $('#ggPath').textContent = ROOT + '/models';
    $('#ggSize').textContent = fmtBytes(m.gb * 1073741824);
    $('#ggInfo').innerHTML = [['Format', 'GGUF v3'], ['Arsitektur', d.arch], ['Parameter', m.meta.split(' · ')[0]], ['Kuantisasi', d.quant], ['Jumlah tensor', d.tensors], ['Pasangan metadata', d.kv], ['Terakhir diubah', fmtDate(mt.mod || S.installAt)]]
      .map(r => `<div class="kv"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
    $('#ggFile').value = mt.file; $('#ggName').value = mt.name; $('#ggCtx').value = mt.ctx; $('#ggTpl').value = mt.tpl; $('#ggSys').value = mt.sys; $('#ggPreset').value = '';
    $('#ggHex').textContent = hexdump(ggufBytes(id));
    ggUpdate(); go('gguf'); screens.gguf.querySelector('.scroll').scrollTop = 0;
  }
  ['#ggFile', '#ggName', '#ggCtx', '#ggTpl', '#ggSys'].forEach(q => $(q).addEventListener('input', ggUpdate));
  $('#ggPreset').addEventListener('change', e => { if (e.target.value) { $('#ggTpl').value = TPL[e.target.value]; ggUpdate(); } });
  $('#ggSave').addEventListener('click', () => {
    const f = ggFields(), mt = meta(gg.mid);
    let file = f.file; if (!/\.gguf$/i.test(file)) file += '.gguf';
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

  /* ================= INIT ================= */
  renderChat(); renderModels(); renderPals(); renderSettings(); updateTop();
})();
