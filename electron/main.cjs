const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  screen,
} = require("electron");
const path = require("node:path");
const iconPath = path.join(
  __dirname,
  "../assets",
  require("../assets/icon-manifest.json").icon,
);
const { Connection } = require("./connection.cjs");
const { LocalConnection } = require("./local.cjs");
const fs = require("node:fs");
const relaunchExecutable = require("./launcher.cjs").relaunchExecutable(
  process.env.OWLET_LAUNCHER,
);
app.setName("Owlet");
app.setAppUserModelId("Owlet.Desktop");
// The old environment names remain accepted for existing scripts and tests.
for (const key of ["USER_DATA", "SSH_TARGET", "ROOT", "DEV_URL", "SSH_PROXY"])
  if (process.env[`OWLET_${key}`])
    process.env[`LWR_${key}`] = process.env[`OWLET_${key}`];
if (process.env.LWR_USER_DATA)
  app.setPath("userData", process.env.LWR_USER_DATA);
const preferencesPath = app.getPath("userData");
if (relaunchExecutable !== process.execPath) {
  // Separate Electron's instance lock/cache by build so an older running build
  // cannot intercept launches of a newly published portable version.
  const build = require("node:crypto")
    .createHash("sha256")
    .update(process.execPath)
    .digest("hex")
    .slice(0, 16);
  app.setPath("userData", path.join(preferencesPath, "build-instances", build));
}
const { RecentWorkspaces } = require("./recent.cjs");
const recent = new RecentWorkspaces(
  path.join(preferencesPath, "recent-workspaces.json"),
);
const { CommandHistory } = require("./command-history.cjs");
const commandHistory = new CommandHistory(
  path.join(preferencesPath, "command-history.json"),
);
const { validateWindowState } = require("./window-state.cjs");
const sessions = new Map();
const windows = new Map();
const terminals = new Map();
const imageCache = new Map();
if (process.env.LWR_TEST_METRICS === "1")
  globalThis.__lwrMetrics = () => ({
    ...[...sessions.values()].find((session) => session.kind === "ssh")
      ?.metrics,
  });

function sessionFor(target) {
  const key = target ? `ssh:${target}` : "local";
  if (sessions.has(key)) return sessions.get(key);
  const session = target
    ? new Connection(target)
    : new LocalConnection({
        executable: process.execPath,
        appPath: app.getAppPath(),
        packaged: app.isPackaged,
      });
  sessions.set(key, session);
  session.on("state", (state) => {
    for (const [id, record] of windows) {
      if (record.session !== session) continue;
      const win = BrowserWindow.fromId(record.windowId);
      if (win && !win.isDestroyed())
        win.webContents.send("connection-state", state);
    }
    if (state.status === "disconnected")
      for (const [id, owner] of terminals)
        if (windows.get(owner.id)?.session === session) terminals.delete(id);
  });
  session.on("remote-event", (event) => {
    if (event.event === "open")
      openWindow(
        event.directory ? event.path : event.cwd,
        event.directory ? undefined : event.path,
        session,
      );
    else if (event.terminal) {
      const owner = terminals.get(event.terminal);
      if (
        owner &&
        !owner.isDestroyed() &&
        windows.get(owner.id)?.session === session
      )
        owner.send("terminal-event", event);
      if (event.event === "terminal-exit") terminals.delete(event.terminal);
    }
  });
  return session;
}
function backend(event) {
  return windows.get(event.sender.id).session;
}

