// Puts the CraftRank icon and name into the app's .exe (rcedit cannot run in our wine build box).
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const pkg = ctx.packager.appInfo;
  const exe = path.join(ctx.appOutDir, pkg.productFilename + '.exe');
  const data = fs.readFileSync(exe);
  const ex = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(ex);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const v = pkg.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  const strings = {
    CompanyName: 'CraftRank', FileDescription: 'CraftRank Launcher', ProductName: 'CraftRank Launcher',
    InternalName: 'CraftRank Launcher', OriginalFilename: 'CraftRank Launcher.exe',
    LegalCopyright: 'Copyright © ' + new Date().getFullYear() + ' CraftRank', FileVersion: pkg.version, ProductVersion: pkg.version,
  };
  for (const l of vi.getAllLanguagesForStringValues()) vi.setStringValues(l, strings);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(ex);
  fs.writeFileSync(exe, Buffer.from(ex.generate()));
};
