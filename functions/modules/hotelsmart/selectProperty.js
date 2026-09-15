const { maybeSaveDebugScreenshot, retry, sleep } = require("./shared");

function getPropertyInput(page) {
    return page.locator('input.el-input__inner[placeholder*="物件"]').last();
}

async function selectProperty(page, {
    propertyName,
    debug = false,
} = {}) {
    if (!propertyName) throw new Error("Missing propertyName");

    await retry(async () => {
        const propertyInput = getPropertyInput(page);
        await propertyInput.click();
        const visibleDropdown = page.locator(".el-select-dropdown.el-popper:visible").last();
        await visibleDropdown.waitFor({ state: "visible", timeout: 15000 });

        const option = visibleDropdown.locator(".el-select-dropdown__item").filter({ hasText: propertyName }).first();
        await option.waitFor({ state: "visible", timeout: 15000 });
        await option.click();

        await sleep(3000);
        await propertyInput.waitFor({ state: "visible", timeout: 15000 });
        await page.waitForFunction((name) => {
            const inputs = Array.from(document.querySelectorAll("input.el-input__inner"));
            const input = inputs.reverse().find((node) => String(node.getAttribute("placeholder") || "").includes("物件"));
            return Boolean(input) && String(input.value || "").trim() === name;
        }, propertyName, { timeout: 15000 });
        await sleep(1500);
        const selectedValue = await propertyInput.inputValue();
        if (String(selectedValue || "").trim() !== propertyName) {
            throw new Error(`Property selection did not stick for ${propertyName}`);
        }
    }, {
        attempts: 5,
        delayMs: 1500,
        label: `selectProperty(${propertyName})`,
    });

    await maybeSaveDebugScreenshot(page, `property-${propertyName.replace(/[^A-Za-z0-9_-]+/g, "_")}`, debug);
}

module.exports = {
    selectProperty,
};
