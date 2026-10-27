// Puts build/portable.nsi in place of electron-builder's portable template (run before electron-builder).
// Ours unpacks each version once and shows the loading picture at once; see build/portable.nsi.
const fs = require('fs');
const path = require('path');
const dest = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'portable.nsi');
fs.copyFileSync(path.join(__dirname, 'portable.nsi'), dest);
console.log('portable template:', dest);
