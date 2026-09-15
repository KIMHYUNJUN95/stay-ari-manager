const { HOTELS } = require("./constants");
const { maybeSaveDebugScreenshot, retry } = require("./shared");

async function login(page, {
    loginId,
    password,
    debug = false,
} = {}) {
    if (!loginId || !password) {
        throw new Error("Missing HOTELSMART credentials");
    }

    await retry(async () => {
        await page.goto(HOTELS.loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        const loginIdInput = page.locator('input[name="login_id"], input.p-login_input[type="text"]').first();
        const passwordInput = page.locator('input[name="password"], input.p-login_input[type="password"], input[type="password"]').first();
        const passwordLoginRadio = page.locator('input[name="login_method"][value="password"]').first();
        const submitButton = page.locator('button[type="submit"], button.c-button').first();

        await loginIdInput.waitFor({ state: "visible", timeout: 30000 });
        await passwordInput.waitFor({ state: "visible", timeout: 30000 });

        if (await passwordLoginRadio.count()) {
            await passwordLoginRadio.check({ force: true });
        }

        await loginIdInput.fill(loginId);
        await passwordInput.fill(password);
        await page.waitForFunction(() => {
            const button = document.querySelector('button[type="submit"], button.c-button');
            return Boolean(button) && !button.disabled;
        }, null, { timeout: 30000 });

        try {
            await Promise.all([
                page.waitForURL((url) => {
                    const path = url.pathname.replace(/\/+$/u, "");
                    return path !== "/host/login";
                }, { waitUntil: "domcontentloaded", timeout: 60000 }),
                submitButton.click(),
            ]);
        } catch (error) {
            const visibleError = await page.locator(
                '.p-login_error, .error, .alert, [role="alert"]'
            ).allInnerTexts().then((items) => items
                .map((item) => String(item || "").replace(/\s+/gu, " ").trim())
                .filter(Boolean)
                .join(" | ")
                .slice(0, 500)
            ).catch(() => "");
            const detail = visibleError ? ` (${visibleError})` : "";
            throw new Error(`HOTELSMART login did not leave the login page: ${page.url()}${detail}`);
        }
    }, {
        attempts: 5,
        delayMs: 2000,
        label: "login",
    });

    await maybeSaveDebugScreenshot(page, "after-login", debug);
}

module.exports = {
    login,
};
