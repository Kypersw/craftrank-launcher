// The CraftRank account inside the launcher: sign-in token, profile, skin, store.
const fs = require('fs');
const path = require('path');
const { safeStorage, net } = require('electron');

module.exports = function makeAccount(base, file, version) {
  // the PHP file directly, so it works even when the site's .htaccess has no rewrite for /api/launcher/
  const api = base.replace(/\/+$/, '') + '/api/launcher.php?r=';
  // Read the saved session on first use, after the app is ready: before that Windows' safeStorage
  // cannot decrypt, and the encrypted bytes read as text are junk that breaks every request.
  let token = null;
  const ok = (t) => /^[\x21-\x7e]{10,200}$/.test(t || '');
  function tok() {
    if (token !== null) return token;
    token = '';
    try {
      const raw = fs.readFileSync(file);
      let t = '';
      try { if (safeStorage.isEncryptionAvailable()) t = safeStorage.decryptString(raw); } catch (e) {}
      if (!ok(t)) t = raw.toString();
      if (ok(t)) token = t; else fs.unlinkSync(file);
    } catch (e) {}
    return token;
  }
  const save = (t) => {
    token = ok(t) ? t : '';
    try {
      if (!token) { fs.unlinkSync(file); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : token);
    } catch (e) {}
  };

  async function call(route, opts = {}) {
    const headers = { 'User-Agent': 'CraftRankLauncher/' + version, Accept: 'application/json' };
    if (tok()) headers.Authorization = 'Bearer ' + tok();
    let body;
    if (opts.form) body = opts.form;
    else if (opts.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
    const req = { method: opts.form || opts.json ? 'POST' : 'GET', headers, body };
    let r, why = '';
    // Chromium's network stack first: it uses the Windows certificate store and proxy settings, like a browser
    try { r = await net.fetch(api + route, req); }
    catch (e) {
      why = e.message;
      try { r = await fetch(api + route, req); }
      catch (e2) { return { ok: false, error: 'Could not reach CraftRank (' + ((e2.cause && (e2.cause.code || e2.cause.message)) || e2.message || why) + ').' }; }
    }
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401) save('');
    if (!r.ok) return { ok: false, error: j.message || 'Something went wrong (' + r.status + ').', status: r.status };
    return Object.assign({ ok: true }, j);
  }

  return {
    signedIn: () => !!tok(),
    config: () => call('config'),
    feed: () => call('feed'),
    async login(login, password) { const r = await call('login', { json: { login, password } }); if (r.ok) save(r.token); delete r.token; return r; },
    async logout() { if (tok()) await call('logout', { json: {} }); save(''); return { ok: true }; },
    me: () => tok() ? call('me') : Promise.resolve({ ok: false, error: 'signed_out' }),
    setName: (name) => call('name', { json: { name } }),
    async uploadSkin(filePath, slim) {
      const fd = new FormData();
      fd.append('skin', new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), 'skin.png');
      if (slim) fd.append('slim', '1');
      return call('skin', { form: fd });
    },
    resetSkin() { const fd = new FormData(); fd.append('reset', '1'); return call('skin', { form: fd }); },
    store: () => call('store'),
    equip: (kind, item) => call('equip', { json: { kind, item } }),
  };
};
