export type BuyerDestination =
  | "/"
  | "/discover"
  | "/profile"
  | "/following"
  | "/cart"
  | "/orders"
  | "/conversations";

const sellerEntryPaths = new Set(["/seller/login", "/seller/application"]);

export function showBuyerNavigation(pathname: string) {
  if (pathname === "/platform" || pathname.startsWith("/platform/")) return false;
  if (pathname === "/seller" || pathname.startsWith("/seller/")) {
    return sellerEntryPaths.has(pathname);
  }
  return true;
}

export function activeBuyerDestination(pathname: string): BuyerDestination | null {
  if (pathname === "/profile") return "/profile";
  if (pathname === "/" || pathname.startsWith("/s/")) return "/";
  if (pathname === "/discover") return "/discover";
  if (pathname === "/following") return "/following";
  if (pathname === "/cart" || pathname.startsWith("/checkout")) return "/cart";
  if (
    pathname === "/orders" ||
    pathname.startsWith("/orders/") ||
    pathname.startsWith("/purchases/")
  )
    return "/orders";
  if (pathname === "/conversations" || pathname.startsWith("/conversations/"))
    return "/conversations";
  return null;
}
