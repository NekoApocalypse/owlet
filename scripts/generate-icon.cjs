const { Resvg } = require("@resvg/resvg-js");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
// Preserve the generated alpha; only resample for Windows icon sizes.
const source = fs.readFileSync(
  path.join(root, "assets/concepts/owlet-selected-transparent.png"),
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="data:image/png;base64,${source.toString("base64")}" width="1024" height="1024"/></svg>`;
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((width) =>
  Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(),
  ),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const p = 6 + index * 16;
  header[p] = header[p + 1] = size % 256;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(images[index].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += images[index].length;
});
fs.writeFileSync(path.join(root, "assets/icon.png"), images.at(-1));
const ico = Buffer.concat([header, ...images]);
const iconName = `owlet-${createHash("sha256").update(ico).digest("hex").slice(0, 12)}.ico`;
fs.writeFileSync(path.join(root, "assets/icon.ico"), ico);
// A new path prevents Explorer's path-keyed cache from reusing an earlier logo.
fs.writeFileSync(path.join(root, "assets", iconName), ico);
fs.writeFileSync(
  path.join(root, "assets/icon-manifest.json"),
  JSON.stringify({ icon: iconName }, null, 2) + "\n",
);
console.log("Generated Owlet icons at 16–256 pixels.");
