import { groups, mapGroup, removeGroup, replaceGroup } from "./layout";
import type { Layout } from "./types";
export type TileEdge = "left" | "right" | "top" | "bottom";
export function tileOpenTab(
  layout: Layout,
  path: string,
  source: number | undefined,
  destination: number,
  edge: TileEdge,
  groupId: number,
  splitId: number,
): Layout {
  const all = groups(layout),
    target = all.find((group) => group.id === destination);
  if (!target || !["left", "right", "top", "bottom"].includes(edge))
    throw Error("Choose a valid target group and edge.");
  if (
    source !== undefined &&
    !all.some((group) => group.id === source && group.tabs.includes(path))
  )
    throw Error("Choose an open tab to tile.");
  let next = layout;
  if (source !== undefined)
    next = mapGroup(next, source, (group) => {
      const tabs = group.tabs.filter((item) => item !== path);
      return {
        ...group,
        tabs,
        active: group.active === path ? tabs[0] : group.active,
      };
    });
  const existing: Layout = {
    kind: "group",
    group: groups(next).find((group) => group.id === destination)!,
  };
  const added: Layout = {
    kind: "group",
    group: { id: groupId, tabs: [path], active: path },
  };
  const before = edge === "left" || edge === "top";
  next = replaceGroup(next, destination, {
    kind: "split",
    id: splitId,
    axis: edge === "left" || edge === "right" ? "row" : "column",
    ratio: 0.5,
    first: before ? added : existing,
    second: before ? existing : added,
  });
  if (
    source !== undefined &&
    source !== destination &&
    !groups(next).find((group) => group.id === source)?.tabs.length
  )
    next = removeGroup(next, source) || next;
  return next;
}
export function dropEdge(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): TileEdge | "center" {
  const distances: [TileEdge, number][] = [
    ["left", x - rect.left],
    ["right", rect.left + rect.width - x],
    ["top", y - rect.top],
    ["bottom", rect.top + rect.height - y],
  ];
  const [edge, distance] = distances.sort((a, b) => a[1] - b[1])[0];
  return distance >= 0 &&
    distance < Math.min(80, rect.width * 0.25, rect.height * 0.25)
    ? edge
    : "center";
}
