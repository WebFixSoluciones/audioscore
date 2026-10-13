const hosts = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "audioscore.localhost",
]);
export function localAccessAllowed(request: Request, enabled: boolean) {
  if (!enabled) return false;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const publicUrl = host ? new URL(`${url.protocol}//${host}`) : url;
  if (!hosts.has(url.hostname) || !hosts.has(publicUrl.hostname)) return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== publicUrl.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
