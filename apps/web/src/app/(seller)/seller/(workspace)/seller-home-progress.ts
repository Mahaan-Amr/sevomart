export function guideProgress(published: boolean, hasProduct: boolean): 1 | 2 | 3 {
  return !published ? 1 : hasProduct ? 3 : 2;
}
