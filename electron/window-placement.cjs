function windowPlacement(area, previous) {
  const width = Math.min(previous?.width || 1440, Math.max(1, area.width - 64));
  const height = Math.min(
    previous?.height || 940,
    Math.max(1, area.height - 64),
  );
  const maxX = area.x + area.width - width,
    maxY = area.y + area.height - height;
  let x = previous
    ? previous.x + 32
    : area.x + Math.round((area.width - width) / 2);
  let y = previous
    ? previous.y + 32
    : area.y + Math.round((area.height - height) / 2);
  if (x > maxX) x = area.x;
  if (y > maxY) y = area.y;
  return {
    x: Math.max(area.x, x),
    y: Math.max(area.y, y),
    width,
    height,
    minWidth: Math.min(850, width),
    minHeight: Math.min(600, height),
  };
}
module.exports = { windowPlacement };
