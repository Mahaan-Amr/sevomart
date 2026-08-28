/** Accept navigation destinations only, never external URLs or API/auth endpoints. */
export function safeReturnPath(value: string | undefined, fallback: string): string {
  if (!value?.startsWith("/")) return fallback;
  try {
    let decoded = value;
    for (let depth = 0; depth < 4; depth += 1) {
      if (
        decoded.startsWith("//") ||
        decoded.includes("\\") ||
        Array.from(decoded).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      ) {
        return fallback;
      }
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      if (depth === 3) return fallback;
      decoded = next;
    }
    const base = "https://sevo.local";
    const target = new URL(value, base);
    const decodedTarget = new URL(decoded, base);
    if (
      target.origin !== base ||
      decodedTarget.origin !== base ||
      /^\/(?:api|login)(?:\/|$)/.test(decodedTarget.pathname)
    )
      return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function firstParameter(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function loginHref(returnTo: string, cancelTo: string) {
  return `/login?${new URLSearchParams({
    returnTo: safeReturnPath(returnTo, "/"),
    cancelTo: safeReturnPath(cancelTo, "/"),
  })}`;
}
