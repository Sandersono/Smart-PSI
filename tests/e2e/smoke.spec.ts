import { expect, test } from "@playwright/test";

test.describe("smartpsi smoke", () => {
  test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to run browser smoke tests.");

  test("renders auth screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SmartPSI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });
});
