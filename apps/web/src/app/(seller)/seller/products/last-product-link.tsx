"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LAST_PRODUCT_ID_STORAGE = "sevo-last-product-id";

export function LastProductLink({ className }: { className?: string }) {
  const [productId, setProductId] = useState("");

  useEffect(() => {
    setProductId(localStorage.getItem(LAST_PRODUCT_ID_STORAGE) ?? "");
  }, []);

  return productId ? (
    <Link className={className} href={`/seller/products/${productId}/edit`}>
      ویرایش آخرین کالا
    </Link>
  ) : null;
}
