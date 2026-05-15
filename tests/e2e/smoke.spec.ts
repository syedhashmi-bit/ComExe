import { test, expect } from "@playwright/test";

test.describe("Dashboard smoke tests", () => {
  test("loads the main dashboard page", async ({ page }) => {
    await page.goto("/");
    // Should see the ComExe header or be redirected to /welcome
    const url = page.url();
    const onDashboard = !url.includes("/welcome") && !url.includes("/login");
    if (onDashboard) {
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("setup wizard loads", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("form, main, [data-testid]")).toBeVisible({ timeout: 10_000 });
  });

  test("welcome flow loads", async ({ page }) => {
    await page.goto("/welcome");
    // Should render the welcome page content
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("login page loads when auth not enabled", async ({ page }) => {
    await page.goto("/login");
    // Should either show login form or redirect to dashboard (if auth disabled)
    const url = page.url();
    const hasForm = await page.locator("form").count();
    const redirected = !url.includes("/login");
    expect(hasForm > 0 || redirected).toBe(true);
  });

  test("API config endpoint returns JSON", async ({ request }) => {
    const res = await request.get("/api/config");
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("truenasIp");
    expect(data).toHaveProperty("serviceUrls");
    expect(data).toHaveProperty("preferences");
  });

  test("API auth status endpoint returns JSON", async ({ request }) => {
    const res = await request.get("/api/auth/status");
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("enabled");
    expect(data).toHaveProperty("authenticated");
  });

  test("API history endpoint returns JSON", async ({ request }) => {
    const res = await request.get("/api/history?range=1h");
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("points");
    expect(data).toHaveProperty("count");
  });
});

test.describe("Theme switching", () => {
  test("applies theme class to html element", async ({ page }) => {
    await page.goto("/");
    // Set theme to forge via localStorage and reload
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("comexe:settings") || "{}");
      settings.theme = "forge";
      localStorage.setItem("comexe:settings", JSON.stringify(settings));
    });
    await page.reload();
    const hasThemeClass = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-forge")
    );
    expect(hasThemeClass).toBe(true);
  });
});
