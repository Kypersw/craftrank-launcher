/* CraftRank Launcher: renderer */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n || 0).toLocaleString('en-US');
const short = (n) => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); };
const KIND = { vanilla: ['Release', ''], optifine: ['OptiFine', 'of'], 'forge-optifine': ['ForgeOptiFine', 'fo'], forge: ['Forge', 'fg'], fabric: ['Fabric', 'fb'], quilt: ['Quilt', 'qt'], neoforge: ['NeoForge', 'nf'] };
const state = { cfg: {}, feed: { servers: [], resources: [] }, versions: [], latest: null, settings: {}, me: null, store: { items: [] }, storeTab: 'all', running: false, ms: { list: [], sel: null, type: 'paper' } };

/* ---------- basics ---------- */
$$('[data-win]').forEach((b) => b.addEventListener('click', () => cr.win(b.dataset.win)));
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-page]:not(body)'); if (p) { e.preventDefault(); go(p.dataset.page); return; }
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); cr.open(o.dataset.open); }
});
function go(page) {
  document.body.dataset.page = page;
  $$('.nav a[data-page]').forEach((a) => a.classList.toggle('on', a.dataset.page === page));
  $('.top-ic .acct').classList.toggle('on', page === 'account');
  $('#verPop').hidden = true;
  $$('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + page));
  $$('.paper').forEach((p) => { p.scrollTop = 0; });
  if (page === 'myservers') loadServers();
  if (page === 'packs') loadPacks(false);
  if (page === 'mods') loadMods(false);
  if (page === 'account') renderAccount();
}
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let msgT;
function showMsg(t, ok) { const m = $('#msg'); m.textContent = t || ''; m.className = 'note' + (ok ? ' ok' : ''); m.hidden = !t; clearTimeout(msgT); if (t) msgT = setTimeout(() => { m.hidden = true; }, ok ? 4000 : 12000); }

/* ---------- skin drawing (front view) ---------- */
function loadImg(src) { return new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
async function drawSkin(canvas, src, slim) {
  const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
  const s = canvas.width / 16, img = await loadImg(src);
  if (!img) { c.fillStyle = '#1a1c20'; [[4, 0, 8, 8], [4, 8, 8, 12], [0, 8, 4, 12], [12, 8, 4, 12], [4, 20, 4, 12], [8, 20, 4, 12]].forEach(([x, y, w, h]) => c.fillRect(x * s, y * s, w * s, h * s)); return; }
  const tall = img.height === 64, aw = slim ? 3 : 4;
  const part = (sx, sy, w, h, dx, dy, flip) => { c.save(); if (flip) { c.translate((dx + w) * s, dy * s); c.scale(-1, 1); c.drawImage(img, sx, sy, w, h, 0, 0, w * s, h * s); } else c.drawImage(img, sx, sy, w, h, dx * s, dy * s, w * s, h * s); c.restore(); };
  part(8, 8, 8, 8, 4, 0); part(20, 20, 8, 12, 4, 8);
  part(44, 20, aw, 12, 4 - aw, 8);
  tall ? part(36, 52, aw, 12, 12, 8) : part(44, 20, aw, 12, 12, 8, true);
  part(4, 20, 4, 12, 4, 20);
  tall ? part(20, 52, 4, 12, 8, 20) : part(4, 20, 4, 12, 8, 20, true);
  part(40, 8, 8, 8, 4, 0);
  if (tall) { part(20, 36, 8, 12, 4, 8); part(44, 36, aw, 12, 4 - aw, 8); part(52, 52, aw, 12, 12, 8); part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20); }
}
async function drawHead(img, src, fallbackName) {
  const i = await loadImg(src);
  if (!i) { img.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(fallbackName || 'Steve') + '/64'; return; }
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(i, 8, 8, 8, 8, 0, 0, 64, 64); x.drawImage(i, 40, 8, 8, 8, 0, 0, 64, 64);
  img.src = c.toDataURL();
}
async function drawCape(canvas, src) {
  const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
  const an = canvas.dataset.anim, img = await loadImg(an || src); if (!img) return;
  const k = img.width / 64;
  c.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
  if (an) animCape(canvas, img, +canvas.dataset.fps || 12, Math.max(1, Math.floor(img.height / (32 * k))), k);
}
// animated capes: one loop for all, only canvases on screen, at the cape's own frame rate
const animCv = new Map();
let animRaf = 0;
const animIo = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { const a = animCv.get(e.target); if (a) a.vis = e.isIntersecting; })) : null;
function animCape(cv, img, fps, n, k) {
  animCv.set(cv, { img, fps, n, k, last: 0, vis: !animIo });
  if (animIo) animIo.observe(cv);
  if (!animRaf) animRaf = requestAnimationFrame(animLoop);
}
function animLoop(ts) {
  animRaf = 0;
  for (const [cv, a] of animCv) {
    if (!cv.isConnected) { animCv.delete(cv); if (animIo) animIo.unobserve(cv); continue; }
    if (!a.vis) continue;
    const f = Math.floor(ts / 1000 * a.fps) % a.n; if (f === a.last) continue;
    a.last = f;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(a.img, a.k, f * 32 * a.k + a.k, 10 * a.k, 16 * a.k, 0, 0, cv.width, cv.height);
  }
  if (animCv.size) animRaf = requestAnimationFrame(animLoop);
}

/* ---------- servers ---------- */
function serverRow(s) {
  const players = s.online ? `<span class="srv-n"><b>${nf(s.players)}</b> online</span>` : '<span class="srv-n off">Offline</span>';
  const tags = (s.tags || []).slice(0, 3).join(', ');
  return `<article class="srv${s.rank <= 3 ? ' r' + s.rank : ''}">
    <span class="srv-rk">${s.rank}</span>${s.icon ? `<img class="srv-ic" src="${esc(s.icon)}" alt="">` : '<span class="srv-ic"></span>'}
    <div class="srv-mid"><b>${esc(s.name)}</b><small><code>${esc(s.address)}</code>${s.version ? ' <span>' + esc(s.version) + '</span>' : ''}${tags ? ' <span>' + esc(tags) + '</span>' : ''}</small></div>
    ${players}<span class="srv-n"><b>${nf(s.votes)}</b> ${s.votes == 1 ? 'vote' : 'votes'}</span>
    <div class="srv-act"><button class="btn vote" data-open="${esc(s.vote_url)}">Vote</button><button class="btn join" data-join="${s.id}">Join</button></div>
  </article>`;
}
function renderServers() {
  $('#onlineN').textContent = nf(state.feed.servers.reduce((n, s) => n + (s.online ? +s.players || 0 : 0), 0));
  $('#homeServers').innerHTML = state.feed.servers.slice(0, 3).map(serverRow).join('') || '<div class="empty">No servers to show right now.</div>';
  const q = $('#srvQ').value.trim().toLowerCase();
  const list = state.feed.servers.filter((s) => !q || (s.name + ' ' + s.address + ' ' + (s.tags || []).join(' ') + ' ' + s.motd).toLowerCase().includes(q));
  $('#allServers').innerHTML = list.map(serverRow).join('') || `<div class="empty">${q ? 'No server matches “' + esc(q) + '”.' : 'No servers to show right now.'}</div>`;
}
$('#srvQ').addEventListener('input', renderServers);
document.addEventListener('click', (e) => { const b = e.target.closest('[data-join]'); if (!b) return; const s = state.feed.servers.find((x) => x.id == b.dataset.join); if (s) play(s); });

