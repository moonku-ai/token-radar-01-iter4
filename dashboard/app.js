// Moonku Radar dashboard: board, detail view, filters, live benchmark. No network.
(function () {
  const D = window.RADAR;
  const $ = (s) => document.querySelector(s);
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function money(n) { return fmt$(n); }

  // Stats hero
  const bt = D.backtest;
  $('#stats').innerHTML =
    stat(fmtInt(D.board_size), 'protocols ranked') +
    stat(fmtInt(D.watchlist_size), 'on the watchlist') +
    stat(money(D.rows[0].implied_value_usd), 'rank 1 · ' + esc(D.rows[0].name)) +
    stat(bt.mdape_pct + '%', 'backtest median error') +
    stat(bt.within_2x_pct + '%', 'backtest within 2×');
  function stat(v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; }
  $('#bt-mdape').textContent = bt.mdape_pct + '%';
  $('#bt-mean').textContent = bt.mean_ape_pct + '%';
  $('#bt-log').textContent = bt.mean_log_err;
  $('#bt-within').textContent = bt.within_2x_pct + '%';
  $('#asof').textContent = D.as_of;
  $('#fine').textContent = 'Snapshot ' + D.as_of + ' · source ' + D.source + ' · watchlist floor $' +
    fmtInt(D.floor_usd) + ' · model ' + D.model_version + ' (slope ' + D.slope + ') · ' +
    D.board_size + ' rows (' + D.watchlist_size + ' watchlist + ' + D.early_size + ' early).';

  // Category filter options
  const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
  const sel = $('#category');
  cats.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });

  let sortKey = 'rank', sortDir = 1, query = '', cat = '', watchOnly = false;

  function filtered() {
    let rows = D.rows;
    if (watchOnly) rows = rows.filter((r) => r.watchlist);
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q));
    }
    rows = [...rows].sort((a, b) => {
      const k = sortKey;
      const av = a[k], bv = b[k];
      if (av === bv) return a.rank - b.rank;
      return (av < bv ? -1 : 1) * sortDir;
    });
    return rows;
  }

  function boardHTML(rows) {
    const head = '<tr><th data-k="rank">Rank</th><th data-k="name">Protocol</th><th data-k="category">Category</th>' +
      '<th>Chains</th><th class="num" data-k="tvl_usd">TVL</th><th class="num" data-k="change_7d">7d</th>' +
      '<th class="num" data-k="implied_value_usd">Implied value</th><th class="num" data-k="readiness">Readiness</th></tr>';
    const body = rows.map((r) =>
      '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
      '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? ' <span class="watch">★ watchlist</span>' : '') + '</td>' +
      '<td><span class="pill">' + esc(r.category || '—') + '</span></td>' +
      '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</td>' +
      '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
      '<td class="num">' + r.readiness.toFixed(2) + '×</td></tr>').join('');
    return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function detailHTML(r) {
    const b = D.benchmark.find((x) => x.slug === r.slug);
    const steps = (D.farm && D.farm[r.slug]) || [];
    return '<div class="detail"><a class="back" href="#/">&larr; Back to the board</a>' +
      '<h2>' + esc(r.name) + ' <span class="muted">· rank ' + r.rank + '</span></h2>' +
      '<p class="sub">' + esc(r.category || '—') + ' · ' + esc((r.chains || []).join(', ') || '—') +
      ' · TVL ' + money(r.tvl_usd) + ' · listed ' + (r.listed_at || 'unknown') +
      (r.watchlist ? ' · <span class="watch">★ on the watchlist</span>' : '') + '</p>' +
      '<div class="math">Implied value <code>' + money(r.implied_value_usd) + '</code> = core value ' +
      '<code>' + money(r.core_value_usd) + '</code> × readiness <code>' + r.readiness.toFixed(3) + '</code><br>' +
      'Core value = exp(intercept + slope × log TVL), slope <code>' + D.slope + '</code>, ' +
      'category intercept fitted on the 128 live-token protocols and shrunk toward the global intercept ' +
      '<code>' + D.global_intercept + '</code> with prior weight 8.</div>' +
      '<h3>Farm plan</h3><ol>' + steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
      (b ? '<p class="muted">Same model, live market: predicted ' + money(b.predicted_mcap_usd) +
        ' vs actual ' + money(b.actual_mcap_usd) + ' (this protocol already trades, so it is a backtest point, not a board row).</p>' : '') +
      '</div>';
  }

  function liveHTML() {
    const rows = D.live.map((p) =>
      '<tr><td><strong>' + esc(p.name) + '</strong></td><td><span class="pill">' + esc(p.category || '—') + '</span></td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd === null ? '—' : money(p.mcap_usd)) + '</td>' +
      '<td class="num">' + (p.change_7d === null ? '—' : p.change_7d.toFixed(1) + '%') + '</td></tr>').join('');
    const bench = [...D.benchmark].sort((a, b) => b.ape_pct - a.ape_pct).slice(0, 10).map((b) =>
      '<tr><td><strong>' + esc(b.name) + '</strong></td><td class="num">' + money(b.tvl_usd) + '</td>' +
      '<td class="num">' + money(b.actual_mcap_usd) + '</td><td class="num">' + money(b.predicted_mcap_usd) +
      '</td><td class="num">' + b.ape_pct.toFixed(1) + '%</td></tr>').join('');
    return '<h2>Live benchmark</h2><p>The biggest live-token protocols by market cap — the market\u2019s own values, ' +
      'never a model\u2019s. Below them, the backtest\u2019s ten worst misses, so the model\u2019s failures are visible too.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th>' +
      '<th class="num">7d</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>Leave-one-out backtest — worst misses (of ' + D.benchmark.length + ')</h3>' +
      '<table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Actual mcap</th>' +
      '<th class="num">Predicted</th><th class="num">Error</th></tr></thead><tbody>' + bench + '</tbody></table>' +
      '<p class="muted">Backtest: median error ' + bt.mdape_pct + '%, mean error ' + bt.mean_ape_pct +
      '%, mean log error ' + bt.mean_log_err + ', ' + bt.within_2x_pct + '% within 2×.</p>';
  }

  function render() {
    const h = location.hash || '#/';
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === h.split('?')[0]));
    const shot = h.indexOf('#/shot-') === 0;
    document.body.classList.toggle('shot', shot);
    $('#controls').style.display = (h === '#/' || h.indexOf('#/filter') === 0 || h.indexOf('#/watchlist') === 0 || h.indexOf('#/shot-') === 0) ? '' : 'none';
    $('#hero').style.display = (h === '#/' || h.indexOf('#/filter') === 0 || h.indexOf('#/watchlist') === 0) ? '' : 'none';
    const view = $('#view');
    if (h.indexOf('#/shot-detail/') === 0 || h.indexOf('#/protocol/') === 0) {
      const slug = decodeURIComponent(h.split('/')[2]);
      const r = D.rows.find((x) => x.slug === slug);
      view.innerHTML = r ? detailHTML(r) : '<p>Unknown protocol: ' + esc(slug) + '</p>';
      return;
    }
    if (h === '#/live') { view.innerHTML = liveHTML(); return; }
    if (h === '#/method') { view.innerHTML = ''; document.getElementById('method').scrollIntoView(); return; }
    if (h.indexOf('#/shot-filter') === 0 || h.indexOf('#/filter') === 0) {
      const m = h.match(/category=([^&]*)/);
      cat = m ? decodeURIComponent(m[1]) : '';
      sel.value = cat;
    } else if (h === '#/watchlist') {
      watchOnly = true; $('#watchonly').checked = true;
    } else {
      if (h === '#/') { watchOnly = false; $('#watchonly').checked = false; }
    }
    if (h.indexOf('#/shot-board') === 0) { cat = ''; query = ''; watchOnly = false; }
    const rows = filtered();
    $('#count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
    view.innerHTML = boardHTML(rows);
  }

  $('#search').addEventListener('input', (e) => { query = e.target.value; render(); });
  sel.addEventListener('change', (e) => { cat = e.target.value; render(); });
  $('#watchonly').addEventListener('change', (e) => { watchOnly = e.target.checked; render(); });
  $('#view').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-k]');
    if (th) {
      const k = th.getAttribute('data-k');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render(); return;
    }
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + tr.getAttribute('data-slug');
  });
  window.addEventListener('hashchange', render);
  render();
})();
