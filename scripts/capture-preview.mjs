import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto("http://localhost:3000/studio");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/studio.png", fullPage: true });
} finally { await browser.close(); }
