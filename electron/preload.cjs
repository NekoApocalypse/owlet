const { contextBridge, ipcRenderer, webUtils } = require("electron");
function subscribe(channel, callback) {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld("lwr", {
  droppedPaths: (files) =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  importFiles: (args) => ipcRenderer.invoke("files-import", args),
  downloadFile: (args) => ipcRenderer.invoke("file-download", args),
  readSettings: () => ipcRenderer.invoke("settings-read"),
  saveSettings: (args) => ipcRenderer.invoke("settings-save", args),
  bootstrap: () => ipcRenderer.invoke("bootstrap"),
  connect: () => ipcRenderer.invoke("connect"),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  remote: (method, args) => ipcRenderer.invoke("remote", method, args),
  openWindow: (root) => ipcRenderer.invoke("open-window", root),
  openLocal: (root) => ipcRenderer.invoke("open-local", root),
  openSSH: (target, root) => ipcRenderer.invoke("open-ssh", target, root),
  newWindow: () => ipcRenderer.invoke("new-window"),
  fileMenu: () => ipcRenderer.invoke("file-menu"),
  recent: () => ipcRenderer.invoke("recent-list"),
  openRecent: (id) => ipcRenderer.invoke("recent-open", id),
  removeRecent: (id) => ipcRenderer.invoke("recent-remove", id),
  clearRecent: () => ipcRenderer.invoke("recent-clear"),
  onRecent: (callback) => subscribe("recent-changed", callback),
  onCommand: (callback) => subscribe("execute-command", callback),
  onConnection: (callback) => subscribe("connection-state", callback),
  startTerminal: (args) => ipcRenderer.invoke("terminal-start", args),
  terminal: (method, args) =>
    ipcRenderer.send("terminal-message", method, args),
  onTerminal: (callback) => subscribe("terminal-event", callback),
  dirty: (value) => ipcRenderer.send("dirty", value),
  external: (url) => ipcRenderer.invoke("external", url),
  reload: () => ipcRenderer.invoke("reload"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  zoom: (direction) => ipcRenderer.invoke("zoom", direction),
  fullscreen: () => ipcRenderer.invoke("fullscreen"),
  appearance: (value) => ipcRenderer.invoke("window-appearance", value),
  windowAction: (action) => ipcRenderer.invoke("window-action", action),
});
