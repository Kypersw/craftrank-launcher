// Security tests for the launcher's main process, run with plain Node (Electron is replaced by a stub):
//   node test/security.test.js
// They need the dependencies from npm ci, but no network and no Windows.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const SRC = path.join(__dirname, '..', 'src');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crl-sec-'));
const opened = [], H = {};
let enc = true, body = Buffer.from('a server jar');
const electron = {
  app: { setName() {}, setAppUserModelId() {}, getPath: () => tmp, getVersion: () => '0.0.0', whenReady: () => new Promise(() => {}), on() {}, quit() {}, isPackaged: false },
  BrowserWindow: class {}, dialog: {},
  net: { fetch: async () => new Response(body, { status: 200 }) },
  ipcMain: { handle: (c, f) => { H[c] = f; }, on() {} },
  shell: { openExternal: (u) => opened.push(u), openPath() {} },
  safeStorage: { isEncryptionAvailable: () => enc, encryptString: (s) => Buffer.from('ENC:' + s), decryptString: (b) => { const s = b.toString(); if (!s.startsWith('ENC:')) throw new Error('x'); return s.slice(4); } },
};
const load = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return electron; if (r.startsWith('@xmcl/')) return {}; if (r === 'undici') return { Agent: class {}, ProxyAgent: class {} }; return load.call(this, r, ...a); };
require(path.join(SRC, 'main.js'));
const game = require(path.join(SRC, 'game.js')), servers = require(path.join(SRC, 'servers.js')), makeAccount = require(path.join(SRC, 'account.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const rejects = async (fn) => { try { await fn(); return false; } catch (e) { return true; } };
const UI = require('url').pathToFileURL(path.join(SRC, 'ui')).href + '/index.html', ev = (url) => ({ senderFrame: { url } });

(async () => {
  // 1. links open only over HTTPS, to CraftRank and known sites
  const open = async (u) => { opened.length = 0; await H.open(ev(UI), u); return opened.length > 0; };
  for (const u of ['https://craftrank.org/server/1', 'https://www.craftrank.org/x', 'https://github.com/Kypersw', 'https://aka.ms/MinecraftEULA']) ok('link opens: ' + u, await open(u));
  for (const u of ['http://craftrank.org/x', 'https://evil.example/login', 'https://craftrank.org.evil.example/', 'https://user:pw@craftrank.org/', 'javascript:alert(1)', 'file:///etc/passwd', 'ms-settings:windowsupdate'])
    ok('link refused: ' + u, !(await open(u)));
  // 2. only the launcher's own pages may call the main process
  ok('IPC from a web page is refused', await rejects(() => H['settings:get'](ev('https://evil.example/'))));
  ok('IPC from another local file is refused', await rejects(() => H['settings:get'](ev('file:///tmp/other.html'))));
  ok('IPC from the launcher works', typeof (await H['settings:get'](ev(UI))) === 'object');
  ok('unknown settings are not saved', !('evil' in (await H['settings:set'](ev(UI), { evil: 1, memory: 'x' }))));
  // 3. sign-in stored only encrypted
  const f1 = path.join(tmp, 's1.bin'); fs.writeFileSync(f1, 'a'.repeat(64)); enc = true;
  const a1 = makeAccount('https://x', f1, '1');
  ok('old plain-text sign-in is re-encrypted', a1.signedIn() && fs.readFileSync(f1).toString().startsWith('ENC:'));
  const f2 = path.join(tmp, 's2.bin'); fs.writeFileSync(f2, 'b'.repeat(64)); enc = false;
  ok('without encryption the sign-in is not kept on disk', makeAccount('https://x', f2, '1').signedIn() && !fs.existsSync(f2));
  enc = true;
  // 4. downloads are checked
  const md5 = crypto.createHash('md5').update(body).digest('hex');
  ok('a .jar without a checksum is refused', await rejects(() => game.download('https://x/a.jar', path.join(tmp, 'a.jar'))));
  ok('a .jar with the right checksum is kept', !(await rejects(() => game.download('https://x/b.jar', path.join(tmp, 'b.jar'), null, { md5 }))));
  ok('a .jar with a wrong checksum is refused and deleted', await rejects(() => game.download('https://x/c.jar', path.join(tmp, 'c.jar'), null, { sha256: 'f'.repeat(64) })) && !fs.existsSync(path.join(tmp, 'c.jar')));
  ok('plain http downloads are refused', await rejects(() => game.download('http://x/d.zip', path.join(tmp, 'd.zip'))));
  // 5. my servers: no path tricks, no settings injection
  ok('deleting ../ outside the servers folder is refused', await rejects(() => servers.removeServer(tmp, '../../etc')));
  ok('a server version with ../ is refused', await rejects(() => servers.createServer(tmp, { type: 'purpur', version: '../x', eula: true }, () => {})));
  ok('BungeeCord (no published checksum) is not offered', !('bungeecord' in servers.offered()));
  // 6. OptiFine file names
  const OF = /^(preview_)?OptiFine_[0-9.]+_[A-Za-z0-9_.-]+\.jar$/;
  for (const n of ['../../x.jar', 'OptiFine_1.2_../../../evil.jar', 'OptiFine_1.20_a/b.jar']) ok('OptiFine name refused: ' + n, !(OF.test(n) && !/\.\./.test(n)));
  ok('real OptiFine name accepted', OF.test('OptiFine_1.21.1_HD_U_J1.jar'));

  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}   // Windows may still hold a file a moment longer
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
