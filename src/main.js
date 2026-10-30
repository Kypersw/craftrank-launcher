// CraftRank Launcher: main process.
const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
app.setName('CraftRank Launcher');
if (process.platform === 'win32') app.setAppUserModelId('org.craftrank.launcher');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');

/* Only the launcher's own pages may call the main process. */
const UI_URL = pathToFileURL(path.join(__dirname, 'ui')).href + '/';
const fromUs = (e) => { const u = e && e.senderFrame && e.senderFrame.url; return typeof u === 'string' && u.startsWith(UI_URL); };
const _handle = ipcMain.handle.bind(ipcMain), _on = ipcMain.on.bind(ipcMain);
ipcMain.handle = (ch, fn) => _handle(ch, (e, ...a) => { if (!fromUs(e)) throw new Error('Blocked: not from the launcher window.'); return fn(e, ...a); });
ipcMain.on = (ch, fn) => _on(ch, (e, ...a) => { if (fromUs(e)) fn(e, ...a); });

/**
 * Links that open in the browser: HTTPS only, to CraftRank and the few sites the launcher links to,
 * or an ad link that came with the CraftRank feed (set by the site's admin).
 */
const LINK_HOSTS = ['craftrank.org', 'github.com', 'modrinth.com', 'aka.ms', 'minecraft.net'];
let feedLinks = new Set();
function safeOpen(url) {
  let u; try { u = new URL(String(url)); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || String(url).length > 2048) return false;
  const h = u.hostname.toLowerCase();
  const site = (() => { try { return new URL(SITE).hostname.toLowerCase(); } catch (e) { return ''; } })();
  const okHost = LINK_HOSTS.concat(site ? [site] : []).some((d) => h === d || h.endsWith('.' + d));
  if (!okHost && !feedLinks.has(u.href)) return false;
  shell.openExternal(u.href);
  return true;
}

// follow a system HTTPS proxy when one is set, so downloads work on proxied networks too
try {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (px) {
    // local addresses (a site running on this PC) never go through the proxy
    const { ProxyAgent, Agent, Dispatcher, setGlobalDispatcher } = require('undici');
    const proxy = new ProxyAgent(px), direct = new Agent();
    const local = (o) => /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.)/.test(String(o.origin || ''));
    setGlobalDispatcher(new (class extends Dispatcher { dispatch(o, h) { return (local(o) ? direct : proxy).dispatch(o, h); } close() { return Promise.all([proxy.close(), direct.close()]); } destroy() { return Promise.all([proxy.destroy(), direct.destroy()]); } })());
  }
} catch (e) {}

const game = require('./game');
const servers = require('./servers');
const updater = require('./updater');
const swapping = updater.swapPortable();   // a new portable .exe putting itself in place of the old one
const discord = require('./discord')();
const SITE = process.env.CRAFTRANK_SITE || 'https://craftrank.org';
const ROOT = path.join(app.getPath('appData'), '.craftrank');           // game files live here, apart from .minecraft
const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
/* Anonymous usage statistics (Settings: "Send anonymous usage statistics"): a random id for this install,
   and a note to the site when a game starts or ends (Minecraft version, loader, server, minutes, kind of PC).
   No name, account or file is sent. Off: nothing is sent and the id is not used. */
let installIdCache = null;
function installId() {
  if (readSettings().stats === false) return '';
  if (installIdCache) return installIdCache;
  const f = path.join(app.getPath('userData'), 'install-id');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(t)) return (installIdCache = t); } catch (e) {}
  installIdCache = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(f, installIdCache); } catch (e) {}
  return installIdCache;
}
const account = require('./account')(SITE, path.join(app.getPath('userData'), 'session.bin'), app.getVersion(), installId);
function winName() {
  if (process.platform !== 'win32') return os.type().slice(0, 24);
  const b = +String(os.release()).split('.')[2] || 0;
  return b >= 22000 ? 'Windows 11' : b >= 10240 ? 'Windows 10' : 'Windows ' + String(os.release()).split('.').slice(0, 2).join('.');
}
function stat(j) { if (readSettings().stats !== false) account.event(j).catch(() => {}); }

let win = null;
let running = null;     // the Minecraft process
let busy = false;

