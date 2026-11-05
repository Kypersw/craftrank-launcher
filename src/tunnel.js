// "Share with friends": a server from My servers gets an address like name.play.craftrank.org.
// The launcher keeps one TLS connection open to CraftRank's relay; for every friend who joins, the relay asks for a
// second connection, which the launcher links to the server on this PC. No port forwarding, and friends never see
// this PC's address. The relay only accepts a name the website signed for this account (see account.tunnel()).
const tls = require('tls');
const net = require('net');

module.exports = function makeTunnel(account, emit) {
  let cur = null;   // { id, port, sock, address, players, stopped, retry }

  function status(extra) {
    if (!cur) return emit({ id: null, state: 'off' });
    emit(Object.assign({ id: cur.id, state: cur.state, address: cur.address || '', invite: cur.invite || '', players: cur.links.size, error: cur.error || '' }, extra || {}));
  }

  function link(t, cid) {
    // one friend: a new connection to the relay, joined to the server on this PC
    const up = tls.connect({ host: t.relay, port: t.port, servername: t.tlsName, timeout: 15000 });
    let local = null;
    let ended = false;
    const done = () => { if (ended) return; ended = true; try { up.destroy(); } catch (e) {} try { local && local.destroy(); } catch (e) {} if (cur) { cur.links.delete(up); status(); } };
    up.once('secureConnect', () => {
      up.write('DATA ' + cid + '\n');
      local = net.connect({ host: '127.0.0.1', port: t.localPort });
      local.on('error', done); local.on('close', done);
      up.pipe(local); local.pipe(up);
      if (cur) { cur.links.add(up); status(); }
    });
    up.on('error', done); up.on('close', done); up.on('timeout', done);
  }

  async function connect(t) {
    if (!cur || cur.stopped) return;
    cur.state = 'connecting'; status();
    // a fresh signed name for every connection (they last a few hours)
    const r = await account.tunnel();
    if (!cur || cur.stopped) return;
    if (!r.ok) { cur.state = 'error'; cur.error = r.error || 'Sharing is not available right now.'; status(); return retry(t, r.status === 401 || r.status === 403 ? 0 : 30000); }
    Object.assign(t, { relay: r.relay, port: r.port, tlsName: r.tls_name });
    cur.address = r.address;
    // a page friends can open: status and how to join (built from the address if the website did not send it)
    const m = /^([a-z0-9-]+)\.play\.([a-z0-9.-]+\.[a-z]{2,})$/.exec(r.address || '');
    cur.invite = /^https:\/\/[a-z0-9.-]+\/play\/[a-z0-9-]+$/.test(r.invite || '') ? r.invite : m ? 'https://' + m[2] + '/play/' + m[1] : '';
    const sock = tls.connect({ host: r.relay, port: r.port, servername: r.tls_name, timeout: 20000 });
    cur.sock = sock;
    let buf = '';
    sock.setEncoding('utf8');
    sock.once('secureConnect', () => { sock.setTimeout(0); sock.write('HELLO 1 ' + r.token + '\n'); });
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const [cmd, arg] = line.split(' ');
        if (cmd === 'OK') { cur.state = 'online'; cur.error = ''; cur.fails = 0; status(); }
        else if (cmd === 'CONN' && /^[a-f0-9]{32}$/.test(arg || '')) link(t, arg);
        else if (cmd === 'PING') sock.write('PONG\n');
        else if (cmd === 'ERR') { cur.error = arg === 'full' ? 'The relay is full right now. Try again later.' : 'CraftRank did not accept this server. Sign in again.'; }
        else if (cmd === 'BYE') { cur.error = 'This server is now shared from another launcher.'; cur.stopped = true; }
      }
      if (buf.length > 4096) sock.destroy();
    });
    const lost = () => {
      if (!cur || cur.sock !== sock) return;
      cur.sock = null;
      if (cur.stopped) { status({ state: cur.error ? 'error' : 'off' }); if (!cur.error) cur = null; return; }
      cur.state = 'connecting'; status();
      retry(t);
    };
    sock.on('error', (e) => { if (cur && cur.sock === sock) cur.error = 'Could not reach the CraftRank relay (' + (e.code || e.message) + ').'; });
    sock.on('close', lost);
    sock.on('timeout', () => sock.destroy());
  }

  function retry(t, ms) {
    if (!cur || cur.stopped || ms === 0) { if (cur) { cur.stopped = true; status(); } return; }
    cur.fails = (cur.fails || 0) + 1;
    clearTimeout(cur.retry);
    cur.retry = setTimeout(() => connect(t), ms || Math.min(60000, 2000 * 2 ** Math.min(5, cur.fails)));
  }

  return {
    /** Share the server with this id, running on this PC's port. Only one server is shared at a time. */
    start(id, localPort) {
      if (cur && cur.id === id && !cur.stopped) return status();
      this.stop();
      cur = { id, links: new Set(), state: 'connecting', fails: 0 };
      connect({ localPort });
    },
    stop(id) {
      if (!cur || (id && cur.id !== id)) return;
      const c = cur; c.stopped = true; clearTimeout(c.retry);
      for (const l of c.links) try { l.destroy(); } catch (e) {}
      try { c.sock && c.sock.destroy(); } catch (e) {}
      cur = null;
      emit({ id: c.id, state: 'off' });
    },
    current() { return cur ? { id: cur.id, state: cur.state, address: cur.address || '', invite: cur.invite || '', players: cur.links.size, error: cur.error || '' } : null; },
  };
};
