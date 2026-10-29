// Installing and starting Minecraft: every version (releases, snapshots, beta, alpha),
// mod loaders (Fabric, Quilt, Forge, NeoForge), the Sodium + Iris performance pack,
// Java runtimes and the CraftRank skin agent (authlib-injector).
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { net } = require('electron');
const { launch, Version, MinecraftFolder } = require('@xmcl/core');
const {
  getVersionList, installTask, installDependenciesTask, installJavaRuntimeTask, fetchJavaRuntimeManifest,
  getFabricLoaderArtifact, installFabric, installQuiltVersion, installForgeTask, installNeoForgedTask, installOptifine,
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
/** CraftBoost: which loader makes plain Minecraft faster for this version: {loader, lv} or null */
const boostVia = {};
async function boostLoader(mc) {
  if (mc in boostVia) return boostVia[mc];
  let via = null;
  try {
    const sod = await getJson('https://api.modrinth.com/v2/project/sodium/version?loaders=' + encodeURIComponent('["fabric"]') + '&game_versions=' + encodeURIComponent(JSON.stringify([mc])));
    const lv = sod.length ? (await loaderVersions('fabric', mc))[0] : '';
    if (lv) via = { loader: 'fabric', lv };
    else {
      const of = ((await optifineList())[mc] || [])[0];
      if (of && of.file) via = { loader: 'optifine', lv: of.file };
    }
    boostVia[mc] = via;
  } catch (e) {}
  return via;
}

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

/* Forge and NeoForge: the installer is fetched over HTTPS from Forge's own Maven (the default list starts with
 * an old http:// address that some networks stall on), and each step shows in the progress bar, so a long
 * step (Forge prepares the game files with Java, which can take a few minutes) does not look stuck. */
const forgeOpts = (java, neo) => Object.assign({ java: consoleJava(java) }, neo ? {} : { mavenHost: ['https://maven.minecraftforge.net/'] }, DL);
async function forgeLike(name, task, progress) {
  const step = (p) => /postProcess/i.test(p) ? 'preparing the game files, this can take a few minutes' : /library|libraries/i.test(p) ? 'downloading libraries' : /installer|download/i.test(p) ? 'downloading the installer' : 'installing';
  let cur = 'installing';
  const tell = () => progress('Installing ' + name + ' · ' + cur, task.total > 0 ? Math.min(99, Math.round(task.progress / task.total * 100)) : 0);
  const tick = setInterval(tell, 1000);   // keeps the line alive while Java works
  try {
    return await task.startAndWait({ onStart(t) { cur = step(t.path); tell(); }, onUpdate() { tell(); } });
  } finally { clearInterval(tick); }
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
const FABRIC_API = 'P7dR8mSH';
const PACKS = {
  // v2: Dynamic FPS (no frames wasted while the game is in the background), More Culling (leaves, blocks
  // behind blocks), BadOptimizations (less work per frame on lightmap, sky and particles)
  perf: { name: 'Performance', v: 2, need: ['sodium'], extra: ['lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps', 'moreculling', 'badoptimizations'] },
  optifine: { name: 'OptiFine features', need: ['sodium', 'iris'], extra: ['continuity', 'zoomify', 'entity-model-features', 'entitytexturefeatures', 'lambdynamiclights', 'lithium', 'ferrite-core', 'sodium-extra', 'reeses-sodium-options'] },
};
async function syncPack(instDir, mc, loader, pack, progress) {
  const mods = path.join(instDir, 'mods');
  const statePath = path.join(instDir, 'craftrank-pack.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
  const remove = () => { (state.files || []).forEach((f) => { try { fs.unlinkSync(path.join(mods, safeName(f))); } catch (e) {} }); state = {}; };
  const def = PACKS[pack];
  if (!def || !['fabric', 'quilt', 'neoforge'].includes(loader)) {
    remove(); fs.mkdirSync(instDir, { recursive: true }); fs.writeFileSync(statePath, '{}');
    return { installed: false, reason: def && loader !== 'vanilla' ? 'Mod packs are made for Fabric, Quilt and NeoForge. Pick one of those.' : def ? 'Pick Fabric to use the ' + def.name + ' pack.' : '' };
  }
  const key = mc + '|' + loader + '|' + pack + '|' + (def.v || 1);
  if (state.key === key && (state.files || []).every((f) => fs.existsSync(path.join(mods, f)))) return { installed: true };
  remove();
  const loaders = loader === 'neoforge' ? ['neoforge'] : ['fabric', 'quilt'].filter((l) => loader === 'quilt' || l === 'fabric');
  const files = [];
  const all = def.need.concat(def.extra);
  for (let i = 0; i < all.length; i++) {
    const slug = all[i];
    progress('Mod pack: ' + (i < def.need.length + def.extra.length ? slug : 'extra files'), Math.round(i / all.length * 100));
    let list = [];
    try { list = await getJson('https://api.modrinth.com/v2/project/' + slug + '/version?loaders=' + encodeURIComponent(JSON.stringify(loaders)) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc]))); } catch (e) { list = []; }
    if (!list.length) {
      if (def.need.includes(slug)) { files.forEach((f) => { try { fs.unlinkSync(path.join(mods, f)); } catch (e) {} }); return { installed: false, reason: 'The ' + def.name + ' pack is not out for Minecraft ' + mc + ' yet.' }; }
      continue;
    }
    // mods this one needs (Fabric API comes below)
    for (const d of list[0].dependencies || []) if (d.dependency_type === 'required' && d.project_id && d.project_id !== FABRIC_API && !all.includes(d.project_id)) all.push(d.project_id);
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
  let loader = LOADERS.includes(opts.loader) ? opts.loader : 'vanilla';
  // The folder (worlds, settings) stays the one of the picked version, even when it runs with a loader below.
  const dirLoader = loader;
  // CraftBoost on plain Minecraft: it runs on Fabric with the performance mods (Sodium and friends), or on
  // OptiFine for versions Sodium does not cover. Same folder, worlds and settings. If that cannot be set up,
  // plain Minecraft starts as before.
  let boosted = false;
  if (loader === 'vanilla' && opts.boost && opts.pack === 'perf') {
    const via = await boostLoader(opts.mc);
    if (via) { loader = via.loader; opts = Object.assign({}, opts, { loaderVersion: via.lv }); boosted = true; }
  }
  if (loader !== 'vanilla') try {
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
      id = await forgeLike('Forge', installForgeTask({ mcversion: opts.mc, version: fv }, root, forgeOpts(java)), progress);
    }
    else if (loader === 'fabric') id = await installFabric(await getFabricLoaderArtifact(opts.mc, lv), root, DL);
    else if (loader === 'quilt') id = await installQuiltVersion({ minecraftVersion: opts.mc, version: lv, minecraft: root });
    else if (loader === 'forge') id = await forgeLike('Forge', installForgeTask({ mcversion: opts.mc, version: lv }, root, forgeOpts(java)), progress);
    else if (loader === 'neoforge') id = await forgeLike('NeoForge', installNeoForgedTask('neoforge', lv, root, forgeOpts(java, true)), progress);
    const resolved = await Version.parse(new MinecraftFolder(root), id);
    const d = installDependenciesTask(resolved, DL);
    await d.startAndWait({ onUpdate() { if (d.total) progress('Downloading libraries', Math.round(d.progress / d.total * 100)); } });
  } catch (e) {
    if (!boosted) throw e;
    loader = 'vanilla'; id = opts.mc;
  }
  const instDir = instanceDir(root, opts.mc, dirLoader);
  fs.mkdirSync(instDir, { recursive: true });
  if (loader === 'forge-optifine') {    // OptiFine runs as a Forge mod: keep exactly one OptiFine jar in mods
    const mods = path.join(instDir, 'mods'); fs.mkdirSync(mods, { recursive: true });
    for (const f of fs.readdirSync(mods)) if (/^(preview_)?OptiFine_.*\.jar$/i.test(f) && f !== path.basename(ofJar)) try { fs.unlinkSync(path.join(mods, f)); } catch (e) {}
    const to = path.join(mods, path.basename(ofJar));
    if (!fs.existsSync(to)) fs.copyFileSync(ofJar, to);
  }
  if (opts.boost) { try { applyBoost(instDir, opts.mc, opts.boost); } catch (e) {} }
  const pack = await syncPack(instDir, opts.mc, loader, opts.pack || 'none', progress);
  if (!boosted) await syncMods(root, opts.mc, loader, progress);
  // Skins on servers come from the CraftRank Skin Agent now (see start): the old skin mod is removed
  const skins = await syncSkinMod(instDir, opts.mc, loader, '', progress);
  if (opts.skinRoot) skins.on = true;
  return { id, java, instDir, pack, skins, loader, mc: opts.mc };
}

