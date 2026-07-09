const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getPlan: (userRequest, attachments, outputType) => ipcRenderer.invoke('lazyoffice:getPlan', userRequest, attachments, outputType),
  classifyAttachments: (attachments) => ipcRenderer.invoke('lazyoffice:classifyAttachments', attachments),
  generateOutput: (userRequest, attachments, outputType) => ipcRenderer.invoke('lazyoffice:generateOutput', userRequest, attachments, outputType),
  openInFinder: (filePath) => ipcRenderer.invoke('lazyoffice:openInFinder', filePath),
  getSettings: () => ipcRenderer.invoke('lazyoffice:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('lazyoffice:setSettings', settings),
  // First-run local-LLM setup
  llmStatus: () => ipcRenderer.invoke('lazyoffice:llmStatus'),
  llmSetup: () => ipcRenderer.invoke('lazyoffice:llmSetup'),
  llmMarkDone: () => ipcRenderer.invoke('lazyoffice:llmMarkDone'),
  onLlmProgress: (cb) => ipcRenderer.on('lazyoffice:llmProgress', (event, p) => cb(p)),
  onLlmModelDone: (cb) => ipcRenderer.on('lazyoffice:llmModelDone', (event, m) => cb(m))
});
