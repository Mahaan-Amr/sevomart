import { orderItemIdContract } from "@sevo/contracts/orders/v1";

import { firstParameter, safeReturnPath } from "../../../../lib/navigation";
import { PurchaseExperienceForm } from "./purchase-experience-form";
import styles from "./purchase-experience.module.css";

type Query = {
  orderItemId?: string | string[];
  returnTo?: string | string[];
};

export default async function NewPurchaseExperiencePage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const orderItemId = orderItemIdContract.safeParse(firstParameter(query.orderItemId));
  const returnTo = safeReturnPath(firstParameter(query.returnTo), "/orders");
  if (!orderItemId.success) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} role="alert">
          <h1>ثبت تجربه ممکن نیست</h1>
          <p>قلم سفارش مشخص نیست. از جزئیات سفارش دوباره وارد این مسیر شوید.</p>
          <a className={styles.secondary} href={returnTo}>
            بازگشت
          </a>
        </section>
      </main>
    );
  }
  const resumePath = `/purchase-experiences/new?${new URLSearchParams({
    orderItemId: orderItemId.data,
    returnTo,
  })}`;
  return (
    <PurchaseExperienceForm
      orderItemId={orderItemId.data}
      returnTo={returnTo}
      resumePath={resumePath}
    />
  );
}