/* ---------- CraftBoost: automatic FPS settings ---------- */
// One preset per kind of PC (see main.js boostTier). Written to options.txt once per version folder,
// and again after "Optimize now" in Settings. The player can change anything in game afterwards.
const BOOST = {
  low: { renderDistance: 8, simulationDistance: 6, graphics: 0, particles: 1, entityShadows: false, clouds: 'false', mipmapLevels: 1, biomeBlendRadius: 0, ao: false, entityDistanceScaling: 0.75 },
  mid: { renderDistance: 12, simulationDistance: 8, graphics: 1, particles: 0, entityShadows: true, clouds: 'fast', mipmapLevels: 2, biomeBlendRadius: 1, ao: true, entityDistanceScaling: 1 },
  high: { renderDistance: 16, simulationDistance: 10, graphics: 1, particles: 0, entityShadows: true, clouds: 'true', mipmapLevels: 4, biomeBlendRadius: 2, ao: true, entityDistanceScaling: 1 },
};
function mcAtLeast(mc, a, b) { const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc); if (!m) return /^\d{2}\./.test(mc); return +m[1] > a || (+m[1] === a && +(m[2] || 0) >= (b || 0)); }
function applyBoost(instDir, mc, boost) {
  const t = BOOST[boost.tier] || BOOST.mid;
  const markF = path.join(instDir, 'craftrank-boost.json');
  let mark = {}; try { mark = JSON.parse(fs.readFileSync(markF, 'utf8')); } catch (e) {}
  if (mark.tier === boost.tier && (mark.at || 0) >= (boost.stamp || 0)) return false;
  const opt = path.join(instDir, 'options.txt');
  let lines = []; try { lines = fs.readFileSync(opt, 'utf8').split(/\r?\n/).filter((l) => l !== ''); } catch (e) {}
  const set = (k, v) => { const i = lines.findIndex((l) => l.startsWith(k + ':')); const line = k + ':' + v; if (i >= 0) lines[i] = line; else lines.push(line); };
  set('renderDistance', t.renderDistance);
  if (mcAtLeast(mc, 18)) set('simulationDistance', t.simulationDistance);
  if (mcAtLeast(mc, 16)) set('graphicsMode', t.graphics); else set('fancyGraphics', t.graphics ? 'true' : 'false');
  set('particles', t.particles);
  set('entityShadows', t.entityShadows);
  set('renderClouds', '"' + t.clouds + '"');
  set('mipmapLevels', t.mipmapLevels);
  if (mcAtLeast(mc, 13)) set('biomeBlendRadius', t.biomeBlendRadius);
  if (mcAtLeast(mc, 19)) set('ao', t.ao); else set('ao', t.ao ? 2 : 0);
  if (mcAtLeast(mc, 16)) set('entityDistanceScaling', t.entityDistanceScaling);
  set('enableVsync', 'false');
  set('maxFps', 260);
  fs.mkdirSync(instDir, { recursive: true });
  fs.writeFileSync(opt, lines.join('\n') + '\n');
  // OptiFine's own speed settings (used when the version runs on OptiFine)
  const ofF = path.join(instDir, 'optionsof.txt');
  let of = []; try { of = fs.readFileSync(ofF, 'utf8').split(/\r?\n/).filter((l) => l !== ''); } catch (e) {}
  const ofSet = (k, v) => { const i = of.findIndex((l) => l.startsWith(k + ':')); if (i >= 0) of[i] = k + ':' + v; else of.push(k + ':' + v); };
  ofSet('ofFastRender', true); ofSet('ofFastMath', true); ofSet('ofSmartAnimations', true); ofSet('ofRenderRegions', true);
  ofSet('ofSmoothFps', false); ofSet('ofLazyChunkLoading', true); ofSet('ofDynamicFov', true);
  if (boost.tier === 'low') { ofSet('ofAnimatedWater', 2); ofSet('ofAnimatedLava', 2); ofSet('ofAnimatedPortal', false); ofSet('ofVoidParticles', false); ofSet('ofSky', false); ofSet('ofTrees', 1); }
  fs.writeFileSync(ofF, of.join('\n') + '\n');
  fs.writeFileSync(markF, JSON.stringify({ tier: boost.tier, at: Date.now() }));
  return true;
}
// Java flags for smooth frames: G1 with short pauses (the well known client flags, safe on Java 8 to 21+)
const BOOST_JVM = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=8M', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC'];