function sendAll(channel, payload) {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
}
const userSettings = new (require("./settings.cjs").UserSettings)(
  path.join(preferencesPath, "settings.json"),
);
ipcMain.handle("settings-read", () => userSettings.read());
ipcMain.handle("settings-save", (_, args) => userSettings.save(args));
function openWindow(root, file, session = sessionFor(), source) {
  const previous =
    source ||
    BrowserWindow.getFocusedWindow() ||
    BrowserWindow.fromId([...windows.values()].at(-1)?.windowId || -1);
  const bounds = previous?.getNormalBounds();
  const display = bounds
    ? screen.getDisplayMatching(bounds)
    : screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...require("./window-placement.cjs").windowPlacement(
      display.workArea,
      bounds,
    ),
    backgroundColor: "#002451",
    icon: iconPath,
    title: "Owlet · Workspace",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#001126", symbolColor: "#ffffff", height: 32 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const record = {
    root,
    file,
    session,
    windowId: win.id,
    dirty: false,
    confirmed: false,
  };
  windows.set(win.webContents.id, record);
  if (process.platform === "win32" && app.isPackaged)
    win.setAppDetails({
      appId: "Owlet.Desktop",
      appIconPath: iconPath,
      relaunchDisplayName: "Owlet",
      relaunchCommand: `"${relaunchExecutable}"`,
    });
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("close", (event) => {
    if (record.dirty && !record.confirmed) {
      event.preventDefault();
      dialog
        .showMessageBox(win, {
          type: "warning",
          message: "Close with unsaved changes?",
          detail: "Your unsaved edits in this window will be lost.",
          buttons: ["Keep editing", "Discard and close"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(({ response }) => {
          if (response === 1) {
            record.confirmed = true;
            win.close();
          }
        });
    }
  });
  const owner = win.webContents.id;
  win.on("closed", () => {
    windows.delete(owner);
    for (const [terminal, webContents] of terminals)
      if (webContents.id === owner) {
        session.notify("terminal-close", { terminal });
        terminals.delete(terminal);
      }
    if (
      session.kind === "ssh" &&
      ![...windows.values()].some((record) => record.session === session)
    )
      session.close();
  });
  if (process.env.LWR_DEV_URL) win.loadURL(process.env.LWR_DEV_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  return win;
}

function trusted(event) {
  if (
    !windows.has(event.sender.id) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error("Untrusted sender");
}
// Read this process's immutable package metadata, never the latest-launcher
// pointer: old windows must continue reporting their own running build.
ipcMain.handle("about", (event) => {
  trusted(event);
  const metadata = require("../package.json");
  return {
    version: app.getVersion(),
    build: metadata.owletBuild || {
      label: "Development build",
      commit: null,
      dirty: false,
      builtAt: null,
    },
    platform: process.platform,
    arch: process.arch,
    runtime: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    },
  };
});
ipcMain.handle("bootstrap", (event) => {
  trusted(event);
  const { root, file, session, reloadState } = windows.get(event.sender.id);
  return { root, file, reloadState, connection: session.state };
});
ipcMain.handle("command-history", (event, action, id) => {
  trusted(event);
  if (action === "list") return commandHistory.list();
  const history =
    action === "remember"
      ? commandHistory.remember(id)
      : action === "clear"
        ? commandHistory.clear()
        : null;
  if (!history) throw new Error("Invalid history action");
  sendAll("command-history-changed", history);
  return history;
});
ipcMain.handle("connect", async (event) => {
  trusted(event);
  return backend(event).connect();
});
ipcMain.handle("disconnect", (event) => {
  trusted(event);
  if (backend(event).kind === "ssh") backend(event).close();
});
const methods = new Set([
  "list",
  "read",
  "save",
  "stat",
  "stats",
  "image",
  "pdf",
  "project-settings",
  "project-color",
  "import-peacock",
  "fs-operation",
]);
ipcMain.handle("remote", async (event, method, args) => {
  trusted(event);
  const connection = backend(event);
  if (!methods.has(method)) throw new Error("Unsupported operation");
  if (method === "fs-operation")
    args = {
      ...args,
      root: windows.get(event.sender.id).root || connection.state.home,
    };
  if (method === "read") return connection.download(args);
  if (method === "pdf") return connection.download(args, false, true);
  if (method === "image") {
    const key = JSON.stringify([connection.kind, connection.target, args]);
    const existing = imageCache.get(key);
    if (existing && Date.now() - existing.time < 5000) return existing.value;
    const value = connection.download(args, true);
    imageCache.set(key, { time: Date.now(), value });
    while (imageCache.size > 8)
      imageCache.delete(imageCache.keys().next().value);
    try {
      return await value;
    } catch (error) {
      imageCache.delete(key);
      throw error;
    }
  }
  const result = await connection.request(method, args);
  const record = windows.get(event.sender.id);
  if (
    method === "list" &&
    !record.remembered &&
    record.root !== "" &&
    args.path === (record.root || connection.state.home)
  ) {
    record.remembered = true;
    try {
      sendAll(
        "recent-changed",
        recent.remember({
          kind: connection.kind,
          target: connection.target,
          path: result.path,
        }),
      );
    } catch (error) {
      console.warn("Could not save recent workspaces:", error.message);
    }
  }
  return result;
});
ipcMain.handle("files-import", async (event, args) => {
  trusted(event);
  const connection = backend(event);
  let paths = args?.paths;
  if (!paths) {
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title:
          connection.kind === "ssh"
            ? "Upload files"
            : "Copy files into workspace",
        properties: ["openFile", "multiSelections"],
      },
    );
    if (result.canceled) return null;
    paths = result.filePaths;
  }
  return require("./transfers.cjs").importFiles(
    connection,
    windows.get(event.sender.id).root || connection.state.home,
    args.directory,
    paths,
  );
});
ipcMain.handle("file-download", async (event, args) => {
  trusted(event);
  const connection = backend(event);
  if (connection.kind !== "ssh")
    throw Error("Download is available in SSH workspaces.");
  if (typeof args?.path !== "string") throw Error("Choose a remote file.");
  let destination = args.destination,
    allowReplace = false;
  if (destination === undefined) {
    const result = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Download file",
        defaultPath: path.basename(args.path),
        properties: ["showOverwriteConfirmation"],
      },
    );
    if (result.canceled) return null;
    destination = result.filePath;
    allowReplace = true;
  }
  return require("./transfers.cjs").downloadFile(
    connection,
    windows.get(event.sender.id).root || connection.state.home,
    args.path,
    destination,
    allowReplace,
  );
});
ipcMain.handle("new-window", (event) => {
  trusted(event);
  openWindow("", undefined, sessionFor());
});
ipcMain.handle("recent-list", (event) => {
  trusted(event);
  return recent.list();
});
ipcMain.handle("recent-remove", (event, id) => {
  trusted(event);
  if (typeof id !== "string") throw new Error("Invalid recent workspace ID");
  const entries = recent.remove(id);
  sendAll("recent-changed", entries);
  return entries;
});
ipcMain.handle("recent-clear", (event) => {
  trusted(event);
  const entries = recent.clear();
  sendAll("recent-changed", entries);
  return entries;
});
ipcMain.handle("recent-open", async (event, id) => {
  trusted(event);
  const entry = recent.list().find((item) => item.id === id);
  if (!entry) throw new Error("This workspace is no longer in Open Recent");
  const session = sessionFor(entry.target);
  if (entry.kind === "local") {
    const info = await session.request("stat", { path: entry.path });
    if (!info.directory) throw new Error("This folder is no longer available");
    openWindow(info.path, undefined, session);
  } else {
    void session.connect().catch(() => {});
    openWindow(
      entry.path,
      undefined,
      session,
      BrowserWindow.fromWebContents(event.sender),
    );
  }
});
ipcMain.handle("file-menu", (event) => {
  trusted(event);
  const invoke =
    (id, args = {}) =>
    () => {
      if (!event.sender.isDestroyed())
        event.sender.send("execute-command", { id, args });
    };
  const entries = recent.list();
  Menu.buildFromTemplate([
    {
      label: "New Window",
      accelerator: "Ctrl+Shift+N",
      click: invoke("window.newEmpty"),
    },
    { label: "Open Local Folder…", click: invoke("workspace.openLocal") },
    { label: "Connect to Remote…", click: invoke("workspace.openSSH") },
    {
      label: "Open Recent",
      submenu: [
        {
          label: "Recently Opened Windows…",
          click: invoke("workspace.openRecent"),
        },
        { type: "separator" },
        ...(entries.length
          ? entries.slice(0, 15).map((item) => ({
              label:
                `${item.path}${item.kind === "ssh" ? ` [SSH: ${item.target}]` : " [Local]"}`.replaceAll(
                  "&",
                  "&&",
                ),
              click: invoke("workspace.openRecent", { id: item.id }),
            }))
          : [{ label: "No recent workspaces", enabled: false }]),
        { type: "separator" },
        {
          label: "Clear Recently Opened…",
          enabled: entries.length > 0,
          click: invoke("workspace.clearRecent"),
        },
      ],
    },
    { type: "separator" },
    { label: "Save", accelerator: "Ctrl+S", click: invoke("file.save") },
    { label: "Save All", click: invoke("file.saveAll") },
    { type: "separator" },
    { label: "About Owlet", click: invoke("help.about") },
    { type: "separator" },
    { label: "Close Window", click: invoke("window.close") },
  ]).popup({
    window: BrowserWindow.fromWebContents(event.sender),
    x: 34,
    y: 32,
  });
});
ipcMain.handle("open-window", async (event, root) => {
  trusted(event);
  const connection = backend(event);
  const info = await connection.request("stat", { path: root });
  if (!info.directory) throw new Error("Choose a directory");
  openWindow(info.path, undefined, connection);
});
ipcMain.handle("open-local", async (event, selected) => {
  trusted(event);
  if (!selected) {
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      { properties: ["openDirectory"], title: "Open local folder" },
    );
    if (result.canceled) return false;
    selected = result.filePaths[0];
  }
  const session = sessionFor();
  const info = await session.request("stat", { path: selected });
  if (!info.directory) throw new Error("Choose a directory");
  openWindow(info.path, undefined, session);
  return true;
});
ipcMain.handle("open-ssh", async (event, target, root) => {
  trusted(event);
  if (root !== undefined && (typeof root !== "string" || root.includes("\0")))
    throw new Error("Invalid remote path");
  const session = sessionFor(target);
  if (session.kind !== "ssh")
    throw new Error("Enter an SSH host alias or user@host");
  void session.connect().catch(() => {});
  openWindow(root || undefined, undefined, session);
});
ipcMain.handle("terminal-start", async (event, args) => {
  trusted(event);
  const identifier = `${event.sender.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  terminals.set(identifier, event.sender);
  try {
    await backend(event).request("terminal-start", {
      ...args,
      terminal: identifier,
    });
    return identifier;
  } catch (error) {
    terminals.delete(identifier);
    throw error;
  }
});
ipcMain.on("terminal-message", (event, method, args) => {
  trusted(event);
  if (
    !["terminal-input", "terminal-resize", "terminal-close"].includes(method) ||
    terminals.get(args.terminal) !== event.sender
  )
    return;
  backend(event).notify(method, args);
});
ipcMain.on("dirty", (event, dirty) => {
  trusted(event);
  windows.get(event.sender.id).dirty = !!dirty;
});
ipcMain.handle("external", (event, url) => {
  trusted(event);
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new Error("Unsupported link");
  return shell.openExternal(parsed.href);
});
ipcMain.handle("close-window", (event) => {
  trusted(event);
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle("window-appearance", (event, appearance) => {
  trusted(event);
  if (
    !appearance ||
    !/^#[0-9a-f]{6}$/i.test(appearance.color) ||
    !/^#[0-9a-f]{6}$/i.test(appearance.foreground) ||
    typeof appearance.title !== "string" ||
    appearance.title.length > 1024
  )
    throw new Error("Invalid window appearance");
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setTitleBarOverlay({
    color: appearance.color,
    symbolColor: appearance.foreground,
  });
  win.setTitle(appearance.title);
});
ipcMain.handle("window-action", (event, action) => {
  trusted(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (action === "minimize") win.minimize();
  else if (action === "maximize")
    win.isMaximized() ? win.unmaximize() : win.maximize();
  else throw new Error("Invalid window action");
});
ipcMain.handle("zoom", (event, direction) => {
  trusted(event);
  if (!["in", "out", "reset"].includes(direction))
    throw new Error("Invalid zoom action");
  event.sender.setZoomFactor(
    direction === "reset"
      ? 1
      : Math.max(
          0.5,
          Math.min(
            2,
            event.sender.getZoomFactor() + (direction === "in" ? 0.1 : -0.1),
          ),
        ),
  );
});
ipcMain.handle("fullscreen", (event) => {
  trusted(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setFullScreen(!win.isFullScreen());
});
ipcMain.handle("reload", async (event, state) => {
  trusted(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  const record = windows.get(event.sender.id);
  const reloadState =
    state === undefined ? undefined : validateWindowState(state);
  if (record.dirty) {
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Reload with unsaved changes?",
      detail:
        "Reloading discards unsaved editor buffers and starts a new direct shell.",
      buttons: ["Keep editing", "Discard and reload"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return false;
  }
  for (const [terminal, owner] of terminals)
    if (owner.id === event.sender.id) {
      backend(event).notify("terminal-close", { terminal });
      terminals.delete(terminal);
    }
  record.dirty = false;
  record.reloadState = reloadState;
  imageCache.clear();
  event.sender.reload();
  return true;
});

function launch(argv, cwd, initial = false) {
  const args = argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith("--inspect"));
  let target = initial ? process.env.LWR_SSH_TARGET : undefined;
  let selected = initial ? process.env.LWR_ROOT : undefined;
  const sshIndex = argv.indexOf("--ssh"),
    localIndex = argv.indexOf("--local");
  if (sshIndex !== -1) {
    target = argv[sshIndex + 1];
    if (!target) throw new Error("Usage: owlet --ssh user@host [directory]");
    selected = argv[sshIndex + 2];
  } else if (localIndex !== -1) {
    target = undefined;
    selected = argv[localIndex + 1] || cwd;
  } else if (args[0] && !args[0].startsWith("-")) {
    target = undefined;
    selected = args[0];
  }
  const session = sessionFor(target);
  if (session.kind === "local") {
    const location = selected
      ? path.resolve(cwd, selected)
      : session.state.home;
    const info = fs.statSync(location);
    openWindow(
      (info.isDirectory() ? location : path.dirname(location)).replaceAll(
        "\\",
        "/",
      ),
      info.isDirectory() ? undefined : location.replaceAll("\\", "/"),
      session,
    );
  } else {
    void session.connect().catch(() => {});
    openWindow(selected, undefined, session);
  }
}
if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() }))
  app.quit();
else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    try {
      launch(process.argv, process.cwd(), true);
    } catch (error) {
      dialog.showErrorBox("Could not open workspace", error.message);
      openWindow();
    }
  });
  app.on("second-instance", (_, argv, cwd, additional) => {
    try {
      launch(additional?.argv || argv, additional?.cwd || cwd);
    } catch (error) {
      dialog.showErrorBox("Could not open workspace", error.message);
    }
  });
  app.on("window-all-closed", () => {
    for (const session of sessions.values()) session.close();
    app.quit();
  });
  app.on("before-quit", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      for (const session of sessions.values()) session.close();
  });
}
