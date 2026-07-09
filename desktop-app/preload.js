const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getPlan: (userRequest, attachments) => ipcRenderer.invoke('lazyoffice:getPlan', userRequest, attachments),
  classifyAttachments: (attachments) => ipcRenderer.invoke('lazyoffice:classifyAttachments', attachments),
  generateDoc: (userRequest, attachments) => ipcRenderer.invoke('lazyoffice:generateDoc', userRequest, attachments),
  openInFinder: (filePath) => ipcRenderer.invoke('lazyoffice:openInFinder', filePath),
  getSettings: () => ipcRenderer.invoke('lazyoffice:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('lazyoffice:setSettings', settings)
});
