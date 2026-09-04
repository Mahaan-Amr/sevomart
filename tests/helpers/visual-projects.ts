export const visualViewports = [
  { name: "chromium-360x800", width: 360, height: 800 },
  { name: "chromium-390x844", width: 390, height: 844 },
  { name: "chromium-768x1024", width: 768, height: 1024 },
  { name: "chromium-1440x900", width: 1440, height: 900 },
] as const;

export const deterministicScreenshotOptions = {
  animations: "disabled",
  fullPage: true,
  maxDiffPixelRatio: 0.015,
} as const;

export const visualSnapshotTimestamp = "2026-08-29T09:00:00.000Z";

export const storefrontTestMobiles = Array.from({ length: 8 }, (_, index) =>
  testMobile(20 + index),
);

export const acceptanceTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(30 + index),
);

export const storeBuilderTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(160 + index),
);

export const storeFollowingTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(164 + index),
);

export const sellerApplicationDraftTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(40 + index),
);

export const sellerWorkspaceTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(44 + index),
);

export const sellerConversationTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(144 + index),
);

export const buyerConversationTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(148 + index),
);

export const otherSellerConversationTestMobiles = Array.from(
  { length: 4 },
  (_, index) => testMobile(152 + index),
);

export const productTracerTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(50 + index),
);

export const simpleProductTracerTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(54 + index),
);

export const sellerInventoryTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(156 + index),
);

export const sellerRefundTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(170 + index),
);

export const sellerBuyerTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(174 + index),
);

export const sellerFulfillmentTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(178 + index),
);

export const sellerRefundRecoveryTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(182 + index),
);

export const sellerDisputeTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(186 + index),
);

export const sellerReportsTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(194 + index),
);

export const sellerSalesContentTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(198 + index),
);

export const guestCartTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(60 + index),
);

export const sameStoreCartConflictTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(70 + index),
);

export const differentStoreCartConflictTestMobiles = Array.from(
  { length: 4 },
  (_, index) => testMobile(80 + index),
);

export const paymentBuyerTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(90 + index),
);

export const paymentSellerTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(94 + index),
);

export const releaseSellerTestMobiles = Array.from({ length: 12 }, (_, index) =>
  testMobile(100 + index),
);

export const releaseAgentTestMobiles = Array.from({ length: 12 }, (_, index) =>
  testMobile(112 + index),
);

export const releaseBuyerTestMobiles = Array.from({ length: 12 }, (_, index) =>
  testMobile(124 + index),
);

export const allE2eTestMobiles = [
  ...storefrontTestMobiles,
  ...acceptanceTestMobiles,
  ...storeBuilderTestMobiles,
  ...storeFollowingTestMobiles,
  ...sellerApplicationDraftTestMobiles,
  ...sellerWorkspaceTestMobiles,
  ...sellerConversationTestMobiles,
  ...buyerConversationTestMobiles,
  ...otherSellerConversationTestMobiles,
  ...productTracerTestMobiles,
  ...simpleProductTracerTestMobiles,
  ...sellerInventoryTestMobiles,
  ...sellerRefundTestMobiles,
  ...sellerBuyerTestMobiles,
  ...sellerFulfillmentTestMobiles,
  ...sellerRefundRecoveryTestMobiles,
  ...sellerDisputeTestMobiles,
  ...sellerReportsTestMobiles,
  ...sellerSalesContentTestMobiles,
  ...guestCartTestMobiles,
  ...sameStoreCartConflictTestMobiles,
  ...differentStoreCartConflictTestMobiles,
  ...paymentBuyerTestMobiles,
  ...paymentSellerTestMobiles,
  ...releaseSellerTestMobiles,
  ...releaseAgentTestMobiles,
  ...releaseBuyerTestMobiles,
];

export function visualProjectIndex(projectName: string) {
  const viewportName = projectName.match(/^(?:chromium|webkit)-(\d+x\d+)$/)?.[1];
  const index = visualViewports.findIndex(({ name }) =>
    name.endsWith(`-${viewportName}`),
  );
  if (index === -1) throw new Error(`Unknown visual project ${projectName}`);
  return index;
}

export function e2eApiBaseUrl() {
  return `http://127.0.0.1:${process.env.SEVO_E2E_API_PORT ?? "3109"}`;
}

function testMobile(suffix: number) {
  return `09111111${String(suffix).padStart(3, "0")}`;
}
