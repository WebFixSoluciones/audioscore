import { test, expect } from "@playwright/test";
test.skip(
  process.env.LOCAL_E2E !== "1",
  "Requires the local Firebase-backed application.",
);
test("the local studio requires sign-in and never exposes the processing archive anonymously", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("http://localhost:3000/studio", { timeout: 180000 });
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Iniciar sesión", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Faded - prueba local")).toHaveCount(0);
  const jobs = await page.request.get("http://localhost:3000/api/local/jobs");
  expect(jobs.status()).toBe(401);
  const files = await page.request.get(
    "http://localhost:3000/api/local/jobs/e12aa8f0-8c21-4957-8388-825d8e7fc3b6/files/original.wav",
    { headers: { "x-local-user": "forged-user" } },
  );
  expect(files.status()).toBe(401);
  const session = await page.request.post(
    "http://localhost:3000/api/auth/session",
    {
      headers: { origin: "http://localhost:3000" },
      data: { idToken: "invalid.invalid.invalid.invalid" },
    },
  );
  expect(session.status()).toBe(401);
});
