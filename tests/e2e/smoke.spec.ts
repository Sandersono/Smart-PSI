import { expect, test } from "@playwright/test";

test.describe("smartpsi smoke", () => {
  test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to run browser smoke tests.");

  test("renders auth screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SmartPSI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  test("auth exposes signup, forgot and recovery update screens", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Criar Conta" }).click();
    await expect(page.getByPlaceholder("Seu nome")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar Conta" })).toBeVisible();

    await page.getByRole("button", { name: "Entrar" }).first().click();
    await page.getByRole("button", { name: "Esqueci minha senha" }).click();
    await expect(page.getByRole("button", { name: "Enviar link de recuperacao" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Voltar para entrar" })).toBeVisible();

    await page.goto("/#type=recovery");
    await expect(page.getByText("Defina sua nova senha para continuar.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Atualizar senha" })).toBeVisible();
  });

  test("secretary role hides clinical sidebar items", async ({ page }) => {
    const email = process.env.E2E_SECRETARY_EMAIL || "";
    const password = process.env.E2E_SECRETARY_PASSWORD || "";
    test.skip(
      !email || !password,
      "Set E2E_SECRETARY_EMAIL and E2E_SECRETARY_PASSWORD to validate role restrictions."
    );

    await page.goto("/");
    await page.getByPlaceholder("voce@exemplo.com").fill(email);
    await page.getByPlaceholder("Sua senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).first().click();

    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Pacientes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Financeiro" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nova Sessao" })).toHaveCount(0);
  });
});
