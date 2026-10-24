const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('cr', {
  win: inv('win'), open: inv('open'), settings: inv('settings:get'), save: inv('settings:set'), folder: inv('folder'), info: inv('info'),
  feed: inv('feed'), config: inv('config'),
  me: inv('acct:me'), login: inv('acct:login'), logout: inv('acct:logout'), setName: inv('acct:name'), uploadSkin: inv('acct:skin'), resetSkin: inv('acct:skinReset'),
  store: inv('store'), equip: inv('store:equip'),
  versions: inv('versions'), catalog: inv('catalog'), loaderVersions: inv('loaderVersions'), play: inv('play'),
  srv: { types: inv('srv:types'), versions: inv('srv:versions'), list: inv('srv:list'), create: inv('srv:create'), start: inv('srv:start'), stop: inv('srv:stop'), cmd: inv('srv:cmd'), log: inv('srv:log'), remove: inv('srv:remove'), open: inv('srv:open') },
  on: (ch, fn) => { if (['progress', 'game', 'srv:line', 'srv:progress'].includes(ch)) ipcRenderer.on(ch, (e, d) => fn(d)); },
});