/* ---------- resources ---------- */
function resCard(r) {
  const ini = r.title.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<a class="res" data-open="${esc(r.url)}"><span class="res-ic">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : esc(ini)}</span>
      <div><b>${esc(r.title)}</b><p>${esc(r.tagline)}</p><small class="res-meta">${esc(r.category)}<span>${nf(r.downloads)} downloads</span>${r.price > 0 ? '<span>$' + r.price.toFixed(2) + '</span>' : ''}</small></div></a>`;
}
function renderResources() {
  $('#homeResources').innerHTML = state.feed.resources.slice(0, 6).map(resCard).join('');
  const q = $('#resQ').value.trim().toLowerCase();
  const list = state.feed.resources.filter((r) => !q || (r.title + ' ' + r.tagline + ' ' + r.category).toLowerCase().includes(q));
  $('#allResources').innerHTML = list.map(resCard).join('') || `<div class="empty" style="grid-column:1/-1">${q ? 'No resource matches “' + esc(q) + '”.' : 'No resources to show right now.'}</div>`;
}
$('#resQ').addEventListener('input', renderResources);

/* ---------- versions ---------- */
// One list like other launchers: "Release 1.21.1", "OptiFine 1.21.1", "ForgeOptiFine 1.20.1", "Fabric 1.21.1"…
let verFilter = 'all';
state.catalog = {};
/* ---------- status line ---------- */
function idleStatus() {
  if (state.running) return;
  $('#prog').classList.add('idle'); $('#progI').style.width = '';
  $('#stLeft').textContent = 'Ready to play';
  $('#stRight').textContent = $('#verLabel').textContent.toUpperCase();
}

/* ---------- last update: the newest launcher release on GitHub ---------- */
async function loadNews() {
  const r = await cr.news();
  if (!r || !r.ok) return;
  $('#newsTitle').textContent = r.title;
  $('#newsDate').textContent = r.date ? new Date(r.date).toLocaleDateString('en-GB').replace(/\//g, '.') : '';
  if (r.body) $('#newsBody').textContent = r.body;
  $('#newsMore').onclick = () => cr.open(r.url);
}
$('#newsMore').onclick = () => cr.open('https://github.com/Kypersw/craftrank-launcher/releases');

function verLabel() {
  const s = state.settings, mc = s.mc || (state.latest && state.latest.release) || '';
  $('#verLabel').textContent = mc ? KIND[s.loader || 'vanilla'][0] + ' ' + mc : 'Loading versions…';
  idleStatus();
}
function entries() {
  const types = ['release'].concat(state.settings.showSnapshots ? ['snapshot'] : [], state.settings.showOld ? ['old_beta', 'old_alpha'] : []);
  const out = [];
  for (const v of state.versions) {
    if (!types.includes(v.type)) continue;
    out.push({ l: 'vanilla', mc: v.id, kind: v.type === 'release' ? 'Release' : v.type === 'snapshot' ? 'Snapshot' : v.type === 'old_beta' ? 'Old beta' : 'Old alpha' });
    if (v.type !== 'release') continue;
    for (const l of ['optifine', 'forge-optifine', 'forge', 'fabric', 'quilt', 'neoforge']) if ((state.catalog[l] || []).includes(v.id)) out.push({ l, mc: v.id, kind: KIND[l][0] });
  }
  return out;
}
function renderVerList() {
  const q = $('#verQ').value.trim().toLowerCase();
  const cur = state.settings.mc || (state.latest && state.latest.release), curL = state.settings.loader || 'vanilla';
  const list = entries().filter((e) => (verFilter === 'all' || e.l === verFilter) && (!q || (e.kind + ' ' + e.mc).toLowerCase().includes(q)));
  $('#verList').innerHTML = list.slice(0, 700).map((e) => `<button data-v="${esc(e.mc)}" data-l="${e.l}" class="${e.mc === cur && e.l === curL ? 'on' : ''}"><span class="k ${KIND[e.l][1]}">${esc(e.kind)}</span><b>${esc(e.mc)}</b>${e.l === 'vanilla' && e.mc === (state.latest && state.latest.release) ? '<small>latest</small>' : ''}</button>`).join('')
    || `<p class="more">${state.versions.length ? 'No versions found.' : 'Loading versions…'}</p>`;
  const on = $('#verList .on'); if (on && !q) on.scrollIntoView({ block: 'center' });
}
$('#verList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  state.settings = await cr.save({ mc: b.dataset.v, loader: b.dataset.l, loaderVersion: '' });
  $('#verPop').hidden = true; verLabel();
  // the mods and texture pack lists belong to a version: show the new version's
  const pg = document.body.dataset.page;
  if (pg === 'mods') loadMods(false); else if (pg === 'packs') loadPacks(false);
});
$('#verFil').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; verFilter = b.dataset.f; $$('#verFil button').forEach((x) => x.classList.toggle('on', x === b)); renderVerList(); });
$('#verQ').addEventListener('input', renderVerList);
$('#verBtn').addEventListener('click', () => {
  const p = $('#verPop'); p.hidden = !p.hidden; if (p.hidden) return;
  const r = $('#verBtn').getBoundingClientRect(); p.style.left = Math.min(r.left, innerWidth - 390) + 'px'; p.style.bottom = (innerHeight - r.top + 12) + 'px';
  renderVerList(); $('#verQ').focus();
});
document.addEventListener('mousedown', (e) => { const p = $('#verPop'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#verBtn')) p.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#verPop').hidden = true; });

/* ---------- play ---------- */
async function play(server) {
  if (state.running) return;
  // typing your own CraftRank name also means: play with my CraftRank skin
  const typed = $('#barName').value.trim().toLowerCase();
  const prof = state.me && state.me.profile;
  const asCr = state.me && ($('#useCr').checked || (prof && typed !== '' && typed === String(prof.name).toLowerCase()));
  if (asCr && !state.me.profile) { showMsg('Pick your CraftRank in-game name first.'); go('account'); return; }
  const username = $('#barName').value.trim();
  if (!asCr && !/^[A-Za-z0-9_]{3,16}$/.test(username)) { showMsg('Type a username first: 3 to 16 letters, numbers or _.'); $('#barName').focus(); return; }
  showMsg(''); $('#play').disabled = true; $('#verPop').hidden = true;
  const force = $('#force').checked;
  const r = await cr.play({ playAs: asCr ? 'craftrank' : 'offline', username, force, server: server ? { host: server.host, port: server.port, name: server.name, url: server.url, icon: server.icon } : null });
  if (!r.ok) { $('#play').disabled = false; showMsg(r.error); }
  else { $('#force').checked = false; showMsg(server ? 'Joining ' + server.name + '…' : 'Starting Minecraft…', true); }
}
$('#play').addEventListener('click', () => play(null));
cr.on('progress', (p) => {
  if (!p) { idleStatus(); return; }
  const parts = String(p.stage).split(' · ');
  $('#prog').classList.remove('idle');
  $('#stLeft').textContent = parts[0] + '…';
  $('#stRight').textContent = (parts.slice(1).join(' · ') ? parts.slice(1).join(' · ').toUpperCase() + '  ' : '') + (p.pct || 0) + '%';
  $('#progI').style.width = (p.pct || 0) + '%';
});
cr.on('game', (g) => {
  state.running = g.running; $('#play').disabled = g.running;
  $('#play span').textContent = g.running ? 'Playing' : 'Start to play';
  if (g.running) { $('#stLeft').textContent = 'Minecraft is running'; $('#stRight').textContent = ''; $('#prog').classList.add('idle'); $('#progI').style.width = ''; } else idleStatus();
  if (g.running && g.note) toast(g.note);
  if (!g.running && g.code) {
    const lines = (g.log || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const why = lines.reverse().find((l) => /OutOfMemory|Exception|Error|crash/i.test(l)) || lines[0] || '';
    showMsg('Minecraft closed with an error (code ' + g.code + ').' + (/OutOfMemory/i.test(g.log || '') ? ' It ran out of memory: give it more in Settings.' : '') + (why ? ' ' + why.slice(0, 220) : '') + ' The full log is in the game folder, logs/launcher-output.log.');
  } else if (!g.running) showMsg('');
});

/* ---------- account ---------- */
async function loadMe(cached) {
  const r = cached || await cr.me();
  state.me = r.ok ? r : null;
  const pr = state.me && state.me.profile;
  $('#useCr').closest('.bchk').hidden = !pr;
  $('#useCr').checked = !!(pr && (state.settings.playAs === 'craftrank' || !state.settings.playAsChosen));
  const asCr = $('#useCr').checked;
  $('#acctTile').textContent = state.me ? (pr ? pr.name : state.me.user.name) : 'Sign in';
  $('#barName').hidden = asCr; $('#barSigned').hidden = !asCr;
  const name = asCr ? pr.name : ($('#barName').value.trim() || 'Steve');
  $('#barSigned').textContent = name;
  drawHead($('#head'), asCr ? pr.skin : null, name);
  $('#acctCrown').hidden = !isPremium();
  applyTheme(state.settings.theme);
  renderAds();
}
$('#useCr').addEventListener('change', async (e) => { state.settings = await cr.save({ playAs: e.target.checked ? 'craftrank' : 'offline', playAsChosen: true }); loadMe(); });

/* ---------- ads ---------- */
function renderAds() {
  const ads = state.feed.ads || [];
  $$('[data-slot]').forEach((el) => {
    const a = ads.find((x) => +x.slot === +el.dataset.slot);
    if (!a) { el.hidden = true; return; }
    el.hidden = false; el.dataset.open = a.url;
    el.innerHTML = `<img src="${esc(a.image)}" alt="${esc(a.title)}">${a.title || a.text ? `<span class="ad-tx">${a.title ? `<b>${esc(a.title)}</b>` : ''}${a.text ? `<small>${esc(a.text)}</small>` : ''}</span>` : ''}<i class="ad-lbl">Ad</i>`;
  });
}

async function renderAccount() {
  if (!state.me) { $('#signin').hidden = false; $('#profile').hidden = true; return; }
  $('#signin').hidden = true; $('#profile').hidden = false;
  const pr = state.me.profile;
  $('#prUser').textContent = state.me.user.name;
  $('#prName').value = pr ? pr.name : '';
  $('#skinSlim').checked = !!(pr && pr.slim);
  $$('#armSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.slim === '1') === !!(pr && pr.slim)));
  renderPremium();
  renderSkinHist();
  renderSlots(); updateView();
  await loadCapes();
  await loadCosmetics();
  loadWardrobe();
  syncTabs();
}

/* ---------- CraftRank Premium (bought here or on the site, same account) ---------- */
const isPremium = () => !!(state.me && state.me.premium && state.me.premium.active);
let premWatch = null;
function renderPremium() {
  const p = state.me && state.me.premium;
  $('#prPrem').hidden = !p;
  if (!p) return;
  $('#prPrem').classList.toggle('on', !!p.active);
  if (p.active) {
    $('#ppTitle').textContent = 'You are Premium';
    $('#ppText').textContent = 'Until ' + p.until + '. HD premium capes, the wardrobe, a gold name on CraftRank and launcher themes are yours. Buying again adds the time on top.';
  } else {
    $('#ppTitle').textContent = 'CraftRank Premium';
    $('#ppText').textContent = 'HD premium capes, a wardrobe for your looks, a gold name with a crown on CraftRank and launcher themes. One payment, no automatic renewal.';
  }
  $('#ppBuy').innerHTML = (p.plans || []).map((pl) => `<button class="btn ${pl.id === 'year' ? 'gold' : 'plain'}" data-plan="${esc(pl.id)}"><b>${esc(pl.price_label)}</b> ${esc(pl.label)}</button>`).join('');
}
$('#ppBuy').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-plan]'); if (!b) return;
  b.disabled = true;
  const r = await cr.premiumBuy(b.dataset.plan);
  b.disabled = false;
  if (!r.ok) return toast(r.error || 'Could not open the payment page.');
  toast('The payment page is open in your browser. Premium turns on here by itself after you pay.');
  // check every 10 seconds for 10 minutes
  clearInterval(premWatch); let n = 0;
  premWatch = setInterval(async () => {
    if (++n > 60) return clearInterval(premWatch);
    const m = await cr.me();
    if (m.ok && m.premium && m.premium.active && !isPremium()) { clearInterval(premWatch); await loadMe(); renderAccount(); toast('Premium is on. Enjoy!'); }
  }, 10000);
});
function goPremium() { const el = $('#prPrem'); if (el && !el.hidden) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

/* ---------- wardrobe page: tabs, the 3D character, what is worn ---------- */
function wrTab(t) {
  $$('#wrTabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $$('.wr-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
}
function syncTabs() {   // a pane with nothing in it (no capes on the site, an older site without Premium) has no tab
  let cur = ($('#wrTabs .on') || {}).dataset;
  $$('#wrTabs [data-tab]').forEach((b) => { const p = $(`.wr-pane[data-pane="${b.dataset.tab}"]`); b.hidden = !!(p && p.hidden); });
  if (!cur || $(`#wrTabs [data-tab="${cur.tab}"]`).hidden) wrTab('skin');
  $('#wrSave').hidden = $('#prWard').hidden;
}
$('#wrTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) wrTab(b.dataset.tab); });
$('#wrSave').addEventListener('click', () => { wrTab('outfits'); const i = $('#wardName'); if (i && !$('#wardNew').hidden) i.focus(); });

// textures come through the launcher (the 3D view needs them as its own data, not a page from another site)
const texCache = new Map();
function texImg(url) {
  if (!url) return Promise.resolve(null);
  if (!texCache.has(url)) texCache.set(url, (cr.tex ? cr.tex(url) : Promise.resolve(null)).then((d) => imgOf(d)).catch(() => null));
  return texCache.get(url);
}
let view = null, viewSeq = 0;
async function updateView() {
  const cv = $('#wrView'); if (!cv || !window.PlayerView) return;
  if (!view) view = new PlayerView(cv);
  const seq = ++viewSeq, pr = state.me && state.me.profile;
  const worn = ((pr && pr.overlays) || []).map((id) => cosUi.items.find((it) => it.id === id)).filter(Boolean);
  const cape = pr && pr.cape_item ? capeUi.items.find((it) => it.id === pr.cape_item) : null;
  const [skin, ovs, cimg, aimg] = await Promise.all([texImg(pr && pr.skin), Promise.all(worn.map((it) => texImg(it.texture))), texImg(cape && cape.texture), texImg(cape && cape.anim && cape.anim.url)]);
  if (seq !== viewSeq) return;
  view.setSkin(skin, ovs, !!(pr && pr.slim));
  view.setCape(cimg, aimg ? { img: aimg, fps: +cape.anim.fps || 12 } : null);
}
$('.wr-face').addEventListener('click', (e) => {
  const b = e.target.closest('[data-face]'); if (!b || !view) return;
  $$('.wr-face button').forEach((x) => x.classList.toggle('on', x === b)); view.face(b.dataset.face === 'back');
});

function renderSlots() {
  const pr = state.me && state.me.profile, el = $('#wrSlots'); if (!el) return;
  const worn = ((pr && pr.overlays) || []).map((id) => cosUi.items.find((it) => it.id === id)).filter(Boolean);
  const cape = pr && pr.cape_item ? capeUi.items.find((it) => it.id === pr.cape_item) : null;
  const slot = (key, label, tab, inner, x, title) => `<button class="slot${inner ? '' : ' empty'}" data-go="${tab}" data-key="${key}" title="${esc(title || label)}"><span class="sq">${inner || '+'}</span>${x ? `<span class="x" data-off="${esc(x)}" title="Take off" aria-label="Take off ${esc(title || label)}">×</span>` : ''}${esc(label)}</button>`;
  const parts = [slot('skin', 'Skin', 'skin', '<img alt="">', '', 'Your skin'),
    slot('cape', 'Cape', 'capes', cape ? `<canvas class="tall" width="40" height="64" data-tex="${esc(cape.texture)}"></canvas>` : '', cape ? 'cape' : '', cape && cape.name)];
  for (const k of Object.keys(SLOT)) { const it = worn.find((w) => w.slot === k); parts.push(slot(k, SLOT[k], 'cos', it ? `<canvas${k === 'body' ? ' class="tall"' : ''} width="${k === 'body' ? 32 : 48}" height="48" data-ov="${esc(it.texture)}" data-k="${k}"></canvas>` : '', it ? 'ov:' + it.id : '', it && it.name)); }
  el.innerHTML = parts.join('');
  drawHead(el.querySelector('[data-key="skin"] img'), pr && pr.skin, pr && pr.name);
  el.querySelectorAll('canvas[data-tex]').forEach((c) => drawCape(c, c.dataset.tex));
  el.querySelectorAll('canvas[data-ov]').forEach(async (c) => {
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const [b, o] = await Promise.all([imgOf(pr && pr.skin), imgOf(c.dataset.ov)]);
    const [sx, sy, w, h, ox, oy] = c.dataset.k === 'body' ? [20, 20, 8, 12, 20, 36] : [8, 8, 8, 8, 40, 8];
    if (b) x.drawImage(b, sx, sy, w, h, 0, 0, c.width, c.height);
    if (o) x.drawImage(o, ox, oy, w, h, 0, 0, c.width, c.height);
  });
}
$('#wrSlots').addEventListener('click', async (e) => {
  const off = e.target.closest('[data-off]');
  if (off) {
    e.stopPropagation(); off.closest('.slot').disabled = true;
    const v = off.dataset.off, r = v === 'cape' ? await cr.equip('cape', 0) : await cr.equip('overlay', +v.slice(3), false);
    if (!r.ok) { renderSlots(); return toast(r.error || 'Could not take it off.'); }
    if (state.me) state.me.profile = r.profile;
    toast('Taken off.'); renderCapes(); renderCosmetics(); return;
  }
  const b = e.target.closest('[data-go]'); if (!b) return;
  if (b.dataset.go === 'cos' && SLOT[b.dataset.key]) { cosUi.slot = b.dataset.key; renderCosmetics(); }
  wrTab(b.dataset.go);
});

/* ---------- skin: drop a file, copy from a Minecraft name, arm style, your last skins ---------- */
async function skinDone(r, msg) {
  if (!r || r.canceled) return false;
  if (!r.ok) { toast(r.error || 'Could not save the skin.'); return false; }
  toast(msg || 'Skin saved. It shows next time you start the game.');
  await loadMe(); renderAccount(); return true;
}
async function skinBusy(fn) { const d = $('#skinDrop'); d.classList.add('busy'); try { return await fn(); } finally { d.classList.remove('busy'); } }
const drop = $('#skinDrop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return; drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
  if (!/\.png$/i.test(f.name) && f.type !== 'image/png') return toast('That is not a PNG file. Skins are PNG pictures.');
  if (f.size > 512 * 1024) return toast('That file is too big for a skin.');
  const buf = new Uint8Array(await f.arrayBuffer());
  await skinBusy(async () => skinDone(await cr.skinData(buf, $('#skinSlim').checked)));
});
// stop files dropped elsewhere from opening in the window
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (!drop.contains(e.target)) e.preventDefault(); }));
$('#skinNameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = $('#skinNameQ').value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) return toast('Type a Minecraft name: 3 to 16 letters, numbers or _.');
  $('#skinNameBtn').disabled = true;
  const r = await skinBusy(() => cr.skinFromName(n));
  $('#skinNameBtn').disabled = false;
  if (await skinDone(r, `You now wear the skin of ${n}.`)) $('#skinNameQ').value = '';
});
$('#armSeg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-slim]'); if (!b || b.classList.contains('on')) return;
  const slim = b.dataset.slim === '1';
  $$('#armSeg button').forEach((x) => x.classList.toggle('on', x === b)); $('#skinSlim').checked = slim;
  const r = await skinBusy(() => cr.skinArms(slim));
  if (r && r.ok) return skinDone(r, slim ? 'Slim arms on.' : 'Classic arms on.');
  if (r && r.none) return toast('Saved for your next skin. Upload one, or pick one of your skins, to change the arms now.');
  toast((r && r.error) || 'Could not change the arms.');
});
async function renderSkinHist() {
  const el = $('#skinHist'); if (!el || !cr.skins) return;
  const r = await cr.skins('list');
  const list = r && r.ok ? r.list : [];
  el.innerHTML = list.length ? list.map((s) => `<button data-skin="${esc(s.id)}" class="${s.current ? 'on' : ''}" title="${s.current ? 'In use' : 'Wear this skin'}"><img alt="" data-src="${esc(s.data)}"><span class="x" data-skin-del="${esc(s.id)}" title="Remove from this list" aria-label="Remove">×</span></button>`).join('')
    : '<p class="hist-none">Skins you upload or copy show up here.</p>';
  el.querySelectorAll('img[data-src]').forEach((i) => drawHead(i, i.dataset.src));
}
$('#skinHist').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-skin-del]');
  if (d) { e.stopPropagation(); await cr.skins('remove', d.dataset.skinDel); return renderSkinHist(); }
  const b = e.target.closest('[data-skin]'); if (!b || b.classList.contains('on')) return;
  await skinBusy(async () => skinDone(await cr.skins('use', b.dataset.skin)));
});

