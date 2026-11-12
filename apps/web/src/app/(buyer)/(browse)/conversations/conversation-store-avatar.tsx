"use client";

import { useState } from "react";
import styles from "./conversations.module.css";

export function StoreAvatar({
  name,
  logoMediaId,
}: {
  name?: string;
  logoMediaId?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.avatar} aria-hidden="true">
      {logoMediaId && !failed ? (
        <img
          src={`/api/store/media/${logoMediaId}`}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        Array.from(name ?? "ف")[0]
      )}
    </span>
  );
}
