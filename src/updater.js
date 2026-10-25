// Updates the launcher in place: downloads the new build from the GitHub release, checks it against
// the SHA-256 GitHub reports for the file (and SHA256SUMS.txt), then
//  - installed copy: runs the new installer silently over it and starts the launcher again
//  - portable .exe: swaps the .exe file once this one has closed and starts the new one
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net } = require('electron');

const REPO = 'Kypersw/craftrank-launcher';
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/** How this copy runs: 'installed' (Setup.exe), 'portable' or 'dev' (no self-update). */
function mode() {
  if (process.platform !== 'win32' || !app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  try { return fs.readdirSync(path.dirname(app.getPath('exe'))).some((f) => /^Uninstall .*\.exe$/i.test(f)) ? 'installed' : 'dev'; } catch (e) { return 'dev'; }
}

async function latest() {
  const r = await net.fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { 'User-Agent': 'CraftRankLauncher', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('Could not reach GitHub (' + r.status + ').');
  const j = await r.json();
  const version = String(j.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('No release found.');
  return { version, assets: j.assets || [] };
}

async function sumsFile(assets) {
  const a = assets.find((x) => x.name === 'SHA256SUMS.txt');
  if (!a) return {};
  try { const r = await net.fetch(a.browser_download_url, { headers: { 'User-Agent': 'CraftRankLauncher' } }); const t = await r.text(); const o = {}; for (const m of t.matchAll(/([a-f0-9]{64})\s+\*?(\S+)/g)) o[m[2]] = m[1]; return o; } catch (e) { return {}; }
}

async function fetchTo(url, file, onPct) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'CraftRankLauncher' } });
  if (!r.ok) throw new Error('Download failed (' + r.status + ').');
  const total = +r.headers.get('content-length') || 0, h = crypto.createHash('sha256'), out = fs.createWriteStream(file);
  let got = 0, last = -1;
  for await (const c of r.body) { out.write(c); h.update(c); got += c.length; const p = total ? Math.floor(got / total * 100) : 0; if (p !== last) { last = p; onPct(p); } }
  await new Promise((ok, no) => { out.end(); out.on('finish', ok); out.on('error', no); });
  return h.digest('hex');
}

/** Downloads, checks and starts the update; the launcher closes right after. onStep({ text, pct }). */
async function run(onStep) {
  const m = mode();
  if (m === 'dev') throw new Error('This copy cannot update itself. Download the new version from craftrank.org/launcher.');
  onStep({ text: 'Checking for updates…', pct: 0 });
  const rel = await latest();
  if (!newer(rel.version, app.getVersion())) return { upToDate: true, version: rel.version };
  const name = m === 'installed' ? 'CraftRank-Launcher-Setup.exe' : 'CraftRank-Launcher.exe';
  const asset = rel.assets.find((a) => a.name === name);
  if (!asset || !/^https:\/\/github\.com\//.test(asset.browser_download_url)) throw new Error('The new version has no ' + name + ' yet. Try again in a few minutes.');
  const want = (/^sha256:([a-f0-9]{64})$/.exec(String(asset.digest || '')) || [])[1] || (await sumsFile(rel.assets))[name];
  if (!want) throw new Error('The new version has no checksum to check it against.');
  const dir = path.join(app.getPath('temp'), 'craftrank-update');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'CraftRank-Launcher-' + rel.version + (m === 'installed' ? '-Setup' : '') + '.exe');
  const got = await fetchTo(asset.browser_download_url, file, (p) => onStep({ text: 'Downloading ' + rel.version + '…', pct: p }));
  if (got !== want) { fs.rmSync(file, { force: true }); throw new Error('The download did not match its checksum. Try again.'); }
  onStep({ text: 'Installing…', pct: 100 });
  if (m === 'installed') {
    // electron-builder's installer: /S silent, into the same folder; --force-run starts the launcher afterwards
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    // the running portable .exe is locked: the new .exe copies itself over it once this launcher has
    // closed, then starts it (see swapPortable; no console windows)
    spawn(file, ['--craftrank-swap=' + process.env.PORTABLE_EXECUTABLE_FILE], { detached: true, stdio: 'ignore' }).unref();
  }
  setTimeout(() => app.quit(), 600);
  return { started: true, version: rel.version };
}

/**
 * Called first thing at start. When this copy was started by run() with --craftrank-swap=<old .exe>, it
 * waits until the old launcher has closed, copies itself over it, starts it and quits. Returns true then.
 */
function swapPortable() {
  const arg = process.argv.find((a) => a.startsWith('--craftrank-swap='));
  if (!arg) return false;
  const target = arg.slice('--craftrank-swap='.length), self = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!self || !/\.exe$/i.test(target) || !path.isAbsolute(target)) { app.exit(0); return true; }
  let tries = 0;
  const step = () => {
    try { fs.copyFileSync(self, target); spawn(target, [], { detached: true, stdio: 'ignore' }).unref(); app.exit(0); }
    catch (e) { if (++tries > 120) app.exit(1); else setTimeout(step, 500); }
  };
  step();
  return true;
}

module.exports = { run, mode, newer, swapPortable };
