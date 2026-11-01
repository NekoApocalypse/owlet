import type { Group, Layout } from "./types";
export function groups(layout: Layout): Group[] {
  return layout.kind === "group"
    ? [layout.group]
    : [...groups(layout.first), ...groups(layout.second)];
}
export function mapGroup(
  layout: Layout,
  id: number,
  change: (group: Group) => Group,
): Layout {
  return layout.kind === "group"
    ? {
        ...layout,
        group: layout.group.id === id ? change(layout.group) : layout.group,
      }
    : {
        ...layout,
        first: mapGroup(layout.first, id, change),
        second: mapGroup(layout.second, id, change),
      };
}
export function replaceGroup(
  layout: Layout,
  id: number,
  replacement: Layout,
): Layout {
  return layout.kind === "group"
    ? layout.group.id === id
      ? replacement
      : layout
    : {
        ...layout,
        first: replaceGroup(layout.first, id, replacement),
        second: replaceGroup(layout.second, id, replacement),
      };
}
export function removeGroup(layout: Layout, id: number): Layout | null {
  if (layout.kind === "group") return layout.group.id === id ? null : layout;
  const first = removeGroup(layout.first, id),
    second = removeGroup(layout.second, id);
  return !first ? second : !second ? first : { ...layout, first, second };
}
export function resizeSplit(layout: Layout, id: number, ratio: number): Layout {
  if (layout.kind === "group") return layout;
  return layout.id === id
    ? { ...layout, ratio }
    : {
        ...layout,
        first: resizeSplit(layout.first, id, ratio),
        second: resizeSplit(layout.second, id, ratio),
      };
}