/* wardrobe (Premium) */
async function loadWardrobe() {
  const box = $('#prWard');
  box.hidden = !(state.me && state.me.premium);   // older sites have no Premium
  if (box.hidden) return;
  box.classList.toggle('locked', !isPremium());
  if (!isPremium()) { $('#wardList').innerHTML = '<p class="hint">The wardrobe is part of Premium. <a href="#" data-go-premium>Get Premium</a></p>'; $('#wardNew').hidden = true; return; }
  $('#wardNew').hidden = false;
  const r = await cr.wardrobe('list');
  renderWardrobe(r.ok ? r.outfits : []);
}
function renderWardrobe(list) {
  const capes = new Map(capeUi.items.map((c) => [c.id, c]));
  $('#nOut').textContent = list.length || '';
  $('#wardList').innerHTML = list.length ? list.map((o) => `<div class="outfit"><canvas class="o-skin" width="48" height="96" data-skin="${esc(o.skin || '')}" data-slim="${o.slim ? 1 : 0}"></canvas>${o.cape_item && capes.get(o.cape_item) ? `<canvas class="o-cape" width="30" height="48" data-tex="${esc(capes.get(o.cape_item).texture)}"></canvas>` : ''}
    <b>${esc(o.name)}</b><div class="o-btns"><button class="btn plain sm" data-wear="${o.id}">Wear</button><button class="btn plain sm" data-del="${o.id}" title="Delete">×</button></div></div>`).join('')
    : '<p class="hint">No outfits yet. Put on a skin and a cape, then save the look.</p>';
  $('#wardList').querySelectorAll('canvas.o-skin').forEach((c) => drawSkin(c, c.dataset.skin || null, c.dataset.slim === '1'));
  $('#wardList').querySelectorAll('canvas.o-cape').forEach((c) => drawCape(c, c.dataset.tex));
}
$('#wardNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await cr.wardrobe('save', $('#wardName').value.trim());
  if (!r.ok) return toast(r.error);
  $('#wardName').value = ''; renderWardrobe(r.outfits); toast('Outfit saved.');
});
$('#prWard').addEventListener('click', async (e) => {
  const g = e.target.closest('[data-go-premium]'); if (g) { e.preventDefault(); return goPremium(); }
  const w = e.target.closest('[data-wear]'), d = e.target.closest('[data-del]');
  if (w) {
    const r = await cr.wardrobe('wear', w.dataset.wear);
    if (!r.ok) return toast(r.error);
    state.me.profile = r.profile; renderAccount(); loadMe(); toast('Outfit on. It shows next time you start the game.');
  } else if (d) {
    const r = await cr.wardrobe('delete', d.dataset.del);
    if (r.ok) renderWardrobe(r.outfits);
  }
});

