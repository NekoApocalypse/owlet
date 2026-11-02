export type PreviewFindAction =
  "find" | "findNext" | "findPrevious" | "closeFind" | "findState";
export type PreviewFindRequest = {
  group: number;
  action: PreviewFindAction;
  search?: string;
  handled?: boolean;
  result?: unknown;
};
export function previewFindCommand(
  group: number,
  action: PreviewFindAction,
  search?: string,
) {
  if (!Number.isInteger(group)) throw new Error("Choose a valid preview group");
  if (
    search !== undefined &&
    (typeof search !== "string" || search.length > 512)
  )
    throw new Error("Preview search must be text of at most 512 characters");
  const detail: PreviewFindRequest = { group, action, search };
  window.dispatchEvent(new CustomEvent("owlet-preview-find", { detail }));
  if (!detail.handled)
    throw new Error("Open a Markdown preview in the requested group first");
  return detail.result;
}
