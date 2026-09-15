const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { chromium } = require("playwright-core");
const chromiumPack = require("@sparticuz/chromium");
const { HOTELSMART_ACTIVE_PROPERTY_ORDER, HOTELSMART_PROPERTY_ORDER } = require("./constants");
const { extractCleaningRows } = require("./extractCleaningRows");
const { login } = require("./login");
const { openCleaningSchedule } = require("./openCleaningSchedule");
const { selectProperty } = require("./selectProperty");

dayjs.extend(utc);
dayjs.extend(timezone);

const TOKYO_TZ = "Asia/Tokyo";
const Chromium = chromiumPack.default || chromiumPack;

/**
 * @typedef {Object} HotelsmartCleaningAssignment
 * @property {string} propertyName
 * @property {string} roomRaw
 * @property {string} roomCodeNormalized
 * @property {string} roomType
 * @property {string} roomStatus
 * @property {string} cleaningStatus
 * @property {string} stayInfoRaw
 * @property {string} checkoutTime
 * @property {string} checkinTime
 * @property {string} cleaningCompanyRaw
 * @property {string} assigneeRaw
 * @property {string} assigneeNormalized
 * @property {string} notes
 * @property {string} collectedAt
 * @property {string} operatingDate
 */

/**
 * @typedef {Object} HotelsmartPropertyAssignments
 * @property {string} propertyName
 * @property {HotelsmartCleaningAssignment[]} assignments
 */

/**
 * @typedef {Object} HotelsmartAssignmentsResult
 * @property {string} operatingDate
 * @property {string} collectedAt
 * @property {HotelsmartPropertyAssignments[]} properties
 * @property {number} assignmentCount
 */

function resolveOperatingDate(explicitDate) {
    return explicitDate
        ? dayjs.tz(explicitDate, TOKYO_TZ).format("YYYY-MM-DD")
        : dayjs().tz(TOKYO_TZ).format("YYYY-MM-DD");
}

function resolveRequestedProperties(propertyNames = []) {
    if (!Array.isArray(propertyNames) || propertyNames.length === 0) {
        return [...HOTELSMART_ACTIVE_PROPERTY_ORDER];
    }

    const requested = new Set(propertyNames.map((name) => String(name || "").trim()).filter(Boolean));
    return HOTELSMART_PROPERTY_ORDER.filter((name) => requested.has(name));
}

async function resolveBrowserLaunchOptions() {
    const envExecutablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    if (envExecutablePath) {
        return { executablePath: envExecutablePath, headless: true };
    }

    if (process.platform === "win32") {
        const knownWindowsBrowsers = [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
            "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        ];

        for (const executablePath of knownWindowsBrowsers) {
            try {
                require("fs").accessSync(executablePath);
                return { executablePath, headless: true };
            } catch (error) {
                continue;
            }
        }
    }

    return {
        executablePath: await Chromium.executablePath(),
        args: Chromium.args,
        headless: true,
    };
}

/**
 * @param {{
 *   operatingDate?: string,
 *   propertyNames?: string[],
 *   credentials?: { loginId?: string, password?: string },
 *   debug?: boolean,
 * }} options
 * @returns {Promise<HotelsmartAssignmentsResult>}
 */
async function collectTodayAssignments(options = {}) {
    const operatingDate = resolveOperatingDate(options.operatingDate);
    const propertyNames = resolveRequestedProperties(options.propertyNames);
    const credentials = {
        loginId: String(options.credentials?.loginId || process.env.HOTELSMART_LOGIN_ID || "").trim(),
        password: String(options.credentials?.password || process.env.HOTELSMART_PASSWORD || "").trim(),
    };
    if (!credentials.loginId || !credentials.password) {
        throw new Error("HOTELSMART credentials are not configured");
    }
    const collectedAt = new Date().toISOString();
    const browserLaunchOptions = await resolveBrowserLaunchOptions();

    const browser = await chromium.launch(browserLaunchOptions);
    const context = await browser.newContext({
        viewport: { width: 1600, height: 2200 },
    });
    const loginPage = await context.newPage();

    try {
        await login(loginPage, {
            loginId: credentials.loginId,
            password: credentials.password,
            debug: options.debug,
        });

        await loginPage.close();

        /** @type {HotelsmartPropertyAssignments[]} */
        const properties = [];

        for (const propertyName of propertyNames) {
            let bestAssignments = [];

            for (let pass = 0; pass < 3; pass += 1) {
                const propertyPage = await context.newPage();

                try {
                    await openCleaningSchedule(propertyPage, {
                        operatingDate,
                        debug: options.debug,
                    });
                    await selectProperty(propertyPage, { propertyName, debug: options.debug });
                    let assignments = await extractCleaningRows(propertyPage, {
                        propertyName,
                        operatingDate,
                        collectedAt,
                    });

                    if (assignments.length === 0) {
                        await openCleaningSchedule(propertyPage, {
                            operatingDate,
                            debug: options.debug,
                        });
                        await selectProperty(propertyPage, { propertyName, debug: options.debug });
                        assignments = await extractCleaningRows(propertyPage, {
                            propertyName,
                            operatingDate,
                            collectedAt,
                        });
                    }

                    if (assignments.length > bestAssignments.length) {
                        bestAssignments = assignments;
                    }
                } finally {
                    await propertyPage.close();
                }
            }

            properties.push({ propertyName, assignments: bestAssignments });
        }

        return {
            operatingDate,
            collectedAt,
            properties,
            assignmentCount: properties.reduce((sum, property) => sum + property.assignments.length, 0),
        };
    } finally {
        await context.close();
        await browser.close();
    }
}

module.exports = {
    collectTodayAssignments,
};