/* CraftBoost */
async function renderBoost() {
  const b = cr.boost ? await cr.boost() : null;
  $('#boostBox').hidden = !(b && b.tier);
  if (!b || !b.tier) return;
  const tier = { low: 'Light', mid: 'Balanced', high: 'High' }[b.tier] || 'Balanced';
  $('#boostBox').classList.toggle('off', !(state.settings.boost !== false));
  $('#boostInfo').innerHTML = `Your PC: <b>${b.ram} GB memory</b>, ${b.cores} processor threads${b.gpu ? ', ' + esc(b.gpu) : ''}. Preset: <b>${tier}</b>.`;
}

/* launcher themes (Premium, except the default) */
const THEMES = [
  { id: 'emerald', name: 'Emerald', br: '#1bd96a', hi: '#4ae68b', ink: '#04140a', free: true },
  { id: 'gold', name: 'Gold', br: '#f2b821', hi: '#ffd25e', ink: '#1a1200' },
  { id: 'crimson', name: 'Crimson', br: '#ff4d5e', hi: '#ff7b88', ink: '#1a0306' },
  { id: 'ocean', name: 'Ocean', br: '#2fb4ff', hi: '#6ccbff', ink: '#03121c' },
  { id: 'amethyst', name: 'Amethyst', br: '#b06cff', hi: '#c895ff', ink: '#12051f' },
  { id: 'sunset', name: 'Sunset', br: '#ff8a3d', hi: '#ffa96b', ink: '#1a0b02' },
  { id: 'frost', name: 'Frost', br: '#8fe3ff', hi: '#b8eeff', ink: '#06161c' },
  { id: 'rose', name: 'Rose', br: '#ff6fb1', hi: '#ff99c8', ink: '#1c0612' },
];
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id && (x.free || isPremium())) || THEMES[0];
  const r = document.documentElement.style;
  r.setProperty('--br', t.br); r.setProperty('--br-hi', t.hi); r.setProperty('--ink', t.ink);
  document.documentElement.dataset.theme = t.id;
  renderThemes(t.id);
}
function renderThemes(cur) {
  const el = $('#themes'); if (!el) return;
  el.innerHTML = THEMES.map((t) => {
    const locked = !t.free && !isPremium();
    return `<button type="button" role="radio" aria-checked="${t.id === cur}" class="th${t.id === cur ? ' on' : ''}${locked ? ' lock' : ''}" data-theme="${t.id}" title="${esc(t.name)}${locked ? ' (Premium)' : ''}"><i style="background:${t.br}"></i><span>${esc(t.name)}</span></button>`;
  }).join('');
  $('#themeNote').textContent = isPremium() ? '' : 'More themes with Premium';
}
$('#themes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-theme]'); if (!b) return;
  const t = THEMES.find((x) => x.id === b.dataset.theme);
  if (!t.free && !isPremium()) { toast('This theme is part of CraftRank Premium. Get it on the Account page.'); return; }
  state.settings = await cr.save({ theme: t.id });
  applyTheme(t.id);
});

