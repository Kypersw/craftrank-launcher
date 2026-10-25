// Installing and starting Minecraft: every version (releases, snapshots, beta, alpha),
// mod loaders (Fabric, Quilt, Forge, NeoForge), the Sodium + Iris performance pack,
// Java runtimes and the CraftRank skin agent (authlib-injector).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { net } = require('electron');
const { launch, Version, MinecraftFolder } = require('@xmcl/core');
const {
  getVersionList, installTask, installDependenciesTask, installJavaRuntimeTask, fetchJavaRuntimeManifest,
  getFabricLoaderArtifact, installFabric, installQuiltVersion, installForge, installNeoForged, installOptifine,
} = require('@xmcl/installer');

const UA = { 'User-Agent': 'CraftRankLauncher (craftrank.org)' };

// Downloads: the installer starts every file of a version at once (4,000+ assets), and without a limit
// that opens thousands of connections, which Mojang's servers slow down and reset. A fixed pool of
// kept-alive connections per host is much faster. Files already on disk are checked by size only.
const { Agent, ProxyAgent } = require('undici');
const pool = { connections: 48, pipelining: 1, keepAliveTimeout: 30000, connect: { timeout: 20000 }, headersTimeout: 30000, bodyTimeout: 60000 };
const px = process.env.HTTPS_PROXY || process.env.https_proxy;
const dispatcher = px ? new ProxyAgent(Object.assign({ uri: px }, pool)) : new Agent(pool);
const DL = { agent: { dispatcher }, prevalidSizeOnly: true };
const LOADERS = ['vanilla', 'optifine', 'forge-optifine', 'fabric', 'quilt', 'forge', 'neoforge'];

let manifestCache = null;
async function versionList() {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60 * 1000) return manifestCache.list;
  const list = await getVersionList();
  manifestCache = { at: Date.now(), list };
  return list;
}

async function getJson(url) {
  const r = await net.fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).host);
  return r.json();
}

/**
 * Downloads a file. With expect = { sha1 | sha256 | sha512: hex } the file is checked before it is kept:
 * a file that does not match is thrown away, so a changed or broken download never runs.
 */
async function download(url, file, onPct, expect) {
  if (!/^https:\/\//.test(url)) throw new Error('Download failed (not a secure link)');
  const r = await net.fetch(url, { headers: UA });
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const total = +r.headers.get('content-length') || 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  const algo = expect && ['sha512', 'sha256', 'sha1', 'md5'].find((a) => typeof expect[a] === 'string' && /^[a-f0-9]{32,128}$/i.test(expect[a]));
  // a .jar is run by Java: it is only kept when it matches a published checksum (OptiFine, which publishes none, is checked in downloadOptifine)
  if (/\.jar$/i.test(file) && !algo && !(expect && expect.optifine)) throw new Error('Download failed (no checksum to check the file against).');
  const hash = algo ? crypto.createHash(algo) : null;
  let got = 0;
  for await (const chunk of r.body) {
    out.write(chunk); got += chunk.length;
    if (hash) hash.update(chunk);
    if (onPct && total) onPct(Math.round(got / total * 100));
  }
  await new Promise((ok, no) => { out.end(); out.on('finish', ok); out.on('error', no); });
  if (hash && hash.digest('hex') !== expect[algo].toLowerCase()) {
    try { fs.unlinkSync(tmp); } catch (e) {}
    throw new Error('Download failed (the file did not match its checksum). Try again.');
  }
  fs.renameSync(tmp, file);
  return file;
}
/** A file name from a download list, safe to use inside one folder (no folders, no odd characters). */
const safeName = (n) => path.basename(String(n || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '_') || 'file';
const OPTIFINE_FILE = /^(preview_)?OptiFine_[0-9.]+_[A-Za-z0-9_.-]+\.jar$/;

/**
 * Assets, fetched before the installer runs: thousands of small files over a fixed set of kept-alive
 * connections, each checked against its SHA-1. The installer then finds them on disk and skips them.
 * (Its own downloader opens a new connection per file, which is slow.) Files that fail here are left
 * for the installer to try again.
 */
async function fetchAssets(root, vj, onBytes) {
  if (!vj.assetIndex || !vj.assetIndex.url) return;
  const { request } = require('undici');
  const idxFile = path.join(root, 'assets', 'indexes', vj.assetIndex.id + '.json');
  let idx;
  try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) {
    idx = await getJson(vj.assetIndex.url);
    fs.mkdirSync(path.dirname(idxFile), { recursive: true }); fs.writeFileSync(idxFile, JSON.stringify(idx));
  }
  const todo = [];
  for (const o of Object.values(idx.objects || {})) {
    const f = path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash);
    let size = -1; try { size = fs.statSync(f).size; } catch (e) {}
    if (size === o.size) onBytes(o.size); else todo.push({ o, f });
  }
  const seen = new Set();
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const { o, f } = todo[i++];
      if (seen.has(o.hash)) { onBytes(o.size); continue; } seen.add(o.hash);
      for (let tries = 0; tries < 3; tries++) {
        try {
          const r = await request('https://resources.download.minecraft.net/' + o.hash.slice(0, 2) + '/' + o.hash, { dispatcher, headers: UA, headersTimeout: 20000, bodyTimeout: 30000 });
          if (r.statusCode !== 200) { await r.body.dump(); throw new Error('HTTP ' + r.statusCode); }
          const buf = Buffer.from(await r.body.arrayBuffer());
          if (crypto.createHash('sha1').update(buf).digest('hex') !== o.hash) throw new Error('bad hash');
          await fs.promises.mkdir(path.dirname(f), { recursive: true });
          await fs.promises.writeFile(f, buf);
          onBytes(o.size);
          break;
        } catch (e) { if (tries === 2) break; }
      }
    }
  }
  await Promise.all(Array.from({ length: 24 }, worker));
}

