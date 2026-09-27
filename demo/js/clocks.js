/* MarketLens — world clocks (traditional analog faces) and time planner. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CITIES = [
    ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'],
    ['San Francisco', 'America/Los_Angeles'], ['Vancouver', 'America/Vancouver'], ['Denver', 'America/Denver'],
    ['Chicago', 'America/Chicago'], ['Mexico City', 'America/Mexico_City'], ['Toronto', 'America/Toronto'],
    ['New York', 'America/New_York'], ['Bogotá', 'America/Bogota'], ['São Paulo', 'America/Sao_Paulo'],
    ['Buenos Aires', 'America/Argentina/Buenos_Aires'], ['Reykjavík', 'Atlantic/Reykjavik'], ['London', 'Europe/London'],
    ['Dublin', 'Europe/Dublin'], ['Lisbon', 'Europe/Lisbon'], ['Paris', 'Europe/Paris'], ['Frankfurt', 'Europe/Berlin'],
    ['Amsterdam', 'Europe/Amsterdam'], ['Zurich', 'Europe/Zurich'], ['Stockholm', 'Europe/Stockholm'], ['Warsaw', 'Europe/Warsaw'],
    ['Athens', 'Europe/Athens'], ['Istanbul', 'Europe/Istanbul'], ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'],
    ['Johannesburg', 'Africa/Johannesburg'], ['Nairobi', 'Africa/Nairobi'], ['Moscow', 'Europe/Moscow'], ['Riyadh', 'Asia/Riyadh'],
    ['Tehran', 'Asia/Tehran'], ['Dubai', 'Asia/Dubai'], ['Karachi', 'Asia/Karachi'], ['Mumbai', 'Asia/Kolkata'],
    ['Dhaka', 'Asia/Dhaka'], ['Bangkok', 'Asia/Bangkok'], ['Jakarta', 'Asia/Jakarta'], ['Singapore', 'Asia/Singapore'],
    ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'], ['Taipei', 'Asia/Taipei'], ['Seoul', 'Asia/Seoul'],
    ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Auckland', 'Pacific/Auckland'],
  ];
  const DEFAULTS = ['New York', 'London', 'Tehran', 'Tokyo', 'Sydney'];
  const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  let clocks = [];            // [{ city, tz, el, hands }]
  let planned = null;         // Date when the planner is active, else null
  let baseTz = null;
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // --------------------------------------------------------------- time math
  const partsCache = new Map();
  function fmtFor(tz) {
    if (!partsCache.has(tz)) partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
    return partsCache.get(tz);
  }
  function zoned(date, tz) {
    const p = Object.fromEntries(fmtFor(tz).formatToParts(date).map(x => [x.type, x.value]));
    const h = +p.hour % 24;
    return { y: +p.year, mo: +p.month, d: +p.day, h, m: +p.minute, s: +p.second };
  }
  function offsetMinutes(date, tz) {
    const z = zoned(date, tz);
    const asUtc = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.m, z.s);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }
  function offsetLabel(mins) {
    const sign = mins >= 0 ? '+' : '−', a = Math.abs(mins);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
  }
  function relLabel(date, tz) {
    const diff = offsetMinutes(date, tz) - offsetMinutes(date, localTz);
    if (diff === 0) return 'Same as you';
    const a = Math.abs(diff), h = Math.floor(a / 60), m = a % 60;
    return `${h ? h + 'h' : ''}${m ? ' ' + m + 'm' : ''} ${diff > 0 ? 'ahead' : 'behind'}`.trim();
  }
  function dayLabel(date, tz) {
    const z = zoned(date, tz), l = zoned(date, localTz);
    const a = Date.UTC(z.y, z.mo - 1, z.d), b = Date.UTC(l.y, l.mo - 1, l.d);
    return a > b ? 'Tomorrow' : a < b ? 'Yesterday' : 'Today';
  }

  // ------------------------------------------------------------- clock face
  function defs() {
    if ($('clockDefs')) return;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.id = 'clockDefs'; s.setAttribute('width', 0); s.setAttribute('height', 0); s.style.position = 'absolute';
    s.innerHTML = `<defs>
      <linearGradient id="rimGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f3d58a"/><stop offset=".35" stop-color="#c8962f"/><stop offset=".7" stop-color="#8a5f17"/><stop offset="1" stop-color="#e7c46d"/>
      </linearGradient>
      <radialGradient id="faceGrad" cx=".45" cy=".4" r=".7">
        <stop offset="0" stop-color="#fffdf6"/><stop offset=".8" stop-color="#f6ecd4"/><stop offset="1" stop-color="#e6d6b0"/>
      </radialGradient>
      <radialGradient id="faceNight" cx=".45" cy=".4" r=".7">
        <stop offset="0" stop-color="#f4ead0"/><stop offset=".85" stop-color="#dccb9f"/><stop offset="1" stop-color="#c5b284"/>
      </radialGradient>
      <radialGradient id="capGrad" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#f7e3a3"/><stop offset="1" stop-color="#7a5314"/></radialGradient>
    </defs>`;
    document.body.appendChild(s);
  }

  function faceSvg() {
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0;
      ticks.push(`<line x1="100" y1="${big ? 24 : 25}" x2="100" y2="${big ? 34 : 29}" stroke="#2a2118" stroke-width="${big ? 2.6 : 1}" stroke-linecap="round" transform="rotate(${i * 6} 100 100)"/>`);
    }
    const numerals = ROMAN.map((r, i) => {
      const a = (i * 30 - 90) * Math.PI / 180, rr = 58;
      const x = 100 + rr * Math.cos(a), y = 100 + rr * Math.sin(a);
      return `<text class="roman" x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${r.length > 2 ? 13 : 15}" text-anchor="middle" dominant-baseline="central">${r}</text>`;
    }).join('');
    return `
      <circle cx="100" cy="100" r="98" fill="url(#rimGrad)"/>
      <circle cx="100" cy="100" r="90" fill="#5c3f10" opacity=".55"/>
      <circle cx="100" cy="100" r="87" fill="url(#faceGrad)" class="face"/>
      <circle cx="100" cy="100" r="76" fill="none" stroke="#2a2118" stroke-width=".6" opacity=".6"/>
      <circle cx="100" cy="100" r="71" fill="none" stroke="#2a2118" stroke-width=".4" opacity=".4"/>
      ${ticks.join('')}
      ${numerals}
      <text x="100" y="80" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="9" font-style="italic" fill="#6b5a3a">MarketLens</text>
      <text class="ampm" x="100" y="130" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="7" font-weight="700" letter-spacing="1.5" fill="#8a7650">AM</text>
      <g class="h-hand">
        <path d="M100 118 L97.2 100 L96 78 Q100 66 104 78 L102.8 100 Z" fill="#1d1710"/>
        <circle cx="100" cy="73" r="5.5" fill="none" stroke="#1d1710" stroke-width="2.4"/>
        <path d="M100 67 L98 60 L100 55 L102 60 Z" fill="#1d1710"/>
      </g>
      <g class="m-hand">
        <path d="M100 122 L98.2 100 L97.6 40 L100 26 L102.4 40 L101.8 100 Z" fill="#1d1710"/>
      </g>
      <g class="s-hand">
        <line x1="100" y1="128" x2="100" y2="24" stroke="#c0392b" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="100" cy="122" r="4" fill="#c0392b"/>
      </g>
      <circle cx="100" cy="100" r="5.5" fill="url(#capGrad)" stroke="#3a2a10" stroke-width=".8"/>
      <circle cx="100" cy="100" r="1.6" fill="#2a1d08"/>`;
  }

  function cardHtml(c, i) {
    return `
      <button class="remove" data-i="${i}" title="Remove ${esc(c.city)}" aria-label="Remove ${esc(c.city)}">✕</button>
      <svg class="clock-svg" viewBox="0 0 200 200" role="img" aria-label="Clock for ${esc(c.city)}">${faceSvg()}</svg>
      <div class="city">${esc(c.city)}</div>
      <div class="dtime">--:--</div>
      <div class="meta"><span class="tag day">Today</span><span class="off"></span><span class="rel"></span></div>`;
  }

  // ------------------------------------------------------------- rendering
  function renderGrid() {
    const grid = $('clockGrid');
    grid.innerHTML = '';
    clocks.forEach((c, i) => {
      const card = document.createElement('article');
      card.className = 'clock-card';
      card.innerHTML = cardHtml(c, i);
      grid.appendChild(card);
      c.el = card;
      c.h = card.querySelector('.h-hand'); c.m = card.querySelector('.m-hand'); c.s = card.querySelector('.s-hand');
      c.face = card.querySelector('.face'); c.ampm = card.querySelector('.ampm');
      c.dtime = card.querySelector('.dtime'); c.day = card.querySelector('.day'); c.off = card.querySelector('.off'); c.rel = card.querySelector('.rel');
    });
    fillBase();
    tick(true);
  }

  const timeFmt = new Map();
  function timeString(date, tz) {
    if (!timeFmt.has(tz)) timeFmt.set(tz, new Intl.DateTimeFormat([], { timeZone: tz, hour: 'numeric', minute: '2-digit' }));
    return timeFmt.get(tz).format(date);
  }

  let lastLabels = 0;
  function tick(force) {
    const now = planned || new Date();
    const ms = planned ? 0 : now.getMilliseconds();
    const updateLabels = force || Date.now() - lastLabels > 1000;
    for (const c of clocks) {
      if (!c.el) continue;
      const z = zoned(now, c.tz);
      const sec = z.s + ms / 1000;
      const min = z.m + sec / 60;
      const hr = (z.h % 12) + min / 60;
      c.h.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
      c.m.setAttribute('transform', `rotate(${min * 6} 100 100)`);
      c.s.setAttribute('transform', `rotate(${sec * 6} 100 100)`);
      c.s.style.display = planned ? 'none' : '';
      if (updateLabels) {
        const night = z.h < 6 || z.h >= 19;
        c.el.classList.toggle('night', night);
        c.el.classList.toggle('base', !!planned && c.tz === baseTz);
        c.face.setAttribute('fill', night ? 'url(#faceNight)' : 'url(#faceGrad)');
        c.ampm.textContent = z.h < 12 ? 'AM' : 'PM';
        c.dtime.textContent = timeString(now, c.tz);
        c.day.textContent = (night ? '🌙 ' : '☀️ ') + dayLabel(now, c.tz);
        c.off.textContent = offsetLabel(offsetMinutes(now, c.tz));
        c.rel.textContent = c.tz === localTz ? 'Your time' : relLabel(now, c.tz);
      }
    }
    if (updateLabels) lastLabels = Date.now();
  }

  function loop() { if (visible && !planned) tick(false); requestAnimationFrame(loop); }

  // --------------------------------------------------------------- planner
  function fillBase() {
    const sel = $('plannerBase');
    const prev = sel.value || baseTz;
    const opts = [{ city: 'My time', tz: localTz }, ...clocks];
    sel.innerHTML = opts.map(c => `<option value="${esc(c.tz)}">${esc(c.city)}</option>`).join('');
    sel.value = opts.some(o => o.tz === prev) ? prev : localTz;
    baseTz = sel.value;
    if (!planned) syncSlider();
  }

  function syncSlider() {
    const z = zoned(new Date(), baseTz);
    $('plannerSlider').value = Math.round((z.h * 60 + z.m) / 15) * 15;
  }

  function applyPlanner() {
    const target = +$('plannerSlider').value;
    const now = new Date();
    const z = zoned(now, baseTz);
    const delta = target - (z.h * 60 + z.m);
    planned = new Date(now.getTime() + delta * 60000 - z.s * 1000 - now.getMilliseconds());
    const baseName = $('plannerBase').selectedOptions[0]?.textContent || 'base';
    $('plannerReadout').innerHTML = `<span class="pill">Planning</span>${String(Math.floor(target / 60) % 24).padStart(2, '0')}:${String(target % 60).padStart(2, '0')} in ${esc(baseName)} — ` +
      clocks.filter(c => c.tz !== baseTz).slice(0, 4).map(c => `${esc(c.city)} ${timeString(planned, c.tz)}`).join(' · ');
    tick(true);
  }

  function goLive() {
    planned = null;
    syncSlider();
    $('plannerReadout').textContent = 'Live time';
    tick(true);
  }

  // --------------------------------------------------------------- persist
  function save() { try { localStorage.setItem('ml-clocks', JSON.stringify(clocks.map(c => c.city))); } catch (e) {} }
  function load() {
    let names = null;
    try { names = JSON.parse(localStorage.getItem('ml-clocks') || 'null'); } catch (e) {}
    const fresh = !Array.isArray(names);
    if (fresh) names = DEFAULTS;
    clocks = names.map(n => CITIES.find(c => c[0] === n)).filter(Boolean).map(([city, tz]) => ({ city, tz }));
    // First visit: put the viewer's own city first when we know it.
    const localCity = CITIES.find(c => c[1] === localTz);
    if (fresh && localCity && !clocks.some(c => c.tz === localTz)) clocks.unshift({ city: localCity[0], tz: localTz });
  }

  let visible = false;
  function init() {
    defs();
    load();
    $('cityPicker').innerHTML = CITIES.map(([c, tz], i) => `<option value="${i}">${esc(c)} — ${offsetLabel(offsetMinutes(new Date(), tz))}</option>`).join('');
    $('cityPicker').value = String(CITIES.findIndex(c => c[0] === 'Dubai'));
    $('addCity').addEventListener('click', () => {
      const [city, tz] = CITIES[+$('cityPicker').value];
      if (clocks.some(c => c.city === city)) { window.MLApp.toast(`${city} is already on your board`); return; }
      clocks.push({ city, tz }); save(); renderGrid();
      window.MLApp.toast(`Added ${city}`);
    });
    $('clockGrid').addEventListener('click', e => {
      const b = e.target.closest('.remove'); if (!b) return;
      clocks.splice(+b.dataset.i, 1); save(); renderGrid();
    });
    $('plannerSlider').addEventListener('input', applyPlanner);
    $('plannerBase').addEventListener('change', e => { baseTz = e.target.value; planned ? applyPlanner() : syncSlider(); });
    $('plannerLive').addEventListener('click', goLive);
    renderGrid();
    requestAnimationFrame(loop);
  }

  window.MLClocks = { init, onShow() { visible = true; tick(true); }, onHide() { visible = false; } };
})();
