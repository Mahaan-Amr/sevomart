type ReadinessRequest = (url: string) => Promise<{ ok: boolean }>;

export async function dependencyIsReady(
  url: string | undefined,
  request: ReadinessRequest = async (target) =>
    fetch(target, { signal: AbortSignal.timeout(2_000) }),
): Promise<boolean> {
  if (!url) return false;
  try {
    return (await request(url)).ok;
  } catch {
    return false;
  }
}