/** Is there a CustomSkinLoader build for this Minecraft version and mod loader on Modrinth? */
async function cslAvailable(mc, ml) {
  try {
    const list = await getJson('https://api.modrinth.com/v2/project/customskinloader/version?loaders=' + encodeURIComponent(JSON.stringify([ml])) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc])));
    return Array.isArray(list) && list.length > 0;
  } catch (e) { return false; }
}

/**
 * CraftRank skins on servers. Offline-mode servers send no skin with a player, so the game only shows
 * skins it gets from the server itself. CustomSkinLoader (from Modrinth, checked by SHA-512) asks the
 * CraftRank skin server for every player by name instead. It needs a mod loader: Fabric, Quilt, Forge
 * (also with OptiFine) or NeoForge. root = CraftRank's skin server, '' = off.
 */
async function syncSkinMod(instDir, mc, loader, root, progress) {
  const mods = path.join(instDir, 'mods'), statePath = path.join(instDir, 'craftrank-skins.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
  const ml = { fabric: 'fabric', quilt: 'quilt', forge: 'forge', 'forge-optifine': 'forge', neoforge: 'neoforge' }[loader];
  const drop = () => { if (st.file) try { fs.unlinkSync(path.join(mods, safeName(st.file))); } catch (e) {} st = {}; try { fs.writeFileSync(statePath, '{}'); } catch (e) {} };
  if (!root || !/^https:\/\/\S+\/$/.test(root) || !ml) { drop(); return { on: false, reason: root && !ml ? 'loader' : '' }; }
  // CustomSkinLoader together with OptiFine on Forge crashes from 1.20.2 on (OptiFine checks that textures
  // are made on the render thread, the skin mod makes them in the background): no skin mod there.
  if (loader === 'forge-optifine' && mcAtLeast(mc, 20, 2)) { drop(); return { on: false, reason: 'optifine' }; }
  const key = mc + '|' + ml;
  if (!(st.key === key && st.file && fs.existsSync(path.join(mods, safeName(st.file))))) {
    drop();
    let list = [];
    try { list = await getJson('https://api.modrinth.com/v2/project/customskinloader/version?loaders=' + encodeURIComponent(JSON.stringify([ml])) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc]))); } catch (e) {}
    if (!list.length) return { on: false, reason: 'version' };
    progress('Mod pack: CraftRank skins', 0);
    const f = list[0].files.find((x) => x.primary) || list[0].files[0], name = safeName(f.filename);
    try { await download(f.url, path.join(mods, name), null, f.hashes); } catch (e) { return { on: false, reason: 'download' }; }
    st = { key, file: name }; fs.writeFileSync(statePath, JSON.stringify(st));
  }
  // CustomSkinLoader asks every source in its list at once and, by default, waits for all of them to
  // answer (some are slow, far-away skin sites), so a skin showed late. Only CraftRank and Mojang are
  // asked, and the first one that has the player wins.
  const dir = path.join(instDir, 'CustomSkinLoader');
  fs.mkdirSync(dir, { recursive: true });
  try { fs.unlinkSync(path.join(dir, 'ExtraList', 'CraftRank.json')); } catch (e) {}
  const cfg = {
    version: '15.1', buildNumber: 0,
    loadlist: [{ name: 'CraftRank', type: 'MojangAPI', apiRoot: root + 'api/', sessionRoot: root + 'sessionserver/' }, { name: 'Mojang', type: 'MojangAPI' }],
    enableDynamicSkull: true, enableTransparentSkin: true, forceLoadAllTextures: false, enableCape: true, threadPoolSize: 8, cacheExpiry: 30,
  };
  const cf = path.join(dir, 'CustomSkinLoader.json');
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch (e) {}
  const same = cur.forceLoadAllTextures === false && JSON.stringify((cur.loadlist || []).map((x) => [x.name, x.apiRoot || '', x.sessionRoot || ''])) === JSON.stringify([['CraftRank', root + 'api/', root + 'sessionserver/'], ['Mojang', cur.loadlist && cur.loadlist[1] && cur.loadlist[1].apiRoot || '', cur.loadlist && cur.loadlist[1] && cur.loadlist[1].sessionRoot || '']]);
  if (!same) fs.writeFileSync(cf, JSON.stringify(cfg, null, 2));
  return { on: true };
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

