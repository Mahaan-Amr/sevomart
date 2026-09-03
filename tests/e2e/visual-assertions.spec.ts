import { expect, test } from "@playwright/test";
import { assertInteractiveTargets } from "../helpers/visual-assertions";

test("target sizing ignores closed details but rejects undersized rendered controls", async ({
  page,
}) => {
  await page.setContent(`
    <html lang="fa" dir="rtl"><body>
      <details><summary>گزینه‌ها</summary><a href="#" style="display:block;width:24px;height:24px">ورود</a></details>
      <button style="width:44px;height:44px">ادامه</button>
    </body></html>
  `);
  await assertInteractiveTargets(page, "a, button");
  await page.locator("details").evaluate((element: HTMLDetailsElement) => {
    element.open = true;
  });
  await expect(assertInteractiveTargets(page, "a, button")).rejects.toThrow(
    /at least 40px/,
  );
  await page.locator("a").evaluate((element: HTMLElement) => {
    element.style.width = "44px";
    element.style.height = "44px";
  });
  await assertInteractiveTargets(page, "a, button");
  await page.locator("button").evaluate((element: HTMLElement) => {
    element.style.cssText = "width:0;height:0;padding:0;border:0;overflow:hidden";
  });
  await expect(assertInteractiveTargets(page, "a, button")).rejects.toThrow(
    /at least 40px/,
  );
});