function readSettings() {
  const ram = Math.floor(os.totalmem() / 1048576);
  const def = { username: '', mc: '', loader: 'vanilla', loaderVersion: '', pack: 'none', playAs: 'offline', performance: false, showSnapshots: false, showOld: false,
    memory: Math.min(4096, Math.max(ram >= 6000 ? 2048 : 1024, Math.floor(ram / 4 / 512) * 512)), closeOnPlay: false, discord: true, skinsOnServers: true, boost: true, stats: true };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch (e) { return def; }
}
function writeSettings(s) { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString('hex');
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
// One bar for the whole start: each step fills its own share, and the bar never goes back
// (the downloaders report several 0–100 runs, and their totals grow while they work).
const STEPS = [[/^(Checking|Downloading) Minecraft/, 0, 62], [/Java/, 62, 76], [/^Installing|libraries|OptiFine/i, 76, 90], [/^Mod pack/, 90, 98], [/^Starting/, 98, 100]];
// The downloaders report every finished chunk (thousands a second); only tell the window when
// the text or the number changes, at most every 150 ms, so it never floods and freezes.
let barNow = 0, lastSent = '', lastAt = 0;
const progress = (stage, pct) => {
  const st = STEPS.find(([re]) => re.test(stage)) || [null, barNow, barNow];
  const v = st[1] + (Math.max(0, Math.min(100, pct || 0)) / 100) * (st[2] - st[1]);
  barNow = Math.max(barNow, Math.round(v));
  const step = stage.split(' · ')[0], key = stage + '|' + barNow, now = Date.now();
  if (key === lastSent || (now - lastAt < 250 && step === lastSent.split(' · ')[0].split('|')[0])) return;
  lastSent = key; lastAt = now;
  send('progress', { stage, pct: barNow });
};

// error text that leaves the computer (stats) never carries the user's folder, which holds their account name
function noHome(t) {
  let out = String(t);
  for (const h of [os.homedir(), process.env.USERPROFILE, process.env.HOME].filter((x) => x && x.length > 2)) out = out.split(h).join('~').split(h.replace(/\\/g, '/')).join('~');
  return out.replace(/([A-Za-z]:)?[\\/](Users|home|Documents and Settings)[\\/][^\\/'"]+/gi, '~');
}
function friendly(err) {
  const m = err && err.message ? err.message : String(err);
  if (/Download|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|socket/i.test((err && err.name) + ' ' + m)) return 'Download failed. Check your internet connection and try again; finished files are kept.';
  if (/ENOSPC/.test(m)) return 'Your disk is full. Free some space and try again.';
  return m;
}
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { console.error(err); return { ok: false, error: friendly(err) }; } };

let splash = null;
function createWindow() {
  // a small loading window first, while the launcher reads versions and servers
  splash = new BrowserWindow({
    width: 440, height: 620, frame: false, transparent: true, resizable: false, maximizable: false, show: false, center: true, skipTaskbar: false,
    backgroundColor: '#00000000', icon: path.join(__dirname, 'ui', process.platform === 'win32' ? 'icon.ico' : 'icon.png'), title: 'CraftRank Launcher',
    // locked down: no Node.js, isolated and sandboxed; middle-click cannot open links in new windows
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, disableBlinkFeatures: 'Auxclick', spellcheck: false },
  });
  splash.loadFile(path.join(__dirname, 'ui', 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { splash = null; });

  // the main window is see-through around the panel, so the character can stand over its edge
  win = new BrowserWindow({
    width: 1320, height: 800, frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, show: false, center: true,
    backgroundColor: '#00000000', hasShadow: false,
    icon: path.join(__dirname, 'ui', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: 'CraftRank Launcher',
    // locked down: no Node.js, isolated and sandboxed; middle-click cannot open links in new windows
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, disableBlinkFeatures: 'Auxclick', spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // shown when the page says it is ready (or after 20 s, whatever happens)
  const fallback = setTimeout(showMain, 20000);
  win.once('show', () => clearTimeout(fallback));
  win.webContents.setWindowOpenHandler(({ url }) => { safeOpen(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { url = url || e.url || ''; if (!url.startsWith(UI_URL)) { e.preventDefault(); safeOpen(url); } });
  splash.webContents.on('will-navigate', (e) => e.preventDefault());
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
function showMain() {
  if (!win || win.isDestroyed() || win.isVisible()) return;
  win.show(); win.focus();
  if (splash && !splash.isDestroyed()) setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, 120);
}
ipcMain.on('boot', (e, pct, text) => {
  if (splash && !splash.isDestroyed()) splash.webContents.send('boot', { pct, text });
  if (pct >= 100) setTimeout(showMain, 350);
});
// "Last update" on the home screen: the newest launcher release on GitHub
ipcMain.handle('news', async () => {
  try {
    const r = await net.fetch('https://api.github.com/repos/Kypersw/craftrank-launcher/releases/latest', { headers: { 'User-Agent': 'CraftRankLauncher', Accept: 'application/vnd.github+json' } });
    if (!r.ok) return { ok: false };
    const j = await r.json();
    const body = String(j.body || '').split(/\r?\n\s*\r?\n/)[0].replace(/\*\*|__|`|#+ |\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    const version = String(j.tag_name || '').replace(/^v/i, '');
    return { ok: true, title: j.name || j.tag_name || 'CraftRank Launcher', date: j.published_at || '', body, url: j.html_url, version: /^\d+\.\d+\.\d+$/.test(version) ? version : '' };
  } catch (e) { return { ok: false }; }
});
app.setName('CraftRank Launcher');
if (process.platform === 'win32') app.setAppUserModelId('org.craftrank.launcher');   // taskbar groups it as CraftRank, with its icon
// the portable .exe unpacks each version once into "CraftRank Launcher Portable\<version>" (build/portable.nsi):
// remove the folders of older versions, a while after start
function cleanPortable() {
  if (!process.env.PORTABLE_EXECUTABLE_FILE) return;
  const mine = path.dirname(process.execPath), root = path.dirname(mine);
  if (path.basename(root) !== 'CraftRank Launcher Portable') return;
  let names = []; try { names = fs.readdirSync(root); } catch (e) { return; }
  for (const n of names) {
    const dir = path.join(root, n);
    if (dir === mine || !/^\d+\.\d+\.\d+$/.test(n)) continue;
    try { fs.rmSync(path.join(dir, '.ready'), { force: true }); fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

app.whenReady().then(() => {
  if (swapping) return;
  setTimeout(cleanPortable, 60000);
  // the launcher needs no browser permissions (camera, microphone, notifications, location…): refuse them all
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow(); startPresence();
});
// no window may ever be created with other settings (for example by a page asking for a webview)
app.on('web-contents-created', (e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});
app.on('window-all-closed', () => { servers.stopAll(); discord.stop(); app.quit(); });

/* Discord status: "In the launcher" or "Playing on <server>", with buttons to the server page and the launcher */
let site = { logo: '', page: '' };
function presence(kind, extra) {
  if (!readSettings().discord) return;
  discord.show(Object.assign({ kind, logo: site.logo, launcherUrl: site.page }, extra || {}));
}
async function startPresence() {
  const s = readSettings();
  discord.setEnabled(s.discord !== false);
  const cfg = await account.config();
  if (!cfg.ok) { setTimeout(startPresence, 60000); return; }   // offline: try again in a minute
  site = { logo: cfg.logo || '', page: cfg.launcher_page || '' };
  discord.setApp(cfg.discord_app || '');
  presence('menu');
}
// closing the loading window before the launcher opens quits too
app.on('browser-window-created', (e, w) => w.on('closed', () => { if (w === splash && win && !win.isDestroyed() && !win.isVisible()) app.quit(); }));

/* window and settings */
ipcMain.handle('win', (e, a) => { const w = BrowserWindow.fromWebContents(e.sender) || win; if (a === 'min') w.minimize(); else if (a === 'close') w.close(); });
ipcMain.handle('open', (e, url) => { safeOpen(url); });
ipcMain.handle('settings:get', () => readSettings());
// only known settings, each with its own type, are saved
const SETTING_TYPES = { username: 'string', mc: 'string', loader: 'string', loaderVersion: 'string', pack: 'string', playAs: 'string', playAsChosen: 'boolean',
  performance: 'boolean', showSnapshots: 'boolean', showOld: 'boolean', memory: 'number', closeOnPlay: 'boolean', updSnooze: 'object', discord: 'boolean', skinsOnServers: 'boolean', theme: 'string', boost: 'boolean', boostStamp: 'number', stats: 'boolean' };
ipcMain.handle('settings:set', (e, s) => {
  const cur = readSettings();
  for (const [k, v] of Object.entries(s && typeof s === 'object' ? s : {})) {
    if (SETTING_TYPES[k] !== typeof v || v === null) continue;
    if (typeof v === 'string' && v.length > 120) continue;
    if (k === 'memory' && !(v >= 512 && v <= 65536)) continue;
    if (k === 'updSnooze') { cur[k] = { ver: String(v.ver || '').slice(0, 20), until: +v.until || 0 }; continue; }
    cur[k] = v;
  }
  writeSettings(cur);
  if (s && typeof s.discord === 'boolean') { discord.setEnabled(cur.discord); if (cur.discord) presence('menu'); }
  return cur;
});
ipcMain.handle('folder', (e, which) => { const p = which === 'servers' ? path.join(ROOT, 'servers') : ROOT; fs.mkdirSync(p, { recursive: true }); shell.openPath(p); });
ipcMain.handle('info', () => ({ version: app.getVersion(), ram: Math.floor(os.totalmem() / 1048576), site: SITE, selfUpdate: updater.mode() !== 'dev' }));
/* update the launcher in place (see updater.js) */
let updating = false;
ipcMain.handle('update:run', async () => {
  if (updating) return { ok: false, error: 'Already updating.' };
  if (running) return { ok: false, error: 'Close Minecraft first, then update.' };
  updating = true;
  try { const r = await updater.run((st) => send('update', st)); return Object.assign({ ok: true }, r); }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
  finally { updating = false; }
});

/* site data, cached for when the internet is down */
ipcMain.handle('feed', async () => {
  const cache = path.join(app.getPath('userData'), 'feed.json');
  const r = await account.feed();
  const keep = (f) => { feedLinks = new Set((f.ads || []).map((x) => { try { return new URL(x.url).href; } catch (e) { return ''; } }).filter(Boolean)); return f; };
  if (r.ok) { try { fs.writeFileSync(cache, JSON.stringify(r)); } catch (e) {} return keep(r); }
  try { return keep(Object.assign(JSON.parse(fs.readFileSync(cache, 'utf8')), { offline: true, why: r.error })); } catch (e) { return { servers: [], resources: [], offline: true, why: r.error }; }
});
// the last good config and profile, so the launcher can open at once and refresh behind
const cacheFile = (n) => path.join(app.getPath('userData'), n + '.json');
const readCache = (n) => { try { return JSON.parse(fs.readFileSync(cacheFile(n), 'utf8')); } catch (e) { return null; } };
const writeCache = (n, v) => { try { if (v) fs.writeFileSync(cacheFile(n), JSON.stringify(v)); else fs.rmSync(cacheFile(n), { force: true }); } catch (e) {} };
ipcMain.handle('config', async () => { const r = await account.config(); if (r.ok) writeCache('config', r); return r; });
ipcMain.handle('boot:cache', () => {
  const feed = readCache('feed');
  if (feed) feedLinks = new Set((feed.ads || []).map((x) => { try { return new URL(x.url).href; } catch (e) { return ''; } }).filter(Boolean));
  return { feed, config: readCache('config'), me: account.signedIn() ? readCache('me') : null };
});

/* account and store */
ipcMain.handle('acct:me', async () => {
  const r = await account.me();
  if (r.ok) writeCache('me', r); else if (r.status === 401 || r.error === 'signed_out') writeCache('me', null);
  return r;
});
ipcMain.handle('acct:login', (e, l, p) => account.login(String(l || ''), String(p || '')));
ipcMain.handle('acct:logout', async () => { writeCache('me', null); return account.logout(); });
ipcMain.handle('acct:name', (e, n) => account.setName(String(n || '')));
/* skins: from a file, dropped in, copied from a Minecraft name; the last few are kept here to switch back */
const SKINS = path.join(app.getPath('userData'), 'skins');
function pngSize(b) {   // a skin is a 64×64 or 64×32 PNG
  if (!Buffer.isBuffer(b) || b.length < 33 || b.length > 512 * 1024 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const isSkin = (b) => { const s = pngSize(b); return !!s && s.w === 64 && (s.h === 64 || s.h === 32); };
function skinIndex() { try { const j = JSON.parse(fs.readFileSync(path.join(SKINS, 'index.json'), 'utf8')); return Array.isArray(j.list) ? j : { list: [], current: '' }; } catch (e) { return { list: [], current: '' }; } }
function skinIndexSave(j) { fs.mkdirSync(SKINS, { recursive: true }); fs.writeFileSync(path.join(SKINS, 'index.json'), JSON.stringify(j)); }
function skinKeep(buf, slim) {
  try {
    const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16), j = skinIndex();
    fs.mkdirSync(SKINS, { recursive: true }); fs.writeFileSync(path.join(SKINS, id + '.png'), buf);
    j.list = [{ id, slim: !!slim, at: Date.now() }, ...j.list.filter((s) => s.id !== id)];
    j.list.slice(12).forEach((s) => { try { fs.unlinkSync(path.join(SKINS, s.id + '.png')); } catch (e) {} });
    j.list = j.list.slice(0, 12); j.current = id; skinIndexSave(j);
  } catch (e) {}
}
async function skinUpload(buf, slim) {
  if (!isSkin(buf)) return { ok: false, error: 'That is not a Minecraft skin: it has to be a 64×64 or 64×32 PNG.' };
  const r = await account.uploadSkinBytes(buf, !!slim);
  if (r.ok) skinKeep(buf, slim);
  return r;
}
async function getBuf(url, max) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > max) throw new Error('too big');
  return b;
}
ipcMain.handle('acct:skin', safe(async (e, slim) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a skin', filters: [{ name: 'Skin (PNG)', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  return skinUpload(fs.readFileSync(r.filePaths[0]), slim);
}));
ipcMain.handle('acct:skinData', safe(async (e, data, slim) => skinUpload(Buffer.from(data || []), slim)));
ipcMain.handle('acct:skinFromName', safe(async (e, name) => {
  name = String(name || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, error: 'Type a Minecraft name: 3 to 16 letters, numbers or _.' };
  let id;
  try { id = JSON.parse((await getBuf('https://api.mojang.com/users/profiles/minecraft/' + name, 65536)).toString()).id; } catch (er) { if (er.status === 404 || er.status === 204) return { ok: false, error: 'No Minecraft player is called ' + name + '.' }; }
  if (!id) return { ok: false, error: 'No Minecraft player is called ' + name + '. Check the spelling.' };
  let tex;
  try {
    const p = JSON.parse((await getBuf('https://sessionserver.mojang.com/session/minecraft/profile/' + id, 65536)).toString());
    tex = JSON.parse(Buffer.from((p.properties || []).find((x) => x.name === 'textures').value, 'base64').toString()).textures.SKIN;
  } catch (er) { return { ok: false, error: 'Could not reach Minecraft to get the skin. Try again in a minute.' }; }
  if (!tex || !/^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/.test(tex.url)) return { ok: false, error: name + ' uses the default skin, there is nothing to copy.' };
  const buf = await getBuf(tex.url.replace(/^http:/, 'https:'), 512 * 1024);
  return skinUpload(buf, !!(tex.metadata && tex.metadata.model === 'slim'));
}));
ipcMain.handle('acct:skinArms', safe(async (e, slim) => {   // the arms belong to the skin file, so the current one goes up again
  const j = skinIndex(), cur = j.list.find((s) => s.id === j.current);
  if (!cur) return { ok: false, none: true };
  const r = await account.uploadSkinBytes(fs.readFileSync(path.join(SKINS, cur.id + '.png')), !!slim);
  if (r.ok) { cur.slim = !!slim; skinIndexSave(j); }
  return r;
}));
ipcMain.handle('skins', safe(async (e, act, id) => {
  const j = skinIndex(); id = String(id || '');
  if (act === 'list') {
    const me = await account.me().catch(() => null);   // a skin changed elsewhere (site, other PC) is not "in use" any more
    const list = j.list.map((s) => { try { return { id: s.id, slim: s.slim, current: s.id === j.current, data: 'data:image/png;base64,' + fs.readFileSync(path.join(SKINS, s.id + '.png')).toString('base64') }; } catch (er) { return null; } }).filter(Boolean);
    if (me && me.ok && !(me.profile && me.profile.skin)) list.forEach((s) => { s.current = false; });
    return { ok: true, list };
  }
  const s = j.list.find((x) => x.id === id); if (!s) return { ok: false, error: 'That skin is gone.' };
  if (act === 'remove') { j.list = j.list.filter((x) => x !== s); if (j.current === id) j.current = ''; try { fs.unlinkSync(path.join(SKINS, id + '.png')); } catch (er) {} skinIndexSave(j); return { ok: true }; }
  if (act === 'use') return skinUpload(fs.readFileSync(path.join(SKINS, id + '.png')), s.slim);
  return { ok: false };
}));
ipcMain.handle('acct:skinReset', async () => { const r = await account.resetSkin(); if (r.ok) { const j = skinIndex(); j.current = ''; skinIndexSave(j); } return r; });
/* pictures for the 3D view: only from CraftRank and Minecraft, as data the page may draw with WebGL */
const texMem = new Map();
ipcMain.handle('tex', safe(async (e, url) => {
  let u; try { u = new URL(String(url)); } catch (er) { return null; }
  const host = u.hostname.replace(/^www\./, ''), site = new URL(SITE).hostname.replace(/^www\./, '');
  if (!['https:', 'http:'].includes(u.protocol) || (host !== site && host !== 'textures.minecraft.net')) return null;
  if (texMem.has(u.href)) return texMem.get(u.href);
  const b = await getBuf(u.href, 12 * 1024 * 1024);
  if (!pngSize(b)) return null;
  const d = 'data:image/png;base64,' + b.toString('base64');
  if (texMem.size > 60) texMem.delete(texMem.keys().next().value);
  texMem.set(u.href, d);
  return d;
}));
ipcMain.handle('store', () => account.store());
ipcMain.handle('store:equip', (e, kind, id, on) => account.equip(['skin', 'overlay'].includes(kind) ? kind : 'cape', id ? +id : 0, on !== false));
/* CraftRank Premium: the payment page (Creem) opens in the browser */
ipcMain.handle('premium', () => account.premium());
ipcMain.handle('premium:buy', safe(async (e, plan) => {
  const r = await account.premiumBuy(plan === 'year' ? 'year' : 'month');
  if (!r.ok) return r;
  let u; try { u = new URL(String(r.url)); } catch (x) { return { ok: false, error: 'The payment page could not be opened.' }; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !(h === 'creem.io' || h.endsWith('.creem.io'))) return { ok: false, error: 'The payment page could not be opened.' };
  shell.openExternal(u.href);
  return { ok: true };
}));
ipcMain.handle('wardrobe', (e, act, arg) => {
  if (act === 'save') return account.outfitSave(String(arg || '').slice(0, 40));
  if (act === 'wear') return account.outfitWear(+arg || 0);
  if (act === 'delete') return account.outfitDelete(+arg || 0);
  return account.outfits();
});

/* versions and loaders */
ipcMain.handle('versions', safe(async () => {
  const list = await game.versionList();
  return { ok: true, latest: list.latest, versions: list.versions.map((v) => ({ id: v.id, type: v.type })) };
}));
ipcMain.handle('catalog', safe(async () => ({ ok: true, data: await game.catalog() })));
ipcMain.handle('loaderVersions', safe(async (e, loader, mc) => ({ ok: true, versions: await game.loaderVersions(loader, mc) })));

function skinNote(k) {
  if (!k || k.on) return '';
  if (k.reason === 'loader') return 'CraftRank skins show on servers with Fabric, Quilt, Forge or NeoForge versions. With OptiFine, pick Fabric with the OptiFine features to see them.';
  if (k.reason === 'optifine') return 'With OptiFine, CraftRank skins on servers do not work on this Minecraft version. Pick Fabric with the OptiFine features to see them.';
  if (k.reason === 'version') return 'CraftRank skins on servers are not out for this Minecraft version yet.';
  if (k.reason === 'download') return 'CraftRank skins on servers are off this time: the skin mod could not be downloaded.';
  return '';
}
/* CraftBoost: what kind of PC this is (memory, processor, graphics card) */
let boostInfo = null;
async function boostTier() {
  if (boostInfo) return boostInfo;
  const ram = Math.round(os.totalmem() / 1073741824), cores = os.cpus().length;
  let gpu = '', vendor = '';
  try {
    const g = await app.getGPUInfo('complete');
    const dev = (g.gpuDevice || []).find((d) => d.active) || (g.gpuDevice || [])[0] || {};
    vendor = { 4318: 'nvidia', 4098: 'amd', 32902: 'intel' }[dev.vendorId] || '';
    gpu = String((g.auxAttributes && g.auxAttributes.glRenderer) || dev.deviceString || '').replace(/^ANGLE \(|\)$/g, '').replace(/,? ?Direct3D.*$/i, '').slice(0, 80);
  } catch (e) {}
  const dedicated = vendor === 'nvidia' || vendor === 'amd' && !/Radeon\(TM\) (Graphics|Vega \d)|Radeon Graphics/i.test(gpu);
  const tier = ram < 8 || !dedicated && cores < 6 ? 'low' : ram >= 16 && dedicated && cores >= 6 ? 'high' : 'mid';
  boostInfo = { tier, ram, cores, gpu, vendor };
  return boostInfo;
}
ipcMain.handle('boost:info', async () => Object.assign({ on: readSettings().boost !== false }, await boostTier()));

/* play */
ipcMain.handle('play', async (e, opts) => {
  if (busy) return { ok: false, error: 'Already starting the game.' };
  if (running) return { ok: false, error: 'Minecraft is already running.' };
  const s = readSettings();
  busy = true; barNow = 0; lastSent = '';
  try {
    const me = account.signedIn() ? await account.me() : { ok: false };
    let acct, skinServer = null;
    if ((opts.playAs || s.playAs) === 'craftrank') {
      if (!(me.ok && me.profile)) return { ok: false, error: 'Sign in to CraftRank and pick your in-game name to play with your CraftRank skin.' };
      acct = { name: me.profile.name, uuid: me.profile.uuid, token: me.profile.uuid, type: 'mojang' };
      const cfg = await account.config();
      skinServer = cfg.ok ? cfg.skin_server : SITE + '/api/ygg/';
    } else {
      const name = String(opts.username || s.username || '').trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, error: 'Pick a username: 3 to 16 letters, numbers or _.' };
      acct = { name, uuid: offlineUuid(name), token: offlineUuid(name), type: 'legacy' };
    }
    let pack = opts.pack !== undefined ? opts.pack : s.pack;
    // CraftBoost: performance mods on Fabric, Quilt and NeoForge, FPS settings once per version, Java flags
    const boost = s.boost !== false ? { tier: (await boostTier()).tier, stamp: +s.boostStamp || 0 } : null;
    if (boost && (!pack || pack === 'none')) pack = 'perf';
    const mc = opts.mc || s.mc || (await game.versionList()).latest.release;
    // CraftRank skins on servers (see game.syncSkinMod): the skin server from the site, also when playing offline
    let skinRoot = '';
    if (s.skinsOnServers !== false) { const cfg = await account.config(); skinRoot = cfg.ok && cfg.skin_server ? cfg.skin_server : SITE.replace(/\/+$/, '') + '/api/ygg/'; }
    const prep = await game.prepare(ROOT, { mc, loader: opts.loader || s.loader, loaderVersion: opts.loaderVersion || s.loaderVersion || '', pack, force: !!opts.force, skinRoot, boost }, progress);
    progress('Starting Minecraft', 100);
    // Modded versions (OptiFine, Forge, Fabric…) run out of memory below 2 GB: the game freezes
    // when it reloads resources (for example after leaving the video settings) and ends with code 1.
    const ram = Math.floor(os.totalmem() / 1048576), picked = opts.loader || s.loader || 'vanilla', loader = prep.loader || picked;
    // CraftBoost: modded versions get at least 3 GB (4 GB with 16 GB of memory or more), never over 60% of the PC
    const floor = loader === 'vanilla' ? 1024 : boost ? (ram >= 15000 ? 4096 : ram >= 7500 ? 3072 : 2048) : 2048;
    const memory = Math.min(Math.max(s.memory, floor), Math.max(1024, Math.floor(ram * 0.6 / 512) * 512));
    const srv = opts.server && typeof opts.server.host === 'string' ? opts.server : null;
    running = await game.start(ROOT, prep, acct, { memory, server: srv ? { host: srv.host, port: +srv.port || 25565 } : null, skinServer, skinRoot, boost: !!boost });
    const sid = crypto.randomBytes(8).toString('hex'), t0 = Date.now(), pc = await boostTier();
    stat({ type: 'start', sid, mc, loader: picked, boost: boost ? boost.tier : '', server: srv ? String(srv.host).slice(0, 100) : '',
      os: winName(), ram: pc.ram, alloc: memory, cores: pc.cores, gpu: pc.vendor || 'other' });
    presence('play', {
      since: Date.now(), version: 'Minecraft ' + mc + (picked !== 'vanilla' ? ' · ' + picked[0].toUpperCase() + picked.slice(1) : ''),
      server: srv ? { name: String(srv.name || srv.host).slice(0, 60), address: srv.host + (+srv.port && +srv.port !== 25565 ? ':' + +srv.port : ''), icon: srv.icon, url: srv.url } : null,
    });
    send('game', { running: true, note: running.skinsOff ? 'Skins are off this time: the skin helper could not be downloaded. Check your connection and start again.' : (prep.pack && prep.pack.reason ? prep.pack.reason : (opts.server ? skinNote(prep.skins) : '')) });
    let log = '';
    // Read everything the game prints. If one of its output pipes is never read, it fills up
    // (64 KB on Windows) and the game freezes the next time it writes a log line.
    const logFile = path.join(prep.instDir, 'logs', 'launcher-output.log');
    let out = null;
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); out = fs.createWriteStream(logFile); } catch (e) {}
    const take = (d) => { log = (log + d).slice(-6000); if (out) out.write(d); };
    if (running.stdout) running.stdout.on('data', take);
    if (running.stderr) running.stderr.on('data', take);
    running.on('close', () => { if (out) out.end(); });
    running.on('exit', (code) => { stat({ type: 'end', sid, minutes: Math.round((Date.now() - t0) / 60000), code: typeof code === 'number' ? code : -1 }); running = null; presence('menu'); send('game', { running: false, code, log: code ? log : '', logFile }); if (s.closeOnPlay) app.quit(); else if (win) { win.show(); win.focus(); } });
    if (s.closeOnPlay) win.hide();
    return { ok: true };
  } catch (err) {
    console.error(err);
    stat({ type: 'fail', sid: crypto.randomBytes(8).toString('hex'), mc: String(opts.mc || s.mc || ''), loader: String(opts.loader || s.loader || 'vanilla'), error: noHome(friendly(err)).slice(0, 80) });
    return { ok: false, error: friendly(err) };
  } finally {
    busy = false;
    send('progress', null);
  }
});

/* texture packs (Modrinth), installed into the chosen version's own folder */
const curVer = async (o) => { const s = readSettings(); return { mc: (o && o.mc) || s.mc || (await game.versionList()).latest.release, loader: (o && o.loader) || s.loader || 'vanilla' }; };
ipcMain.handle('packs:search', safe(async (e, q, offset) => { const v = await curVer(); const r = await game.searchPacks(String(q || '').slice(0, 80), v.mc, offset); return Object.assign({ ok: true, mc: v.mc, loader: v.loader, installed: game.packState(ROOT, v.mc, v.loader).st }, r); }));
ipcMain.handle('packs:install', safe(async (e, id) => { const v = await curVer(); const r = await game.installPack(ROOT, v.mc, v.loader, String(id)); return Object.assign({ ok: true }, r); }));
ipcMain.handle('packs:remove', safe(async (e, id) => { const v = await curVer(); game.removePack(ROOT, v.mc, v.loader, String(id)); return { ok: true }; }));
ipcMain.handle('packs:folder', async () => { const v = await curVer(); const d = game.packState(ROOT, v.mc, v.loader).dir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });

/* mods: the list comes from the CraftRank site, the files from Modrinth (checked by SHA-512) */
ipcMain.handle('mods:list', safe(async (e, q, offset) => {
  const v = await curVer();
  const u = SITE.replace(/\/+$/, '') + '/api/launcher.php?r=mods&mc=' + encodeURIComponent(v.mc) + '&loader=' + encodeURIComponent(v.loader)
    + '&q=' + encodeURIComponent(String(q || '').slice(0, 60)) + '&offset=' + Math.max(0, Math.min(5000, offset | 0));
  const r = await game.getJson(u);
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 30).filter((m) => m && /^[A-Za-z0-9]{6,12}$/.test(m.id)).map((m) => ({
    id: m.id, title: String(m.title || ''), about: String(m.about || ''), author: String(m.author || ''), downloads: m.downloads | 0,
    icon: /^https:\/\//.test(m.icon || '') ? m.icon : '', url: /^https:\/\//.test(m.url || '') ? m.url : '', env: String(m.env || ''),
  }));
  return { ok: true, mc: v.mc, loader: v.loader, canMod: !!game.modLoaders(v.loader), total: r.total | 0, items, installed: game.modState(ROOT, v.mc, v.loader).st };
}));
ipcMain.handle('mods:install', safe(async (e, id) => {
  if (busy) return { ok: false, error: 'Wait until the game has started, then try again.' };
  const v = await curVer();
  const r = await game.installMod(ROOT, v.mc, v.loader, String(id), (n) => send('mods:step', { id: String(id), file: n }));
  return Object.assign({ ok: true, installed: game.modState(ROOT, v.mc, v.loader).st }, r);
}));
ipcMain.handle('mods:remove', safe(async (e, id) => { const v = await curVer(); game.removeMod(ROOT, v.mc, v.loader, String(id)); return { ok: true, installed: game.modState(ROOT, v.mc, v.loader).st }; }));
/* ready mod packs (PvP Pack…). A pack on a version without a mod loader switches that version to Fabric first. */
ipcMain.handle('modpacks:list', async () => { const v = await curVer(); return { ok: true, mc: v.mc, loader: v.loader, packs: game.modPackState(ROOT, v.mc, v.loader) }; });
ipcMain.handle('modpacks:install', safe(async (e, id) => {
  if (busy) return { ok: false, error: 'Wait until the game has started, then try again.' };
  let v = await curVer(), switched = false;
  const pk = game.MOD_PACKS.find((p) => p.id === String(id));
  if (!pk) return { ok: false, error: 'Unknown pack.' };
  if (!game.modLoaders(v.loader)) {
    const fab = await game.loaderVersions('fabric', v.mc).catch(() => []);
    if (!fab || !fab.length) return { ok: false, error: 'Fabric is not out for Minecraft ' + v.mc + '. Pick a newer version in the version menu.' };
    writeSettings(Object.assign(readSettings(), { loader: 'fabric', loaderVersion: '' }));
    v = { mc: v.mc, loader: 'fabric' }; switched = true;
  }
  const r = await game.installModPack(ROOT, v.mc, v.loader, pk.id, (name, i, n) => send('mods:step', { id: 'pack:' + pk.id, file: (i + 1) + '/' + n + ' ' + name }));
  return Object.assign({ ok: true, switched, mc: v.mc, loader: v.loader, packs: game.modPackState(ROOT, v.mc, v.loader) }, r);
}));
ipcMain.handle('modpacks:remove', safe(async (e, id) => { const v = await curVer(); game.removeModPack(ROOT, v.mc, v.loader, String(id)); return { ok: true, packs: game.modPackState(ROOT, v.mc, v.loader) }; }));
ipcMain.handle('mods:folder', async () => { const v = await curVer(); const d = game.modState(ROOT, v.mc, v.loader).dir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });

/* my servers */
const sline = (id, line, stopped) => send('srv:line', { id, line, stopped: !!stopped });
ipcMain.handle('srv:types', () => servers.TYPES);
ipcMain.handle('srv:versions', safe(async (e, type) => ({ ok: true, versions: await servers.versionsFor(type) })));
ipcMain.handle('srv:list', () => servers.listServers(ROOT));
ipcMain.handle('srv:create', safe(async (e, opts) => { const s = await servers.createServer(ROOT, opts || {}, (st, p) => send('srv:progress', { stage: st, pct: p })); send('srv:progress', null); return Object.assign({ ok: true }, s); }));
ipcMain.handle('srv:start', safe(async (e, id) => { await servers.startServer(ROOT, id, sline, (st, p) => send('srv:progress', { stage: st, pct: p })); send('srv:progress', null); return { ok: true }; }));
ipcMain.handle('srv:stop', (e, id) => { servers.stopServer(ROOT, id); return { ok: true }; });
ipcMain.handle('srv:cmd', (e, id, c) => { servers.command(id, c); return { ok: true }; });
ipcMain.handle('srv:log', (e, id) => servers.logOf(id));
ipcMain.handle('srv:remove', safe(async (e, id) => { servers.removeServer(ROOT, id); return { ok: true }; }));
ipcMain.handle('srv:open', (e, id) => { const s = servers.listServers(ROOT).find((x) => x.id === id); if (s) shell.openPath(s.dir); });
