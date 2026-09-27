/* MasterLens — app shell: routing, theme, file loading, settings. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ROUTES = ['home', 'bigtech', 'dashboard', 'chat', 'currency', 'clocks'];
  const hooks = { bigtech: MLBigTech, dashboard: MLDashboard, chat: MLChat, currency: MLCurrency, clocks: MLClocks };
  let current = null;

  // ---------------------------------------------------------------- routing
  function route() {
    const r = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    if (r === current) return;
    if (current && hooks[current] && hooks[current].onHide) hooks[current].onHide();
    ROUTES.forEach(x => { $('view-' + x).hidden = x !== r; });
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    $('nav').classList.remove('open');
    current = r;
    if (hooks[r] && hooks[r].onShow) requestAnimationFrame(() => hooks[r].onShow());
    window.scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------------ theme
  function effectiveDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function toggleTheme() {
    const next = effectiveDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ml-theme', next); } catch (e) {}
    MLDashboard.render();
    MLCurrency.refreshTheme();
  }

  // ------------------------------------------------------------------ toast
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------- documents
  function loadDoc(text, name) {
    const doc = MLParser.analyze(text, name);
    if (doc.words < 200) throw new Error('That file has very little readable text. If it is a scanned PDF, try the HTML version from SEC EDGAR.');
    MLDashboard.setDoc(doc);
    MLChat.setDoc(doc);
    $('docCard').hidden = false;
    $('docName').textContent = doc.meta.company;
    const found = Object.keys(doc.metrics).length;
    $('docInfo').textContent = `${name} · FY${doc.meta.fiscalYear} · ${doc.words.toLocaleString()} words · ${doc.sections.length} sections · ${found} line items`;
    return doc;
  }

  async function handleFile(file) {
    if (!file) return;
    const prog = $('dzProgress'), bar = $('dzBar'), status = $('dzStatus');
    prog.hidden = false; bar.style.width = '5%'; status.textContent = `Reading ${file.name}…`;
    try {
      const text = await MLParser.fileToText(file, p => { bar.style.width = Math.round(5 + p * 85) + '%'; status.textContent = `Reading pages… ${Math.round(p * 100)}%`; });
      bar.style.width = '95%'; status.textContent = 'Analyzing…';
      await new Promise(r => setTimeout(r, 30));
      const doc = loadDoc(text, file.name);
      bar.style.width = '100%'; status.textContent = 'Done';
      toast(`Loaded ${doc.meta.company}`);
      setTimeout(() => { location.hash = '#dashboard'; }, 400);
    } catch (err) {
      status.textContent = err.message || 'Could not read that file.';
      toast('Could not read that file');
    } finally {
      setTimeout(() => { prog.hidden = true; }, 2500);
    }
  }

  function loadSample() {
    loadDoc(MLSample.text, MLSample.name);
    toast('Sample report loaded');
    location.hash = '#dashboard';
  }

  // ----------------------------------------------------------------- reader
  function openReader(title, text) {
    $('readerTitle').textContent = title;
    $('readerText').textContent = text;
    $('readerDialog').showModal();
    $('readerText').scrollTop = 0;
  }

  // --------------------------------------------------------------- settings
  function openSettings() {
    let key = '';
    try { key = sessionStorage.getItem('ml-key') || localStorage.getItem('ml-key') || ''; } catch (e) {}
    $('apiKey').value = key;
    $('settingsDialog').showModal();
  }
  function saveSettings() {
    const key = $('apiKey').value.trim();
    const remember = $('rememberKey').checked;
    try {
      localStorage.removeItem('ml-key'); sessionStorage.removeItem('ml-key');
      if (key) (remember ? localStorage : sessionStorage).setItem('ml-key', key);
    } catch (e) {}
    MLChat.updateMode();
    toast(key ? 'Claude AI mode on' : 'Offline mode');
  }

  // ------------------------------------------------------------------ init
  function init() {
    MLCurrency.initView();
    MLDashboard.init();
    MLBigTech.init();
    MLChat.init();
    MLClocks.init();
    MLCurrency.loadRates();

    const dz = $('dropzone'), input = $('fileInput');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', () => { handleFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
    // Allow dropping anywhere on the home view.
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0] && current === 'home') handleFile(e.dataTransfer.files[0]); });

    document.querySelectorAll('[data-action="sample"]').forEach(b => b.addEventListener('click', loadSample));
    $('themeToggle').addEventListener('click', toggleTheme);
    $('settingsBtn').addEventListener('click', openSettings);
    $('saveSettings').addEventListener('click', saveSettings);
    $('readerClose').addEventListener('click', () => $('readerDialog').close());
    $('readerDialog').addEventListener('click', e => { if (e.target === $('readerDialog')) $('readerDialog').close(); });
    $('menuBtn').addEventListener('click', () => $('nav').classList.toggle('open'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { MLDashboard.render(); MLCurrency.refreshTheme(); });

    // Open in a working state: show the sample until the user uploads their own filing.
    try { loadDoc(MLSample.text, MLSample.name); } catch (e) {}

    window.addEventListener('hashchange', route);
    route();
  }

  window.MLApp = { toast, openReader, openSettings };
  init();
})();
