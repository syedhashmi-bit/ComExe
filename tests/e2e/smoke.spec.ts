import { test, expect } from "@playwright/test";

test.describe("Dashboard smoke tests", () => {
  // ?demo=1 short-circuits the first-run redirect in page.tsx ("if (demoMode)
  // return" before the configured===0 check) and feeds the page fake data, so
  // this asserts against the real dashboard on a machine with no homelab
  // reachable. Without it the test lands on /welcome and proves nothing.
  test("loads the main dashboard page", async ({ page }) => {
    await page.goto("/?demo=1");
    await expect(page).toHaveURL(/demo=1/);
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("setup wizard loads", async ({ page }) => {
    await page.goto("/setup");
    // The wizard renders a plain <div> tree — no <form>, no <main>, no
    // data-testid anywhere. The previous selector ("form, main, [data-testid]")
    // could never match, so this test failed on every run.
    await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("input").first()).toBeVisible();
  });

  test("welcome flow loads", async ({ page }) => {
    await page.goto("/welcome");
    // Should render the welcome page content
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("login page resolves to either a form or a redirect", async ({ page }) => {
    await page.goto("/login");
    // /login fetches /api/auth/status on mount and only then decides: render
    // the form (auth on) or router.replace to "/" (auth off). Sampling url +
    // form count immediately, as this test used to, reads the intermediate
    // "checking" state where neither is true yet — a guaranteed flake that
    // failed whenever the fetch hadn't resolved. Poll until it settles.
    await expect
      .poll(async () => {
        if (!page.url().includes("/login")) return "redirected";
        return (await page.locator("form").count()) > 0 ? "form" : "checking";
      }, { timeout: 10_000 })
      .not.toBe("checking");
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
    // Must stay in demo mode. On an unconfigured machine "/" redirects to
    // /welcome, whose own theme-preview effect writes its selected theme
    // (default midnight) onto <html> — clobbering theme-forge and failing
    // this test for a reason that has nothing to do with theming.
    // Seed BEFORE navigating. Writing localStorage after goto() is racy:
    // goto resolves on `load`, which can precede hydration, and page.tsx has a
    // `useEffect(..., [settings])` that persists the still-default settings on
    // its first commit — clobbering whatever the test just wrote. addInitScript
    // runs before any page script, so the value is already there for the
    // pre-hydration theme script in layout.tsx to read.
    await page.addInitScript(() => {
      localStorage.setItem("comexe:settings", JSON.stringify({ theme: "forge" }));
    });
    await page.goto("/?demo=1");
    // layout.tsx applies the class in a pre-hydration inline script, so it is
    // present before React mounts.
    await expect(page.locator("html")).toHaveClass(/theme-forge/, { timeout: 10_000 });
  });
});
