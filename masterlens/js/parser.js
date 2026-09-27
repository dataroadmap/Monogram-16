/* MasterLens — 10-K reading and analysis.
   Turns PDF / HTML / text into plain text, then extracts sections,
   financial line items, tone and risk themes. Everything runs in the browser. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- file -> text
  async function fileToText(file, onProgress) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(file, onProgress);
    const raw = await file.text();
    if (/\.html?$/.test(name) || /<html|<body|<table/i.test(raw.slice(0, 5000))) return htmlToText(raw);
    return raw;
  }

  async function pdfToText(file, onProgress) {
    if (!window.pdfjsLib) throw new Error('PDF reader failed to load. Check your connection or upload an HTML/TXT version.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Group text items into lines by their y position, then order by x.
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: it.transform[4], s: it.str });
      }
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join('    '));
      pages.push(lines.join('\n'));
      if (onProgress) onProgress(p / pdf.numPages);
    }
    return pages.join('\n\n');
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,head,noscript').forEach(n => n.remove());
    // Hidden XBRL header blocks in iXBRL filings.
    doc.querySelectorAll('[style*="display:none"], [style*="display: none"], ix\\:header').forEach(n => n.remove());
    doc.querySelectorAll('td,th').forEach(n => n.append(doc.createTextNode('    ')));
    doc.querySelectorAll('tr,p,div,br,li,h1,h2,h3,h4,h5,h6,table').forEach(n => n.append(doc.createTextNode('\n')));
    return (doc.body ? doc.body.textContent : '')
      .replace(/ /g, ' ')
      .replace(/[ \t]*\n[ \t]*\n\s*/g, '\n\n');
  }

  // ------------------------------------------------------------------- helpers
  const NUM_RE = /\(?-?\$?\s*\(?\d[\d,]*(?:\.\d+)?\)?|—|–/g;

  function parseNumber(tok) {
    const t = tok.trim();
    if (t === '—' || t === '–') return 0;
    const neg = /\(/.test(t) || /^-/.test(t);
    const n = parseFloat(t.replace(/[^\d.]/g, ''));
    return isNaN(n) ? null : (neg ? -n : n);
  }

  function isYearLike(tok) {
    return /^\d{4}$/.test(tok.trim()) && +tok >= 1990 && +tok <= 2045;
  }

  // Values on a "table-like" line: label followed only by numbers, $, (), %.
  function numbersAfter(rest) {
    const toks = rest.match(NUM_RE) || [];
    const leftover = rest.replace(NUM_RE, '').replace(/[\s$()%,.:*]/g, '');
    if (leftover.length > 2) return null;
    const vals = toks.filter(t => !isYearLike(t)).map(parseNumber).filter(v => v !== null);
    return vals.length ? vals : null;
  }

  // -------------------------------------------------------------- line items
  const METRICS = [
    { key: 'revenue', label: 'Revenue', re: /^(total\s+)?(net\s+)?(revenues?|sales|net sales|operating revenues?)(,\s*net)?\b/i },
    { key: 'costOfRevenue', label: 'Cost of revenue', re: /^(total\s+)?cost of (revenues?|sales|goods sold|products sold)\b/i },
    { key: 'grossProfit', label: 'Gross profit', re: /^gross (profit|margin)\b/i },
    { key: 'rnd', label: 'R&D expense', re: /^(total\s+)?research,? (and|&) development\b/i },
    { key: 'sga', label: 'SG&A expense', re: /^(total\s+)?selling,? general,? and administrative\b/i },
    { key: 'operatingIncome', label: 'Operating income', re: /^(total\s+)?(operating income|income from operations|operating (profit|loss)|income \(loss\) from operations)\b/i },
    { key: 'netIncome', label: 'Net income', re: /^net (income|earnings|income \(loss\)|loss)(?! per)(?!\s+attributable to non)/i },
    { key: 'epsDiluted', label: 'Diluted EPS', re: /^(diluted( net income| earnings)?( per (common )?share)?|net income per share.{0,20}diluted)\b/i, small: true },
    { key: 'totalAssets', label: 'Total assets', re: /^total assets\b/i },
    { key: 'totalLiabilities', label: 'Total liabilities', re: /^total liabilities(?!\s+and)\b/i },
    { key: 'equity', label: "Shareholders' equity", re: /^total (stockholders|shareholders)[’']?s?[’']?\s+equity\b/i },
    { key: 'cash', label: 'Cash & equivalents', re: /^cash and cash equivalents\b(?!,?\s*(beginning|end))/i },
    { key: 'longTermDebt', label: 'Long-term debt', re: /^long[- ]term debt\b/i },
    { key: 'operatingCashFlow', label: 'Operating cash flow', re: /^net cash (provided by|from|provided by \(used in\)) operating activities\b/i },
    { key: 'capex', label: 'Capital expenditures', re: /^(purchases? of property(, plant)? and equipment|capital expenditures|payments for acquisition of property)\b/i },
  ];

  function extractMetrics(lines) {
    const out = {};
    for (const m of METRICS) {
      let best = null;
      for (const raw of lines) {
        const line = raw.trim().replace(/\s+/g, ' ');
        if (line.length > 180) continue;
        const match = line.match(m.re);
        if (!match) continue;
        let rest = line.slice(match[0].length);
        // allow short trailing label words like "net" or "(Note 4)"
        rest = rest.replace(/^[^\d$(—–-]{0,40}?(?=[\d$(—–-])/, '');
        const vals = numbersAfter(rest);
        if (!vals) continue;
        const clean = vals.slice(0, 3);
        if (m.small && clean.some(v => Math.abs(v) > 1000)) continue;
        if (!best || clean.length > best.length) best = clean;
        if (best.length >= 3) break;
      }
      if (best) out[m.key] = best;
    }
    // Derive gross profit if missing.
    if (!out.grossProfit && out.revenue && out.costOfRevenue) {
      out.grossProfit = out.revenue.map((r, i) => out.costOfRevenue[i] != null ? r - out.costOfRevenue[i] : null).filter(v => v != null);
    }
    if (!out.totalLiabilities && out.totalAssets && out.equity) {
      out.totalLiabilities = out.totalAssets.map((a, i) => out.equity[i] != null ? a - out.equity[i] : null).filter(v => v != null);
    }
    return out;
  }

  // ---------------------------------------------------------------- sections
  const ITEM_NAMES = {
    '1': 'Business', '1A': 'Risk Factors', '1B': 'Unresolved Staff Comments', '1C': 'Cybersecurity',
    '2': 'Properties', '3': 'Legal Proceedings', '4': 'Mine Safety Disclosures',
    '5': 'Market for Common Equity', '6': 'Reserved', '7': "Management's Discussion & Analysis",
    '7A': 'Market Risk Disclosures', '8': 'Financial Statements', '9': 'Changes in Accountants',
    '9A': 'Controls and Procedures', '9B': 'Other Information', '9C': 'Foreign Jurisdiction Inspections',
    '10': 'Directors & Governance', '11': 'Executive Compensation', '12': 'Security Ownership',
    '13': 'Relationships & Transactions', '14': 'Accountant Fees', '15': 'Exhibits', '16': 'Form 10-K Summary',
  };

  function findSections(text) {
    const re = /^[ \t]*item[ \t ]+(1[0-6]|[1-9][A-C]?)[ \t]*[.:—–-]?[ \t]*([^\n]{0,120})$/gim;
    const heads = [];
    let m;
    while ((m = re.exec(text))) heads.push({ code: m[1].toUpperCase(), pos: m.index });
    heads.sort((a, b) => a.pos - b.pos);
    heads.forEach((h, i) => { h.len = (i + 1 < heads.length ? heads[i + 1].pos : text.length) - h.pos; });
    // Keep, per item, the occurrence with the longest body (skips the table of contents).
    const best = {};
    for (const h of heads) if (!best[h.code] || h.len > best[h.code].len) best[h.code] = h;
    const chosen = Object.values(best).sort((a, b) => a.pos - b.pos);
    return chosen.map((h, i) => {
      const end = i + 1 < chosen.length ? chosen[i + 1].pos : text.length;
      const body = text.slice(h.pos, end).trim();
      return { code: h.code, name: ITEM_NAMES[h.code] || 'Item ' + h.code, start: h.pos, end, text: body, words: countWords(body) };
    }).filter(s => s.words > 3);
  }

  function countWords(s) { return (s.match(/[A-Za-z][A-Za-z'-]+/g) || []).length; }

  // ------------------------------------------------------------ tone / risks
  const LEX = {
    positive: 'achieve achieved benefit benefited benefits best better gain gains grew growth improve improved improvement improvements increase increased opportunities opportunity profitable progress record strong stronger strength success successful exceed exceeded favorable expanded expansion innovative leading'.split(' '),
    negative: 'adverse adversely against breach breaches claims closure decline declined declines default deficiency delay delays difficult disruption disruptions downturn failure fail failed fines impairment impair inability lawsuit litigation loss losses penalties penalty recall recession restated restructuring shortage shortages termination unable unfavorable volatility weak weakness adversely'.split(' '),
    uncertainty: 'may might could approximately assume believe contingent depend depends estimate estimates fluctuate fluctuations possible possibly predict risk risks uncertain uncertainty uncertainties unknown variable'.split(' '),
  };

  function tone(text) {
    const words = (text.toLowerCase().match(/[a-z]+/g) || []);
    const sets = Object.fromEntries(Object.entries(LEX).map(([k, v]) => [k, new Set(v)]));
    const counts = { positive: 0, negative: 0, uncertainty: 0 };
    for (const w of words) for (const k in sets) if (sets[k].has(w)) counts[k]++;
    const total = words.length || 1;
    const score = (counts.positive - counts.negative) / Math.max(1, counts.positive + counts.negative);
    return { ...counts, words: total, score, per1k: {
      positive: counts.positive / total * 1000, negative: counts.negative / total * 1000, uncertainty: counts.uncertainty / total * 1000 } };
  }

  const RISK_THEMES = [
    ['Competition', /\bcompet\w*/gi],
    ['Supply chain', /\bsuppl(y|ier|iers)\b|\bshortages?\b/gi],
    ['Regulation', /\bregulat\w*|\blegislat\w*|\bcompliance\b|\bgovernment\w*/gi],
    ['Macroeconomic', /\binflation\w*|\binterest rates?\b|\brecession\w*|\bmacroeconomic\b|\beconomic conditions/gi],
    ['Cybersecurity', /\bcyber\w*|\bransomware\b|\bdata breach\w*|\bsecurity (breach|incident|vulnerabilit)\w*/gi],
    ['Litigation', /\blitigation\b|\blawsuits?\b|\blegal proceedings\b|\bclass actions?\b|\binfringement\b/gi],
    ['FX & geopolitics', /\bcurrenc\w*|\bforeign exchange\b|\bgeopolitic\w*|\bsanctions?\b|\btariffs?\b|\btrade disputes?/gi],
    ['Talent', /\bpersonnel\b|\btalent\b|\bengineers\b|\bretain\w*/gi],
    ['Debt & liquidity', /\bindebtedness\b|\bdebt\b|\bliquidity\b|\bcovenants?\b|\bcredit facilit\w*/gi],
    ['Climate & weather', /\bclimate\b|\bweather\b|\bwildfires?\b|\bflood\w*|\bnatural disasters?/gi],
    ['AI & technology', /\bartificial intelligence\b|\bmachine learning\b|\balgorithm\w*|\bAI\b/g],
    ['Public health', /\bpandemic\w*|\bCOVID\b|\bpublic health\b|\bepidemic\w*/gi],
  ];

  function riskThemes(text) {
    return RISK_THEMES.map(([name, re]) => ({ name, count: (text.match(re) || []).length }))
      .filter(t => t.count > 0).sort((a, b) => b.count - a.count);
  }

  // ------------------------------------------------------------- metadata
  function detectMeta(text) {
    const head = text.slice(0, 20000);
    let company = null;
    const reg = head.match(/\n\s*([^\n]{3,90})\s*\n\s*\(?\s*exact name of registrant/i);
    if (reg) company = reg[1].trim();
    if (!company) {
      const inc = head.match(/\b([A-Z][A-Za-z0-9&.,' -]{2,60}?(?:Inc\.|Corporation|Corp\.|Company|Holdings|Ltd\.|plc|N\.V\.|LLC))/);
      if (inc) company = inc[1].trim();
    }
    if (company && company === company.toUpperCase()) company = titleCase(company);

    const fyMatch = head.match(/fiscal\s+year\s+ended\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s+(\d{4}))/i);
    const fiscalYearEnd = fyMatch ? fyMatch[1].replace(/\s+/g, ' ') : null;
    let fy = fyMatch ? +fyMatch[2] : null;
    if (!fy) {
      const years = (head.match(/\b20[0-4]\d\b/g) || []).map(Number);
      fy = years.length ? Math.max(...years) : new Date().getFullYear() - 1;
    }
    const unitMatch = text.match(/\(\s*(?:dollars\s+|amounts\s+|\$\s*)?in\s+(millions|thousands|billions)/i) || text.match(/\bin\s+(millions|thousands|billions)\b/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : 'millions';
    return { company: company || 'Unknown registrant', fiscalYearEnd, fiscalYear: fy, unit };
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Inc|Corp|Ltd|Llc|Plc)\b/g, w => w === 'Llc' ? 'LLC' : w === 'Plc' ? 'plc' : w);
  }

  // ------------------------------------------------------------- chunks
  function chunkText(text, sections, size = 1100) {
    const paras = text.split(/\n\s*\n|\n(?=[A-Z][^\n]{0,80}\n)/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const chunks = [];
    let buf = '', start = 0, cursor = 0;
    const secAt = pos => { let s = null; for (const x of sections) if (x.start <= pos) s = x; return s; };
    for (const p of paras) {
      const at = text.indexOf(p.slice(0, 40), cursor);
      if (at >= 0) cursor = at;
      if (!buf) start = cursor;
      buf += (buf ? '\n' : '') + p;
      if (buf.length >= size) { chunks.push({ text: buf, pos: start }); buf = ''; }
    }
    if (buf) chunks.push({ text: buf, pos: start });
    return chunks.map((c, i) => {
      const s = secAt(c.pos);
      return { id: i, text: c.text, section: s ? `Item ${s.code} · ${s.name}` : 'Cover & front matter' };
    });
  }

  // ----------------------------------------------------------------- main
  function analyze(text, name) {
    text = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const lines = text.split('\n');
    const meta = detectMeta(text);
    const sections = findSections(text);
    const metrics = extractMetrics(lines);
    const risk = sections.find(s => s.code === '1A');
    const years = [0, 1, 2].map(i => meta.fiscalYear - i);
    return {
      name, text, meta, years, sections, metrics,
      metricDefs: METRICS,
      tone: tone(text),
      risks: riskThemes(risk ? risk.text : text),
      chunks: chunkText(text, sections),
      words: countWords(text),
    };
  }

  window.MLParser = { fileToText, analyze, htmlToText };
})();
