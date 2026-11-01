const { contextBridge, ipcRenderer } = require("electron");
function subscribe(channel, callback) {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld("lwr", {
  bootstrap: () => ipcRenderer.invoke("bootstrap"),
  connect: () => ipcRenderer.invoke("connect"),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  remote: (method, args) => ipcRenderer.invoke("remote", method, args),
  openWindow: (root) => ipcRenderer.invoke("open-window", root),
  openLocal: (root) => ipcRenderer.invoke("open-local", root),
  openSSH: (target, root) => ipcRenderer.invoke("open-ssh", target, root),
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
