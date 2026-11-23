// Token Radar dashboard (no network, no framework). Reads window.RADAR from data.js.
// Farm plans below mirror lib/model.ts step for step: same category action, same
// capital tiers ($250 / $150 / $100 / $50 by TVL), same hold days (60 / 45 / 30 by age).
(function () {
  var D = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), detailEl = $('detail'), countEl = $('count'), emptyEl = $('empty');
  var state = { q: '', cat: '', chain: '', sort: 'implied', watch: false, sel: null };

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- header stats + live check ----
  var totalImplied = D.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('stats').innerHTML = [
    [String(D.rows.length), 'protocols ranked'], [String(D.watchlist_size), 'on the watchlist'],
    [String(D.early_size), 'early finds outside the watchlist'],
    [money(D.rows[0].implied_value_usd), 'top implied value · ' + D.rows[0].name],
    [money(totalImplied), 'combined implied value']
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>'; }).join('');
  $('livecheck').textContent = 'Snapshot 2026-11-14 · ' + D.live_check;

  // ---- filter options ----
  var cats = {}, chains = {};
  D.rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { $('cat').appendChild(new Option(c, c)); });
  Object.keys(chains).sort().forEach(function (c) { $('chain').appendChild(new Option(c, c)); });

  // ---- farm plan (mirrors lib/model.ts) ----
  function capitalFor(r) { return r.tvl_usd >= 5e9 ? 250 : r.tvl_usd >= 1e9 ? 150 : r.tvl_usd >= 1e8 ? 100 : 50; }
  function holdFor(r) { var a = r.age_days; return a === null ? 30 : a < 180 ? 60 : a < 365 ? 45 : 30; }
  function actionFor(r, cap, chain) {
    var c = (r.category || '').toLowerCase(), n = r.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + chain + ' and keep the vault shares in your wallet.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + chain + ', then borrow a small amount against it and repay it.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + cap + ' of liquidity to ' + n + '\'s main pool on ' + chain + ' and keep the LP position open.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + cap + ' into ' + n + '\'s basis vault on ' + chain + ' and hold the receipt token.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + cap + ' of the yield-bearing asset on ' + n + ' (' + chain + ') and hold it in your wallet.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + cap + ' into ' + n + '\'s highest-TVL strategy on ' + chain + ' and keep it open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + n + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + cap + ' of the chain\'s staking asset through ' + n + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + cap + ' on ' + n + ' and place one position in an active market.';
    if (c.indexOf('payment') >= 0) return 'Send two payments totalling $' + cap + ' through ' + n + ' on ' + chain + ' from your farm wallet.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + cap + ' to ' + n + ' and use its main app at least once a week.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(r) {
    var chain = r.chains[0] || 'its main chain', cap = capitalFor(r), hold = holdFor(r), gas = cap >= 150 ? 8 : 4;
    return [
      { t: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', c: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { t: 'Open the protocol from its DefiLlama page, check the contract address matches, and never connect through a link from a chat or a QR code.', c: 'nothing to check', time: '10 minutes' },
      { t: actionFor(r, cap, chain), c: '$' + cap + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { t: 'Do one qualifying action each week — a deposit, a borrow, a swap or a vote — and never leave the position empty.', c: 'about $2 of gas a week', time: '10 minutes a week' },
      { t: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and keep the receipt tokens.', c: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { t: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.', c: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ];
  }

  // ---- board ----
  function filtered() {
    var list = D.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) { var q = state.q.toLowerCase(); if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false; }
      return true;
    });
    var s = state.sort;
    if (s === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === 'growth') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (s === 'age') list.sort(function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }
  function render() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + D.rows.length + ' protocols · ranked by implied value · snapshot ' + D.as_of;
    emptyEl.hidden = list.length > 0;
    if (list.length === 0) emptyEl.textContent = 'No protocol matches these filters. Reset to see all ' + D.rows.length + ' rows.';
    rowsEl.innerHTML = list.map(function (r) {
      var g = r.change_7d, cls = g === null ? '' : g >= 0 ? 'up' : 'down';
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.sel === r.slug ? 'sel' : '') + '"><td>#' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="tag watch">WATCHLIST</span>' : '<span class="tag">EARLY</span>') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 2).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num ' + cls + '">' + pct(g) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td></tr>';
    }).join('');
    rowsEl.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), true); });
    });
  }
  function compNote(r) {
    var c = null;
    D.comparables.forEach(function (x) { if (x.category === r.category) c = x; });
    if (c && c.n >= 3) return c.n + ' live comparables · median mcap/TVL ' + c.median.toFixed(3) + ' → multiple ' + r.base_multiple.toFixed(3);
    return 'Fewer than 3 live comparables in ' + (r.category || 'this category') + ' — global median ' + D.global_multiple.toFixed(3) + ' used';
  }
  function select(slug, scroll) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.innerHTML = '<h2>Pick a protocol</h2><p class="sub">Click any row on the board to see its model maths and farm plan.</p>'; state.sel = null; render(); return; }
    state.sel = slug;
    var age = r.age_days === null ? 'unknown (model uses 365 days)' : r.age_days + ' days';
    var chainLabel = r.chains.length > 3 ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) + ' more' : r.chains.join(', ');
    detailEl.innerHTML = '<h2>' + esc(r.name) + '</h2><p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(chainLabel) +
      (r.on_watchlist ? ' · <span class="tag watch">WATCHLIST</span>' : ' · <span class="tag">EARLY — verify parent status before farming</span>') + '</p>' +
      '<div class="formula">Implied value = TVL × multiple × growth × maturity<br><strong>' + money(r.tvl_usd) + ' × ' + r.base_multiple.toFixed(3) + ' × ' + r.growth_multiplier.toFixed(3) + ' × ' + r.maturity_multiplier.toFixed(3) + ' = ' + money(r.implied_value_usd) + '</strong></div>' +
      '<h3>Model breakdown</h3><dl class="kv">' +
      '<dt>TVL (snapshot ' + D.as_of + ')</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>Category multiple</dt><dd>' + r.base_multiple.toFixed(3) + '</dd>' +
      '<dt>Comparables</dt><dd>' + esc(compNote(r)) + '</dd>' +
      '<dt>7-day TVL change</dt><dd>' + pct(r.change_7d) + ' → ×' + r.growth_multiplier.toFixed(3) + '</dd>' +
      '<dt>Age since listing</dt><dd>' + age + ' → ×' + r.maturity_multiplier.toFixed(3) + '</dd>' +
      '<dt>Token recorded</dt><dd>None — pre-token</dd></dl>' +
      '<h3>Farm plan — 6 steps</h3><ol class="steps">' +
      farmSteps(r).map(function (s, i) { return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s.t) + '<br><span class="cost">Cost: ' + esc(s.c) + ' · Time: ' + esc(s.time) + '</span></li>'; }).join('') + '</ol>' +
      '<p class="note">Implied value is this radar\u2019s claim from the snapshot, not a prediction that a token launches. ' + (r.on_watchlist ? '' : (r.tvl_usd >= D.floor_usd ? 'This protocol is above the $50M floor but not on the house watchlist — the snapshot carries no parent-protocol field, so check it is not a wrapped or staked product of a token that already trades before farming.' : 'This protocol is below the $50M watchlist floor and the snapshot carries no parent-protocol field — check it is not a wrapped or staked product of a token that already trades before farming.')) + '</p>';
    render();
    if (scroll) detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- live comparables + methodology tables ----
  $('liverows').innerHTML = D.live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td><td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + (p.mcap_usd ? money(p.mcap_usd) : '—') + '</td>' +
      '<td class="num">' + (p.mcap_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—') + '</td></tr>';
  }).join('');
  $('comprows').innerHTML = D.comparables.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.median.toFixed(3) + '×</td><td class="num">' + c.multiple.toFixed(3) + '×</td></tr>';
  }).join('');

  // ---- controls + deep links ----
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  $('watchonly').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  $('reset').addEventListener('click', function () {
    state = { q: '', cat: '', chain: '', sort: 'implied', watch: false, sel: state.sel };
    $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('sort').value = 'implied'; $('watchonly').checked = false;
    render();
  });
  var params = new URLSearchParams(location.search);
  if (params.get('cat')) { state.cat = params.get('cat'); $('cat').value = state.cat; }
  if (params.get('chain')) { state.chain = params.get('chain'); $('chain').value = state.chain; }
  if (params.get('watch') === '1') { state.watch = true; $('watchonly').checked = true; }
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  render();
  var hash = (location.hash || '').replace(/^#detail-/, '').replace(/^#/, '');
  select(hash && D.rows.some(function (r) { return r.slug === hash; }) ? hash : D.rows[0].slug, false);
})();
