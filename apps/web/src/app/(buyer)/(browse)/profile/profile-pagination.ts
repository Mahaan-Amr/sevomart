export function productPageQuery(cursor?: string) {
  return new URLSearchParams({ limit: "30", ...(cursor ? { cursor } : {}) }).toString();
}

export function nextProfilePage(cursor: string | null) {
  return cursor ? `/profile?${new URLSearchParams({ cursor })}` : undefined;
}
