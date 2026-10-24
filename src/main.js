// CraftRank Launcher: main process.
const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
app.setName('CraftRank Launcher');
if (process.platform === 'win32') app.setAppUserModelId('org.craftrank.launcher');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

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
const SITE = process.env.CRAFTRANK_SITE || 'https://craftrank.org';
const ROOT = path.join(app.getPath('appData'), '.craftrank');           // game files live here, apart from .minecraft
const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
const account = require('./account')(SITE, path.join(app.getPath('userData'), 'session.bin'), app.getVersion());

let win = null;
let running = null;     // the Minecraft process
let busy = false;

function readSettings() {
  const ram = Math.floor(os.totalmem() / 1048576);
  const def = { username: '', mc: '', loader: 'vanilla', loaderVersion: '', pack: 'none', playAs: 'offline', performance: false, showSnapshots: false, showOld: false,
    memory: Math.min(4096, Math.max(ram >= 6000 ? 2048 : 1024, Math.floor(ram / 4 / 512) * 512)), closeOnPlay: false };
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // shown when the page says it is ready (or after 20 s, whatever happens)
  const fallback = setTimeout(showMain, 20000);
  win.once('show', () => clearTimeout(fallback));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
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
    return { ok: true, title: j.name || j.tag_name || 'CraftRank Launcher', date: j.published_at || '', body, url: j.html_url };
  } catch (e) { return { ok: false }; }
});
app.setName('CraftRank Launcher');
if (process.platform === 'win32') app.setAppUserModelId('org.craftrank.launcher');   // taskbar groups it as CraftRank, with its icon
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { servers.stopAll(); app.quit(); });
// closing the loading window before the launcher opens quits too
app.on('browser-window-created', (e, w) => w.on('closed', () => { if (w === splash && win && !win.isDestroyed() && !win.isVisible()) app.quit(); }));

/* window and settings */
ipcMain.handle('win', (e, a) => { const w = BrowserWindow.fromWebContents(e.sender) || win; if (a === 'min') w.minimize(); else if (a === 'close') w.close(); });
ipcMain.handle('open', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (e, s) => { const cur = Object.assign(readSettings(), s); writeSettings(cur); return cur; });
ipcMain.handle('folder', (e, which) => { const p = which === 'servers' ? path.join(ROOT, 'servers') : ROOT; fs.mkdirSync(p, { recursive: true }); shell.openPath(p); });
ipcMain.handle('info', () => ({ version: app.getVersion(), ram: Math.floor(os.totalmem() / 1048576), site: SITE }));

/* site data, cached for when the internet is down */
ipcMain.handle('feed', async () => {
  const cache = path.join(app.getPath('userData'), 'feed.json');
  const r = await account.feed();
  if (r.ok) { try { fs.writeFileSync(cache, JSON.stringify(r)); } catch (e) {} return r; }
  try { return Object.assign(JSON.parse(fs.readFileSync(cache, 'utf8')), { offline: true, why: r.error }); } catch (e) { return { servers: [], resources: [], offline: true, why: r.error }; }
});
ipcMain.handle('config', () => account.config());

/* account and store */
ipcMain.handle('acct:me', () => account.me());
ipcMain.handle('acct:login', (e, l, p) => account.login(String(l || ''), String(p || '')));
ipcMain.handle('acct:logout', () => account.logout());
ipcMain.handle('acct:name', (e, n) => account.setName(String(n || '')));
ipcMain.handle('acct:skin', safe(async (e, slim) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a skin', filters: [{ name: 'Skin (PNG)', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  return account.uploadSkin(r.filePaths[0], !!slim);
}));
ipcMain.handle('acct:skinReset', () => account.resetSkin());
ipcMain.handle('store', () => account.store());
ipcMain.handle('store:equip', (e, kind, id) => account.equip(kind === 'skin' ? 'skin' : 'cape', id ? +id : 0));

/* versions and loaders */
ipcMain.handle('versions', safe(async () => {
  const list = await game.versionList();
  return { ok: true, latest: list.latest, versions: list.versions.map((v) => ({ id: v.id, type: v.type })) };
}));
ipcMain.handle('catalog', safe(async () => ({ ok: true, data: await game.catalog() })));
ipcMain.handle('loaderVersions', safe(async (e, loader, mc) => ({ ok: true, versions: await game.loaderVersions(loader, mc) })));

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
    const pack = opts.pack !== undefined ? opts.pack : s.pack;
    const mc = opts.mc || s.mc || (await game.versionList()).latest.release;
    const prep = await game.prepare(ROOT, { mc, loader: opts.loader || s.loader, loaderVersion: opts.loaderVersion || s.loaderVersion || '', pack, force: !!opts.force }, progress);
    progress('Starting Minecraft', 100);
    // Modded versions (OptiFine, Forge, Fabric…) run out of memory below 2 GB: the game freezes
    // when it reloads resources (for example after leaving the video settings) and ends with code 1.
    const ram = Math.floor(os.totalmem() / 1048576), loader = opts.loader || s.loader || 'vanilla';
    const memory = Math.min(Math.max(s.memory, loader === 'vanilla' ? 1024 : 2048), Math.max(1024, Math.floor(ram * 0.6 / 512) * 512));
    running = await game.start(ROOT, prep, acct, { memory, server: opts.server, skinServer });
    send('game', { running: true, note: prep.pack && prep.pack.reason ? prep.pack.reason : '' });
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
    running.on('exit', (code) => { running = null; send('game', { running: false, code, log: code ? log : '', logFile }); if (s.closeOnPlay) app.quit(); else if (win) { win.show(); win.focus(); } });
    if (s.closeOnPlay) win.hide();
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: friendly(err) };
  } finally {
    busy = false;
    send('progress', null);
  }
});

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