/* ---------- capes (added in Admin → Launcher on the site) ---------- */
// hundreds of capes: grouped by category, searchable, each picture drawn only when it scrolls into view
const capeUi = { items: [], cat: 'All', q: '' };
const capeIo = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return; capeIo.unobserve(e.target); drawCape(e.target, e.target.dataset.tex);
}), { rootMargin: '300px' }) : null;
async function loadCapes() {
  const r = await cr.store();
  capeUi.items = r && r.ok ? (r.items || []).filter((it) => it.kind === 'cape' && (it.owned || it.premium)) : [];
  $('#prCapes').hidden = !capeUi.items.length;
  $('#nCapes').textContent = capeUi.items.length || '';
  syncTabs();
  if (!capeUi.items.length) { renderSlots(); updateView(); return; }
  const cats = {};
  capeUi.items.forEach((it) => { if (it.premium) return; const c = it.category || 'Other'; cats[c] = (cats[c] || 0) + 1; });
  if (capeUi.cat !== 'All' && capeUi.cat !== 'Premium' && !cats[capeUi.cat]) capeUi.cat = 'All';
  const nPrem = capeUi.items.filter((it) => it.premium).length;
  if (capeUi.cat === 'Premium' && !nPrem) capeUi.cat = 'All';
  $('#capeCats').innerHTML = [['All', capeUi.items.length], ...(nPrem ? [['Premium', nPrem]] : []), ...Object.keys(cats).sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b)).map((c) => [c, cats[c]])]
    .map(([c, n]) => `<button class="${c === capeUi.cat ? 'on' : ''}${c === 'Premium' ? ' prem' : ''}" data-cat="${esc(c)}">${esc(c)} <em>${n}</em></button>`).join('');
  renderCapes();
}
function renderCapes() {
  const pr = state.me && state.me.profile, on = pr ? pr.cape_item : null, q = capeUi.q.trim().toLowerCase();
  const worn = capeUi.items.find((it) => it.id === on);
  $('#capeNow').innerHTML = worn ? `Wearing <b>${esc(worn.name)}</b> <button class="btn plain sm" data-cape="0">Take off</button>` : 'No cape on';
  const list = capeUi.items.filter((it) => (capeUi.cat === 'All' || (capeUi.cat === 'Premium' ? it.premium : (it.category || 'Other') === capeUi.cat)) && (!q || it.name.toLowerCase().includes(q)));
  $('#capeList').innerHTML = list.length ? list.map((it) => `<button class="cape${it.id === on ? ' on' : ''}${it.premium ? ' prem' : ''}${it.owned ? '' : ' lock'}" data-cape="${it.id}" title="${esc(it.about || it.name)}"${pr ? '' : ' disabled'}>
    <canvas width="50" height="80" data-tex="${esc(it.texture)}"${it.anim ? ` data-anim="${esc(it.anim.url)}" data-fps="${+it.anim.fps || 12}"` : ''}></canvas><b>${esc(it.name)}</b><small>${it.id === on ? 'Wearing' : it.owned ? esc(it.category || 'Other') : 'Premium'}${it.anim && !/animated/i.test(it.category || '') ? ' · Animated' : ''}</small></button>`).join('')
    : '<p class="hint capes-none">No capes match your search.</p>';
  $('#capeList').querySelectorAll('canvas[data-tex]').forEach((cv) => capeIo ? capeIo.observe(cv) : drawCape(cv, cv.dataset.tex));
  $('#capeHint').hidden = !!pr;
  renderSlots(); updateView();
}
$('#capeCats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  capeUi.cat = b.dataset.cat;
  $('#capeCats').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderCapes();
});
$('#capeQ').addEventListener('input', (e) => { capeUi.q = e.target.value; renderCapes(); });
$('#prCapes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cape]'); if (!b || b.disabled) return;
  const id = +b.dataset.cape, pr = state.me && state.me.profile;
  if (!pr) return toast('Pick your in-game name first.');
  if (id && pr.cape_item === id) return;
  const it = capeUi.items.find((x) => x.id === id);
  if (it && !it.owned) { toast('This cape is part of CraftRank Premium.'); return goPremium(); }
  b.disabled = true;
  const r = await cr.equip('cape', id);
  if (!r.ok) { b.disabled = false; return toast(r.error || 'Could not change the cape.'); }
  if (state.me) state.me.profile = r.profile;
  toast(id ? 'Cape on. It shows next time you start the game.' : 'Cape taken off.');
  renderCapes();
});
/* ---------- cosmetics painted onto the skin (Admin → Launcher, kind "overlay") ---------- */
const cosUi = { items: [], slot: 'all', q: '' };
const SLOT = { face: 'Face', head: 'Head', body: 'Body' };
function imgOf(src) { return new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
/** The head's front: the player's face with the cosmetic's outer layer on top. */
async function drawCos(cv, tex, base) {
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, cv.width, cv.height);
  const [b, o] = await Promise.all([imgOf(base), imgOf(tex)]);
  if (b) x.drawImage(b, 8, 8, 8, 8, 0, 0, cv.width, cv.height); else { x.fillStyle = '#2a2d31'; x.fillRect(0, 0, cv.width, cv.height); }
  if (o) x.drawImage(o, 40, 8, 8, 8, 0, 0, cv.width, cv.height);
}
async function loadCosmetics() {
  const r = await cr.store();
  cosUi.items = r && r.ok ? (r.items || []).filter((it) => it.kind === 'overlay' && (it.owned || it.premium)) : [];
  $('#prCos').hidden = !cosUi.items.length;
  $('#nCos').textContent = cosUi.items.length || '';
  syncTabs();
  renderCosmetics();
}
function renderCosmetics() {
  if (!cosUi.items.length) { renderSlots(); updateView(); return; }
  const pr = state.me && state.me.profile, worn = (pr && pr.overlays) || [];
  const order = Object.keys(SLOT), q = cosUi.q.trim().toLowerCase();
  const n = (f) => cosUi.items.filter(f).length;
  const cats = [['all', 'All', cosUi.items.length], ...order.map((k) => [k, SLOT[k], n((it) => it.slot === k)]).filter((c) => c[2]), ['premium', 'Premium', n((it) => it.premium)]].filter((c) => c[2]);
  if (!cats.some((c) => c[0] === cosUi.slot)) cosUi.slot = 'all';
  $('#cosCats').innerHTML = cats.map(([k, l, c]) => `<button class="${k === cosUi.slot ? 'on' : ''}${k === 'premium' ? ' prem' : ''}" data-slot="${k}">${l} <em>${c}</em></button>`).join('');
  const list = cosUi.items.filter((it) => (cosUi.slot === 'all' || (cosUi.slot === 'premium' ? it.premium : it.slot === cosUi.slot)) && (!q || it.name.toLowerCase().includes(q)))
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || a.name.localeCompare(b.name));
  $('#cosList').innerHTML = !list.length ? '<p class="hint capes-none">No cosmetics match your search.</p>' : list.map((it) => `<button class="cape cos${worn.includes(it.id) ? ' on' : ''}${it.premium ? ' prem' : ''}${it.owned ? '' : ' lock'}" data-cos="${it.id}" title="${esc(it.about || it.name)}"${pr ? '' : ' disabled'}>
    ${it.preview ? `<img class="cos-card" src="${esc(it.preview)}" alt="${esc(it.name)}" loading="lazy" draggable="false">` : `<canvas width="64" height="64" data-tex="${esc(it.texture)}"></canvas><b>${esc(it.name)}</b>`}<small>${worn.includes(it.id) ? 'Wearing, click to take off' : it.owned ? esc(SLOT[it.slot] || 'Cosmetic') : 'Premium'}</small></button>`).join('');
  $('#cosList').querySelectorAll('canvas[data-tex]').forEach((cv) => drawCos(cv, cv.dataset.tex, pr && pr.skin));
  $('#cosHint').hidden = !!pr;
  renderSlots(); updateView();
}
$('#cosCats').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (!b) return; cosUi.slot = b.dataset.slot; renderCosmetics(); });
$('#cosQ').addEventListener('input', (e) => { cosUi.q = e.target.value; renderCosmetics(); });
$('#prCos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cos]'); if (!b || b.disabled) return;
  const id = +b.dataset.cos, pr = state.me && state.me.profile;
  if (!pr) return toast('Pick your in-game name first.');
  const it = cosUi.items.find((x) => x.id === id);
  if (it && !it.owned) { toast('This cosmetic is part of CraftRank Premium.'); return goPremium(); }
  const on = !(pr.overlays || []).includes(id);
  b.disabled = true;
  const r = await cr.equip('overlay', id, on);
  b.disabled = false;
  if (!r.ok) return toast(r.error || 'Could not change it.');
  if (state.me) state.me.profile = r.profile;
  toast(on ? 'On. It shows next time you start the game.' : 'Taken off.');
  renderCosmetics();
});
$('#signin').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#siBtn').disabled = true;
  const r = await cr.login($('#siLogin').value, $('#siPass').value, $('#siCodeRow').hidden ? '' : $('#siCode').value.trim());
  $('#siBtn').disabled = false;
  // accounts with two-step sign-in: the code from the authenticator app is asked after the password
  if (!r.ok && r.code === 'totp') { $('#siCodeRow').hidden = false; $('#siCode').focus(); toast(r.error); return; }
  if (!r.ok) { toast(r.error); return; }
  $('#siPass').value = ''; $('#siCode').value = ''; $('#siCodeRow').hidden = true; await loadMe(); renderAccount();
  toast(r.profile ? 'Signed in.' : 'Signed in. Now pick your in-game name.');
});
$('#siReg').addEventListener('click', async (e) => { e.preventDefault(); const c = await cr.config(); cr.open(c.register || 'https://craftrank.org/register'); });
$('#prNameSave').addEventListener('click', async () => { const r = await cr.setName($('#prName').value.trim()); if (!r.ok) return toast(r.error); toast('Name saved.'); await loadMe(); renderAccount(); });
$('#skinUp').addEventListener('click', async (e) => { e.stopPropagation(); skinDone(await cr.uploadSkin($('#skinSlim').checked)); });
$('#skinReset').addEventListener('click', async (e) => { e.preventDefault(); const r = await cr.resetSkin(); if (!r.ok) return toast(r.error); toast('Back to the default skin.'); await loadMe(); renderAccount(); });
$('#prLogout').addEventListener('click', async () => { await cr.logout(); state.me = null; await loadMe(); renderAccount(); });

