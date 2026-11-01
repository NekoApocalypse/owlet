const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const destination = path.join(root, "release", "Owlet");
  if (!destination.startsWith(root + path.sep))
    throw new Error("Invalid package destination");
  if (!fs.existsSync(path.join(root, "dist", "index.html")))
    throw new Error("Run npm run build first");
  const runtime = path.dirname(require("electron"));
  execFileSync(process.execPath, [path.join(__dirname, "generate-icon.cjs")], {
    stdio: "inherit",
    windowsHide: true,
  });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(runtime, destination, { recursive: true });
  fs.renameSync(
    path.join(destination, "electron.exe"),
    path.join(destination, "Owlet.exe"),
  );
  const appDir = path.join(destination, "resources", "app");
  fs.mkdirSync(appDir, { recursive: true });
  // node-pty ships its native ConPTY binaries; no Node or compiler is needed by users.
  for (const moduleName of ["node-pty"]) {
    fs.cpSync(
      path.join(root, "node_modules", moduleName),
      path.join(appDir, "node_modules", moduleName),
      { recursive: true },
    );
  }
  for (const directory of ["dist", "electron", "remote", "assets"]) {
    const generatedTarget = path.resolve(appDir, directory);
    if (
      !generatedTarget.startsWith(
        path.resolve(root, "release", "Owlet", "resources", "app") + path.sep,
      )
    )
      throw new Error("Invalid generated application path");
    fs.rmSync(generatedTarget, { recursive: true, force: true });
    if (directory === "assets") {
      fs.mkdirSync(generatedTarget, { recursive: true });
      for (const name of [
        "icon.ico",
        "icon.png",
        "icon-manifest.json",
        require("../assets/icon-manifest.json").icon,
      ])
        fs.copyFileSync(
          path.join(root, directory, name),
          path.join(generatedTarget, name),
        );
    } else {
      fs.cpSync(path.join(root, directory), generatedTarget, {
        recursive: true,
      });
    }
  }
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "owlet",
        productName: "Owlet",
        version: "0.1.0",
        main: "electron/main.cjs",
      },
      null,
      2,
    ),
  );
  fs.copyFileSync(
    path.join(root, "README.md"),
    path.join(destination, "README.md"),
  );
  // Keep the portable README's images, examples and public documentation usable.
  for (const relative of [
    "assets/icon.png",
    "examples",
    "docs/images",
    "docs/usage.md",
    "docs/development.md",
    "docs/spacing.md",
    "docs/performance.md",
  ]) {
    const output = path.join(destination, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.cpSync(path.join(root, relative), output, { recursive: true });
  }
  const target = path.join(destination, "Owlet.exe");
  // Brand the generated executable, leaving the installed Electron runtime untouched.
  const { NtExecutable, NtExecutableResource, Resource, Data } =
    await import("resedit");
  const executable = NtExecutable.from(fs.readFileSync(target), {
    ignoreCert: true,
  });
  const resources = NtExecutableResource.from(executable);
  const icon = Data.IconFile.from(
    fs.readFileSync(path.join(root, "assets/icon.ico")),
  );
  for (const group of Resource.IconGroupEntry.fromEntries(resources.entries))
    Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map((item) => item.data),
    );
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    version.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: "Owlet — A quiet workspace for agent work",
        ProductName: "Owlet",
        InternalName: "Owlet",
        OriginalFilename: "Owlet.exe",
        CompanyName: "Owlet",
        LegalCopyright: "Owlet contributors",
      },
    );
    version.setFileVersion(0, 1, 0, 0, 1033);
    version.setProductVersion(0, 1, 0, 0, 1033);
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  fs.writeFileSync(target, Buffer.from(executable.generate()));
  const shortcutEnv = { ...process.env };
  delete shortcutEnv.ELECTRON_RUN_AS_NODE;
  execFileSync(
    require("electron"),
    [path.join(__dirname, "install-shortcuts.cjs")],
    {
      env: shortcutEnv,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const shortcut = JSON.parse(
    fs.readFileSync(path.join(root, "artifacts/shortcut-results.json"), "utf8"),
  ).find((item) => path.basename(item.link) === "Owlet.lnk").link;
  console.log(
    JSON.stringify(
      { executable: target, shortcut, package: destination },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "package.json"),
    JSON.stringify(
      { executable: target, shortcut, package: destination },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
