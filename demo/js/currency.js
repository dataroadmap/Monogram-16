/* MarketLens — currency rates and converter view. */
(function () {
  'use strict';

  // Fallback USD-based rates, used only if the live feed is unreachable.
  const FALLBACK = {
    USD: 1, EUR: 0.92, GBP: 0.78, JPY: 149.5, CNY: 7.24, CAD: 1.36, AUD: 1.52, CHF: 0.88, INR: 83.2,
    IRR: 42100, AED: 3.6725, SAR: 3.75, TRY: 32.5, SGD: 1.34, HKD: 7.82, KRW: 1340, MXN: 17.1, BRL: 5.0,
    SEK: 10.6, NOK: 10.7, DKK: 6.87, PLN: 3.98, ZAR: 18.6, NZD: 1.64, RUB: 91, THB: 36, IDR: 15700,
  };
  const POPULAR = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF', 'INR', 'AED', 'SGD', 'HKD'];

  const state = { rates: { ...FALLBACK }, live: false, updated: null, listeners: [] };
  let displayNames = null;
  try { displayNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (e) {}

  function name(code) {
    try { return displayNames ? displayNames.of(code) : code; } catch (e) { return code; }
  }
  function flag(code) {
    if (code === 'EUR') return '🇪🇺';
    if (!/^[A-Z]{3}$/.test(code) || code[0] === 'X') return '💱';
    return String.fromCodePoint(...[...code.slice(0, 2)].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
  }
  function convert(amount, from, to) {
    const a = state.rates[from], b = state.rates[to];
    if (!a || !b) return null;
    return amount / a * b;
  }
  function format(value, code, opts = {}) {
    if (value == null || isNaN(value)) return '—';
    const abs = Math.abs(value);
    const digits = opts.digits != null ? opts.digits : abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    } catch (e) {
      return value.toLocaleString('en-US', { maximumFractionDigits: digits }) + ' ' + code;
    }
  }
  function onChange(fn) { state.listeners.push(fn); }

  async function loadRates() {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (data.result !== 'success' || !data.rates) throw new Error('bad payload');
      state.rates = data.rates;
      state.live = true;
      state.updated = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000) : new Date();
    } catch (e) {
      state.live = false;
    }
    state.listeners.forEach(fn => fn(state));
  }

  // ------------------------------------------------------------------ view
  let chart = null;
  const $ = id => document.getElementById(id);

  function codes() { return Object.keys(state.rates).sort(); }

  function fillSelect(sel, value) {
    const all = codes();
    const top = POPULAR.filter(c => all.includes(c));
    const rest = all.filter(c => !top.includes(c));
    const opt = c => `<option value="${c}">${flag(c)} ${c} — ${name(c)}</option>`;
    sel.innerHTML = `<optgroup label="Popular">${top.map(opt).join('')}</optgroup><optgroup label="All currencies">${rest.map(opt).join('')}</optgroup>`;
    sel.value = all.includes(value) ? value : 'USD';
  }

  function saved(key, dflt) { try { return localStorage.getItem(key) || dflt; } catch (e) { return dflt; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

  function render() {
    const amount = parseFloat($('fxAmount').value) || 0;
    const from = $('fxFrom').value, to = $('fxTo').value;
    const out = convert(amount, from, to);
    $('fxResult').textContent = format(out, to, { digits: Math.abs(out) >= 1 ? 2 : 4 });
    const one = convert(1, from, to);
    $('fxRate').textContent = `1 ${from} = ${one != null ? one.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'} ${to}  ·  1 ${to} = ${one ? (1 / one).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'} ${from}`;
    $('fxQuickLabel').textContent = `${format(amount, from)} in popular currencies`;
    $('fxGrid').innerHTML = POPULAR.filter(c => c !== from && state.rates[c]).map(c => `
      <button class="fx-tile" data-code="${c}" title="Convert to ${name(c)}">
        <div class="code">${flag(c)} ${c}</div>
        <div class="amt">${format(convert(amount, from, c), c)}</div>
      </button>`).join('');
    save('ml-fx-from', from); save('ml-fx-to', to);
  }

  let trendTimer = null;
  function scheduleTrend() { clearTimeout(trendTimer); trendTimer = setTimeout(loadTrend, 250); }

  async function loadTrend() {
    const from = $('fxFrom').value, to = $('fxTo').value;
    const label = $('fxTrendLabel');
    if (from === to) { label.textContent = 'Same currency'; drawTrend([], []); return; }
    const end = new Date(), start = new Date(Date.now() - 30 * 864e5);
    const iso = d => d.toISOString().slice(0, 10);
    label.textContent = `${from} → ${to} · loading…`;
    try {
      const res = await fetch(`https://api.frankfurter.app/${iso(start)}..${iso(end)}?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const days = Object.keys(data.rates || {}).sort();
      if (!days.length) throw new Error('empty');
      const vals = days.map(d => data.rates[d][to]);
      const first = vals[0], last = vals[vals.length - 1];
      const pct = (last - first) / first * 100;
      label.textContent = `${from} → ${to} · ${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}% over 30 days`;
      drawTrend(days, vals);
    } catch (e) {
      label.textContent = `History isn't available for ${from} → ${to}`;
      drawTrend([], []);
    }
  }

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function drawTrend(labels, values) {
    if (!window.Chart) return;
    const ctx = $('fxChart');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: css('--series-1'), backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: c => c.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 6 }) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: css('--text-3'), maxTicksLimit: 6 }, border: { color: css('--grid') } },
          y: { grid: { color: css('--grid') }, ticks: { color: css('--text-3'), maxTicksLimit: 5 }, border: { display: false } },
        },
      },
    });
  }

  function initView() {
    fillSelect($('fxFrom'), saved('ml-fx-from', 'USD'));
    fillSelect($('fxTo'), saved('ml-fx-to', 'EUR'));
    $('fxAmount').addEventListener('input', render);
    $('fxFrom').addEventListener('change', () => { render(); scheduleTrend(); });
    $('fxTo').addEventListener('change', () => { render(); scheduleTrend(); });
    $('fxSwap').addEventListener('click', () => {
      const a = $('fxFrom').value; $('fxFrom').value = $('fxTo').value; $('fxTo').value = a; render(); scheduleTrend();
    });
    $('fxGrid').addEventListener('click', e => {
      const t = e.target.closest('.fx-tile'); if (!t) return;
      $('fxTo').value = t.dataset.code; render(); scheduleTrend();
    });
    onChange(() => {
      const f = $('fxFrom').value, t = $('fxTo').value;
      fillSelect($('fxFrom'), f); fillSelect($('fxTo'), t);
      $('fxStatus').textContent = state.live
        ? `Live rates · updated ${state.updated.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${codes().length} currencies`
        : 'Offline — showing approximate reference rates';
      render();
    });
    render();
  }

  let trendLoaded = false;
  function onShow() { if (!trendLoaded) { trendLoaded = true; loadTrend(); } else if (chart) chart.resize(); }
  function refreshTheme() { if (trendLoaded) loadTrend(); }

  window.MLCurrency = { state, loadRates, convert, format, name, flag, codes, onChange, initView, onShow, refreshTheme, POPULAR };
})();
