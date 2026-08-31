import { cookies } from "next/headers";
import Link from "next/link";

import { readSellerDispute } from "../../../../../../lib/seller-dispute-api";
import { SellerDisputeResponse } from "../../../disputes/seller-dispute-response";
import styles from "../../../disputes/seller-disputes.module.css";

type Props = { params: Promise<{ disputeId: string }> };

export default async function SellerDisputePage({ params }: Props) {
  const { disputeId } = await params;
  const result = await readSellerDispute((await cookies()).toString(), disputeId);

  if (result.kind !== "OK") {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="unavailable-title">
          <Link className={styles.back} href="/seller/disputes">
            بازگشت به پرونده‌های اختلاف
          </Link>
          <h1 id="unavailable-title">این پرونده در دسترس نیست</h1>
          <p>پرونده بسته یا متعلق به فروشگاه دیگر از این مسیر نمایش داده نمی‌شود.</p>
        </section>
      </main>
    );
  }

  return <SellerDisputeResponse initialDispute={result.data} />;
}