/** " · 120 / 480 MB · 6.2 MB/s" for the progress line. */
function speedMeter() {
  let at = Date.now(), from = 0, rate = 0, text = '';
  return (done, total) => {
    const now = Date.now();
    if (now - at >= 1000) { rate = (done - from) / ((now - at) / 1000); at = now; from = done; }
    const mb = (b) => (b / 1048576).toFixed(0);
    text = ' · ' + mb(done) + ' / ' + mb(total) + ' MB' + (rate > 0 ? ' · ' + (rate / 1048576).toFixed(1) + ' MB/s' : '');
    return text;
  };
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/* ---------- OptiFine ----------
 * OptiFine may not be redistributed, so the launcher fetches it from optifine.net on the player's PC,
 * the same way the OptiFine website hands it out. The list comes from optifine.net/downloads;
 * BMCLAPI's mirror list is the fallback when that page cannot be read.
 */
let ofCache = null;
async function getText(url) {
  const r = await net.fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).host);
  return r.text();
}
async function optifineList() {
  if (ofCache && Date.now() - ofCache.at < 30 * 60 * 1000) return ofCache.map;
  const map = {};
  const add = (mc, file, forge) => { mc = mc.replace(/^(\d+\.\d+)\.0$/, '$1'); (map[mc] = map[mc] || []).push({ file, name: file.replace(/^(preview_)?OptiFine_[^_]+_/, '').replace(/\.jar$/, '').replace(/_/g, ' '), preview: /^preview_/.test(file), forge: forge || '' }); };
  try {
    const html = await getText('https://optifine.net/downloads');
    const seen = new Set();
    const rows = html.split(/<tr class=['"]downloadLine/).slice(1);
    for (const row of rows) {
      const f = /adloadx\?f=((?:preview_)?OptiFine_([0-9.]+)_[^'"&]+?\.jar)/.exec(row);
      if (!f || seen.has(f[1])) continue; seen.add(f[1]);
      const fg = /colForge['"][^>]*>([^<]*)</.exec(row);
      add(f[2], f[1], fg ? fg[1].trim() : '');
    }
  } catch (e) {}
  if (!Object.keys(map).length) {
    const list = await getJson('https://bmclapi2.bangbang93.com/optifine/versionList');
    list.sort((a, b) => String(b._id).localeCompare(String(a._id)));   // newest first, like the OptiFine page
    for (const v of list) add(v.mcversion, v.filename, v.forge || '');
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => a.preview - b.preview);   // stable builds first, page order is newest first
  ofCache = { at: Date.now(), map };
  return map;
}
async function downloadOptifine(root, file, progress) {
  if (!OPTIFINE_FILE.test(String(file)) || /\.\./.test(file)) throw new Error('Pick an OptiFine version from the list.');
  const dest = path.join(root, 'optifine', file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) { checkOptifine(root, file, dest); return dest; }
  progress('Downloading OptiFine', 0);
  let url = null;
  try {
    const page = await getText('https://optifine.net/adloadx?f=' + encodeURIComponent(file));
    const m = /href=['"](downloadx\?f=[^'"]+)['"]/.exec(page);
    if (m) url = 'https://optifine.net/' + m[1].replace(/&amp;/g, '&');
  } catch (e) {}
  // only from optifine.net itself (OptiFine publishes no checksums, so no third-party mirrors)
  if (!url || !/^https:\/\/optifine\.net\/downloadx\?f=[^\s]+$/.test(url)) throw new Error('Could not download OptiFine from optifine.net. Try again in a minute.');
  await download(url, dest, (p) => progress('Downloading OptiFine', p), { optifine: true });
  checkOptifine(root, file, dest);
  return dest;
}

/**
 * OptiFine publishes no checksums. A downloaded jar must be a real OptiFine jar (a zip with OptiFine's
 * classes), and the first good copy of each build is remembered by SHA-256: a later download of the same
 * build that differs is refused.
 */
function checkOptifine(root, file, dest) {
  const buf = fs.readFileSync(dest);
  const bad = () => { try { fs.unlinkSync(dest); } catch (e) {} throw new Error('The OptiFine download was not a valid OptiFine file. Try again.'); };
  if (buf.length < 100000 || buf.readUInt32LE(0) !== 0x04034b50 || !buf.includes('net/optifine/')) bad();
  const known = path.join(root, 'optifine-hashes.json');
  let k = {}; try { k = JSON.parse(fs.readFileSync(known, 'utf8')); } catch (e) {}
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  if (k[file] && k[file] !== h) bad();
  if (!k[file]) { k[file] = h; fs.writeFileSync(known, JSON.stringify(k, null, 1)); }
}

/** The Forge build OptiFine was made for ("Forge 52.0.16" or "Forge #2847"), else Forge's own pick. */
async function forgeForOptifine(mc, file) {
  try {
    const want = (((await optifineList())[mc] || []).find((x) => x.file === file) || {}).forge || '';
    const m = /Forge\s+#?([0-9.]+)/i.exec(want);
    if (m) {
      const all = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'))[mc] || [];
      const hit = all.map((v) => v.slice(mc.length + 1)).find((v) => v === m[1] || v.endsWith('.' + m[1]));
      if (hit) return hit;
    }
  } catch (e) {}
  return (await loaderVersions('forge', mc))[0];
}

/** Which Minecraft versions each loader supports, for the version list. */
let catCache = null;
async function catalog() {
  if (catCache && Date.now() - catCache.at < 30 * 60 * 1000) return catCache.data;
  const safeGet = (fn) => fn().catch(() => null);
  const [of, forge, fabric, quilt, neo] = await Promise.all([
    safeGet(optifineList),
    safeGet(() => getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')),
    safeGet(() => getJson('https://meta.fabricmc.net/v2/versions/game')),
    safeGet(() => getJson('https://meta.quiltmc.org/v3/versions/game')),
    safeGet(() => getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')),
  ]);
  const forgeMc = forge ? [...new Set(Object.keys(forge.promos).map((k) => k.replace(/-(latest|recommended)$/, '')))] : [];
  const neoMc = neo ? [...new Set((neo.versions || []).map((v) => { const p = v.split('.'); return +p[0] >= 26 ? p.slice(0, p[2] === '0' ? 2 : 3).join('.') : '1.' + p[0] + (p[1] !== '0' ? '.' + p[1] : ''); }))] : [];
  const data = {
    optifine: of ? Object.keys(of) : [],
    'forge-optifine': of ? Object.keys(of).filter((mc) => forgeMc.includes(mc) && of[mc].some((x) => x.forge && !/N\/A/i.test(x.forge))) : [],
    forge: forgeMc,
    fabric: fabric ? fabric.filter((v) => v.stable).map((v) => v.version) : [],
    quilt: quilt ? quilt.filter((v) => v.stable).map((v) => v.version) : [],
    neoforge: neoMc,
  };
  if (of && forge) catCache = { at: Date.now(), data };
  return data;
}

/** Loader versions for one Minecraft version; [] when the loader does not exist for it. */
async function loaderVersions(loader, mc) {
  try {
    if (loader === 'optifine' || loader === 'forge-optifine') return ((await optifineList())[mc] || []).map((x) => x.file);
    if (loader === 'fabric') return (await getJson('https://meta.fabricmc.net/v2/versions/loader/' + encodeURIComponent(mc))).map((v) => v.loader.version).slice(0, 25);
    if (loader === 'quilt') return (await getJson('https://meta.quiltmc.org/v3/versions/loader/' + encodeURIComponent(mc))).map((v) => v.loader.version).slice(0, 25);
    if (loader === 'forge') {
      const p = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos;
      return [p[mc + '-recommended'], p[mc + '-latest']].filter((v, i, a) => v && a.indexOf(v) === i);
    }
    if (loader === 'neoforge') {
      const all = (await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions || [];
      let prefix;
      const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
      if (m) prefix = m[1] + '.' + (m[2] || '0') + '.';
      else prefix = (mc.split('.').length === 2 ? mc + '.0' : mc) + '.';
      return all.filter((v) => v.startsWith(prefix)).reverse().slice(0, 25);
    }
  } catch (e) { return []; }
  return [];
}

/** Java runtime Mojang uses for this component, installed once. */
async function ensureJava(root, component, progress) {
  const dir = path.join(root, 'runtime', component);
  const exe = path.join(dir, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  if (fs.existsSync(exe)) return exe;
  progress('Downloading Java', 0);
  const manifest = await fetchJavaRuntimeManifest({ target: component, dispatcher });
  const task = installJavaRuntimeTask(Object.assign({ destination: dir, manifest }, DL));
  const meter = speedMeter();
  await task.startAndWait({ onUpdate() { if (task.total) progress('Downloading Java' + meter(task.progress, task.total), Math.round(task.progress / task.total * 100)); } });
  if (process.platform !== 'win32') try { fs.chmodSync(exe, 0o755); } catch (e) {}
  return exe;
}
function consoleJava(exe) { return process.platform === 'win32' ? exe.replace(/javaw\.exe$/, 'java.exe') : exe; }

/** The skin agent: shows CraftRank skins and capes in game. Optional; the game starts without it. */
async function ensureAgent(root) {
  const file = path.join(root, 'authlib-injector.jar');
  try {
    const meta = await getJson('https://authlib-injector.yushi.moe/artifact/latest.json');
    if (fs.existsSync(file) && sha256(file) === meta.checksums.sha256) return file;
    await download(meta.download_url, file, null, { sha256: meta.checksums.sha256 });
    return file;
  } catch (e) { return fs.existsSync(file) ? file : null; }
}

/**
 * CraftRank Plus mod packs, from Modrinth. Required mods must exist for the version,
 * the others are added when they do.
 *  perf:     more FPS and less memory
 *  optifine: the OptiFine features (shaders, connected textures, zoom, custom entity models,
 *            dynamic lights) rebuilt from open mods, because OptiFine itself may not be redistributed
 */
const PACKS = {
  perf: { name: 'Performance', need: ['sodium'], extra: ['lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix'] },
  optifine: { name: 'OptiFine features', need: ['sodium', 'iris'], extra: ['continuity', 'zoomify', 'entity-model-features', 'entitytexturefeatures', 'lambdynamiclights', 'lithium', 'ferrite-core', 'sodium-extra', 'reeses-sodium-options'] },
};
async function syncPack(instDir, mc, loader, pack, progress) {
  const mods = path.join(instDir, 'mods');
  const statePath = path.join(instDir, 'craftrank-pack.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
  const remove = () => { (state.files || []).forEach((f) => { try { fs.unlinkSync(path.join(mods, safeName(f))); } catch (e) {} }); state = {}; };
  const def = PACKS[pack];
  if (!def || loader === 'vanilla' || loader === 'forge') {
    remove(); fs.mkdirSync(instDir, { recursive: true }); fs.writeFileSync(statePath, '{}');
    return { installed: false, reason: def && loader !== 'vanilla' ? 'Mod packs are made for Fabric, Quilt and NeoForge. Pick one of those.' : def ? 'Pick Fabric to use the ' + def.name + ' pack.' : '' };
  }
  const key = mc + '|' + loader + '|' + pack;
  if (state.key === key && (state.files || []).every((f) => fs.existsSync(path.join(mods, f)))) return { installed: true };
  remove();
  const loaders = loader === 'neoforge' ? ['neoforge'] : ['fabric', 'quilt'].filter((l) => loader === 'quilt' || l === 'fabric');
  const files = [];
  const all = def.need.concat(def.extra);
  for (let i = 0; i < all.length; i++) {
    const slug = all[i];
    progress('Mod pack: ' + slug, Math.round(i / all.length * 100));
    let list = [];
    try { list = await getJson('https://api.modrinth.com/v2/project/' + slug + '/version?loaders=' + encodeURIComponent(JSON.stringify(loaders)) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc]))); } catch (e) { list = []; }
    if (!list.length) {
      if (def.need.includes(slug)) { files.forEach((f) => { try { fs.unlinkSync(path.join(mods, f)); } catch (e) {} }); return { installed: false, reason: 'The ' + def.name + ' pack is not out for Minecraft ' + mc + ' yet.' }; }
      continue;
    }
    const file = list[0].files.find((f) => f.primary) || list[0].files[0];
    const fname = safeName(file.filename);
    await download(file.url, path.join(mods, fname), null, file.hashes);
    files.push(fname);
  }
  // Fabric API, which most of these mods need
  if (loader !== 'neoforge') {
    try {
      const fa = await getJson('https://api.modrinth.com/v2/project/fabric-api/version?loaders=' + encodeURIComponent(JSON.stringify(['fabric'])) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc])));
      if (fa.length) { const f = fa[0].files.find((x) => x.primary) || fa[0].files[0], fname = safeName(f.filename); if (!fs.existsSync(path.join(mods, fname))) { await download(f.url, path.join(mods, fname), null, f.hashes); files.push(fname); } }
    } catch (e) {}
  }
  fs.writeFileSync(statePath, JSON.stringify({ key, files }));
  return { installed: true };
}

/**
 * Makes sure everything for {mc, loader, loaderVersion} is installed and returns the version id to launch.
 * Game files (libraries, assets, versions) are shared in root; each mc+loader pair gets its own
 * instance folder for mods, worlds and settings.
 */
async function prepare(root, opts, progress) {
  const list = await versionList();
  const meta = list.versions.find((v) => v.id === opts.mc);
  if (!meta) throw new Error('Minecraft ' + opts.mc + ' was not found.');
  if (opts.force) {   // "Force update": fetch this version's files again
    for (const d of [path.join(root, 'versions', opts.mc)]) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(path.join(root, 'optifine'), { recursive: true, force: true }); } catch (e) {}
  }
  progress('Checking Minecraft ' + opts.mc, 0);
  // The installer only learns the full size as it goes (it says 100% after the first few files),
  // so measure against the real size: game jar + every asset + every library, from the version file.
  let want = 0, vjson = null;
  try {
    const vj = vjson = await getJson(meta.url);
    want = ((vj.downloads && vj.downloads.client && vj.downloads.client.size) || 0) + ((vj.assetIndex && vj.assetIndex.totalSize) || 0)
      + (vj.libraries || []).reduce((n, l) => n + ((l.downloads && l.downloads.artifact && l.downloads.artifact.size) || 0), 0);
  } catch (e) {}
  const meter = speedMeter();
  let pre = 0;
  const show = (done) => { const total = Math.max(want, done); if (total) progress('Downloading Minecraft ' + opts.mc + meter(done, total), Math.min(99, Math.floor(done / total * 100))); };
  if (vjson) { try { await fetchAssets(root, vjson, (n) => { pre += n; show(pre); }); } catch (e) {} }
  // The installer counts the assets above again as it checks them, so start its count after them.
  const assetBytes = pre;
  const t = installTask(meta, root, DL);
  await t.startAndWait({ onUpdate() { show(Math.max(pre, Math.min(want, assetBytes + Math.max(0, (t.progress || 0) - assetBytes)))); } });
  const base = await Version.parse(new MinecraftFolder(root), opts.mc);
  const java = await ensureJava(root, (base.javaVersion && base.javaVersion.component) || 'jre-legacy', progress);
  let id = opts.mc, ofJar = null;
  const loader = LOADERS.includes(opts.loader) ? opts.loader : 'vanilla';
  if (loader !== 'vanilla') {
    let lv = opts.loaderVersion;
    if (!lv) lv = (await loaderVersions(loader, opts.mc))[0];
    if (!lv) throw new Error((loader[0].toUpperCase() + loader.slice(1)) + ' is not available for Minecraft ' + opts.mc + '.');
    progress('Installing ' + loader + ' ' + lv, 0);
    if (loader === 'optifine') id = await installOptifine(await downloadOptifine(root, lv, progress), root, Object.assign({ java: consoleJava(java) }, DL));
    else if (loader === 'forge-optifine') {
      ofJar = await downloadOptifine(root, lv, progress);
      const fv = await forgeForOptifine(opts.mc, lv);
      if (!fv) throw new Error('Forge is not available for Minecraft ' + opts.mc + '.');
      progress('Installing Forge ' + fv, 0);
      id = await installForge({ mcversion: opts.mc, version: fv }, root, Object.assign({ java: consoleJava(java) }, DL));
    }
    else if (loader === 'fabric') id = await installFabric(await getFabricLoaderArtifact(opts.mc, lv), root, DL);
    else if (loader === 'quilt') id = await installQuiltVersion({ minecraftVersion: opts.mc, version: lv, minecraft: root });
    else if (loader === 'forge') id = await installForge({ mcversion: opts.mc, version: lv }, root, Object.assign({ java: consoleJava(java) }, DL));
    else if (loader === 'neoforge') id = await installNeoForged('neoforge', lv, root, Object.assign({ java: consoleJava(java) }, DL));
    const resolved = await Version.parse(new MinecraftFolder(root), id);
    const d = installDependenciesTask(resolved, DL);
    await d.startAndWait({ onUpdate() { if (d.total) progress('Downloading libraries', Math.round(d.progress / d.total * 100)); } });
  }
  const instDir = instanceDir(root, opts.mc, loader);
  fs.mkdirSync(instDir, { recursive: true });
  if (loader === 'forge-optifine') {    // OptiFine runs as a Forge mod: keep exactly one OptiFine jar in mods
    const mods = path.join(instDir, 'mods'); fs.mkdirSync(mods, { recursive: true });
    for (const f of fs.readdirSync(mods)) if (/^(preview_)?OptiFine_.*\.jar$/i.test(f) && f !== path.basename(ofJar)) try { fs.unlinkSync(path.join(mods, f)); } catch (e) {}
    const to = path.join(mods, path.basename(ofJar));
    if (!fs.existsSync(to)) fs.copyFileSync(ofJar, to);
  }
  const pack = await syncPack(instDir, opts.mc, loader, opts.pack || 'none', progress);
  return { id, java, instDir, pack };
}

/** The folder for one Minecraft version + loader: mods, worlds, settings and resource packs. */
function instanceDir(root, mc, loader) {
  return path.join(root, 'instances', (mc + '-' + (LOADERS.includes(loader) ? loader : 'vanilla')).replace(/[^A-Za-z0-9._-]/g, '_'));
}

/* ---------- texture packs from Modrinth, most downloaded first ---------- */
async function searchPacks(q, mc, offset) {
  const facets = [['project_type:resourcepack']];
  if (mc) facets.push(['versions:' + mc]);
  const u = 'https://api.modrinth.com/v2/search?index=downloads&limit=30&offset=' + (offset | 0) + '&facets=' + encodeURIComponent(JSON.stringify(facets)) + (q ? '&query=' + encodeURIComponent(q) : '');
  const r = await getJson(u);
  return { total: r.total_hits || 0, items: (r.hits || []).map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, author: h.author, about: h.description, icon: h.icon_url || '', downloads: h.downloads || 0, url: 'https://modrinth.com/resourcepack/' + h.slug })) };
}
function packsDir(root, mc, loader) { return path.join(instanceDir(root, mc, loader), 'resourcepacks'); }
function packState(root, mc, loader) {
  const dir = packsDir(root, mc, loader), f = path.join(dir, '.craftrank-packs.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  for (const id of Object.keys(st)) if (!fs.existsSync(path.join(dir, st[id]))) delete st[id];
  return { dir, file: f, st };
}
/** Downloads the newest file of a pack for this Minecraft version and switches it on in options.txt. */
async function installPack(root, mc, loader, id) {
  let list = await getJson('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version?game_versions=' + encodeURIComponent(JSON.stringify([mc])));
  let exact = true;
  if (!list.length) { list = await getJson('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version'); exact = false; }
  if (!list.length) throw new Error('This pack has no files to download.');
  const fl = list[0].files.find((x) => x.primary) || list[0].files[0];
  const { dir, file, st } = packState(root, mc, loader);
  const name = safeName(fl.filename);
  await download(fl.url, path.join(dir, name), null, fl.hashes);
  st[id] = name; fs.writeFileSync(file, JSON.stringify(st));
  setPackOn(instanceDir(root, mc, loader), name, true);
  return { file: name, exact };
}
function removePack(root, mc, loader, id) {
  const { dir, file, st } = packState(root, mc, loader);
  if (st[id]) { setPackOn(instanceDir(root, mc, loader), st[id], false); try { fs.unlinkSync(path.join(dir, safeName(st[id]))); } catch (e) {} delete st[id]; fs.writeFileSync(file, JSON.stringify(st)); }
}
/** options.txt keeps the list of switched-on packs: resourcePacks:["vanilla","file/x.zip"] */
function setPackOn(inst, name, on) {
  const opt = path.join(inst, 'options.txt');
  let lines = []; try { lines = fs.readFileSync(opt, 'utf8').split(/\r?\n/); } catch (e) {}
  let i = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  let packs = ['vanilla'];
  if (i >= 0) { try { packs = JSON.parse(lines[i].slice('resourcePacks:'.length)); } catch (e) {} }
  const key = 'file/' + name;
  packs = packs.filter((p) => p !== key);
  if (on) packs.push(key);
  const line = 'resourcePacks:' + JSON.stringify(packs);
  if (i >= 0) lines[i] = line; else lines.push(line);
  fs.mkdirSync(inst, { recursive: true });
  fs.writeFileSync(opt, lines.filter((l, k) => l !== '' || k < lines.length - 1).join('\n') + '\n');
}

/** Starts the game. account: {name, uuid, token, type}: 'msa' = Microsoft, 'mojang' = CraftRank profile (skin agent). */
async function start(root, prep, account, opts) {
  const agent = opts.skinServer ? await ensureAgent(root) : null;
  const extraJVMArgs = [];
  if (agent) extraJVMArgs.push('-javaagent:' + agent + '=' + opts.skinServer, '-Dauthlibinjector.side=client');
  const proc = await launch({
    gamePath: prep.instDir, resourcePath: root, javaPath: prep.java, version: prep.id,
    gameProfile: { name: account.name, id: account.uuid }, accessToken: account.token || account.uuid, userType: account.type || 'mojang',
    maxMemory: opts.memory, minMemory: Math.min(1024, opts.memory),
    launcherName: 'CraftRank', launcherBrand: 'CraftRank Launcher',
    extraJVMArgs, extraExecOption: { detached: false },
    server: opts.server && opts.server.host ? { ip: opts.server.host, port: opts.server.port || 25565 } : undefined,
  });
  proc.skinsOff = !!opts.skinServer && !agent;
  return proc;
}

module.exports = { instanceDir, searchPacks, packState, installPack, removePack, PACKS, versionList, loaderVersions, catalog, optifineList, prepare, start, ensureJava, consoleJava, download, getJson, LOADERS };
