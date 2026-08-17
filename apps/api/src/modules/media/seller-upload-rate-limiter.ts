export class SellerUploadRateLimiter {
  readonly #windows = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  accept(sellerId: string): boolean {
    const now = this.now();
    const recent = (this.#windows.get(sellerId) ?? []).filter(
      (value) => now - value < 60_000,
    );
    if (recent.length >= 12) return false;
    recent.push(now);
    this.#windows.set(sellerId, recent);
    return true;
  }
}
