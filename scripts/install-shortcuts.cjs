// Run with Electron so Windows Shell properties (including AppUserModelID) are
// written together. Only migrate links that target this checkout's own builds.
const { app, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
app
  .whenReady()
  .then(() => {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    const target = path.join(root, "release/Owlet/Owlet.exe");
    const legacy = path.join(root, "release/LWR/LWR.exe");
    const same = (a, b) =>
      path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const icon = path.join(
      root,
      "release/Owlet/resources/app/assets",
      require("../assets/icon-manifest.json").icon,
    );
    const desktop = app.getPath("desktop");
    const programs = path.join(
      app.getPath("appData"),
      "Microsoft/Windows/Start Menu/Programs",
    );
    const pinned = path.join(
      app.getPath("appData"),
      "Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar",
    );
    const links = new Set([
      path.join(desktop, "Owlet.lnk"),
      path.join(programs, "Owlet.lnk"),
    ]);
    for (const directory of [desktop, programs, pinned]) {
      if (!fs.existsSync(directory)) continue;
      for (const name of fs.readdirSync(directory)) {
        if (!name.toLowerCase().endsWith(".lnk")) continue;
        const link = path.join(directory, name);
        try {
          const details = shell.readShortcutLink(link);
          if (same(details.target, target) || same(details.target, legacy))
            links.add(link);
        } catch {
          /* Other applications' links are not ours to repair. */
        }
      }
    }
    const proof = [];
    for (const link of links) {
      const exists = fs.existsSync(link);
      const previous = exists ? shell.readShortcutLink(link) : null;
      if (
        previous &&
        !same(previous.target, target) &&
        !same(previous.target, legacy)
      )
        throw new Error(`Refusing to replace unrelated shortcut: ${link}`);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      const details = {
        target,
        cwd: path.dirname(target),
        icon,
        iconIndex: 0,
        appUserModelId: "Owlet.Desktop",
        description: "Owlet — A quiet workspace for agent work",
        args: previous?.args || "",
      };
      if (!shell.writeShortcutLink(link, exists ? "update" : "create", details))
        throw new Error(`Could not write shortcut: ${link}`);
      const actual = shell.readShortcutLink(link);
      for (const key of ["target", "icon", "appUserModelId"])
        if (actual[key] !== details[key])
          throw new Error(`Shortcut ${key} did not persist: ${link}`);
      proof.push({ link, ...actual });
    }
    fs.writeFileSync(
      path.join(root, "artifacts/shortcut-results.json"),
      JSON.stringify(proof, null, 2),
    );
    console.log(
      `Verified ${proof.length} Owlet shortcuts, including existing legacy/pinned links.`,
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
