// Discord status ("Rich Presence"): shows friends what the player is doing, with buttons to the server
// page and the launcher. Talks to the Discord app on this PC over its local pipe; nothing goes online
// from here. When Discord is not running it quietly tries again later.
const net = require('net');
const path = require('path');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => '\\\\?\\pipe\\discord-ipc-' + i);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  const dirs = [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord'), '/tmp'];
  const out = [];
  for (const d of dirs) for (let i = 0; i < 10; i++) out.push(path.join(d, 'discord-ipc-' + i));
  return [...new Set(out)];
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0); head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

/** Discord limits: text 2–128 characters, button labels up to 32, links up to 512. */
const txt = (s, max = 128) => { s = String(s || '').replace(/\s+/g, ' ').trim().slice(0, max); return s.length >= 2 ? s : undefined; };
const link = (u) => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) && u.length <= 512 ? u : undefined);

module.exports = function makeDiscord() {
  let clientId = '', sock = null, connecting = false, ready = false, enabled = true, wanted = null, retry = null, buf = Buffer.alloc(0), nonce = 0;

  function cleanup() {
    ready = false; connecting = false;
    if (sock) { try { sock.destroy(); } catch (e) {} sock = null; }
    buf = Buffer.alloc(0);
  }
  function later() {
    if (retry || !enabled || !clientId) return;
    retry = setTimeout(() => { retry = null; connect(); }, 30000);
  }
  function tryPath(list, i) {
    if (i >= list.length) { connecting = false; later(); return; }
    const s = net.createConnection(list[i]);
    let opened = false;
    s.once('connect', () => {
      opened = true; sock = s; connecting = false;
      s.write(encode(OP.HANDSHAKE, { v: 1, client_id: clientId }));
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
        if (len < 0 || len > 65536) { cleanup(); later(); return; }
        if (buf.length < 8 + len) break;
        let msg = {}; try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch (e) {}
        buf = buf.slice(8 + len);
        if (op === OP.PING) s.write(encode(OP.PONG, msg));
        else if (op === OP.CLOSE) { cleanup(); later(); return; }
        else if (msg.evt === 'READY') { ready = true; push(); }
      }
    });
    s.on('error', () => { if (!opened) tryPath(list, i + 1); else { cleanup(); later(); } });
    s.on('close', () => { if (opened && sock === s) { cleanup(); later(); } });
  }
  function connect() {
    if (sock || connecting || !enabled || !clientId) return;
    connecting = true;
    tryPath(pipePaths(), 0);
  }
  function push() {
    if (!ready || !sock) return;
    sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: wanted || undefined }, nonce: String(++nonce) }));
  }

  /** What to show. kind: 'menu' | 'play'; server: { name, address, icon, url } or null. */
  function activity(a) {
    const buttons = [];
    if (a.server && link(a.server.url)) buttons.push({ label: 'Server page', url: link(a.server.url) });
    if (link(a.launcherUrl)) buttons.push({ label: 'Get CraftRank Launcher', url: link(a.launcherUrl) });
    const logo = link(a.logo);
    if (a.kind === 'play') {
      const icon = a.server && link(a.server.icon);
      return {
        details: txt(a.server ? 'Playing on ' + a.server.name : 'Playing Minecraft'),
        state: txt(a.server ? a.server.address : a.version),
        timestamps: { start: a.since || Date.now() },
        assets: {
          large_image: icon || logo, large_text: txt(a.server ? a.server.name : a.version),
          small_image: icon ? logo : undefined, small_text: icon ? txt('CraftRank Launcher') : undefined,
        },
        buttons: buttons.length ? buttons : undefined,
        instance: false,
      };
    }
    return {
      details: txt('In the launcher'), state: txt('Choosing a server'),
      assets: { large_image: logo, large_text: txt('CraftRank Launcher') },
      buttons: buttons.length ? buttons : undefined,
      instance: false,
    };
  }

  return {
    /** Application ID from the site (Admin → Launcher). Empty switches the status off. */
    setApp(id) {
      id = /^\d{15,21}$/.test(String(id || '')) ? String(id) : '';
      if (id === clientId) return;
      cleanup(); clientId = id;
      if (clientId) connect();
    },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) { if (ready) { wanted = null; push(); } cleanup(); if (retry) { clearTimeout(retry); retry = null; } }
      else connect();
    },
    show(a) { wanted = activity(a); if (ready) push(); else connect(); },
    clear() { wanted = null; push(); },
    stop() { if (retry) clearTimeout(retry); retry = null; if (ready) { wanted = null; push(); } cleanup(); },
    _activity: activity,
  };
};