/* ---------- mods (the list comes from the CraftRank site, the files from Modrinth) ---------- */
/** Modrinth loader names a mod may have to run on our loader; null = this version can't run mods. */
function modLoaders(loader) {
  return { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], 'forge-optifine': ['forge'], neoforge: ['neoforge'] }[loader] || null;
}
function modsDir(root, mc, loader) { return path.join(instanceDir(root, mc, loader), 'mods'); }
/**
 * What the player installed here: { projectId: { file, title, dep: bool, by: [projectIds] } }.
 * dep = it came along because another mod needs it; by = the mods that need it.
 */
function modState(root, mc, loader) {
  const dir = modsDir(root, mc, loader), f = path.join(dir, '.craftrank-mods.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  if (!st || typeof st !== 'object' || Array.isArray(st)) st = {};
  for (const id of Object.keys(st)) if (!/^[A-Za-z0-9]{6,12}$/.test(id) || !st[id] || typeof st[id].file !== 'string') delete st[id];
  return { dir, file: f, st };
}
const MOD_ID = /^[A-Za-z0-9]{6,12}$/;
async function modVersion(id, mc, loaders) {
  const list = await getJson('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version?loaders=' + encodeURIComponent(JSON.stringify(loaders)) + '&game_versions=' + encodeURIComponent(JSON.stringify([mc])));
  // a release if there is one, else the newest beta
  return list.find((v) => v.version_type === 'release') || list[0] || null;
}
/**
 * Installs a mod and the mods it needs into this version's mods folder. Every file is checked
 * against Modrinth's SHA-512 before it is kept.
 */
async function installMod(root, mc, loader, id, progress) {
  const loaders = modLoaders(loader);
  if (!loaders) throw new Error('Mods run on Fabric, Quilt, Forge or NeoForge. Pick one of those in the version menu first.');
  if (!MOD_ID.test(id)) throw new Error('Unknown mod.');
  const { dir, file, st } = modState(root, mc, loader);
  fs.mkdirSync(dir, { recursive: true });
  const seen = new Set(), added = [], addedIds = [];
  const step = async (pid, by, depth) => {
    if (seen.has(pid) || depth > 4) return;
    seen.add(pid);
    const have = st[pid];
    if (have && fs.existsSync(path.join(dir, safeName(have.file)))) {
      if (by) { have.by = [...new Set((have.by || []).concat(by))]; } else have.dep = false;
      return;
    }
    const v = await modVersion(pid, mc, loaders);
    if (!v) {
      if (!by) throw new Error('This mod is not out for Minecraft ' + mc + ' with ' + loaderName(loader) + ' yet.');
      throw new Error('A mod it needs is not out for Minecraft ' + mc + ' with ' + loaderName(loader) + ' yet.');
    }
    const fl = (v.files || []).find((x) => x.primary) || (v.files || [])[0];
    if (!fl || !/\.jar$/i.test(fl.filename || '')) throw new Error('This mod has no file to download.');
    const name = safeName(fl.filename);
    if (progress) progress(name);
    if (!fs.existsSync(path.join(dir, name))) await download(fl.url, path.join(dir, name), null, fl.hashes);
    let title = pid; try { title = (await getJson('https://api.modrinth.com/v2/project/' + encodeURIComponent(pid))).title || pid; } catch (e) {}
    st[pid] = { file: name, title: String(title).slice(0, 80), dep: !!by, by: by ? [by] : [] };
    added.push(name); addedIds.push(pid);
    for (const d of v.dependencies || []) {
      if (d.dependency_type !== 'required') continue;
      let dp = d.project_id;
      if (!dp && d.version_id) { try { dp = (await getJson('https://api.modrinth.com/v2/version/' + encodeURIComponent(d.version_id))).project_id; } catch (e) {} }
      if (dp && MOD_ID.test(dp)) await step(dp, pid, depth + 1);
    }
  };
  try { await step(id, null, 0); }
  catch (e) { // leave the folder as it was
    for (const n of added) { try { fs.unlinkSync(path.join(dir, n)); } catch (x) {} }
    throw e;
  }
  fs.writeFileSync(file, JSON.stringify(st));
  const deps = addedIds.filter((k) => k !== id).map((k) => st[k].title);
  return { file: st[id].file, deps };
}
function loaderName(l) { return { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', 'forge-optifine': 'Forge', neoforge: 'NeoForge' }[l] || l; }
/** Removes a mod, and the mods that only came along for it. */
function removeMod(root, mc, loader, id) {
  const { dir, file, st } = modState(root, mc, loader);
  if (!st[id]) return;
  const drop = (pid) => {
    const m = st[pid]; if (!m) return;
    try { fs.unlinkSync(path.join(dir, safeName(m.file))); } catch (e) {}
    delete st[pid];
    for (const k of Object.keys(st)) {
      if (!st[k] || !st[k].by || !st[k].by.includes(pid)) continue;
      st[k].by = st[k].by.filter((x) => x !== pid);
      if (st[k].dep && !st[k].by.length) drop(k);
    }
  };
  const need = Object.keys(st).filter((k) => (st[id].by || []).includes(k));
  if (need.length) throw new Error(need.map((k) => st[k].title).join(', ') + ' needs this mod. Remove ' + (need.length > 1 ? 'those' : 'that') + ' first.');
  drop(id);
  fs.writeFileSync(file, JSON.stringify(st));
}
/**
 * Ready mod packs on the Mods page: one click installs every mod in the pack that is out for the
 * version (with the mods they need). All client-side mods from Modrinth that servers allow; no cheats.
 */
const MOD_PACKS = [{
  id: 'pvp', title: 'PvP Pack', loader: 'fabric',
  about: 'Everything for PvP in one click: keystrokes and CPS, armor and effect timers, zoom, ping, hit color, low fire, totem counter and 1.8-style animations.',
  mods: [
    ['w7ThoJFB', 'Zoomify', 'Zoom'], ['5xqElbjw', 'Clean Keystrokes', 'Keystrokes and CPS'], ['1yIQcc2b', 'EvergreenHUD', 'FPS, CPS and more on screen'],
    ['wF189hn9', "uku's Armor HUD", 'Armor durability'], ['x02cBj9Y', 'Status Effect Bars', 'Effect timers'], ['MS1ZMyR7', 'Better Ping Display', 'Ping in the player list'],
    ['ZcR9weSm', 'Dynamic Crosshair', 'Crosshair that shows what you can hit'], ['o4y0N2hu', 'BetterHurtCam', 'Less screen shake when hit'],
    ['9ZPMzrQQ', 'Low Fire Reborn', 'Lower fire on screen'], ['6zatK8W5', 'DamageTint', 'Hit color'], ['GfoMZ9Ly', 'Shield Statuses', 'Shield state by color'],
    ['T9R7YTnA', 'TotemCounter', 'Totem pops'], ['4Hfmgaef', 'OverflowAnimations', '1.7 / 1.8 animations'], ['mOgUt4GM', 'Mod Menu', 'Settings for every mod'],
  ],
}];
/** Installs a pack: every mod that is out for this version; the rest are listed as skipped. */
async function installModPack(root, mc, loader, packId, progress) {
  const pk = MOD_PACKS.find((p) => p.id === packId);
  if (!pk) throw new Error('Unknown pack.');
  const done = [], skipped = [], skippedIds = [];
  for (const [id, name] of pk.mods) {
    if (progress) progress(name, done.length + skipped.length, pk.mods.length);
    try { await installMod(root, mc, loader, id); done.push(name); } catch (e) { skipped.push(name); skippedIds.push(id); }
  }
  // remember which mods are not out for this version, so the page shows them as such
  try { const f = path.join(modsDir(root, mc, loader), '.craftrank-packs.json'); let j = {}; try { j = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (e) {} j[pk.id] = { na: skippedIds, at: Date.now() }; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); } catch (e) {}
  if (!done.length) throw new Error('None of the ' + pk.title + ' mods are out for Minecraft ' + mc + ' with ' + loaderName(loader) + ' yet.');
  return { done, skipped };
}
/** Removes the pack's mods from this version (mods another mod needs stay). */
function removeModPack(root, mc, loader, packId) {
  const pk = MOD_PACKS.find((p) => p.id === packId);
  if (!pk) return;
  // remove in reverse so mods that need others go first
  for (const [id] of pk.mods.slice().reverse()) { try { removeMod(root, mc, loader, id); } catch (e) {} }
}
/** How many of each pack's mods are installed in this version. */
function modPackState(root, mc, loader) {
  const { st, dir } = modState(root, mc, loader);
  let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(dir, '.craftrank-packs.json'), 'utf8')) || {}; } catch (e) {}
  return MOD_PACKS.map((p) => {
    const na = (pj[p.id] && Array.isArray(pj[p.id].na)) ? pj[p.id].na : [];
    return { id: p.id, title: p.title, about: p.about, loader: p.loader, mc, mods: p.mods.map(([id, name, what]) => { const on = !!(st[id] && !st[id].dep); return { id, name, what, on, na: !on && na.includes(id) }; }) };
  });
}

