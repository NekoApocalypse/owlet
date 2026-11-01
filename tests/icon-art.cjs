const { Resvg } = require("@resvg/resvg-js");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const ico = fs.readFileSync(path.join(root, "assets/icon.ico"));
const results = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const p = 6 + i * 16;
  const size = ico[p] || 256;
  const offset = ico.readUInt32LE(p + 12);
  const data = ico.subarray(offset, offset + ico.readUInt32LE(p + 8));
  const uri = `data:image/png;base64,${data.toString("base64")}`;
  const render = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="${uri}" width="${size}" height="${size}"/></svg>`,
  ).render();
  const pixels = render.pixels;
  let transparent = 0,
    opaque = 0;
  for (let a = 3; a < pixels.length; a += 4) {
    if (pixels[a] === 0) transparent++;
    if (pixels[a] > 240) opaque++;
  }
  assert.ok(
    transparent / (size * size) > 0.1,
    `Outside background must remain transparent at ${size}px`,
  );
  assert.ok(
    opaque / (size * size) > 0.45,
    `Solid owl silhouette required at ${size}px`,
  );
  for (const point of [0, size - 1]) assert.equal(pixels[point * 4 + 3], 0);
  results.push({
    size,
    transparentFraction: transparent / (size * size),
    opaqueFraction: opaque / (size * size),
  });
}
const uri = `data:image/png;base64,${fs.readFileSync(path.join(root, "assets/icon.png")).toString("base64")}`;
const backgrounds = ["#f6f6f6", "#001126", "#fa9af4", "#44775a"];
const cells = backgrounds
  .map(
    (color, row) =>
      `<rect y="${row * 140}" width="560" height="140" fill="${color}"/>` +
      [16, 24, 32, 64, 96]
        .map(
          (size, col) =>
            `<image href="${uri}" x="${col * 110 + (110 - size) / 2}" y="${row * 140 + (140 - size) / 2}" width="${size}" height="${size}"/>`,
        )
        .join(""),
  )
  .join("");
fs.writeFileSync(
  path.join(root, "artifacts/icon-surfaces.png"),
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560">${cells}</svg>`,
  )
    .render()
    .asPng(),
);
fs.writeFileSync(
  path.join(root, "artifacts/icon-art-results.json"),
  JSON.stringify(results, null, 2),
);
console.log(
  "Transparent background and solid owl verified at all seven icon sizes.",
);
