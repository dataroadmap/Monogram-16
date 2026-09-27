/* MarketLens — dashboard view. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const UNIT = { thousands: 1e3, millions: 1e6, billions: 1e9 };
  let doc = null, currency = 'USD', trendChart = null;

  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Money in the reporting unit -> absolute value in the selected currency.
  function toDisplay(v) {
    if (v == null) return null;
    const abs = v * (UNIT[doc.meta.unit] || 1e6);
    return currency === 'USD' ? abs : MLCurrency.convert(abs, 'USD', currency);
  }
  function money(v, compact = true) {
    const x = toDisplay(v);
    if (x == null || isNaN(x)) return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0 }).format(x);
    } catch (e) { return x.toLocaleString('en-US', { notation: 'compact' }) + ' ' + currency; }
  }
  function perShare(v) {
    if (v == null) return '—';
    const x = currency === 'USD' ? v : MLCurrency.convert(v, 'USD', currency);
    return MLCurrency.format(x, currency, { digits: 2 });
  }
  const pct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
  const m = (k, i = 0) => doc.metrics[k] ? doc.metrics[k][i] : null;
  const growth = k => (m(k, 0) != null && m(k, 1)) ? (m(k, 0) - m(k, 1)) / Math.abs(m(k, 1)) : null;

  function deltaHtml(g, label = 'vs prior year') {
    if (g == null || !isFinite(g)) return '<span class="sub">No prior-year figure found</span>';
    const up = g >= 0;
    return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(g * 100).toFixed(1)}%</span> <span class="sub">${label}</span>`;
  }

  function renderKpis() {
    const rev = m('revenue'), ni = m('netIncome');
    const tiles = [
      { label: 'Revenue', value: money(rev), delta: deltaHtml(growth('revenue')), accent: true },
      { label: 'Net income', value: money(ni), delta: deltaHtml(growth('netIncome')) },
      { label: 'Net margin', value: pct(rev && ni != null ? ni / rev : null), delta: `<span class="sub">Net income ÷ revenue</span>` },
      { label: 'Diluted EPS', value: perShare(m('epsDiluted')), delta: deltaHtml(growth('epsDiluted')) },
      { label: 'Operating cash flow', value: money(m('operatingCashFlow')), delta: deltaHtml(growth('operatingCashFlow')) },
      { label: 'Cash & equivalents', value: money(m('cash')), delta: deltaHtml(growth('cash')) },
    ];
    $('kpiGrid').innerHTML = tiles.map(t => `
      <div class="kpi${t.accent ? ' accent' : ''}">
        <div class="label">${t.label}</div>
        <div class="value">${t.value}</div>
        ${t.delta}
      </div>`).join('');
  }

  function renderTrend() {
    const s1 = css('--series-1'), s2 = css('--series-2');
    $('trendLegend').innerHTML = `<span><i style="background:${s1}"></i>Revenue</span><span><i style="background:${s2}"></i>Net income</span>`;
    const n = Math.max((doc.metrics.revenue || []).length, (doc.metrics.netIncome || []).length);
    const idx = [...Array(n).keys()].reverse();
    const labels = idx.map(i => 'FY' + doc.years[i]);
    const series = k => idx.map(i => { const v = m(k, i); return v == null ? null : toDisplay(v); });
    $('trendUnit').textContent = currency + (currency !== 'USD' ? ' (converted at today’s rate)' : '');
    if (!window.Chart) { const c = $('trendChart'); if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Charts need an internet connection to load. The figures are in the table below.' })); return; }
    if (trendChart) trendChart.destroy();
    const fmt = v => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    trendChart = new Chart($('trendChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Revenue', data: series('revenue'), backgroundColor: s1, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 44, categoryPercentage: .6, barPercentage: .9 },
          { label: 'Net income', data: series('netIncome'), backgroundColor: s2, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 44, categoryPercentage: .6, barPercentage: .9 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : fmt(c.parsed.y)} ${currency}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: css('--text-2'), font: { family: 'Montserrat', weight: 600 } }, border: { color: css('--grid') } },
          y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--text-3'), callback: fmt, maxTicksLimit: 6 } },
        },
      },
    });
  }

  function renderTone() {
    const t = doc.tone;
    const score = Math.max(-1, Math.min(1, t.score));
    const angle = Math.PI * (1 - (score + 1) / 2); // pi (left, negative) .. 0 (right, positive)
    const cx = 100, cy = 100, r = 78;
    const px = cx + r * Math.cos(angle), py = cy - r * Math.sin(angle);
    const label = score > 0.15 ? 'Positive' : score < -0.15 ? 'Cautious' : 'Balanced';
    const arc = (a0, a1, color) => {
      const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
      return `<path d="M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}" stroke="${color}" stroke-width="16" fill="none" />`;
    };
    const g = $('toneGauge');
    g.setAttribute('aria-label', `Filing tone ${label}, score ${score.toFixed(2)} on a scale of minus one to one`);
    g.innerHTML = `
      ${arc(Math.PI, Math.PI * 0.67 + 0.02, css('--bad'))}
      ${arc(Math.PI * 0.67 - 0.02, Math.PI * 0.33 + 0.02, css('--neutral'))}
      ${arc(Math.PI * 0.33 - 0.02, 0, css('--good'))}
      <line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="${css('--text')}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="8" fill="${css('--text')}"/>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="18" font-weight="800" fill="${css('--text')}" style="font-family:Montserrat,system-ui,sans-serif">${label}</text>`;
    $('toneList').innerHTML = [
      ['Positive words', t.positive, t.per1k.positive],
      ['Negative words', t.negative, t.per1k.negative],
      ['Uncertainty words', t.uncertainty, t.per1k.uncertainty],
    ].map(([n, c, p]) => `<li><span>${n}</span><b>${c.toLocaleString()} · ${p.toFixed(1)}/1k</b></li>`).join('');
  }

  function hbars(el, rows, fmt, color) {
    const max = Math.max(...rows.map(r => Math.abs(r.value || 0)), 1e-9);
    el.innerHTML = rows.length ? rows.map(r => `
      <div class="hbar" title="${esc(r.name)}: ${fmt(r.value)}">
        <span class="name">${esc(r.name)}</span>
        <span class="track"><span class="fill" style="width:${r.value == null ? 0 : Math.max(2, Math.abs(r.value) / max * 100)}%;background:${color}"></span></span>
        <span class="val">${fmt(r.value)}</span>
      </div>`).join('') : '<p class="muted small">Not enough data found in this filing.</p>';
  }

  function renderMargins() {
    const rev = m('revenue');
    const rows = [
      ['Gross margin', m('grossProfit')],
      ['Operating margin', m('operatingIncome')],
      ['Net margin', m('netIncome')],
      ['R&D intensity', m('rnd')],
      ['FCF margin', m('operatingCashFlow') != null && m('capex') != null ? m('operatingCashFlow') - Math.abs(m('capex')) : null],
    ].filter(([, v]) => v != null && rev).map(([name, v]) => ({ name, value: v / rev }));
    hbars($('marginBars'), rows, pct, css('--series-1'));
  }

  function renderBalance() {
    const a = m('totalAssets'), l = m('totalLiabilities'), e = m('equity');
    const el = $('balanceStack');
    if (!a || l == null || e == null) { el.innerHTML = '<p class="muted small">Balance sheet totals were not found.</p>'; return; }
    const s1 = css('--series-1'), s3 = css('--series-3');
    const lp = l / (l + e) * 100;
    el.innerHTML = `
      <div class="muted small">Total assets <b style="color:var(--text)">${money(a)}</b></div>
      <div class="stack-bar" role="img" aria-label="Liabilities ${lp.toFixed(0)} percent, equity ${(100 - lp).toFixed(0)} percent">
        <div style="width:${lp}%;background:${s1}" title="Liabilities ${money(l)}"></div>
        <div style="width:${100 - lp}%;background:${s3}" title="Equity ${money(e)}"></div>
      </div>
      <div class="stack-legend">
        <div><span><i style="background:${s1}"></i>Liabilities</span><b>${money(l)} · ${lp.toFixed(0)}%</b></div>
        <div><span><i style="background:${s3}"></i>Equity</span><b>${money(e)} · ${(100 - lp).toFixed(0)}%</b></div>
        <div><span>Debt-to-equity</span><b>${m('longTermDebt') != null ? (m('longTermDebt') / e).toFixed(2) + '×' : '—'}</b></div>
        <div><span>Return on equity</span><b>${m('netIncome') != null ? pct(m('netIncome') / e) : '—'}</b></div>
      </div>`;
  }

  function renderRisks() {
    const rows = doc.risks.slice(0, 7).map(r => ({ name: r.name, value: r.count }));
    hbars($('riskBars'), rows, v => v, css('--series-2'));
  }

  function renderSections() {
    const max = Math.max(...doc.sections.map(s => s.words), 1);
    $('sectionMap').innerHTML = doc.sections.length ? doc.sections.map((s, i) => `
      <button class="sec-chip" data-i="${i}">
        <b>Item ${s.code}</b><small>${esc(s.name)}</small><small>${s.words.toLocaleString()} words</small>
        <span class="meter" style="width:${s.words / max * 100}%"></span>
      </button>`).join('') : '<p class="muted small">No "Item" headings were detected in this document.</p>';
  }

  function renderTable() {
    const n = Math.max(...Object.values(doc.metrics).map(v => v.length), 1);
    const head = `<tr><th>Line item</th>${[...Array(n).keys()].map(i => `<th>FY${doc.years[i]}</th>`).join('')}</tr>`;
    const body = doc.metricDefs.filter(d => doc.metrics[d.key]).map(d => `<tr><td>${d.label}</td>${[...Array(n).keys()].map(i => {
      const v = m(d.key, i);
      return `<td>${v == null ? '—' : d.key === 'epsDiluted' ? perShare(v) : money(v)}</td>`;
    }).join('')}</tr>`).join('');
    $('metricTable').innerHTML = `<thead>${head}</thead><tbody>${body || '<tr><td colspan="4">No financial statement lines recognised.</td></tr>'}</tbody>`;
  }

  function render() {
    if (!doc) return;
    $('dashEmpty').hidden = true; $('dashBody').hidden = false;
    $('dashCompany').textContent = doc.meta.company;
    $('dashFy').textContent = `Form 10-K · Fiscal ${doc.meta.fiscalYear}`;
    $('dashSub').textContent = `${doc.meta.fiscalYearEnd ? 'Fiscal year ended ' + doc.meta.fiscalYearEnd + ' · ' : ''}${doc.words.toLocaleString()} words · reported ${doc.meta.unit === 'thousands' ? 'in thousands' : doc.meta.unit === 'billions' ? 'in billions' : 'in millions'} of USD`;
    renderKpis(); renderTrend(); renderTone(); renderMargins(); renderBalance(); renderRisks(); renderSections(); renderTable();
  }

  function fillCurrency() {
    const sel = $('dashCurrency');
    const codes = MLCurrency.codes();
    const top = MLCurrency.POPULAR.filter(c => codes.includes(c));
    sel.innerHTML = top.concat(codes.filter(c => !top.includes(c))).map(c => `<option value="${c}">${MLCurrency.flag(c)} ${c}</option>`).join('');
    sel.value = codes.includes(currency) ? currency : 'USD';
  }

  function init() {
    if (window.Chart) Chart.defaults.font.family = 'Montserrat, system-ui, sans-serif';
    fillCurrency();
    MLCurrency.onChange(() => { fillCurrency(); render(); });
    $('dashCurrency').addEventListener('change', e => { currency = e.target.value; render(); });
    $('sectionMap').addEventListener('click', e => {
      const b = e.target.closest('.sec-chip'); if (!b) return;
      const s = doc.sections[+b.dataset.i];
      window.MLApp.openReader(`Item ${s.code} · ${s.name}`, s.text);
    });
  }

  window.MLDashboard = {
    init,
    setDoc(d) { doc = d; render(); },
    render,
    onShow() { if (trendChart) trendChart.resize(); },
  };
})();
