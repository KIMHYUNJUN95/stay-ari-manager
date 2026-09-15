const { HOTELS } = require("./constants");
const { maybeSaveDebugScreenshot, retry, sleep } = require("./shared");

async function openCleaningSchedule(page, {
    operatingDate,
    debug = false,
} = {}) {
    if (!operatingDate) throw new Error("Missing operatingDate");

    const url = `${HOTELS.cleaningScheduleBaseUrl}${encodeURIComponent(operatingDate)}`;

    await retry(async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.locator('input.el-input__inner[placeholder*="物件"]').last().waitFor({ state: "visible", timeout: 30000 });
        await sleep(1500);
    }, {
        attempts: 5,
        delayMs: 2000,
        label: "openCleaningSchedule",
    });

    await maybeSaveDebugScreenshot(page, `schedule-${operatingDate}`, debug);
}

module.exports = {
    openCleaningSchedule,
};
