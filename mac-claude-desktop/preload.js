const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getPlan: (userRequest, attachments, outputType, clarifications) => ipcRenderer.invoke('lazyoffice:getPlan', userRequest, attachments, outputType, clarifications),
  classifyAttachments: (attachments) => ipcRenderer.invoke('lazyoffice:classifyAttachments', attachments),
  buildContent: (userRequest, attachments, outputType) => ipcRenderer.invoke('lazyoffice:buildContent', userRequest, attachments, outputType),
  createOutput: (outputType, parsed) => ipcRenderer.invoke('lazyoffice:createOutput', outputType, parsed),
  openInFinder: (filePath) => ipcRenderer.invoke('lazyoffice:openInFinder', filePath),
  getSettings: () => ipcRenderer.invoke('lazyoffice:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('lazyoffice:setSettings', settings),
  claudeDesktopStatus: () => ipcRenderer.invoke('lazyoffice:claudeDesktopStatus')
});
