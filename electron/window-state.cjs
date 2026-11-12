// Reload metadata only: never store file contents, terminal output or commands.
function validateWindowState(value) {
  const fail = () => {
    throw new Error("Invalid reload window state");
  };
  if (
    !value ||
    value.version !== 1 ||
    JSON.stringify(value).length > 1024 * 1024
  )
    fail();
  const text = (v) => {
    if (typeof v !== "string" || !v || v.length > 8192 || v.includes("\0"))
      fail();
    return v;
  };
  const number = (v, min, max) => {
    if (!Number.isFinite(v) || v < min || v > max) fail();
    return v;
  };
  const id = (v) => {
    if (!Number.isSafeInteger(v) || v < 1) fail();
    return v;
  };
  const groupIds = new Set(),
    splitIds = new Set(),
    paths = new Set(),
    modeKeys = new Set();
  const layout = (node, depth = 0) => {
    if (!node || depth > 128) fail();
    if (node.kind === "group") {
      const g = node.group,
        group = id(g?.id);
      if (groupIds.has(group) || !Array.isArray(g.tabs)) fail();
      groupIds.add(group);
      const tabs = [...new Set(g.tabs.map(text))];
      tabs.forEach((p) => {
        paths.add(p);
        modeKeys.add(`${group}:${p}`);
      });
      if (g.active !== undefined && !tabs.includes(g.active)) fail();
      return { kind: "group", group: { id: group, tabs, active: g.active } };
    }
    if (
      node.kind !== "split" ||
      !["row", "column"].includes(node.axis) ||
      splitIds.has(id(node.id))
    )
      fail();
    splitIds.add(node.id);
    return {
      kind: "split",
      id: node.id,
      axis: node.axis,
      ratio: number(node.ratio, 0.01, 0.99),
      first: layout(node.first, depth + 1),
      second: layout(node.second, depth + 1),
    };
  };
  const restoredLayout = layout(value.layout);
  if (!groupIds.has(value.activeGroup) || !Array.isArray(value.terminals))
    fail();
  const terminalIds = new Set();
  const terminals = value.terminals.map((item) => {
    const terminal = text(item.id);
    if (
      !terminal.startsWith("owlet-terminal:") ||
      terminalIds.has(terminal) ||
      !["panel", "editor"].includes(item.location)
    )
      fail();
    terminalIds.add(terminal);
    if ((item.location === "editor") !== paths.has(terminal)) fail();
    return {
      id: terminal,
      name: text(item.name).slice(0, 80),
      path: text(item.path),
      location: item.location,
    };
  });
  for (const p of paths)
    if (p.startsWith("owlet-terminal:") && !terminalIds.has(p)) fail();
  const map = (data, allowed, check) =>
    Object.fromEntries(
      Object.entries(data || {})
        .filter(([key]) => allowed.has(key))
        .map(([key, v]) => [key, check(v)]),
    );
  const mode = (v) => {
    if (!["source", "preview", "both"].includes(v)) fail();
    return v;
  };
  if (
    typeof value.sidebar !== "boolean" ||
    typeof value.terminalVisible !== "boolean"
  )
    fail();
  return {
    version: 1,
    layout: restoredLayout,
    activeGroup: value.activeGroup,
    modes: map(value.modes, paths, mode),
    viewModes: map(value.viewModes, modeKeys, mode),
    previewRatios: map(value.previewRatios, modeKeys, (v) =>
      number(v, 0.08, 0.92),
    ),
    previewZoom: number(value.previewZoom, 0.5, 3),
    sidebar: value.sidebar,
    sidebarWidth: number(value.sidebarWidth, 160, 500),
    terminalVisible: value.terminalVisible,
    terminalHeight: number(value.terminalHeight, 0, 100000),
    terminals,
    activeTerminal: terminalIds.has(value.activeTerminal)
      ? value.activeTerminal
      : terminals[0]?.id,
    terminalSerial: number(value.terminalSerial, 0, Number.MAX_SAFE_INTEGER),
  };
}
module.exports = { validateWindowState };
