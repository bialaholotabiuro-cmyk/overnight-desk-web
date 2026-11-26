(function () {
  'use strict';

  const BOT_META = {
    scanner: { label: 'Scanner', color: '#64d2ff', unit: 'pule' },
    analyst: { label: 'Analyst', color: '#ffd60a', unit: 'audyty' },
    brain: { label: 'Brain', color: '#bf5af2', unit: 'oceny' },
    executor: { label: 'Executor', color: '#00d35a', unit: 'zlecenia' },
    risk: { label: 'Risk', color: '#ff6b9a', unit: 'pozycje' },
  };

  const state = {
    dataPath: localStorage.getItem('desk_data_path') || '',
    tab: 'home',
    subView: null, // { type: 'coin'|'audit', mint }
    range: 'LIVE',
    loading: true,
    error: null,
    retryIn: 15,
    lastGoodTs: null,
    lastBalanceStr: '',
    lastScreenUrl: '',
    settingsDraft: {}, // key -> draft string (unsaved Account edits)
    data: {
      state: null,
      charts: null,
      activity: null,
      orders: null,
      account: null,
      settings: null,
      bots: {},
      coins: {},
      audits: {},
    },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const fmtTime = (ts) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const fmtUsd = (v) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    if (Math.abs(n) >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
    return `$${n.toPrecision(4)}`;
  };

  const fmtAge = (createdTs) => {
    if (!createdTs) return 'nowy';
    const mins = Math.max(1, Math.floor((Date.now() / 1000 - createdTs) / 60));
    if (mins < 60) return `${mins}m old`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h old`;
  };

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function extractDataPathFromInput(raw) {
    const val = (raw || '').trim();
    if (!val) return '';
    const hashIdx = val.indexOf('#d=');
    if (hashIdx >= 0) {
      return val.slice(hashIdx + 3).split('&')[0].trim();
    }
    if (val.includes('/d/')) {
      const seg = val.split('/d/')[1].split('/')[0].split('#')[0].split('?')[0];
      return seg.trim();
    }
    return val.replace(/^#+/, '').replace(/^d=/, '').trim();
  }

  function consumeUrlHash() {
    const h = window.location.hash || '';
    if (h.startsWith('#d=')) {
      const dp = decodeURIComponent(h.slice(3).split('&')[0].trim());
      if (dp) {
        localStorage.setItem('desk_data_path', dp);
        state.dataPath = dp;
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function dataUrl(rel) {
    return `d/${encodeURIComponent(state.dataPath)}/${rel}`;
  }

  async function fetchJson(rel) {
    const res = await fetch(`${dataUrl(rel)}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function refreshAll() {
    if (!state.dataPath) return;
    try {
      const [st, charts, act, ords, acc, sets] = await Promise.all([
        fetchJson('state.json'),
        fetchJson('chart.json'),
        fetchJson('activity.json'),
        fetchJson('orders.json').catch(() => ({ items: [] })),
        fetchJson('account.json').catch(() => state.data.account),
        fetchJson('settings.json').catch(() => state.data.settings),
      ]);
      state.data.state = st;
      state.data.charts = charts;
      state.data.activity = act;
      state.data.orders = ords;
      if (acc) state.data.account = acc;
      if (sets) state.data.settings = sets;
      state.loading = false;
      state.error = null;
      state.lastGoodTs = st.ts || Math.floor(Date.now() / 1000);
      state.retryIn = 15;
      updateBellAndAvatar();
      // Don't wipe an in-progress Account edit with a poll re-render.
      const editing = state.tab === 'account' && Object.keys(state.settingsDraft).length;
      if (!editing) render();
      refreshLiveScreenImage();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'offline';
      state.retryIn = 15;
      renderErrorBanner();
      if (!state.data.state) render();
    }
  }

  function updateBellAndAvatar() {
    const st = state.data.state;
    if (!st) return;
    const act = state.data.activity?.items || [];
    $('bell-dot').classList.toggle('hidden', act.length === 0);
    const acc = state.data.account;
    if (acc && acc.fomo_handle) {
      $('nav-avatar').textContent = acc.fomo_handle.slice(0, 2).toUpperCase();
    }
  }

  function renderErrorBanner() {
    const el = $('error-banner');
    if (!state.error) {
      el.classList.add('hidden');
      return;
    }
    el.textContent = `Desk offline · retrying in ${state.retryIn}s · last update ${fmtTime(state.lastGoodTs)}`;
    el.classList.remove('hidden');
  }

  function renderDigitRoll(targetEl, text) {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (text === '—') {
      targetEl.innerHTML = '<span class="muted" style="font-weight:500;">$—</span>';
      state.lastBalanceStr = text;
      return;
    }
    if (reduced) {
      targetEl.textContent = text;
      state.lastBalanceStr = text;
      return;
    }
    const prev = state.lastBalanceStr;
    targetEl.innerHTML = '';
    [...text].forEach((ch, idx) => {
      if (/\d/.test(ch)) {
        const slot = document.createElement('span');
        slot.className = 'digit-slot';
        const reel = document.createElement('span');
        reel.className = 'digit-reel';
        for (let d = 0; d <= 9; d++) {
          const cell = document.createElement('span');
          cell.textContent = String(d);
          reel.appendChild(cell);
        }
        const prevDigit = prev && /\d/.test(prev[idx]) ? Number(prev[idx]) : 0;
        reel.style.transform = `translateY(-${prevDigit * 10}%)`;
        slot.appendChild(reel);
        targetEl.appendChild(slot);
        requestAnimationFrame(() => {
          reel.style.transitionDelay = `${idx * 30}ms`;
          reel.style.transform = `translateY(-${Number(ch) * 10}%)`;
        });
      } else {
        const span = document.createElement('span');
        span.textContent = ch;
        targetEl.appendChild(span);
      }
    });
    state.lastBalanceStr = text;
  }

  function refreshLiveScreenImage() {
    const st = state.data.state;
    if (!st || !st.screen || !st.screen.available) return;
    const url = `${dataUrl('screen.jpg')}?ts=${Date.now()}`;
    const probe = new Image();
    probe.onload = () => {
      state.lastScreenUrl = url;
      const img = $('live-screen-img');
      if (img) img.src = url;
      const modalImg = $('screen-modal-img');
      if (modalImg && !$('screen-modal').classList.contains('hidden')) {
        modalImg.src = url;
      }
    };
    probe.src = url;
  }

  function marketPillHtml(regime) {
    if (!regime) return '<span class="pill pill-grey">Quiet</span>';
    const mode = String(regime.mode || '').toLowerCase();
    if (mode === 'red' || (regime.sol_h1 != null && Number(regime.sol_h1) <= -4.0)) {
      const chg = regime.sol_h1 != null ? `${Number(regime.sol_h1).toFixed(1)}%` : '-4.6%';
      return `<span class="pill pill-red">Red mode · SOL ${esc(chg)} 1h</span>`;
    }
    if (mode === 'green') return '<span class="pill pill-green">Green market</span>';
    return '<span class="pill pill-grey">Quiet</span>';
  }

  function renderSkeleton() {
    return `
      <div class="stack" style="margin-top:8px;">
        <div class="skel" style="height:64px;width:62%;"></div>
        <div class="skel" style="height:24px;width:45%;"></div>
        <div class="skel" style="height:190px;width:100%;"></div>
        <div class="skel" style="height:210px;width:100%;border-radius:22px;"></div>
        <div class="skel" style="height:110px;width:100%;"></div>
      </div>
    `;
  }

  function renderOnboarding() {
    $('navbar').classList.add('hidden');
    $('tabbar').classList.add('hidden');
    $('error-banner').classList.add('hidden');
    $('main').innerHTML = `
      <div class="onboard-wrap">
        <div class="onboard-card">
          <h1 class="onboard-title">Grok Bot</h1>
          <p class="muted small">Wklej prywatny link do swojego desku, aby połączyć aplikację na Androidzie (Plan B · GitHub Pages).</p>
          <input id="onboard-input" class="input" type="text" placeholder="Paste your desk link" autocomplete="off">
          <button id="onboard-save" class="btn-primary">Połącz</button>
        </div>
      </div>
    `;
    $('onboard-save').onclick = () => {
      const dp = extractDataPathFromInput($('onboard-input').value);
      if (!dp || dp.length < 8) {
        showToast('Podaj poprawny link #d=...');
        return;
      }
      localStorage.setItem('desk_data_path', dp);
      state.dataPath = dp;
      state.loading = true;
      state.error = null;
      render();
      refreshAll();
    };
  }

  function renderHome() {
    const st = state.data.state;
    const act = state.data.activity?.items || [];
    const charts = state.data.charts || {};
    const chartData = charts[state.range] || charts.LIVE || { points: [], marks: [] };

    const isPaper = !st || st.mode === 'PAPER';
    const balStr = st && st.balance != null ? fmtUsd(st.balance) : '—';
    const pctVal = st && st.today_pct != null ? `${st.today_pct >= 0 ? '+' : ''}${Number(st.today_pct).toFixed(2)}% dziś` : 'Waiting for the first trade';
    const pctCls = st && st.today_pct != null ? (st.today_pct >= 0 ? 'green' : 'red') : 'muted';
    const multPill = st && st.multiplier != null
      ? `<span class="pill pill-green">${Number(st.multiplier).toFixed(2)}×</span>`
      : '';

    // Screen card meta
    const scr = st?.screen || {};
    const ageS = scr.ts ? Math.max(0, Math.floor(Date.now() / 1000) - scr.ts) : 9999;
    let scrBadge = `<span class="pill-small"><span class="dot dot-grey"></span>Brak klatki</span>`;
    if (scr.paused) {
      scrBadge = `<span class="pill-small"><span class="dot dot-orange"></span>Paused · private</span>`;
    } else if (scr.available && ageS <= 5) {
      scrBadge = `<span class="pill-small"><span class="dot dot-red"></span>Live · Bot's computer</span>`;
    } else if (scr.available) {
      scrBadge = `<span class="pill-small"><span class="dot dot-grey"></span>Last frame ${fmtTime(scr.ts)}</span>`;
    }

    const activeBot = (st?.bots || []).find((b) => b.latest && b.latest.status === 'clicking');
    const laneBadge = activeBot
      ? `<span class="pill-small" style="color:${BOT_META[activeBot.name].color}">${BOT_META[activeBot.name].label} · clicking</span>`
      : `<span class="pill-small">Idle</span>`;

    const lo = st?.last_order;
    const loText = lo
      ? `${lo.side === 'buy' ? 'Bought' : 'Sold'} ${esc(lo.symbol || lo.mint.slice(0, 6))} · ${fmtUsd(lo.fill_usd ?? lo.usd)} · ${esc(lo.status)}`
      : 'Brak zleceń w tej sesji';
    const loChecks = lo ? `
      <span class="checks-row">
        <span class="chk ${lo.checks?.screen_ok ? 'ok' : ''}">ekran</span>
        <span class="chk ${lo.checks?.api_ok ? 'ok' : ''}">api</span>
        <span class="chk ${lo.checks?.chain_ok ? 'ok' : ''}">chain</span>
      </span>` : '';

    // Bot carousel cards
    const botCardsHtml = (st?.bots || []).map((b) => {
      const m = BOT_META[b.name] || { label: b.name, color: '#fff', unit: '' };
      let detail = `<div class="small muted">Brak aktywności</div>`;
      if (b.name === 'scanner') {
        const verdict = b.latest ? (b.latest.verdict === 'pass'
          ? `<span class="green">→ Analyst</span>`
          : `<span class="strike">${esc(b.latest.symbol || b.latest.mint?.slice(0, 6) || '')}</span> <span class="muted">${esc(b.latest.reason || '')}</span>`)
          : '<span class="muted">Feed gotowy</span>';
        detail = `<div class="small">${b.count} ${m.unit}</div><div class="small">${verdict}</div>`;
      } else if (b.name === 'analyst') {
        const sc = b.latest?.score != null ? Number(b.latest.score) : null;
        detail = `
          <div class="small">${b.count} ${m.unit} · ${sc != null ? `<span class="${sc >= 70 ? 'green' : 'muted'}">score ${sc}</span>` : 'oczekuje'}</div>
          <div class="strip-grid">${Array.from({ length: 8 }).map((_, i) => `<span class="strip ${b.latest ? 'ok' : ''}"></span>`).join('')}</div>
        `;
      } else if (b.name === 'brain') {
        detail = b.latest
          ? `<div class="small">${esc(b.latest.symbol || '')} · $${Number(b.latest.sizeUsd || 0).toFixed(2)} · ${esc(b.latest.pctOfCash ?? 0)}% of cash</div><div class="small muted">cap: ${esc(b.latest.capHit || 'none')} · score ${esc(b.latest.score ?? '—')}</div>`
          : `<div class="small">Sizing</div><div class="small muted">80+ = full size</div>`;
      } else if (b.name === 'executor') {
        detail = `<div class="small">${b.count} ${m.unit}</div><div class="small muted">${lo ? `${esc(lo.status)} · ${esc(lo.quote_source || 'fomo')}` : 'Waiting for a dip -15%'}</div>`;
      } else if (b.name === 'risk') {
        const openN = st?.open_positions?.length || 0;
        detail = `
          <div class="small">Guarding (${openN})</div>
          <div class="sub-pills" style="margin-top:2px;">
            <span class="pill pill-red">stop -25%</span>
            <span class="pill pill-green">trail 40%</span>
          </div>
        `;
      }
      return `
        <div class="bot-mini" data-open-bots="1">
          <div class="bot-mini-top">
            <span class="bot-name" style="color:${m.color}"><span class="dot" style="background:${m.color}"></span>${m.label}</span>
            <span class="small mono muted">${esc(b.status)}</span>
          </div>
          ${detail}
        </div>
      `;
    }).join('');

    const actHtml = act.length === 0
      ? `<div class="card muted small">Waiting for the first trade</div>`
      : `<div class="list-card">${act.slice(0, 5).map(renderActivityRow).join('')}</div>`;

    const posHtml = (st?.open_positions || []).length
      ? `<div class="sec-head"><h2 class="sec-title">Otwarte pozycje</h2></div>
         <div class="list-card">${st.open_positions.map((p) => `
           <div class="row-item">
             <div class="row-main" data-open-coin="${esc(p.mint)}">
               <div class="row-title">${esc(p.symbol || p.mint.slice(0, 8))}</div>
               <div class="row-sub">${fmtUsd(p.size_usd)} wejście</div>
             </div>
             <div class="row-right">
               <span class="mono ${Number(p.unrealized_pnl_usd || 0) >= 0 ? 'green' : 'red'}">${p.unrealized_pnl_pct != null ? `${p.unrealized_pnl_pct >= 0 ? '+' : ''}${p.unrealized_pnl_pct}%` : '—'}</span>
               <a class="fomo-chip" href="${esc(p.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>
             </div>
           </div>`).join('')}</div>`
      : '';

    $('main').innerHTML = `
      <section class="hero">
        <div class="balance-row">
          <div id="balance-val" class="balance-val"></div>
          ${isPaper ? '<span class="badge-paper">PAPER</span>' : ''}
        </div>
        <div class="sub-pills">
          <span class="${pctCls}">${esc(pctVal)}</span>
          ${multPill}
          ${marketPillHtml(st?.regime)}
        </div>
      </section>

      <section class="chart-wrap">
        <canvas id="home-chart" class="chart-canvas"></canvas>
        <div class="range-row">
          ${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map((r) => `
            <button class="range-btn ${state.range === r ? 'active' : ''}" data-range="${r}">${r}</button>
          `).join('')}
        </div>
      </section>

      <section class="live-screen-card">
        <div id="live-screen-stage" class="live-screen-stage">
          ${scr.available
            ? `<img id="live-screen-img" src="${esc(state.lastScreenUrl || `${dataUrl('screen.jpg')}?ts=${scr.ts || 1}`)}" alt="Ekran bota">`
            : `<div class="live-screen-empty">Brak aktywnego podglądu ekranu</div>`}
          <div class="live-overlay-top">${scrBadge}${laneBadge}</div>
        </div>
        <div class="live-screen-foot">
          <div class="small" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${loText}</div>
          ${loChecks}
        </div>
      </section>

      ${posHtml}

      <div class="sec-head">
        <h2 class="sec-title">Bots · 5 running</h2>
        <button class="sec-link" data-open-bots="1">Szczegóły</button>
      </div>
      <div class="bots-carousel">${botCardsHtml}</div>

      <div class="sec-head">
        <h2 class="sec-title">Activity · See all</h2>
        <button class="sec-link" id="home-see-all">Wszystkie</button>
      </div>
      ${actHtml}
    `;

    renderDigitRoll($('balance-val'), balStr);
    window.DeskCharts.drawBalanceChart($('home-chart'), chartData, st?.night_start);

    document.querySelectorAll('.range-btn').forEach((btn) => {
      btn.onclick = () => {
        state.range = btn.dataset.range;
        renderHome();
      };
    });
    document.querySelectorAll('[data-open-bots]').forEach((el) => {
      el.onclick = () => switchTab('bots');
    });
    const seeAll = $('home-see-all');
    if (seeAll) seeAll.onclick = () => switchTab('activity');

    const stage = $('live-screen-stage');
    if (stage) {
      stage.onclick = () => {
        if (!scr.available) return;
        $('screen-modal-status').innerHTML = scrBadge;
        $('screen-modal-img').src = state.lastScreenUrl || `${dataUrl('screen.jpg')}?ts=${Date.now()}`;
        const fomoBtn = $('screen-modal-fomo');
        if (lo && lo.coin_url) {
          fomoBtn.href = lo.coin_url;
          fomoBtn.classList.remove('hidden');
        } else {
          fomoBtn.classList.add('hidden');
        }
        $('screen-modal').classList.remove('hidden');
      };
    }
    bindRowClicks();
  }

  function renderActivityRow(item) {
    const kind = item.kind || 'bought';
    const sym = item.symbol || (item.mint ? item.mint.slice(0, 6) : '—');
    let title = item.title || `${kind} ${sym}`;
    let rightCls = '';
    let rightTxt = item.value != null ? fmtUsd(item.value) : '—';
    if (kind === 'bought') {
      title = item.title || `Bought ${sym}`;
    } else if (kind === 'sold') {
      title = item.title || `Sold ${sym}`;
      rightCls = 'green';
      rightTxt = item.value != null ? `+${fmtUsd(Math.abs(item.value))}` : 'Sold';
    } else if (kind === 'stopped') {
      title = item.title || `Stopped ${sym}`;
      rightCls = 'red';
      rightTxt = item.value != null ? `-${fmtUsd(Math.abs(item.value))}` : '-25%';
    } else if (kind === 'rejected') {
      title = item.title || `Rejected ${sym}`;
      rightCls = 'muted';
      rightTxt = 'Skipped';
    }
    const targetKind = kind === 'rejected' ? 'audit' : 'coin';
    return `
      <div class="row-item">
        <div class="row-main" ${item.mint ? `data-open-${targetKind}="${esc(item.mint)}"` : ''}>
          <div class="row-title">${esc(title)}</div>
          <div class="row-sub">${esc(item.bot || 'desk')} · ${esc(item.subtitle || fmtTime(item.ts))}</div>
        </div>
        <div class="row-right">
          <span class="mono small ${rightCls}">${esc(rightTxt)}</span>
          ${item.coin_url ? `<a class="fomo-chip" href="${esc(item.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}
        </div>
      </div>
    `;
  }

  async function renderBots() {
    const st = state.data.state;
    const bots = st?.bots || Object.keys(BOT_META).map((name) => ({ name, status: 'idle', paused: false, count: 0 }));
    const openPosCount = st?.open_positions?.length || 0;

    // Fetch per-bot decisions lazily if missing
    await Promise.all(
      bots.map(async (b) => {
        if (!state.data.bots[b.name]) {
          try {
            state.data.bots[b.name] = await fetchJson(`bots/${b.name}.json`);
          } catch {}
        }
      })
    );

    $('main').innerHTML = `
      <div class="sec-head">
        <h2 class="sec-title">Bots · 5</h2>
        <button class="sec-link" id="bots-to-settings">Settings</button>
      </div>
      <div class="stack">
        ${bots.map((b) => {
          const m = BOT_META[b.name] || { label: b.name, color: '#fff' };
          const dec = state.data.bots[b.name];
          const items = (dec?.items || []).slice(0, 20);
          const riskLocked = b.name === 'risk' && openPosCount > 0;
          const pauseNote = riskLocked
            ? 'Zablokowany przy otwartej pozycji'
            : 'w planie B przez Telegram';
          const decHtml = items.length === 0
            ? `<div class="small muted">Brak decyzji dzisiaj</div>`
            : items.map((d) => `
              <div class="dec-row">
                <span class="row-main" ${d.mint ? `data-open-${b.name === 'analyst' ? 'audit' : 'coin'}="${esc(d.mint)}"` : ''}>
                  ${esc(d.mint ? d.mint.slice(0, 8) : (d.reason || d.status || '—'))} · <span class="muted">${esc(d.verdict || d.status || d.layer || (d.score != null ? `score ${d.score}` : ''))}</span>
                </span>
                ${d.coin_url ? `<a class="fomo-chip" href="${esc(d.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}
              </div>`).join('');
          return `
            <div class="card">
              <div class="bot-full-head">
                <div>
                  <div class="bot-name" style="color:${m.color}"><span class="dot" style="background:${m.color}"></span>${m.label}</div>
                  <div class="small muted">Dziś: ${b.count} · status: ${esc(b.status)}</div>
                </div>
                <div class="switch-wrap" title="${esc(pauseNote)}">
                  <span>${esc(pauseNote)}</span>
                  <button class="switch-pill" disabled aria-label="Pauza ${m.label}"></button>
                </div>
              </div>
              <div class="decisions-list">${decHtml}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    const setBtn = $('bots-to-settings');
    if (setBtn) setBtn.onclick = () => switchTab('account');
    bindRowClicks();
  }

  function renderActivity() {
    const act = state.data.activity?.items || [];
    $('main').innerHTML = `
      <div class="sec-head"><h2 class="sec-title">Activity</h2></div>
      ${act.length === 0
        ? `<div class="card muted small">Nothing yet tonight</div>`
        : `<div class="list-card">${act.map(renderActivityRow).join('')}</div>`}
    `;
    bindRowClicks();
  }

  async function renderAudit(mint) {
    let data = state.data.audits[mint];
    if (!data) {
      try {
        data = await fetchJson(`audit/${mint}.json`);
        state.data.audits[mint] = data;
      } catch {
        data = { mint, layers: [], score: null };
      }
    }
    const layers = data.layers || [];
    const sc = data.score;
    const socialRow = sc && sc.social
      ? `Social +${sc.social_pts ?? 0} · smart/15m aktywne`
      : 'Social: off';

    $('main').innerHTML = `
      <div class="sec-head">
        <button class="btn-ghost" id="sub-back">‹ Wróć</button>
        ${data.coin_url ? `<a class="fomo-chip" href="${esc(data.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}
      </div>
      <div class="card">
        <div class="coin-title">${esc(data.coin?.symbol || mint.slice(0, 8))}</div>
        <div class="small mono muted" style="overflow-wrap:anywhere;">${esc(mint)}</div>
        <div class="audit-discs">
          <div class="audit-beam"></div>
          ${Array.from({ length: 8 }).map((_, idx) => {
            const l = layers[idx];
            const cls = l ? (l.pass ? 'ok' : 'bad') : '';
            const mark = l ? (l.pass ? '✓' : '✕') : String(idx + 1);
            return `
              <div class="disc-item">
                <div class="disc ${cls}">${mark}</div>
                <div class="small">${esc(l?.name || `Warstwa ${idx + 1}`)}</div>
                <div class="small mono muted">${esc(l?.value_text || '—')}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="row-item" style="padding:10px 0 0;border-top:1px solid var(--sep);">
          <span class="small">${esc(socialRow)}</span>
        </div>
      </div>
    `;
    $('sub-back').onclick = () => { state.subView = null; render(); };
  }

  async function renderCoin(mint) {
    let data = state.data.coins[mint];
    if (!data) {
      try {
        data = await fetchJson(`coin/${mint}.json`);
        state.data.coins[mint] = data;
      } catch {
        data = { mint, candles: [], audit_summary: { passed: 0, total: 0 } };
      }
    }
    const st = state.data.state;
    const isPaper = !st || st.mode === 'PAPER';
    const c = data.coin || {};
    const pos = data.position;
    const curP = data.price?.price ?? pos?.entry_price;
    const chgPct = (pos && pos.entry_price && curP)
      ? (((curP - pos.entry_price) / pos.entry_price) * 100).toFixed(2)
      : null;
    const shield = data.audit_summary ? `${data.audit_summary.passed}/${data.audit_summary.total || 8}` : '0/8';

    $('main').innerHTML = `
      <div class="sec-head">
        <button class="btn-ghost" id="sub-back">‹ Wróć</button>
        <button class="pill pill-grey" data-open-audit="${esc(mint)}" style="border:none;cursor:pointer;">${esc(shield)} ›</button>
      </div>
      <div class="coin-head">
        <div>
          <h1 class="coin-title">${esc(c.name || c.symbol || mint.slice(0, 8))}</h1>
          <div class="small muted">${esc(c.symbol || mint.slice(0, 6))} · Solana · ${fmtAge(c.created_at)}</div>
        </div>
        ${isPaper ? '<span class="badge-paper">PAPER</span>' : ''}
      </div>

      <div class="coin-price mono">${curP != null ? fmtUsd(curP) : '—'}</div>
      <div class="small ${chgPct != null && Number(chgPct) >= 0 ? 'green' : 'muted'}">
        ${chgPct != null ? `▲ ${chgPct}% since entry` : 'Brak otwartej pozycji'}
      </div>

      <div class="chart-wrap">
        <canvas id="coin-chart" class="coin-chart-canvas"></canvas>
      </div>

      <div class="tiles-grid">
        <div class="tile"><div class="small muted">Liquidity</div><div class="tile-val mono">${fmtUsd(data.latest_scan?.liquidity_usd)}</div></div>
        <div class="tile"><div class="small muted">Holders</div><div class="tile-val mono">${esc(data.price?.holders ?? c.holders ?? '—')}</div></div>
        <div class="tile"><div class="small muted">Score</div><div class="tile-val mono">${esc(data.latest_score?.score ?? '—')}</div></div>
      </div>

      ${pos ? `<div class="card small">Your position · ${fmtUsd(pos.size_usd)} in · Executor</div>` : ''}

      <div class="btn-row">
        <a class="btn-secondary" href="${esc(data.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>
        <button id="coin-sell-now" class="btn-primary btn-red">Sell now</button>
      </div>
    `;
    window.DeskCharts.drawCoinCandles($('coin-chart'), data.candles || [], pos?.stop_price);
    $('sub-back').onclick = () => { state.subView = null; render(); };
    $('coin-sell-now').onclick = () => {
      $('sell-modal-title').textContent = `Sell now · ${c.symbol || mint.slice(0, 6)}`;
      $('sell-modal').classList.remove('hidden');
    };
    bindRowClicks();
  }


  function settingsRegistry() {
    const fromJson = state.data.settings && state.data.settings.registry;
    if (fromJson && fromJson.settings && fromJson.settings.length) return fromJson;
    return window.DESK_SETTINGS_REGISTRY || { settings: [], group_order: [], group_labels: {}, telegram_bot: 'GrzegrzolkaBot', live_warning: '' };
  }

  function telegramBotName() {
    return (state.data.settings && state.data.settings.telegram_bot) || settingsRegistry().telegram_bot || 'GrzegrzolkaBot';
  }

  function currentSettingMap() {
    const list = (state.data.settings && state.data.settings.settings) || [];
    const map = {};
    (settingsRegistry().settings || []).forEach((sp) => { map[sp.key] = sp.default; });
    list.forEach((r) => { map[r.key] = r.value; });
    return map;
  }

  function formatSettingDisplay(spec, stored) {
    if (spec.kind === 'bool') return (stored === '1' || stored === 'true' || stored === 'on') ? 'on' : 'off';
    if (spec.kind !== 'num') return String(stored ?? '');
    const n = Number(stored);
    if (!Number.isFinite(n)) return String(stored ?? '');
    const body = Number.isInteger(n) ? String(n) : String(n);
    if (spec.neg_display) return `-${body}%`;
    if (spec.unit === 'pct') return `${body}%`;
    if (spec.unit === 'usd') return `$${body}`;
    if (spec.unit === 'x') return `${body}x`;
    return body;
  }

  function effectiveHi(spec, values) {
    let hi = spec.hi;
    if (spec.dynamic_max_of) {
      const dyn = Number(values[spec.dynamic_max_of]);
      if (Number.isFinite(dyn)) hi = Math.min(hi, dyn);
    }
    return hi;
  }

  function parseDraft(spec, raw, values) {
    const txt = String(raw ?? '').trim();
    if (spec.kind === 'time') {
      const m = txt.match(/^(\d{1,2}):(\d{2})$/);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
        return { ok: false, error: `${spec.ui_key}: podaj godzinę HH:MM (00:00–23:59).` };
      }
      const stored = `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
      return { ok: true, stored, command: `set ${spec.command_name} to ${stored}` };
    }
    if (spec.kind === 'enum') {
      const low = txt.toLowerCase();
      if (!(spec.choices || []).includes(low)) {
        return { ok: false, error: `${spec.ui_key}: dozwolone wartości: ${(spec.choices || []).join(', ')}.` };
      }
      return { ok: true, stored: low, command: `set ${spec.command_name} to ${low}` };
    }
    if (spec.kind === 'bool') {
      const low = txt.toLowerCase();
      let stored = null;
      if (['1', 'true', 'on', 'yes', 'tak'].includes(low)) stored = '1';
      if (['0', 'false', 'off', 'no', 'nie'].includes(low)) stored = '0';
      if (stored === null) return { ok: false, error: `${spec.ui_key}: dozwolone on/off.` };
      const shown = stored === '1' ? 'on' : 'off';
      return { ok: true, stored, command: `set ${spec.command_name} to ${shown}` };
    }
    // num
    let t = txt.replace(',', '.').replace(/%/g, '').replace(/\$/g, '').replace(/x$/i, '').trim();
    const n0 = Number(t);
    if (!Number.isFinite(n0)) return { ok: false, error: `${spec.ui_key}: '${raw}' nie jest liczbą.` };
    const n = spec.neg_display ? Math.abs(n0) : n0;
    const lo = spec.lo;
    const hi = effectiveHi(spec, values);
    if (n < lo || n > hi) {
      const fmt = (v) => formatSettingDisplay(spec, v);
      const rng = spec.neg_display ? `${fmt(hi)} do ${fmt(lo)}` : `${fmt(lo)} do ${fmt(hi)}`;
      return { ok: false, error: `Poza zakresem: ${spec.ui_key} musi być w zakresie ${rng} (podano ${fmt(n)}).` };
    }
    const stored = Number.isInteger(n) ? String(n) : String(n);
    return { ok: true, stored, command: `set ${spec.command_name} to ${formatSettingDisplay(spec, stored)}` };
  }

  function isValidSolanaAddress(addr) {
    const a = String(addr || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return false;
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n;
    try {
      for (const ch of a) {
        const i = B58.indexOf(ch);
        if (i < 0) return false;
        n = n * 58n + BigInt(i);
      }
    } catch { return false; }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const pad = a.match(/^1*/)[0].length;
    const len = (hex.length / 2) + pad;
    return len === 32;
  }

  function telegramHttpsUrl(text) {
    return `https://t.me/${telegramBotName()}?text=${encodeURIComponent(text)}`;
  }
  function telegramAppUrl(text) {
    return `tg://resolve?domain=${telegramBotName()}&text=${encodeURIComponent(text)}`;
  }

  async function openTelegramCommand(cmd) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(cmd);
      copied = true;
    } catch {}
    const httpsUrl = telegramHttpsUrl(cmd);
    const tgUrl = telegramAppUrl(cmd);
    // Try the native scheme first (Android Chrome PWA), then https t.me, then the copied command.
    const started = Date.now();
    try { window.location.href = tgUrl; } catch {}
    setTimeout(() => {
      // If the app didn't take over, fall back to t.me (opens Telegram or a tab).
      if (Date.now() - started < 2000) {
        const a = document.createElement('a');
        a.href = httpsUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
      }
    }, 700);
    showToast(copied ? 'Komenda skopiowana · otwieram Telegram' : 'Otwórz Telegram i wyślij skopiowaną komendę');
  }


  async function renderAccount() {
    if (!state.data.account) {
      try { state.data.account = await fetchJson('account.json'); } catch {}
    }
    if (!state.data.settings) {
      try { state.data.settings = await fetchJson('settings.json'); } catch {}
    }
    const acc = state.data.account || {};
    const published = state.data.settings || {};
    const registry = settingsRegistry();
    const values = currentSettingMap();
    const mode = published.mode || acc.mode || values.mode || 'PAPER';
    const liveWarning = published.live_warning || registry.live_warning ||
      'LIVE trades real cash on FOMO. New coins can go to 0 in minutes. Only put in what you can lose.';
    const rpcDisplay = published.rpc_url || `set · ${registry.default_rpc_host || 'api.mainnet-beta.solana.com'}`;
    const wdStatus = published.withdraw_address || 'not set';
    const groupOrder = registry.group_order || [];
    const groupLabels = registry.group_labels || {};
    const specs = registry.settings || [];
    const byGroup = {};
    specs.forEach((sp) => {
      (byGroup[sp.group] = byGroup[sp.group] || []).push(sp);
    });

    const dirtyValid = [];
    const invalidMsgs = [];

    function rowState(spec) {
      const cur = values[spec.key];
      const draft = Object.prototype.hasOwnProperty.call(state.settingsDraft, spec.key)
        ? state.settingsDraft[spec.key]
        : null;
      const raw = draft === null ? cur : draft;
      const parsed = parseDraft(spec, raw, { ...values, [spec.key]: raw });
      // Recompute dynamic max against committed values + other drafts? use committed stop_pct unless stop itself is drafted
      const valMap = { ...values };
      Object.keys(state.settingsDraft).forEach((k) => {
        const sp2 = specs.find((x) => x.key === k);
        if (!sp2) return;
        const p2 = parseDraft(sp2, state.settingsDraft[k], values);
        if (p2.ok) valMap[k] = p2.stored;
      });
      const parsed2 = parseDraft(spec, raw, valMap);
      const dirty = draft !== null && String(parsed2.ok ? parsed2.stored : raw) !== String(cur);
      if (parsed2.ok && dirty) dirtyValid.push({ spec, ...parsed2 });
      if (!parsed2.ok) invalidMsgs.push(parsed2.error);
      return { cur, raw, parsed: parsed2, dirty };
    }

    const groupsHtml = groupOrder.map((g) => {
      const rows = (byGroup[g] || []).map((spec) => {
        const st = rowState(spec);
        const cls = `slider-row${st.parsed.ok ? (st.dirty ? ' is-dirty' : '') : ' is-invalid'}`;
        const shown = st.parsed.ok ? formatSettingDisplay(spec, st.parsed.stored) : formatSettingDisplay(spec, st.cur);
        const keyLabel = esc(spec.ui_key || spec.name);
        let control = '';
        if (spec.kind === 'num') {
          const hi = effectiveHi(spec, values);
          control = `
            <div class="slider-controls">
              <input class="slider-input" type="range" min="${spec.lo}" max="${hi}" step="${spec.step}" value="${esc(st.parsed.ok ? st.parsed.stored : st.cur)}" data-key="${esc(spec.key)}" ${st.parsed.ok ? '' : ''}>
              <input class="num-input" type="number" inputmode="decimal" min="${spec.lo}" max="${hi}" step="${spec.step}" value="${esc(st.parsed.ok ? st.parsed.stored : String(st.raw))}" data-key="${esc(spec.key)}" aria-label="${keyLabel}">
            </div>`;
        } else if (spec.kind === 'time') {
          control = `<input class="time-input" type="time" value="${esc(st.parsed.ok ? st.parsed.stored : String(st.raw))}" data-key="${esc(spec.key)}" aria-label="${keyLabel}">`;
        } else if (spec.kind === 'enum') {
          const opts = (spec.choices || []).map((c) => `<option value="${esc(c)}" ${c === (st.parsed.ok ? st.parsed.stored : st.cur) ? 'selected' : ''}>${esc(c)}</option>`).join('');
          control = `<select class="enum-input" data-key="${esc(spec.key)}" aria-label="${keyLabel}">${opts}</select>`;
        } else if (spec.kind === 'bool') {
          const on = (st.parsed.ok ? st.parsed.stored : st.cur) === '1';
          control = `<button type="button" class="toggle${on ? ' on' : ''}" data-key="${esc(spec.key)}" aria-pressed="${on}" aria-label="${keyLabel}"></button>`;
        }
        const hint = st.parsed.ok ? '' : `<div class="range-hint">${esc(st.parsed.error)}</div>`;
        const saveBtn = (st.parsed.ok && st.dirty)
          ? `<button type="button" class="row-save" data-save="${esc(spec.key)}">Wyślij w Telegramie · ${esc(st.parsed.command)}</button>`
          : '';
        return `
          <div class="${cls}" data-row="${esc(spec.key)}">
            <div class="slider-top"><span class="slider-key">${keyLabel}</span><span class="slider-val">${esc(shown)}</span></div>
            ${control}
            ${hint}
            ${saveBtn}
          </div>`;
      }).join('');
      return `
        <div class="card settings-group" id="settings-${esc(g)}">
          <div class="settings-group-head">
            <strong>${esc(groupLabels[g] || g)}</strong>
            <span class="small muted">zapis przez Telegram</span>
          </div>
          ${rows}
        </div>`;
    }).join('');

    const missing = published.live_missing || [];
    const liveLockedHint = missing.length ? `<div class="small muted">LIVE na razie zablokowane: ${esc(missing.join('; '))}.</div>` : '';
    const changes = published.change_log || [];
    const logHtml = changes.length ? changes.slice(0, 20).map((c) => `
          <div class="row-item">
            <div class="row-main">
              <div class="row-title">${esc(c.key)}</div>
              <div class="row-sub">${esc(c.old ?? '—')} → ${esc(c.new ?? '—')} · ${esc(c.who || '')}</div>
            </div>
            <span class="small muted">${fmtTime(c.ts)}</span>
          </div>`).join('') : '<div class="row-item"><span class="muted">Brak zmian.</span></div>';

    const wdDraft = Object.prototype.hasOwnProperty.call(state.settingsDraft, 'withdraw_address')
      ? state.settingsDraft.withdraw_address : '';
    const wdOk = wdDraft && isValidSolanaAddress(wdDraft);
    const wdErr = wdDraft && !wdOk ? 'To nie wygląda na adres Solana (Base58, 32–44 znaki).' : '';
    const wdCmd = wdOk ? `set withdraw_address ${wdDraft.trim()}` : '';

    const savebar = (dirtyValid.length || wdOk) ? `
      <div class="settings-savebar" id="settings-savebar">
        <div class="cmd-preview">${esc((dirtyValid[0] && dirtyValid[0].command) || wdCmd)}</div>
        <button type="button" class="btn-primary" id="savebar-send">Wyślij ${dirtyValid.length + (wdOk ? 1 : 0)} zmianę w Telegramie</button>
        <button type="button" class="btn-ghost" id="savebar-copy">Kopiuj komendę</button>
      </div>` : '';

    $('main').innerHTML = `
      <div class="sec-head"><h2 class="sec-title">Account</h2></div>

      <div class="card stack">
        <div class="bot-full-head">
          <div>
            <strong>Tryb pracy: ${esc(mode)}</strong>
            <div class="small muted">Zmiana trybu tylko przez Telegram (paper / live)</div>
          </div>
          <span class="badge-paper">${esc(mode)}</span>
        </div>
        <div class="warning-box">${esc(liveWarning)}</div>
        <div class="mode-row">
          <button type="button" class="mode-btn ${mode === 'PAPER' ? 'active-paper' : ''}" id="mode-paper">PAPER</button>
          <button type="button" class="mode-btn ${mode === 'LIVE' ? 'active-live' : ''}" id="mode-live">LIVE</button>
        </div>
        ${liveLockedHint}
        <div class="row-item" style="padding:8px 0 0;">
          <span>Gotówka (PAPER / API)</span>
          <span class="mono">${fmtUsd(acc.balance)}</span>
        </div>
      </div>

      <div class="list-card" style="margin-top:12px;">
        <a class="row-item" href="${esc(acc.profile_url || '#')}" target="_blank" rel="noopener">
          <div class="row-main"><div class="row-title">Twój profil FOMO</div><div class="row-sub">@${esc(acc.fomo_handle || 'LoseMadter')}</div></div>
          <span class="muted">↗</span>
        </a>
        <div class="row-item" id="invite-friend-row" style="cursor:pointer;">
          <div class="row-main"><div class="row-title">Zaproś znajomego</div><div class="row-sub">Udostępnij lub skopiuj link polecający</div></div>
          <span class="muted">↗</span>
        </div>
        <div class="row-item">
          <div class="row-main"><div class="row-title">Copy picks</div><div class="row-sub">Harmonogram: ${esc(values.picks_every || acc.copy_picks_schedule || 'off')}</div></div>
        </div>
        <div class="row-item">
          <div class="row-main"><div class="row-title">${esc(acc.vault_status || 'Vault: files · not on phone')}</div><div class="row-sub">Notatki desku w komputerze bota (Obsidian) · Desk/Live.md</div></div>
        </div>
        <div class="row-item">
          <div class="row-main"><div class="row-title">Powiadomienia</div><div class="row-sub">Telegram only (Plan B) · ${esc(values.notifier || 'telegram')}</div></div>
        </div>
        <div class="row-item" id="watch-grok-bot" style="cursor:pointer;">
          <div class="row-main"><div class="row-title">Watch in Grok Bot</div><div class="row-sub">Otwórz podgląd ekranu bota</div></div>
          <span class="muted">›</span>
        </div>
      </div>

      <div class="card settings-group" id="settings-special" style="margin-top:12px;">
        <div class="settings-group-head">
          <strong>Wypłata i RPC</strong>
          <span class="small muted">właściciel ustawia sam</span>
        </div>
        <div class="slider-row">
          <div class="slider-top"><span class="slider-key">rpc_url</span><span class="slider-val">${esc(rpcDisplay)}</span></div>
          <div class="small muted">Jeśli RPC ma klucz, podajesz go tylko przez zamaskowaną kartę sekretu. Aplikacja pokazuje wyłącznie „set · host”.</div>
        </div>
        <div class="slider-row ${wdErr ? 'is-invalid' : (wdOk ? 'is-dirty' : '')}">
          <div class="slider-top"><span class="slider-key">withdraw_address</span><span class="slider-val">${esc(wdStatus === 'set' ? 'ustawiony' : 'nie ustawiony')}</span></div>
          <input class="addr-input" id="wd-input" type="text" autocomplete="off" spellcheck="false" placeholder="Adres Solana (wklej i wyślij w Telegramie)" value="${esc(wdDraft)}" aria-label="withdraw_address">
          ${wdErr ? `<div class="range-hint">${esc(wdErr)}</div>` : '<div class="small muted">Desk nie zapisuje adresu z tej strony — Save otwiera Telegram z komendą, bot prosi o yes.</div>'}
          ${wdOk ? `<button type="button" class="row-save" id="wd-save">Wyślij w Telegramie · set withdraw_address …</button>` : ''}
        </div>
      </div>

      <div class="sec-head"><h2 class="sec-title">Ustawienia</h2></div>
      ${groupsHtml}

      <div class="sec-head change-log"><h2 class="sec-title">Ostatnie zmiany</h2></div>
      <div class="list-card">${logHtml}</div>

      <button id="unlink-desk" class="btn-secondary" style="margin-top:16px;">Odłącz desk na tym telefonie</button>
      ${savebar}
    `;

    const setDraft = (key, val) => {
      const cur = currentSettingMap()[key];
      if (String(val) === String(cur)) delete state.settingsDraft[key];
      else state.settingsDraft[key] = String(val);
      // Keep scroll position while re-rendering the tab
      const y = window.scrollY;
      renderAccount().then(() => window.scrollTo(0, y));
    };

    $('main').querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      const apply = () => {
        if (el.type === 'range' || el.type === 'number' || el.type === 'time' || el.tagName === 'SELECT') {
          setDraft(key, el.value);
        }
      };
      if (el.classList.contains('toggle')) {
        el.onclick = () => setDraft(key, el.classList.contains('on') ? '0' : '1');
        return;
      }
      el.addEventListener('change', apply);
      if (el.type === 'range') el.addEventListener('input', () => {
        // live-update the sibling number field without a full rerender
        const row = el.closest('[data-row]');
        const num = row && row.querySelector('.num-input');
        if (num) num.value = el.value;
        const valEl = row && row.querySelector('.slider-val');
        const spec = specs.find((x) => x.key === key);
        if (valEl && spec) valEl.textContent = formatSettingDisplay(spec, el.value);
      });
      if (el.type === 'number') el.addEventListener('change', apply);
    });

    $('main').querySelectorAll('[data-save]').forEach((btn) => {
      btn.onclick = () => {
        const spec = specs.find((x) => x.key === btn.dataset.save);
        if (!spec) return;
        const raw = Object.prototype.hasOwnProperty.call(state.settingsDraft, spec.key)
          ? state.settingsDraft[spec.key] : currentSettingMap()[spec.key];
        const parsed = parseDraft(spec, raw, currentSettingMap());
        if (parsed.ok) openTelegramCommand(parsed.command);
      };
    });

    const wdInput = $('wd-input');
    if (wdInput) {
      wdInput.addEventListener('change', () => {
        const v = wdInput.value.trim();
        if (!v) delete state.settingsDraft.withdraw_address;
        else state.settingsDraft.withdraw_address = v;
        const y = window.scrollY;
        renderAccount().then(() => window.scrollTo(0, y));
      });
    }
    const wdSave = $('wd-save');
    if (wdSave) wdSave.onclick = () => {
      const v = (state.settingsDraft.withdraw_address || '').trim();
      if (isValidSolanaAddress(v)) openTelegramCommand(`set withdraw_address ${v}`);
    };

    $('mode-paper').onclick = () => openTelegramCommand('paper');
    $('mode-live').onclick = () => openTelegramCommand('live');

    const firstCmd = (dirtyValid[0] && dirtyValid[0].command) || wdCmd || '';
    const savebarSend = $('savebar-send');
    if (savebarSend) savebarSend.onclick = () => { if (firstCmd) openTelegramCommand(firstCmd); };
    const savebarCopy = $('savebar-copy');
    if (savebarCopy) savebarCopy.onclick = async () => {
      if (!firstCmd) return;
      try { await navigator.clipboard.writeText(firstCmd); showToast('Skopiowano komendę'); }
      catch { showToast(firstCmd); }
    };

    $('invite-friend-row').onclick = async () => {
      const url = acc.signup_url;
      if (!url) return;
      if (navigator.share) {
        try { await navigator.share({ title: 'FOMO', url }); return; } catch {}
      }
      try { await navigator.clipboard.writeText(url); showToast('Link skopiowany'); }
      catch { showToast('Link skopiowany'); }
    };

    $('watch-grok-bot').onclick = () => {
      switchTab('home');
      setTimeout(() => {
        const stage = $('live-screen-stage');
        if (stage) stage.click();
      }, 60);
    };

    $('unlink-desk').onclick = () => {
      localStorage.removeItem('desk_data_path');
      state.dataPath = '';
      state.settingsDraft = {};
      render();
    };
  }

  function bindRowClicks() {
    document.querySelectorAll('[data-open-coin]').forEach((el) => {
      el.onclick = () => {
        state.subView = { type: 'coin', mint: el.dataset.openCoin };
        render();
      };
    });
    document.querySelectorAll('[data-open-audit]').forEach((el) => {
      el.onclick = () => {
        state.subView = { type: 'audit', mint: el.dataset.openAudit };
        render();
      };
    });
  }

  function switchTab(tab) {
    state.tab = tab;
    state.subView = null;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    render();
  }

  function render() {
    if (!state.dataPath) {
      renderOnboarding();
      return;
    }
    $('navbar').classList.remove('hidden');
    $('tabbar').classList.remove('hidden');
    renderErrorBanner();

    if (state.loading && !state.data.state) {
      $('main').innerHTML = renderSkeleton();
      return;
    }
    if (state.subView) {
      if (state.subView.type === 'coin') renderCoin(state.subView.mint);
      else renderAudit(state.subView.mint);
      return;
    }
    if (state.tab === 'home') renderHome();
    else if (state.tab === 'bots') renderBots();
    else if (state.tab === 'activity') renderActivity();
    else if (state.tab === 'account') renderAccount();
  }

  function initModals() {
    $('nav-avatar').onclick = () => switchTab('account');
    $('nav-title').onclick = () => switchTab('home');
    $('nav-bell').onclick = () => switchTab('activity');
    $('nav-search').onclick = () => {
      $('search-modal').classList.remove('hidden');
      $('search-input').focus();
      renderSearch('');
    };
    $('search-close').onclick = () => $('search-modal').classList.add('hidden');
    $('search-input').oninput = (e) => renderSearch(e.target.value);

    $('screen-modal-close').onclick = () => $('screen-modal').classList.add('hidden');
    $('sell-modal-close').onclick = () => $('sell-modal').classList.add('hidden');
    document.querySelectorAll('.preset-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.preset-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      };
    });

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });
  }

  function renderSearch(q) {
    const query = (q || '').trim().toLowerCase();
    const idx = state.data.state?.search_index || [];
    const hits = idx.filter((c) =>
      !query ||
      (c.symbol || '').toLowerCase().includes(query) ||
      (c.name || '').toLowerCase().includes(query) ||
      (c.mint || '').toLowerCase().includes(query)
    );
    $('search-results').innerHTML = hits.length === 0
      ? '<div class="small muted">Brak pasujących coinów</div>'
      : hits.slice(0, 20).map((c) => `
          <div class="row-item">
            <div class="row-main" data-search-mint="${esc(c.mint)}">
              <div class="row-title">${esc(c.symbol || c.mint.slice(0, 8))}</div>
              <div class="row-sub">${esc(c.name || c.mint)}</div>
            </div>
            <a class="fomo-chip" href="${esc(c.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>
          </div>
        `).join('');
    document.querySelectorAll('[data-search-mint]').forEach((el) => {
      el.onclick = () => {
        $('search-modal').classList.add('hidden');
        state.subView = { type: 'coin', mint: el.dataset.searchMint };
        render();
      };
    });
  }

  function boot() {
    consumeUrlHash();
    window.addEventListener('hashchange', () => {
      const prev = state.dataPath;
      consumeUrlHash();
      if (state.dataPath && state.dataPath !== prev) {
        state.loading = true;
        render();
        refreshAll();
      }
    });
    initModals();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    render();
    if (state.dataPath) {
      refreshAll();
    }
    setInterval(() => {
      if (state.dataPath) refreshAll();
    }, 15000);
    setInterval(() => {
      if (state.error && state.retryIn > 1) {
        state.retryIn -= 1;
        renderErrorBanner();
      }
    }, 1000);
  }

  boot();
})();