/* ---------- my servers ---------- */
async function loadServers() {
  state.ms.list = await cr.srv.list();
  const types = await cr.srv.types();
  $('#msTypes').innerHTML = Object.entries(types).filter(([, t]) => !t.legacy).map(([k, t]) => `<button type="button" class="type${k === state.ms.type ? ' on' : ''}" data-type="${k}"><b>${esc(t.name)}</b><small>${esc(t.about)}</small></button>`).join('');
  $('#msList').innerHTML = state.ms.list.map((s) => `<button class="ms-item${s.id === state.ms.sel ? ' on' : ''}" data-ms="${esc(s.id)}"><b><i class="dot${s.running ? ' on' : ''}"></i>${esc(s.name)}</b><small>${esc(types[s.type] ? types[s.type].name : s.type)} ${esc(s.version)} · port ${s.port}</small></button>`).join('');
  $('#msEmpty').hidden = !!(state.ms.list.length || !$('#msNew').hidden);
  if (state.ms.sel) showServer(state.ms.sel);
}
async function msVersions() {
  const sel = $('#msVer'); sel.innerHTML = '<option>Loading…</option>';
  const r = await cr.srv.versions(state.ms.type);
  sel.innerHTML = r.ok ? r.versions.map((v) => `<option>${esc(v)}</option>`).join('') : '<option value="">Could not load versions</option>';
  $('#msPort').value = ['velocity', 'bungeecord'].includes(state.ms.type) ? 25577 : 25565;
}
$('#msTypes').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (!b) return; state.ms.type = b.dataset.type; $$('#msTypes .type').forEach((x) => x.classList.toggle('on', x === b)); msVersions(); });
$('#msNewBtn').addEventListener('click', () => { $('#msNew').hidden = false; $('#msView').hidden = true; $('#msEmpty').hidden = true; msVersions(); });
$('#msCancel').addEventListener('click', () => { $('#msNew').hidden = true; loadServers(); });
const memV = () => { $('#msMemV').textContent = ($('#msMem').value / 1024).toFixed(1) + ' GB'; };
$('#msMem').addEventListener('input', memV); memV();
$('#msNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('#msEula').checked) return toast("Accept Mojang's EULA to create a server.");
  $('#msCreate').disabled = true;
  const r = await cr.srv.create({ type: state.ms.type, name: $('#msName').value, version: $('#msVer').value, memory: +$('#msMem').value, port: +$('#msPort').value, online: $('#msOnline').checked, eula: true });
  $('#msCreate').disabled = false;
  if (!r.ok) return toast(r.error);
  $('#msNew').hidden = true; state.ms.sel = r.id; toast('Server created. Press Start.'); loadServers();
});
$('#msList').addEventListener('click', (e) => { const b = e.target.closest('[data-ms]'); if (!b) return; state.ms.sel = b.dataset.ms; $('#msNew').hidden = true; loadServers(); });
async function showServer(id) {
  const s = state.ms.list.find((x) => x.id === id); if (!s) return;
  $('#msView').hidden = false; $('#msEmpty').hidden = true;
  $('#msvName').textContent = s.name;
  $('#msvMeta').textContent = s.type + ' ' + s.version + ' · ' + (s.memory / 1024).toFixed(1) + ' GB · join with localhost' + (s.port !== 25565 ? ':' + s.port : '');
  $('#msvStart').hidden = s.running; $('#msvStop').hidden = !s.running;
  const log = await cr.srv.log(id);
  $('#msvLog').textContent = log.join('\n') || (s.running ? '' : 'The server is stopped. Press Start.');
  $('#msvLog').scrollTop = 1e9;
}
$('#msvStart').addEventListener('click', async () => { $('#msvLog').textContent = 'Starting…'; const r = await cr.srv.start(state.ms.sel); if (!r.ok) { toast(r.error); $('#msvLog').textContent = r.error; } loadServers(); });
$('#msvStop').addEventListener('click', async () => { await cr.srv.stop(state.ms.sel); toast('Stopping the server…'); });
$('#msvFolder').addEventListener('click', () => cr.srv.open(state.ms.sel));
$('#msvDel').addEventListener('click', async () => { if (!confirm('Delete this server and its worlds?')) return; const r = await cr.srv.remove(state.ms.sel); if (!r.ok) return toast(r.error); state.ms.sel = null; $('#msView').hidden = true; loadServers(); });
$('#msvCmd').addEventListener('submit', async (e) => { e.preventDefault(); const v = $('#msvCmdIn').value.trim(); if (!v) return; await cr.srv.cmd(state.ms.sel, v); $('#msvCmdIn').value = ''; });
cr.on('srv:line', (d) => {
  if (d.id === state.ms.sel) { const el = $('#msvLog'); const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 30; el.textContent += (el.textContent ? '\n' : '') + d.line; if (end) el.scrollTop = 1e9; }
  if (d.stopped) loadServers();
});
cr.on('srv:progress', (p) => { if (p && state.ms.sel) $('#msvLog').textContent = p.stage + ' ' + (p.pct || 0) + '%'; });

/* ---------- settings ---------- */
function bindSettings(info) {
  const s = state.settings;
  $('#barName').value = s.username || '';
  const mem = $('#setMem'); mem.max = Math.max(2048, Math.floor(info.ram * 0.75 / 512) * 512); mem.value = s.memory;
  const showMem = () => { $('#memVal').textContent = (mem.value / 1024).toFixed(1) + ' GB of ' + (info.ram / 1024).toFixed(0) + ' GB'; };
  showMem(); mem.addEventListener('input', showMem); mem.addEventListener('change', async () => { state.settings = await cr.save({ memory: +mem.value }); });
  $('#msMem').max = Math.max(2048, Math.floor(info.ram * 0.75 / 512) * 512);
  $('#setBoost').checked = s.boost !== false;
  $('#setBoost').addEventListener('change', async (e) => { state.settings = await cr.save({ boost: e.target.checked }); renderBoost(); });
  $('#boostNow').addEventListener('click', async () => { state.settings = await cr.save({ boost: true, boostStamp: Date.now() }); $('#setBoost').checked = true; renderBoost(); toast('Done. Every version gets the best settings for this PC the next time it starts.'); });
  renderBoost();
  $('#setSkins').checked = s.skinsOnServers !== false; $('#setSkins').addEventListener('change', async (e) => { state.settings = await cr.save({ skinsOnServers: e.target.checked }); });
  $('#setStats').checked = s.stats !== false; $('#setStats').addEventListener('change', async (e) => { state.settings = await cr.save({ stats: e.target.checked }); });
  $('#setDiscord').checked = s.discord !== false; $('#setDiscord').addEventListener('change', async (e) => { state.settings = await cr.save({ discord: e.target.checked }); });
  $('#setClose').checked = !!s.closeOnPlay; $('#setClose').addEventListener('change', async (e) => { state.settings = await cr.save({ closeOnPlay: e.target.checked }); });
  $('#setSnap').checked = !!s.showSnapshots; $('#setOld').checked = !!s.showOld; $('#setPerf').checked = s.pack === 'perf';
  $('#setSnap').addEventListener('change', async (e) => { state.settings = await cr.save({ showSnapshots: e.target.checked }); });
  $('#setOld').addEventListener('change', async (e) => { state.settings = await cr.save({ showOld: e.target.checked }); });
  $('#setPerf').addEventListener('change', async (e) => { state.settings = await cr.save({ pack: e.target.checked ? 'perf' : 'none' }); });
  $('#tbVer').textContent = info.version;
  $('#ghTile').addEventListener('click', () => cr.open('https://github.com/Kypersw/craftrank-launcher'));
  $('#openFolder2').addEventListener('click', () => cr.folder());
  state.site = info.site;
  $('#siteTile').addEventListener('click', () => cr.open(info.site));
  $('#reload').addEventListener('click', refreshAll);
  $('#barName').addEventListener('input', (e) => { const v = e.target.value.trim(); if (/^[A-Za-z0-9_]{3,16}$/.test(v)) { cr.save({ username: v }); drawHead($('#head'), null, v); } });
  drawHead($('#head'), null, s.username || 'Steve');
  $('#openFolder').addEventListener('click', () => cr.folder());
  $('#about').textContent = 'CraftRank Launcher ' + info.version + '. Game files are kept apart from your normal .minecraft folder.';
}

