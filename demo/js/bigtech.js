/* MarketLens — "Big Tech" beginner view.
   Figures are from each company's Form 10-K, rounded to billions of US dollars.
   FY = the company's own fiscal year (not always the calendar year). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // revenue / prevRevenue / netIncome in $ billions; employees at fiscal year end.
  const COMPANIES = [
    { name: 'Amazon', ticker: 'AMZN', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 637.96, prevRevenue: 574.79, netIncome: 59.25, employees: 1556000,
      sells: 'Online shopping, Prime subscriptions, and cloud computing (AWS).', fact: 'Most of its sales are online stores, but most of its profit comes from AWS cloud services.' },
    { name: 'Apple', ticker: 'AAPL', fy: 'FY2024 (ended Sep 28, 2024)', revenue: 391.04, prevRevenue: 383.29, netIncome: 93.74, employees: 164000,
      sells: 'iPhone, Mac, iPad, Apple Watch, and services like the App Store and iCloud.', fact: 'The iPhone alone brings in about half of all Apple’s revenue.' },
    { name: 'Alphabet (Google)', ticker: 'GOOGL', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 350.02, prevRevenue: 307.39, netIncome: 100.12, employees: 183323,
      sells: 'Advertising on Google Search and YouTube, plus Google Cloud.', fact: 'Search is free for you. Advertisers pay for it, and ads are most of Alphabet’s revenue.' },
    { name: 'Microsoft', ticker: 'MSFT', fy: 'FY2024 (ended Jun 30, 2024)', revenue: 245.12, prevRevenue: 211.92, netIncome: 88.14, employees: 228000,
      sells: 'Azure cloud, Microsoft 365 (Office), Windows, LinkedIn, and Xbox.', fact: 'Microsoft’s fiscal year ends in June, so its “2024” is mostly the second half of 2023 plus early 2024.' },
    { name: 'Meta', ticker: 'META', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 164.50, prevRevenue: 134.90, netIncome: 62.36, employees: 74067,
      sells: 'Advertising on Facebook, Instagram, and WhatsApp.', fact: 'Almost all of Meta’s revenue is advertising, and it keeps a very large share as profit.' },
    { name: 'Nvidia', ticker: 'NVDA', fy: 'FY2025 (ended Jan 26, 2025)', revenue: 130.50, prevRevenue: 60.92, netIncome: 72.88, employees: 36000,
      sells: 'Graphics chips (GPUs) that power AI data centers and gaming PCs.', fact: 'Revenue more than doubled in one year because of demand for AI chips.' },
    { name: 'Tesla', ticker: 'TSLA', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 97.69, prevRevenue: 96.77, netIncome: 7.09, employees: 125665,
      sells: 'Electric cars, plus batteries and solar energy products.', fact: 'Building cars is expensive, so Tesla keeps a much smaller share of each sale than software companies do.' },
    { name: 'IBM', ticker: 'IBM', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 62.75, prevRevenue: 61.86, netIncome: 6.02, employees: 270300,
      sells: 'Software, consulting, and mainframe computers for big businesses.', fact: 'IBM has more employees than Apple but much less revenue, so each worker brings in less money.' },
    { name: 'Intel', ticker: 'INTC', fy: 'FY2024 (ended Dec 28, 2024)', revenue: 53.10, prevRevenue: 54.23, netIncome: -18.76, employees: 108900,
      sells: 'Processors (CPUs) for PCs and servers, and chip manufacturing.', fact: 'Intel lost money in 2024. Big revenue does not guarantee a profit.' },
    { name: 'Netflix', ticker: 'NFLX', fy: 'FY2024 (ended Dec 31, 2024)', revenue: 39.00, prevRevenue: 33.72, netIncome: 8.71, employees: 14000,
      sells: 'Streaming subscriptions for movies and TV shows.', fact: 'Netflix has the fewest employees here, so each one brings in a lot of revenue.' },
  ];

  const METRICS = {
    revenue: {
      label: 'Revenue', q: 'Who sells the most?',
      explain: '<b>Revenue</b> is all the money a company collects from customers in a year, before paying any costs. Think of it as the total at the cash register.',
      value: c => c.revenue * 1e9, fmt: v => money(v),
    },
    profit: {
      label: 'Profit', q: 'Who keeps the most money?',
      explain: '<b>Profit</b> (net income) is what is left after paying every cost: staff, factories, taxes, everything. It can be negative, which means a loss.',
      value: c => c.netIncome * 1e9, fmt: v => money(v),
    },
    margin: {
      label: 'Profit per $100', q: 'Out of every $100 of sales, how much is profit?',
      explain: 'Imagine customers spend <b>$100</b> with the company. It uses part of that money to pay its costs: workers, factories, research, taxes. Whatever is <b>left over is profit</b>. Nvidia: $100 in, about $44 spent on costs, <b>$56 left as profit</b>. In finance this is called the <b>profit margin</b> (56%).',
      value: c => c.netIncome / c.revenue, fmt: v => v < 0 ? perHundred(-v) + ' loss' : perHundred(v) + ' profit',
    },
    growth: {
      label: 'Growth', q: 'Who grew the fastest in one year?',
      explain: '<b>Growth</b> compares this year’s revenue with last year’s. +10% means the company sold 10% more than the year before.',
      value: c => (c.revenue - c.prevRevenue) / c.prevRevenue, fmt: v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) + '%',
    },
    perEmployee: {
      label: 'Per employee', q: 'How much revenue does each worker bring in?',
      explain: '<b>Revenue per employee</b> = revenue ÷ number of employees. It shows how many dollars of sales each person working there generates in a year.',
      value: c => c.revenue * 1e9 / c.employees, fmt: v => money(v),
    },
  };

  let metric = 'revenue', selected = 'Apple', currency = 'USD', openedAt = Date.now(), timer = null;

  function conv(usd) { return currency === 'USD' ? usd : MLCurrency.convert(usd, 'USD', currency); }
  function money(usd, compact = true) {
    const v = conv(usd);
    if (v == null || isNaN(v)) return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(v);
    } catch (e) { return Math.round(v).toLocaleString() + ' ' + currency; }
  }
  function perHundred(ratio) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(conv(100) * ratio); }
    catch (e) { return Math.round(conv(100) * ratio) + ' ' + currency; }
  }
  const perSecond = c => c.revenue * 1e9 / (365 * 24 * 3600);

  // --------------------------------------------------------------- chart
  function renderChart() {
    const m = METRICS[metric];
    const rows = COMPANIES.map(c => ({ c, v: m.value(c) })).sort((a, b) => b.v - a.v);
    const max = Math.max(...rows.map(r => Math.abs(r.v)));
    $('btQuestion').textContent = m.q;
    $('btExplain').innerHTML = m.explain;
    $('btChart').innerHTML = rows.map((r, i) => {
      const w = Math.max(1.5, Math.abs(r.v) / max * 100);
      return `
      <button class="bt-row${r.c.name === selected ? ' on' : ''}" data-name="${esc(r.c.name)}" aria-pressed="${r.c.name === selected}">
        <span class="bt-rank">${i + 1}</span>
        <span class="bt-name">${esc(r.c.name)}</span>
        <span class="bt-track"><span class="bt-bar${r.v < 0 ? ' neg' : ''}" style="width:${w}%"></span></span>
        <span class="bt-val">${m.fmt(r.v)}</span>
      </button>`;
    }).join('');
    document.querySelectorAll('.bt-tab').forEach(t => t.setAttribute('aria-selected', t.dataset.m === metric));
  }

  // --------------------------------------------------------------- detail
  function renderDetail() {
    const c = COMPANIES.find(x => x.name === selected);
    const margin = c.netIncome / c.revenue;
    const growth = (c.revenue - c.prevRevenue) / c.prevRevenue;
    const keep = Math.max(0, Math.min(100, margin * 100));
    $('btDetail').innerHTML = `
      <div class="bt-d-head">
        <div><span class="eyebrow">${esc(c.ticker)} · ${esc(c.fy)}</span><h3>${esc(c.name)}</h3></div>
      </div>
      <p class="bt-sells">${esc(c.sells)}</p>
      <div class="bt-facts">
        <div><span>Revenue</span><b>${money(c.revenue * 1e9)}</b></div>
        <div><span>Profit</span><b class="${c.netIncome < 0 ? 'neg-text' : ''}">${money(c.netIncome * 1e9)}</b></div>
        <div><span>Growth</span><b>${(growth >= 0 ? '+' : '−') + Math.abs(growth * 100).toFixed(0)}%</b></div>
        <div><span>Employees</span><b>${c.employees.toLocaleString()}</b></div>
      </div>
      <div class="bt-hundred">
        <p><b>When customers spend ${perHundred(1)}:</b></p>
        <div class="bt-split" role="img" aria-label="${margin >= 0 ? `${keep.toFixed(0)} percent left over as profit` : 'the company lost money'}">
          ${margin >= 0 ? `<span class="kept" style="width:${keep}%"></span><span class="spent" style="width:${100 - keep}%"></span>` : `<span class="spent" style="width:100%"></span>`}
        </div>
        <div class="bt-split-legend">
          ${margin >= 0
            ? `<span><i class="kept"></i>${perHundred(margin)} left over = profit</span><span><i class="spent"></i>${perHundred(1 - margin)} spent on costs</span>`
            : `<span><i class="spent"></i>Costs were higher than sales: ${perHundred(-margin)} lost</span>`}
        </div>
      </div>
      <p class="bt-fact">💡 ${esc(c.fact)}</p>`;
    tickCounter();
  }

  function tickCounter() {
    const c = COMPANIES.find(x => x.name === selected);
    const secs = (Date.now() - openedAt) / 1000;
    const ps = perSecond(c);
    $('btPerSec').textContent = money(ps, false);
    $('btSince').textContent = money(ps * secs, false);
    $('btCounterName').textContent = c.name;
  }

  function render() { renderChart(); renderDetail(); }

  function fillCurrency() {
    const sel = $('btCurrency');
    const codes = MLCurrency.codes();
    const top = MLCurrency.POPULAR.filter(c => codes.includes(c));
    sel.innerHTML = top.concat(codes.filter(c => !top.includes(c))).map(c => `<option value="${c}">${MLCurrency.flag(c)} ${c}</option>`).join('');
    sel.value = codes.includes(currency) ? currency : 'USD';
  }

  function init() {
    fillCurrency();
    MLCurrency.onChange(() => { fillCurrency(); render(); });
    $('btCurrency').addEventListener('change', e => { currency = e.target.value; render(); });
    $('btTabs').addEventListener('click', e => {
      const t = e.target.closest('.bt-tab'); if (!t) return;
      metric = t.dataset.m; renderChart();
    });
    $('btChart').addEventListener('click', e => {
      const r = e.target.closest('.bt-row'); if (!r) return;
      selected = r.dataset.name; openedAt = Date.now(); render();
    });
    render();
  }

  // ------------------------------------------------ home page live ticker
  const pageOpened = Date.now();
  let homeTimer = null;
  const usd = (v, d = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d }).format(v);
  const TOP = [...COMPANIES].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  function buildHome() {
    $('tkRows').innerHTML = TOP.map((c, i) => `
      <div class="tk-row">
        <span class="tk-name">${esc(c.name.replace(' (Google)', ''))}</span>
        <span class="tk-rate">${usd(perSecond(c))}/sec</span>
        <span class="tk-amt" id="tkAmt${i}">$0</span>
      </div>`).join('');
  }
  function tickHome() {
    const secs = (Date.now() - pageOpened) / 1000;
    const all = COMPANIES.reduce((s, c) => s + perSecond(c), 0);
    $('tkTotal').textContent = usd(all * secs);
    TOP.forEach((c, i) => { $('tkAmt' + i).textContent = usd(perSecond(c) * secs); });
  }

  window.MLBigTech = {
    init,
    startHome() { if (!$('tkRows').children.length) buildHome(); clearInterval(homeTimer); tickHome(); homeTimer = setInterval(tickHome, 100); },
    stopHome() { clearInterval(homeTimer); },
    onShow() { clearInterval(timer); timer = setInterval(tickCounter, 100); },
    onHide() { clearInterval(timer); },
  };
})();
