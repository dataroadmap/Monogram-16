/* MarketLens — chat with the filing.
   Offline: BM25 passage search + figures extracted by the parser.
   With a Claude API key: the question, the most relevant passages and the
   extracted figures are sent to the Claude API and the answer is streamed. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODEL = 'claude-opus-5';
  const STOP = new Set('a an and are as at be by for from has have how i in is it its of on or our that the their them they this to was were what when where which who why will with would do does did can you your me about tell show give much many any there than into over per company firm say says said'.split(' '));

  let doc = null, index = null, history = [], busy = false, clientPromise = null;

  // ------------------------------------------------------------ search index
  const tokenize = s => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
  function stem(w) { return w.length > 4 ? w.replace(/(ies|es|s|ing|ed)$/, '') : w; }

  function buildIndex(chunks) {
    const docs = chunks.map(c => { const t = tokenize(c.text); const tf = new Map(); t.forEach(w => tf.set(w, (tf.get(w) || 0) + 1)); return { tf, len: t.length }; });
    const df = new Map();
    docs.forEach(d => d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
    const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
    return { docs, df, avg, N: docs.length };
  }

  function search(q, k = 4) {
    if (!index) return [];
    const terms = [...new Set(tokenize(q))];
    const k1 = 1.4, b = 0.75;
    const scored = index.docs.map((d, i) => {
      let s = 0;
      for (const t of terms) {
        const f = d.tf.get(t); if (!f) continue;
        const n = index.df.get(t);
        const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
        s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / index.avg));
      }
      return { i, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
    return scored.map(x => ({ ...doc.chunks[x.i], score: x.s }));
  }

  // --------------------------------------------------------- offline answers
  const UNIT = { thousands: 1e3, millions: 1e6, billions: 1e9 };
  const money = v => v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v * (UNIT[doc.meta.unit] || 1e6));
  const mv = (k, i = 0) => doc.metrics[k] ? doc.metrics[k][i] : null;
  const yoy = k => mv(k, 0) != null && mv(k, 1) ? ((mv(k, 0) - mv(k, 1)) / Math.abs(mv(k, 1)) * 100) : null;
  const yoyTxt = k => { const g = yoy(k); return g == null ? '' : ` (${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(1)}% from FY${doc.years[1]}'s ${money(mv(k, 1))})`; };

  const INTENTS = [
    { re: /\b(revenue|sales|top line|turnover)\b/i, key: 'revenue', label: 'Revenue' },
    { re: /\b(net income|profit|earnings|bottom line)\b/i, key: 'netIncome', label: 'Net income' },
    { re: /\b(operating income|operating profit|ebit)\b/i, key: 'operatingIncome', label: 'Operating income' },
    { re: /\bgross (profit|margin)\b/i, key: 'grossProfit', label: 'Gross profit' },
    { re: /\b(eps|per share)\b/i, key: 'epsDiluted', label: 'Diluted EPS', perShare: true },
    { re: /\b(total )?assets\b/i, key: 'totalAssets', label: 'Total assets' },
    { re: /\bliabilit/i, key: 'totalLiabilities', label: 'Total liabilities' },
    { re: /\bequity\b/i, key: 'equity', label: "Shareholders' equity" },
    { re: /\bcash (and|&) (cash )?equivalents|\bcash position|\bhow much cash\b/i, key: 'cash', label: 'Cash and cash equivalents' },
    { re: /\b(debt|borrowing|leverage)\b/i, key: 'longTermDebt', label: 'Long-term debt' },
    { re: /\b(cash flow|operating cash)\b/i, key: 'operatingCashFlow', label: 'Operating cash flow' },
    { re: /\b(r&d|research)\b/i, key: 'rnd', label: 'R&D expense' },
    { re: /\b(capex|capital expenditure)/i, key: 'capex', label: 'Capital expenditures' },
  ];

  function figureAnswer(q) {
    const hits = INTENTS.filter(x => x.re.test(q) && doc.metrics[x.key]);
    if (!hits.length) return null;
    const lines = hits.slice(0, 4).map(h => {
      const v = mv(h.key);
      const val = h.perShare ? '$' + v.toFixed(2) : money(Math.abs(v));
      return `<li><b>${h.label}</b> for FY${doc.years[0]}: <b>${val}</b>${h.perShare ? '' : yoyTxt(h.key)}</li>`;
    });
    let extra = '';
    if (/margin/i.test(q) && mv('revenue')) {
      const parts = [['Gross', 'grossProfit'], ['Operating', 'operatingIncome'], ['Net', 'netIncome']].filter(([, k]) => mv(k) != null)
        .map(([n, k]) => `${n} ${(mv(k) / mv('revenue') * 100).toFixed(1)}%`);
      if (parts.length) extra = `<p>Margins: ${parts.join(' · ')}.</p>`;
    }
    return `<p>From the financial statements in this 10-K:</p><ul>${lines.join('')}</ul>${extra}`;
  }

  function summaryAnswer() {
    const r = mv('revenue'), n = mv('netIncome');
    const risks = doc.risks.slice(0, 3).map(x => x.name.toLowerCase()).join(', ');
    const tone = doc.tone.score > 0.15 ? 'positive' : doc.tone.score < -0.15 ? 'cautious' : 'balanced';
    return `<p><b>${esc(doc.meta.company)}</b> — Form 10-K for fiscal ${doc.meta.fiscalYear}.</p><ul>
      ${r != null ? `<li>Revenue of <b>${money(r)}</b>${yoyTxt('revenue')}.</li>` : ''}
      ${n != null ? `<li>Net income of <b>${money(n)}</b>${yoyTxt('netIncome')}${r ? `, a ${(n / r * 100).toFixed(1)}% net margin` : ''}.</li>` : ''}
      ${mv('cash') != null ? `<li>Cash and equivalents of <b>${money(mv('cash'))}</b>${mv('longTermDebt') != null ? ` against long-term debt of <b>${money(mv('longTermDebt'))}</b>` : ''}.</li>` : ''}
      ${risks ? `<li>The risk factors return most often to ${risks}.</li>` : ''}
      <li>Overall wording is <b>${tone}</b> (${doc.tone.positive} positive vs ${doc.tone.negative} negative terms).</li></ul>`;
  }

  function riskAnswer() {
    const s = doc.sections.find(x => x.code === '1A');
    const themes = doc.risks.slice(0, 6).map(r => `<li>${r.name} <span class="muted">(${r.count} mentions)</span></li>`).join('');
    let heads = [];
    if (s) {
      // Risk factor headings are usually the first sentence of each paragraph.
      heads = s.text.split(/\n\s*\n|\n/).map(p => p.trim()).filter(p => p.length > 60)
        .map(p => (p.match(/^[^.]{30,260}\./) || [])[0]).filter(Boolean).slice(0, 6);
    }
    return `<p>The main risk themes in Item 1A:</p><ul>${themes}</ul>${heads.length ? `<p>Key risk factors as written:</p>${heads.map(h => `<div class="quote">${esc(h)}</div>`).join('')}` : ''}`;
  }

  function bestSentences(passages, q, n = 3) {
    const terms = new Set(tokenize(q));
    const sents = [];
    passages.forEach(p => (p.text.match(/[\s\S]*?[.!?](?=\s+[A-Z("“]|\s*$)/g) || [p.text]).forEach(s => {
      const t = tokenize(s); const hit = t.filter(w => terms.has(w)).length;
      if (hit && s.length > 40) sents.push({ s: s.trim(), score: hit / Math.sqrt(t.length + 1), src: p });
    }));
    return sents.sort((a, b) => b.score - a.score).slice(0, n);
  }

  function highlight(text, q) {
    const terms = [...new Set(tokenize(q))].filter(t => t.length > 2);
    let h = esc(text);
    if (terms.length) h = h.replace(new RegExp(`\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*`, 'gi'), '<mark>$&</mark>');
    return h;
  }

  function offlineAnswer(q, passages) {
    if (/\b(summar|overview|tl;?dr|key takeaways|highlights)\b/i.test(q)) return summaryAnswer();
    const fig = figureAnswer(q);
    const riskQ = /\brisk/i.test(q) && !fig;
    if (riskQ) return riskAnswer();
    const best = bestSentences(passages, q);
    let html = fig || '';
    if (best.length) {
      html += `<p>${fig ? 'Related passages:' : 'Here is what the filing says:'}</p>` + best.map(b => `<div class="quote">${highlight(b.s, q)}</div>`).join('');
    }
    if (!html) html = `<p>I couldn't find anything in this filing about that. Try different wording, or ask about revenue, profit, risks, cash, debt or strategy.</p>`;
    if (!fig) html += `<p class="small muted">Offline mode shows matching passages. Add a Claude API key in Settings for written answers.</p>`;
    return html;
  }

  // ------------------------------------------------------------ Claude API
  function apiKey() { try { return sessionStorage.getItem('ml-key') || localStorage.getItem('ml-key') || ''; } catch (e) { return ''; } }

  async function getClient() {
    const key = apiKey();
    if (!key) return null;
    if (!clientPromise || clientPromise.key !== key) {
      const p = import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm').then(mod => {
        const Anthropic = mod.default || mod.Anthropic;
        return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      });
      p.key = key; clientPromise = p;
    }
    return clientPromise;
  }

  function figuresBlock() {
    return doc.metricDefs.filter(d => doc.metrics[d.key]).map(d =>
      `${d.label}: ${doc.metrics[d.key].map((v, i) => `FY${doc.years[i]}=${v}`).join(', ')}`).join('\n');
  }

  const SYSTEM = `You are MarketLens, an analyst assistant that answers questions about a single SEC Form 10-K annual report.
Ground every answer in the excerpts and extracted figures you are given. When the excerpts don't contain the answer, say so plainly and suggest what section of the 10-K would cover it, rather than guessing.
Keep answers concise and skimmable: a direct answer first, then supporting detail as short bullet points where helpful. Quote key phrases from the filing when they matter, and name the section (for example "Item 7") you drew from.
Figures you are given are in the filing's reporting unit; state the unit when you quote them. This is informational analysis, not investment advice.`;

  async function llmAnswer(q, passages, bubble) {
    const client = await getClient();
    const context = `Company: ${doc.meta.company}\nFiscal year: ${doc.meta.fiscalYear}${doc.meta.fiscalYearEnd ? ' (ended ' + doc.meta.fiscalYearEnd + ')' : ''}\nReporting unit: USD ${doc.meta.unit}\n\nExtracted figures:\n${figuresBlock() || '(none recognised)'}\n\nRelevant excerpts:\n` +
      passages.map((p, i) => `<excerpt index="${i + 1}" section="${p.section}">\n${p.text}\n</excerpt>`).join('\n');
    const messages = [
      ...history.slice(-8),
      { role: 'user', content: `<filing_context>\n${context}\n</filing_context>\n\nQuestion: ${q}` },
    ];
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    });
    let text = '';
    stream.on('text', delta => { text += delta; bubble.innerHTML = markdown(text); scrollDown(); });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      text = text || "I can't help with that request.";
      bubble.innerHTML = markdown(text);
    }
    history.push({ role: 'user', content: q }, { role: 'assistant', content: text || '(no answer)' });
    return text;
  }

  function markdown(md) {
    const lines = esc(md).split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<i>$2</i>');
      const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = line.match(/^#{1,4}\s+(.*)/);
      if (h) html += `<p><b>${h[1]}</b></p>`;
      else if (line.trim()) html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  // ------------------------------------------------------------------ UI
  function scrollDown() { const log = $('chatLog'); log.scrollTop = log.scrollHeight; }

  function addMsg(role, html) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="avatar">${role === 'bot' ? 'ML' : 'You'}</div><div class="bubble">${html}</div>`;
    $('chatLog').appendChild(el);
    scrollDown();
    return el.querySelector('.bubble');
  }

  function addSources(bubble, passages) {
    if (!passages.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'sources';
    passages.forEach(p => {
      const b = document.createElement('button');
      b.className = 'source-chip'; b.type = 'button';
      b.textContent = p.section;
      b.addEventListener('click', () => window.MLApp.openReader(p.section, p.text));
      wrap.appendChild(b);
    });
    bubble.appendChild(wrap);
  }

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    addMsg('user', esc(q));
    if (!doc) { addMsg('bot', '<p>Load a 10-K first — upload one on the Home tab or try the sample report.</p>'); return; }
    busy = true; $('chatForm').querySelector('button').disabled = true;
    const bubble = addMsg('bot', '<span class="typing"><span></span><span></span><span></span></span>');
    const passages = search(q, apiKey() ? 8 : 4);
    try {
      if (apiKey()) {
        await llmAnswer(q, passages, bubble);
      } else {
        await new Promise(r => setTimeout(r, 350));
        bubble.innerHTML = offlineAnswer(q, passages);
      }
      addSources(bubble, passages.slice(0, 4));
    } catch (err) {
      const status = err && err.status;
      const msg = status === 401 ? 'The API key was rejected. Check it in Settings.'
        : status === 429 ? 'Rate limited by the API. Wait a moment and try again.'
        : (err && err.message) || 'Something went wrong.';
      bubble.innerHTML = `<p><b>Couldn't reach Claude:</b> ${esc(msg)}</p><p class="small muted">Here's the offline answer instead:</p>` + offlineAnswer(q, passages);
      addSources(bubble, passages.slice(0, 4));
    } finally {
      busy = false; $('chatForm').querySelector('button').disabled = false; scrollDown();
    }
  }

  function updateMode() {
    const on = !!apiKey();
    $('modeDot').classList.toggle('on', on);
    $('modeTitle').textContent = on ? 'Claude AI mode' : 'Offline mode';
    $('modeDesc').textContent = on ? `Answers are written by ${MODEL} from the most relevant passages.` : 'Answers come from passages and figures found in the filing. Add an API key in Settings for AI answers.';
  }

  const SUGGESTIONS = [
    'Give me a summary of this 10-K',
    'How did revenue change year over year?',
    'What are the biggest risk factors?',
    'What are the margins?',
    'How much cash and debt does the company have?',
    'What is the strategy and outlook?',
  ];

  function greet() {
    $('chatLog').innerHTML = '';
    addMsg('bot', doc
      ? `<p>Hi! I've read <b>${esc(doc.meta.company)}</b>'s 10-K for fiscal ${doc.meta.fiscalYear} (${doc.words.toLocaleString()} words, ${doc.sections.length} sections). What would you like to know?</p>`
      : `<p>Hi, I'm MarketLens. Load a 10-K and I'll answer questions about it — financials, risks, strategy, anything in the filing.</p>`);
  }

  function init() {
    $('suggestions').innerHTML = SUGGESTIONS.map(s => `<button type="button">${s}</button>`).join('');
    $('suggestions').addEventListener('click', e => { const b = e.target.closest('button'); if (b) ask(b.textContent); });
    const ta = $('chatText');
    $('chatForm').addEventListener('submit', e => { e.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = ''; ask(v); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    $('clearChat').addEventListener('click', () => { history = []; greet(); });
    updateMode(); greet();
  }

  window.MLChat = {
    init, updateMode, ask,
    setDoc(d) {
      doc = d; index = buildIndex(d.chunks); history = [];
      $('chatDocLabel').textContent = `${d.meta.company} · FY${d.meta.fiscalYear}`;
      greet();
    },
    onShow() { $('chatText').focus(); },
  };
})();
