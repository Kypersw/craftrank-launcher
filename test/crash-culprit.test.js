// node test/crash-culprit.test.js — the "Turn off <mod> and play" button finds the right jar for a crash
const fs = require('fs'), os = require('os'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const grab = (n) => { const i = src.indexOf('function ' + n + '('); let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) return src.slice(i, k + 1); } };
const { crashReason, crashCulprit } = new Function('fs', 'path', grab('jarNames') + grab('crashCulprit') + src.slice(src.indexOf('function crashReason(log)'), src.indexOf('\nfunction friendly(')) + '\nreturn { crashReason, crashCulprit };')(fs, path);
// a zip with empty stored entries, enough for the central directory reader
function zip(names) {
  const loc = [], cen = []; let off = 0;
  for (const n of names) {
    const nb = Buffer.from(n), l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(nb.length, 26); loc.push(l, nb);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42); cen.push(c, nb); off += 30 + nb.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crl-cul-')), inst = path.join(tmp, '1.18.1-fabric'), mods = path.join(inst, 'mods');
fs.mkdirSync(mods, { recursive: true });
fs.writeFileSync(path.join(mods, 'mlf.jar'), zip(['fabric.mod.json', 'memoryleakfix.mixins.json', 'memoryleakfix-fabric.mixins.json', 'org/x/A.class']));
fs.writeFileSync(path.join(mods, 'sodium-fabric-0.4.10.jar'), zip(['fabric.mod.json', 'sodium.mixins.json']));
fs.writeFileSync(path.join(mods, 'create-1.20.1-0.5.1.jar'), zip(['META-INF/mods.toml']));
let bad = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + name + '  ' + JSON.stringify(got)); };
const pick = (why) => { const c = crashCulprit(inst, why); return c && [c.file, c.name]; };
const fabricLog = "[main/ERROR]: Mixin apply for mod memoryleakfix failed memoryleakfix.mixins.json:leaks.SomeMixin from mod memoryleakfix -> net.minecraft.class_1959: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure: WrapOperation annotation on memoryLeakFix$useStaticThreadLocal could not find any targets matching 'Lnet/minecraft/class_1959;'";
t('fabric mixin log -> reason names the mod', /memoryleakfix/.test(crashReason(fabricLog)), true);
t('fabric mixin log -> jar', pick(crashReason(fabricLog)), ['mlf.jar', 'memoryleakfix']);
t('mixin config name -> jar', pick('A mod does not work with this version (memoryleakfix.mixins.json). Caused by: x'), ['mlf.jar', 'memoryleakfix']);
t('mod id -> jar', pick('A mod does not work with this version: memoryleakfix. Caused by: x'), ['mlf.jar', 'memoryleakfix']);
t('Forge "Mod loading failed (create)" -> jar by file name', pick('Mod loading failed (create): Create (create) has failed to load correctly'), ['create-1.20.1-0.5.1.jar', 'create']);
t('other crash -> nothing', pick('Wrong Java version for this Minecraft version.'), null);
t('mod not in the folder -> nothing', pick('A mod does not work with this version: lithium. x'), null);
fs.writeFileSync(path.join(inst, 'craftrank-pack.json'), JSON.stringify({ files: ['sodium-fabric-0.4.10.jar'] }));
t('launcher pack mod -> never offered', pick('A mod does not work with this version: sodium. x'), null);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
