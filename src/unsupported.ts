// Transport, permission and missing-path errors are not unsupported formats.
export function unsupportedReason(error: unknown): string | undefined {
  const message = String(error)
    .replace(/^Error: Error invoking remote method '[^']+': Error: /, "")
    .replace(/^Error: /, "");
  return /binary file|encoded data was not valid|utf-?8.*(?:can't decode|invalid|codec)|unsupported (?:image|file) format|not a valid PDF|(?:text|pdf|images?|file).* (?:limited to|exceeds).*MiB/i.test(
    message,
  )
    ? message
    : undefined;
}