/* ---------- texture packs ---------- */
const pk = { items: [], off: 0, total: 0, key: '', busy: false, installed: {} };
let pkT;
$('#pkQ').addEventListener('input', () => { clearTimeout(pkT); pkT = setTimeout(() => loadPacks(true), 350); });
$('#pkMore').addEventListener('click', () => loadPacks(false, true));
$('#pkFolder').addEventListener('click', () => cr.packs.folder());
async function loadPacks(reset, more) {
  const q = $('#pkQ').value.trim(), key = q + '|' + (state.settings.mc || '') + '|' + (state.settings.loader || '');
  if (!reset && !more && pk.key === key && pk.items.length) return renderPacks();
  if (pk.busy) return; pk.busy = true;
  if (!more) { pk.items = []; pk.off = 0; $('#pkList').innerHTML = '<div class="empty" style="grid-column:1/-1">Loading texture packs…</div>'; }
  const r = await cr.packs.search(q, pk.off);
  pk.busy = false;
  if (!r.ok) { $('#pkList').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(r.error || 'Could not load texture packs.')}</div>`; return; }
  pk.key = key; pk.total = r.total; pk.installed = r.installed || {}; pk.items = pk.items.concat(r.items); pk.off = pk.items.length;
  $('#pkNote').textContent = 'Most downloaded first, for ' + $('#verLabel').textContent + '. Packs go into this version and are switched on for you.';
  renderPacks();
}
function renderPacks() {
  $('#pkList').innerHTML = pk.items.map((p) => {
    const has = !!pk.installed[p.id];
    return `<div class="res"><span class="res-ic">${p.icon ? `<img src="${esc(p.icon)}" alt="">` : esc(p.title.slice(0, 2).toUpperCase())}</span>
      <div><b>${esc(p.title)}</b><p>${esc(p.about)}</p><small class="res-meta">${esc(p.author)}<span>${short(p.downloads)} downloads</span></small>
      <div class="pk-act"><a href="#" class="more" data-open="${esc((state.site || 'https://craftrank.org') + '/resource-go.php?modrinth=' + encodeURIComponent(p.id))}">Details</a><button class="btn plain${has ? ' on' : ''}" data-pk="${esc(p.id)}">${has ? 'Installed' : 'Install'}</button></div></div></div>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">No texture packs found for this version.</div>';
  $('#pkMore').hidden = pk.items.length >= pk.total;
}
$('#pkList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pk]'); if (!b) return;
  const id = b.dataset.pk; b.disabled = true;
  if (pk.installed[id]) {
    b.textContent = 'Removing…'; const r = await cr.packs.remove(id); b.disabled = false;
    if (!r.ok) return toast(r.error); delete pk.installed[id]; renderPacks(); toast('Pack removed.');
  } else {
    b.textContent = 'Installing…'; const r = await cr.packs.install(id); b.disabled = false;
    if (!r.ok) { renderPacks(); return toast(r.error); }
    pk.installed[id] = r.file; renderPacks();
    toast(r.exact ? 'Installed and switched on. Start the game to see it.' : 'Installed. This pack was made for another version, it may look a little different.');
  }
});

/* ---------- mods (from the CraftRank site) ---------- */
const md = { items: [], off: 0, total: 0, key: '', busy: false, installed: {}, can: true, show: 'all', working: {} };
let mdT;
$('#mdQ').addEventListener('input', () => { clearTimeout(mdT); mdT = setTimeout(() => loadMods(true), 350); });
$('#mdMore').addEventListener('click', () => loadMods(false, true));
$('#mdFolder').addEventListener('click', () => cr.mods.folder());
$$('[data-mdshow]').forEach((b) => b.addEventListener('click', () => { md.show = b.dataset.mdshow; $$('[data-mdshow]').forEach((x) => x.classList.toggle('on', x === b)); renderMods(); }));
cr.on('mods:step', (d) => { const b = $(`[data-md="${CSS.escape(d.id)}"]`); if (b && d.file) b.textContent = 'Installing ' + (d.file.length > 22 ? d.file.slice(0, 20) + '…' : d.file); });
async function loadMods(reset, more) {
  const q = $('#mdQ').value.trim(), key = q + '|' + (state.settings.mc || '') + '|' + (state.settings.loader || '');
  if (!reset && !more && md.key === key && md.items.length) return renderMods();
  if (md.busy) return; md.busy = true;
  if (!more) { md.items = []; md.off = 0; $('#mdList').innerHTML = '<div class="empty" style="grid-column:1/-1">Loading mods…</div>'; }
  const r = await cr.mods.list(q, md.off);
  md.busy = false;
  if (!r.ok) { $('#mdList').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(r.error || 'Could not load mods.')}</div>`; return; }
  loadModPacks();
  md.key = key; md.total = r.total; md.installed = r.installed || {}; md.can = r.canMod; md.items = md.items.concat(r.items); md.off = md.items.length;
  $('#mdNote').textContent = 'For ' + $('#verLabel').textContent + '. Mods go into this version only, with the mods they need.';
  const w = $('#mdWarn');
  w.hidden = md.can;
  w.textContent = md.can ? '' : 'Mods need a mod loader. Pick a Fabric, Forge or NeoForge version in the version menu (Fabric has the most mods), then install them here.';
  renderMods();
}
function renderMods() {
  const mine = Object.keys(md.installed).filter((id) => !md.installed[id].dep);
  $('#mdCount').textContent = mine.length ? '(' + mine.length + ')' : '';
  const list = md.show === 'mine'
    ? mine.map((id) => md.items.find((m) => m.id === id) || { id, title: md.installed[id].title || id, about: md.installed[id].file, author: '', downloads: 0, icon: '', url: '' })
    : md.items;
  $('#mdList').innerHTML = list.map((m) => {
    const has = !!(md.installed[m.id] && !md.installed[m.id].dep), work = md.working[m.id];
    const meta = [m.author ? esc(m.author) : '', m.downloads ? `<span>${short(m.downloads)} downloads</span>` : '', m.env === 'both' ? '<span class="md-tag" title="Only works on servers that have this mod too, and in single player">Server needs it too</span>' : ''].filter(Boolean).join('');
    return `<div class="res"><span class="res-ic">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : esc(m.title.slice(0, 2).toUpperCase())}</span>
      <div><b>${esc(m.title)}</b><p>${esc(m.about)}</p><small class="res-meta">${meta}</small>
      <div class="pk-act">${m.url ? `<a href="#" class="more" data-open="${esc(m.url)}">Details</a>` : '<span></span>'}<button class="btn plain${has ? ' on' : ''}" data-md="${esc(m.id)}"${work || (!md.can && !has) ? ' disabled' : ''}>${work || (has ? 'Installed' : 'Install')}</button></div></div></div>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1">${md.show === 'mine' ? 'No mods installed in this version yet.' : 'No mods found for this version.'}</div>`;
  $('#mdMore').hidden = md.show === 'mine' || md.items.length >= md.total;
}
$('#mdList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-md]'); if (!b || b.disabled) return;
  const id = b.dataset.md, has = md.installed[id] && !md.installed[id].dep;
  md.working[id] = has ? 'Removing…' : 'Installing…'; renderMods();
  const r = has ? await cr.mods.remove(id) : await cr.mods.install(id);
  delete md.working[id];
  if (r.ok) md.installed = r.installed || md.installed;
  renderMods();
  if (!r.ok) return toast(r.error);
  toast(has ? 'Mod removed.' : r.deps && r.deps.length ? 'Installed with ' + r.deps.join(', ') + '. Start the game to use it.' : 'Installed. Start the game to use it.');
});

