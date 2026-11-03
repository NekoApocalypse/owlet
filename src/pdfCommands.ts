export type PdfAction =
  | "nextPage"
  | "previousPage"
  | "page"
  | "zoomIn"
  | "zoomOut"
  | "fitWidth"
  | "actualSize"
  | "copyPageText"
  | "state";
export const pdfViewers = new Map<
  number,
  (action: PdfAction, args: Record<string, any>) => unknown
>();
export function pdfCommand(
  group: number,
  action: PdfAction,
  args: Record<string, any> = {},
) {
  const viewer = pdfViewers.get(group);
  if (!viewer) throw new Error("Open a PDF and wait for it to load first");
  return viewer(action, args);
}
