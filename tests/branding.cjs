const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const { NtExecutable, NtExecutableResource, Resource, Data } =
    await import("resedit");
  const executable =
    process.env.LWR_PACKAGED ||
    path.resolve(__dirname, "../release/Owlet/Owlet.exe");
  const resources = NtExecutableResource.from(
    NtExecutable.from(fs.readFileSync(executable)),
  );
  const expected = Data.IconFile.from(
    fs.readFileSync(path.resolve(__dirname, "../assets/icon.ico")),
  );
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  assert.ok(groups.length > 0);
  for (const group of groups) {
    const icons = group.getIconItemsFromEntries(resources.entries);
    assert.equal(icons.length, 7);
    for (let index = 0; index < icons.length; index++) {
      assert.deepEqual(
        Buffer.from(icons[index].bin),
        Buffer.from(expected.icons[index].data.bin),
      );
    }
  }
  const version = Resource.VersionInfo.fromEntries(
    resources.entries,
  )[0].getStringValues({ lang: 1033, codepage: 1200 });
  assert.equal(version.ProductName, "Owlet");
  assert.equal(version.OriginalFilename, "Owlet.exe");
  assert.equal(version.InternalName, "Owlet");
  const assets = path.join(path.dirname(executable), "resources/app/assets");
  const iconName = require("../assets/icon-manifest.json").icon;
  assert.deepEqual(
    fs.readdirSync(assets).sort(),
    ["icon-manifest.json", "icon.ico", "icon.png", iconName].sort(),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(assets, iconName)),
    fs.readFileSync(path.join(assets, "icon.ico")),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(assets, "icon.png")),
    fs.readFileSync(path.resolve(__dirname, "../assets/icon.png")),
  );
  const proof = {
    executable,
    iconSizes: expected.icons.map((icon) => icon.data.width),
    version,
    verified: true,
  };
  fs.writeFileSync(
    path.resolve(__dirname, "../artifacts/branding-results.json"),
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