/* ---------- ready mod packs (PvP Pack) ---------- */
const mpk = { packs: [], work: '' };
async function loadModPacks() { const r = await cr.mods.packs(); if (r && r.ok) { mpk.packs = r.packs; renderModPacks(); } }
function renderModPacks() {
  $('#mdPacks').innerHTML = mpk.packs.map((p) => {
    const n = p.mods.filter((m) => m.on).length, all = n > 0 && p.mods.every((m) => m.on || m.na);
    return `<div class="mpk"><img class="mpk-logo" src="${p.id}-pack.png" alt="">
      <div class="mpk-body"><div class="mpk-h"><b>${esc(p.title)}</b><span>${p.mods.length} mods · Fabric</span>${n ? `<span class="on">${n} installed</span>` : ''}</div>
        <p>${esc(p.about)}</p>
        <div class="mpk-mods">${p.mods.map((m) => `<span class="${m.on ? 'on' : m.na ? 'na' : ''}" title="${esc(m.na ? 'Not out for Minecraft ' + p.mc + ' yet' : m.what)}">${esc(m.name)}${m.na ? ' <em>not for ' + esc(p.mc) + '</em>' : ''}</span>`).join('')}</div></div>
      <div class="mpk-act"><button class="btn ${n ? 'plain' : 'blue'}" data-mpk="${p.id}" data-has="${n ? 1 : ''}"${mpk.work ? ' disabled' : ''}>${mpk.work === p.id ? 'Installing…' : all ? 'Remove pack' : n ? 'Install the rest' : 'Install pack'}</button>
        ${n && !all ? `<a href="#" class="more" data-mpkrm="${p.id}">Remove pack</a>` : ''}</div></div>`;
  }).join('');
}
cr.on('mods:step', (d) => { if (d && String(d.id).startsWith('pack:')) { const b = $(`[data-mpk="${CSS.escape(d.id.slice(5))}"]`); if (b && d.file) b.textContent = d.file.length > 26 ? d.file.slice(0, 24) + '…' : d.file; } });
$('#mdPacks').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-mpkrm]'), b = e.target.closest('[data-mpk]');
  if (rm) { e.preventDefault(); const r = await cr.mods.packRemove(rm.dataset.mpkrm); if (r.ok) { mpk.packs = r.packs; renderModPacks(); loadMods(true); toast('Pack removed.'); } else toast(r.error); return; }
  if (!b || b.disabled) return;
  const p = mpk.packs.find((x) => x.id === b.dataset.mpk), all = p && p.mods.some((m) => m.on) && p.mods.every((m) => m.on || m.na);
  if (all) { const r = await cr.mods.packRemove(p.id); if (r.ok) { mpk.packs = r.packs; renderModPacks(); loadMods(true); toast('Pack removed.'); } else toast(r.error); return; }
  mpk.work = p.id; renderModPacks();
  const r = await cr.mods.packInstall(p.id);
  mpk.work = '';
  if (!r.ok) { renderModPacks(); return toast(r.error); }
  mpk.packs = r.packs; renderModPacks();
  if (r.switched) { state.settings = await cr.settings(); verLabel(); }
  loadMods(true);
  toast((r.switched ? 'Switched Minecraft ' + r.mc + ' to Fabric. ' : '') + r.done.length + ' mods installed.' + (r.skipped.length ? ' Not out for this version yet: ' + r.skipped.join(', ') + '.' : '') + ' Start the game to use them.');
});

/* ---------- update reminder ---------- */
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
// The newest version is read from GitHub directly (the site caches it for a while) and from the site,
// at start and again every 20 minutes while the launcher is open.
async function checkUpdate(info) {
  const [cfg, n] = await Promise.all([cr.config(), cr.news()]);
  if (cfg && cfg.ok) state.cfg = cfg;
  const cands = [state.cfg && state.cfg.latest, n && n.ok && n.version].filter((v) => /^\d+\.\d+\.\d+$/.test(v || ''));
  const latest = cands.reduce((a, b) => (!a || newer(b, a) ? b : a), ''), cur = info.version;
  if (!latest || !newer(latest, cur)) return;
  $('#updBtn').hidden = false; $('#updBtn').onclick = () => { $('#upd').hidden = false; $('#updGo').onclick = () => runUpdate(info, latest); };
  if (!$('.nav a[data-page="home"] .nav-dot')) $('.nav a[data-page="home"]').insertAdjacentHTML('beforeend', '<i class="nav-dot" title="Update available"></i>');
  const snooze = state.settings.updSnooze || {};
  if (snooze.ver === latest && snooze.until > Date.now()) return;
  if (!$('#upd').hidden && $('#updVer').textContent === latest) return;
  $('#updVer').textContent = latest; $('#updCur').textContent = cur;
  $('#updNotes').textContent = n && n.ok && n.version === latest ? (n.body || '') : '';
  $('#upd').hidden = false;
  $('#updBtn').hidden = false;
  $('#updGo').onclick = () => runUpdate(info, latest);
  const later = async () => { $('#upd').hidden = true; state.settings = await cr.save({ updSnooze: { ver: latest, until: Date.now() + 24 * 3600 * 1000 } }); };
  $('#updLater').onclick = later; $('#updX').onclick = later;
}

/** One press: download, check and install the new version; the launcher closes and opens again. */
async function runUpdate(info, latest) {
  if (!info.selfUpdate) { cr.open('https://github.com/Kypersw/craftrank-launcher/releases/latest/download/CraftRank-Launcher.exe'); $('#upd').hidden = true; toast('The download opened in your browser. Close the launcher and open the new file.'); return; }
  $('#updGo').disabled = true; $('#updLater').disabled = true; $('#updBar').hidden = false; $('#updSt').hidden = false; $('#updSt').textContent = 'Starting…';
  const r = await cr.update();
  if (r.ok && r.started) { $('#updSt').textContent = 'Installing ' + latest + '. The launcher opens again in a moment.'; return; }
  $('#updGo').disabled = false; $('#updLater').disabled = false; $('#updBar').hidden = true;
  $('#updSt').textContent = r.ok && r.upToDate ? 'You already have the newest version.' : (r.error || 'The update did not work. Try again.');
}
cr.on('update', (st) => { if (!st) return; $('#updSt').hidden = false; $('#updSt').textContent = st.text + (st.pct ? ' ' + st.pct + '%' : ''); $('#updBarI').style.width = (st.pct || 0) + '%'; });

async function refreshAll() {
  const f = await cr.feed();
  if (!f.offline || !state.feed.servers.length) state.feed = f;
  renderServers(); renderResources(); renderAds();
  if (f.offline) showMsg((f.why || 'Could not reach CraftRank.') + (state.feed.servers.length ? ' Showing the last saved list.' : ' Check your internet connection, then press refresh.'));
  cr.catalog().then((c) => { if (c.ok) { state.catalog = c.data; if (!$('#verPop').hidden) renderVerList(); } });
}
(async function init() {
  const boot = (p, t) => { try { cr.boot(p, t); } catch (e) {} };
  boot(10, 'Starting the launcher…');
  const [s, info] = await Promise.all([cr.settings(), cr.info()]);
  state.settings = s; bindSettings(info);
  boot(25, 'Loading Minecraft versions…');
  cr.versions().then((v) => {
    if (!v.ok) { $('#verLabel').textContent = 'Offline'; return; }
    state.versions = v.versions; state.latest = v.latest;
    verLabel();
  });
  // what we saw last time shows at once; fresh data comes in behind it
  const cache = (await cr.bootCache().catch(() => null)) || {};
  const fresh = async () => {
    const [cfg] = await Promise.all([
      cr.config().then((c) => { if (c.ok) state.cfg = c; return c; }),
      refreshAll(),
      // offline for a moment: keep showing the saved profile instead of looking signed out
      cr.me().then((r) => loadMe(r.ok || !cache.me || r.status === 401 || r.error === 'signed_out' ? r : cache.me)),
    ]);
    return cfg;
  };
  if (cache.feed && cache.feed.servers) {
    state.cfg = cache.config || {};
    state.feed = cache.feed; renderServers(); renderResources(); renderAds();
    boot(80, 'Loading your profile…');
    if (cache.me) await loadMe(cache.me);
    idleStatus();
    boot(100, 'Ready');
    fresh().then(() => idleStatus());
  } else {
    // first start: nothing saved yet, ask for everything at the same time
    boot(55, 'Loading servers from CraftRank…');
    await fresh();
    state.cfg = state.cfg || {};
    idleStatus();
    boot(100, 'Ready');
  }
  loadNews();
  setTimeout(() => checkUpdate(info), 1500);
  setInterval(() => checkUpdate(info), 20 * 60 * 1000);
  setInterval(async () => { const f = await cr.feed(); if (!f.offline) { state.feed = f; renderServers(); renderResources(); renderAds(); } }, 5 * 60 * 1000);
})();
