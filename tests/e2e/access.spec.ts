import { test, expect } from "@playwright/test";
test("la landing conduce al ingreso y el acceso administrativo exige una sesión", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Navegación pública" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Administración", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Ingresar" })
    .click();
  await expect(page).toHaveURL(/\/auth\/login$/, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Iniciar sesión", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
  for (const path of [
    "/admin/users",
    "/admin/plans",
    "/dashboard",
    "/dashboard/studio",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(
      page.getByRole("heading", { name: "Vuelve a tu música." }),
    ).toBeVisible();
  }
});
