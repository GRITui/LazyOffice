const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getPlan: (userRequest, attachments, outputType) => ipcRenderer.invoke('lazyoffice:getPlan', userRequest, attachments, outputType),
  classifyAttachments: (attachments) => ipcRenderer.invoke('lazyoffice:classifyAttachments', attachments),
  generateOutput: (userRequest, attachments, outputType) => ipcRenderer.invoke('lazyoffice:generateOutput', userRequest, attachments, outputType),
  openInFinder: (filePath) => ipcRenderer.invoke('lazyoffice:openInFinder', filePath),
  getSettings: () => ipcRenderer.invoke('lazyoffice:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('lazyoffice:setSettings', settings)
});