/** Before the game starts: puts back mods whose file went missing (removed by hand, or by a mod pack). */
async function syncMods(root, mc, loader, progress) {
  if (!modLoaders(loader)) return;
  const { dir, st } = modState(root, mc, loader);
  const top = Object.keys(st).filter((k) => !st[k].dep);
  if (Object.keys(st).every((k) => fs.existsSync(path.join(dir, safeName(st[k].file))))) return;
  for (const id of top) { try { await installMod(root, mc, loader, id, (n) => progress('Mods: ' + n, 0)); } catch (e) {} }
}

/**
 * The CraftRank Skin Agent (agent/ in the source, built to src/agent/craftrank-skins.jar): shows CraftRank skins
 * and capes on every server and every version (vanilla, OptiFine, Forge, Fabric…) without a mod.
 * Java cannot read it from inside the app archive, so it is copied next to the game files.
 */
function skinAgent(root) {
  try {
    const src = path.join(__dirname, 'agent', 'craftrank-skins.jar'), to = path.join(root, 'craftrank-skins.jar');
    const buf = fs.readFileSync(src);
    let same = false;
    try { same = sha256(to) === crypto.createHash('sha256').update(buf).digest('hex'); } catch (e) {}
    if (!same) { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(to, buf); }
    return to;
  } catch (e) { return null; }
}

