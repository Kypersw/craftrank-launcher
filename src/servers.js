// "My servers": create and run your own server (Paper, Purpur, Vanilla, BungeeCord, Velocity) on this PC.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getJson, download, ensureJava, consoleJava, versionList } = require('./game');

const TYPES = {
  paper: { name: 'Paper', proxy: false, about: 'Fast server with plugin support. The usual choice.' },
  purpur: { name: 'Purpur', proxy: false, about: 'Paper with many extra settings.' },
  vanilla: { name: 'Vanilla', proxy: false, about: "Mojang's own server, no plugins." },
  velocity: { name: 'Velocity', proxy: true, about: 'Modern proxy that links several servers into one network.' },
  bungeecord: { name: 'BungeeCord', proxy: true, about: 'The classic proxy for server networks.' },
};

const procs = new Map();   // id -> { child, log }

async function versionsFor(type) {
  if (type === 'paper' || type === 'velocity') {
    const j = await getJson('https://fill.papermc.io/v3/projects/' + type);
    return Object.values(j.versions).flat().filter((v) => !/(pre|rc|SNAPSHOT)/i.test(v));
  }
  if (type === 'purpur') return (await getJson('https://api.purpurmc.org/v2/purpur')).versions.slice().reverse();
  if (type === 'vanilla') return (await versionList()).versions.filter((v) => v.type === 'release').map((v) => v.id);
  if (type === 'bungeecord') return ['latest'];
  return [];
}

async function jarUrl(type, version) {
  if (type === 'paper' || type === 'velocity') {
    const b = await getJson('https://fill.papermc.io/v3/projects/' + type + '/versions/' + encodeURIComponent(version) + '/builds/latest');
    return b.downloads['server:default'].url;
  }
  if (type === 'purpur') return 'https://api.purpurmc.org/v2/purpur/' + encodeURIComponent(version) + '/latest/download';
  if (type === 'bungeecord') return 'https://hub.spigotmc.org/jenkins/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';
  if (type === 'vanilla') {
    const meta = (await versionList()).versions.find((v) => v.id === version);
    const full = await getJson(meta.url);
    return full.downloads.server.url;
  }
  throw new Error('Unknown server type');
}

/** Java the server needs: proxies and new versions run on 21, old versions on 8 or 17. */
function javaFor(type, version) {
  if (TYPES[type].proxy) return 'java-runtime-delta';
  const m = /^1\.(\d+)/.exec(version);
  if (!m) return 'java-runtime-delta';           // year-based versions (26.x) are new
  const minor = +m[1];
  if (minor >= 21 || (minor === 20 && !/^1\.20(\.[0-4])?$/.test(version))) return 'java-runtime-delta';
  if (minor >= 17) return 'java-runtime-gamma';
  return 'jre-legacy';
}

function listServers(root) {
  const dir = path.join(root, 'servers');
  let out = [];
  try {
    out = fs.readdirSync(dir).map((id) => {
      try { const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'craftrank-server.json'), 'utf8')); return Object.assign(m, { id, running: procs.has(id), dir: path.join(dir, id) }); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) {}
  return out.sort((a, b) => b.created - a.created);
}

async function createServer(root, opts, progress) {
  if (!TYPES[opts.type]) throw new Error('Pick a server type.');
  if (!opts.eula) throw new Error("Accept Mojang's EULA to create a server.");
  const name = String(opts.name || '').trim().slice(0, 40) || TYPES[opts.type].name + ' server';
  const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server') + '-' + Date.now().toString(36);
  const dir = path.join(root, 'servers', id);
  fs.mkdirSync(dir, { recursive: true });
  const version = opts.version || (await versionsFor(opts.type))[0];
  progress('Downloading ' + TYPES[opts.type].name + ' ' + version, 0);
  await download(await jarUrl(opts.type, version), path.join(dir, 'server.jar'), (p) => progress('Downloading ' + TYPES[opts.type].name, p));
  if (!TYPES[opts.type].proxy) {
    fs.writeFileSync(path.join(dir, 'eula.txt'), '# Accepted in CraftRank Launcher (https://aka.ms/MinecraftEULA)\neula=true\n');
    const port = +opts.port || 25565;
    fs.writeFileSync(path.join(dir, 'server.properties'), [
      'server-port=' + port, 'motd=' + name.replace(/\n/g, ' '), 'online-mode=' + (opts.online ? 'true' : 'false'),
      'max-players=' + (+opts.maxPlayers || 20), 'view-distance=10', 'enable-command-block=false',
    ].join('\n') + '\n');
  }
  const meta = { name, type: opts.type, version, memory: +opts.memory || 2048, port: +opts.port || (TYPES[opts.type].proxy ? 25577 : 25565), created: Date.now() };
  fs.writeFileSync(path.join(dir, 'craftrank-server.json'), JSON.stringify(meta, null, 2));
  return Object.assign(meta, { id, dir });
}

async function startServer(root, id, onLine, progress) {
  if (procs.has(id)) throw new Error('This server is already running.');
  const s = listServers(root).find((x) => x.id === id);
  if (!s) throw new Error('Server not found.');
  const java = consoleJava(await ensureJava(root, javaFor(s.type, s.version), progress));
  const args = ['-Xms' + Math.min(1024, s.memory) + 'M', '-Xmx' + s.memory + 'M', '-jar', 'server.jar'];
  if (!TYPES[s.type].proxy) args.push('--nogui');
  const child = spawn(java, args, { cwd: s.dir, windowsHide: true });
  const entry = { child, log: [] };
  procs.set(id, entry);
  const push = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => { entry.log.push(l); if (entry.log.length > 500) entry.log.shift(); onLine(id, l); });
  child.stdout.on('data', push); child.stderr.on('data', push);
  child.on('exit', (code) => { procs.delete(id); onLine(id, '[CraftRank] Server stopped' + (code ? ' (code ' + code + ')' : '') + '.', true); });
  return true;
}

function command(id, cmd) { const p = procs.get(id); if (p && cmd) p.child.stdin.write(String(cmd).slice(0, 500) + '\n'); }
function stopServer(root, id) {
  const p = procs.get(id); if (!p) return;
  const s = listServers(root).find((x) => x.id === id);
  command(id, s && TYPES[s.type].proxy ? 'end' : 'stop');
  setTimeout(() => { if (procs.get(id) === p) p.child.kill(); }, 20000);
}
function logOf(id) { const p = procs.get(id); return p ? p.log.slice() : []; }
function stopAll() { for (const [, p] of procs) try { p.child.kill(); } catch (e) {} }
function removeServer(root, id) {
  if (procs.has(id)) throw new Error('Stop the server first.');
  const dir = path.join(root, 'servers', id);
  if (!fs.existsSync(path.join(dir, 'craftrank-server.json'))) throw new Error('Server not found.');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { TYPES, versionsFor, listServers, createServer, startServer, stopServer, command, logOf, stopAll, removeServer };
