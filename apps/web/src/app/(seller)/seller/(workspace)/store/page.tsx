import { StoreStatus } from "../../store/store-status";
import styles from "../workspace-page.module.css";

export default function SellerStorePage() {
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-store-title">
        <span className={styles.eyebrow}>فروشگاه</span>
        <h1 id="seller-store-title">وضعیت فروشگاه</h1>
        <StoreStatus />
      </section>
    </main>
  );
}
