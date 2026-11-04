const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const outputIndex = process.argv.indexOf("--out");
  if (outputIndex !== -1 && !process.argv[outputIndex + 1])
    throw new Error("--out requires a destination inside release/");
  const destination = path.resolve(
    root,
    outputIndex === -1 ? "release/Owlet" : process.argv[outputIndex + 1],
  );
  if (!destination.startsWith(path.join(root, "release") + path.sep))
    throw new Error("Invalid package destination");
  if (outputIndex !== -1 && !process.argv.includes("--no-shortcuts"))
    throw new Error("Custom package destinations require --no-shortcuts");
  const packageVersion = require("../package.json").version;
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion))
    throw new Error("Expected a numeric major.minor.patch release version");
  const [major, minor, patch] = packageVersion.split(".").map(Number);
  const owletBuild = {
    label: process.env.OWLET_BUILD_LABEL || "Portable build",
    commit: null,
    dirty: false,
    builtAt: new Date().toISOString(),
  };
  try {
    owletBuild.commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    owletBuild.dirty = !!execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    owletBuild.label = process.env.OWLET_BUILD_LABEL || "Source archive build";
  }
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
  fs.copyFileSync(
    path.join(root, "node_modules/mark.js/LICENSE"),
    path.join(destination, "LICENSE.mark.js"),
  );
  fs.copyFileSync(
    path.join(root, "node_modules/pdfjs-dist/LICENSE"),
    path.join(destination, "LICENSE.pdfjs"),
  );
  fs.copyFileSync(
    path.join(root, "assets/LICENSE.lucide.txt"),
    path.join(destination, "LICENSE.lucide"),
  );
  // node-pty ships its native ConPTY binaries; no Node or compiler is needed by users.
  for (const moduleName of ["node-pty", "jsonc-parser"]) {
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
        path.resolve(destination, "resources", "app") + path.sep,
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
        version: packageVersion,
        owletBuild,
        license: require("../package.json").license,
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
  if (fs.existsSync(path.join(root, "LICENSE"))) {
    // Keep the runtime's own license when adding the project's license.
    fs.copyFileSync(
      path.join(destination, "LICENSE"),
      path.join(destination, "LICENSE.electron"),
    );
    fs.copyFileSync(
      path.join(root, "LICENSE"),
      path.join(destination, "LICENSE"),
    );
    fs.copyFileSync(path.join(root, "LICENSE"), path.join(appDir, "LICENSE"));
  }
  // Keep the portable README's images, examples and public documentation usable.
  for (const relative of [
    "README_CN.md",
    "AGENTS.md",
    "docs/reviews",
    "assets/icon.png",
    "examples",
    "docs/images",
    "docs/usage.md",
    "docs/commands.md",
    "docs/development.md",
    "docs/spacing.md",
    "docs/performance.md",
  ]) {
    if (
      relative === "README_CN.md" &&
      !fs.existsSync(path.join(root, relative))
    )
      continue;
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
    version.setFileVersion(major, minor, patch, 0, 1033);
    version.setProductVersion(major, minor, patch, 0, 1033);
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  fs.writeFileSync(target, Buffer.from(executable.generate()));
  let shortcut = null;
  if (!process.argv.includes("--no-shortcuts")) {
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
    shortcut = JSON.parse(
      fs.readFileSync(
        path.join(root, "artifacts/shortcut-results.json"),
        "utf8",
      ),
    ).find((item) => path.basename(item.link) === "Owlet.lnk").link;
  }
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