/**
 * CraftBoost on Windows: Java runs on the fast graphics card. Laptops with two cards (Intel/AMD built in plus
 * NVIDIA/AMD) otherwise often run Minecraft on the slow built-in one. Same as the per-app choice in
 * Windows Settings > Display > Graphics, set for this Java only.
 */
function highPerformanceGpu(java) {
  if (process.platform !== 'win32' || !java) return;
  const dir = path.dirname(java);
  for (const exe of ['javaw.exe', 'java.exe']) {
    const f = path.join(dir, exe);
    if (!fs.existsSync(f)) continue;
    try { require('child_process').execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', f, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true }, () => {}); } catch (e) {}
  }
}

/** Starts the game. account: {name, uuid, token, type}: 'msa' = Microsoft, 'mojang' = CraftRank profile (skin agent). */
async function start(root, prep, account, opts) {
  const agent = opts.skinServer ? await ensureAgent(root) : null;
  const extraJVMArgs = [];
  if (agent) extraJVMArgs.push('-javaagent:' + agent + '=' + opts.skinServer, '-Dauthlibinjector.side=client');
  const skins = opts.skinRoot ? skinAgent(root) : null;
  if (skins) extraJVMArgs.push('-javaagent:' + skins + '=' + opts.skinRoot);
  if (opts.boost) extraJVMArgs.push(...BOOST_JVM);
  if (opts.boost) highPerformanceGpu(prep.java);
  const mcv = prep.mc || String(prep.id).split('-')[0];
  const quickPlay = mcAtLeast(mcv, 20);
  // Minecraft 26.x looks for its native libraries (lwjgl.dll…) in natives/java, natives/lwjgl… while the
  // installer still unpacks them into the natives folder itself: tell LWJGL where they are, and make the folders.
  const nativeRoot = path.join(root, 'versions', prep.id, prep.id + '-natives');
  if (/^\d{2}\./.test(mcv)) {
    for (const d of ['', 'java', 'jna', 'lwjgl', 'netty']) { try { fs.mkdirSync(path.join(nativeRoot, d), { recursive: true }); } catch (e) {} }
    extraJVMArgs.push('-Dorg.lwjgl.librarypath=' + nativeRoot);
  }
  const proc = await launch({
    gamePath: prep.instDir, resourcePath: root, javaPath: prep.java, version: prep.id, nativeRoot,
    gameProfile: { name: account.name, id: account.uuid }, accessToken: account.token || account.uuid, userType: account.type || 'mojang',
    maxMemory: opts.memory, minMemory: opts.boost ? Math.floor(opts.memory / 2) : Math.min(1024, opts.memory),
    launcherName: 'CraftRank', launcherBrand: 'CraftRank Launcher',
    extraJVMArgs, extraExecOption: { detached: false },
    // Minecraft 1.20 and newer ignore --server: they join with --quickPlayMultiplayer
    server: opts.server && opts.server.host && !quickPlay ? { ip: opts.server.host, port: opts.server.port || 25565 } : undefined,
    extraMCArgs: opts.server && opts.server.host && quickPlay ? ['--quickPlayMultiplayer', opts.server.host + ':' + (opts.server.port || 25565)] : undefined,
  });
  proc.skinsOff = !!opts.skinServer && !agent;
  // CraftBoost: the game gets a bit more CPU time than background apps
  if (opts.boost && proc.pid) { try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch (e) {} }
  return proc;
}

module.exports = { instanceDir, modLoaders, modState, installMod, removeMod, installModPack, removeModPack, modPackState, MOD_PACKS, searchPacks, packState, installPack, removePack, PACKS, versionList, loaderVersions, catalog, optifineList, prepare, start, ensureJava, consoleJava, download, getJson, LOADERS };
