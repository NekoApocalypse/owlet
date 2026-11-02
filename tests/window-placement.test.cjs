const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { windowPlacement } = require("../electron/window-placement.cjs");
test("new windows cascade and wrap inside the selected work area", () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1920, y: 40, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 800, height: 500 },
  ]) {
    let previous = windowPlacement(area);
    for (let i = 0; i < 12; i++) {
      const next = windowPlacement(area, previous);
      assert(next.x >= area.x && next.y >= area.y);
      assert(
        next.x + next.width <= area.x + area.width &&
          next.y + next.height <= area.y + area.height,
      );
      assert(next.x !== previous.x || next.y !== previous.y);
      previous = next;
    }
  }
  const next = windowPlacement(
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 100, y: 100, width: 900, height: 600 },
  );
  assert.equal(next.x, 132);
  assert.equal(next.y, 132);
});
