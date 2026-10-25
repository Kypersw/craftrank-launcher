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
  const img = await loadImg(src); if (!img) return;
  const k = img.width / 64;
  c.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
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
async function loadMe() {
  const r = await cr.me();
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
  const skinItem = null;
  $('#skinSlim').checked = !!(pr && pr.slim);
  await drawSkin($('#skinCanvas'), skinItem ? skinItem.texture : pr && pr.skin, skinItem ? skinItem.slim : pr && pr.slim);
}
$('#signin').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#siBtn').disabled = true;
  const r = await cr.login($('#siLogin').value, $('#siPass').value);
  $('#siBtn').disabled = false;
  if (!r.ok) { toast(r.error); return; }
  $('#siPass').value = ''; await loadMe(); renderAccount();
  toast(r.profile ? 'Signed in.' : 'Signed in. Now pick your in-game name.');
});
$('#siReg').addEventListener('click', async (e) => { e.preventDefault(); const c = await cr.config(); cr.open(c.register || 'https://craftrank.org/register'); });
$('#prNameSave').addEventListener('click', async () => { const r = await cr.setName($('#prName').value.trim()); if (!r.ok) return toast(r.error); toast('Name saved.'); await loadMe(); renderAccount(); });
$('#skinUp').addEventListener('click', async () => { const r = await cr.uploadSkin($('#skinSlim').checked); if (r.canceled) return; if (!r.ok) return toast(r.error); toast('Skin saved. It shows next time you start the game.'); await loadMe(); renderAccount(); });
$('#skinReset').addEventListener('click', async () => { const r = await cr.resetSkin(); if (!r.ok) return toast(r.error); await loadMe(); renderAccount(); });
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
  $('#setSkins').checked = s.skinsOnServers !== false; $('#setSkins').addEventListener('change', async (e) => { state.settings = await cr.save({ skinsOnServers: e.target.checked }); });
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
  if (!$('.nav a[data-page="home"] .nav-dot')) $('.nav a[data-page="home"]').insertAdjacentHTML('beforeend', '<i class="nav-dot" title="Update available"></i>');
  const snooze = state.settings.updSnooze || {};
  if (snooze.ver === latest && snooze.until > Date.now()) return;
  if (!$('#upd').hidden && $('#updVer').textContent === latest) return;
  $('#updVer').textContent = latest; $('#updCur').textContent = cur;
  $('#updNotes').textContent = n && n.ok && n.version === latest ? (n.body || '') : '';
  $('#upd').hidden = false;
  const url = 'https://github.com/Kypersw/craftrank-launcher/releases/latest/download/CraftRank-Launcher.exe';
  $('#updGo').onclick = () => { cr.open(url); $('#upd').hidden = true; toast('The download opened in your browser. Close the launcher and open the new file.'); };
  const later = async () => { $('#upd').hidden = true; state.settings = await cr.save({ updSnooze: { ver: latest, until: Date.now() + 24 * 3600 * 1000 } }); };
  $('#updLater').onclick = later; $('#updX').onclick = later;
}

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
  const cfg = await cr.config(); state.cfg = cfg.ok ? cfg : {};
  boot(55, 'Loading servers from CraftRank…');
  await refreshAll();
  boot(80, 'Loading your profile…');
  await loadMe();
  boot(92, 'Almost ready…');
  await Promise.race([loadNews(), new Promise((ok) => setTimeout(ok, 2500))]);
  idleStatus();
  boot(100, 'Ready');
  setTimeout(() => checkUpdate(info), 1500);
  setInterval(() => checkUpdate(info), 20 * 60 * 1000);
  setInterval(async () => { const f = await cr.feed(); if (!f.offline) { state.feed = f; renderServers(); renderResources(); renderAds(); } }, 5 * 60 * 1000);
})();
