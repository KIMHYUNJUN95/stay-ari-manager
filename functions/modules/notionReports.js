const { Client: NotionClient } = require("@notionhq/client");

function createNotionReportModule({
    onSchedule,
    onRequest,
    cors,
    db,
    dayjs,
    DEFAULT_COMPANY_ID,
    cleanPrice
}) {
    function getNotionClient() {
        const token = process.env.NOTION_API_SECRET || process.env.NOTION_TOKEN;
        if (!token || token === "ntn_YOUR_NOTION_TOKEN_HERE") {
            throw new Error("NOTION_TOKEN 환경변수가 설정되지 않았습니다.");
        }
        return new NotionClient({ auth: token });
    }

    async function aggregateMonthlyStats(yearMonth, companyId) {
        const salesLogDoc = await db.doc(`salesLogs/${yearMonth}`).get();
        let monthlyStats = {};
        if (salesLogDoc.exists && salesLogDoc.data().monthlyStats) {
            monthlyStats = salesLogDoc.data().monthlyStats;
        }

        const resSnap = await db.collection("reservations")
            .where("companyId", "==", companyId)
            .where("status", "==", "confirmed")
            .where("stayMonth", "==", yearMonth)
            .get();

        const reservations = resSnap.docs.map((d) => d.data());

        const byBuilding = {};
        const byPlatform = {};
        let totalRevenue = 0;
        let totalNights = 0;

        reservations.forEach((r) => {
            const building = r.building || "기타";
            const platform = r.platform || "기타";
            const revenue = cleanPrice(r.price || r.totalPrice || 0);
            const nights = r.nights || (r.arrival && r.departure
                ? dayjs(r.departure).diff(dayjs(r.arrival), "day")
                : 0);

            if (!byBuilding[building]) byBuilding[building] = { revenue: 0, nights: 0, bookings: 0 };
            byBuilding[building].revenue += revenue;
            byBuilding[building].nights += nights;
            byBuilding[building].bookings += 1;

            if (!byPlatform[platform]) byPlatform[platform] = { revenue: 0, bookings: 0 };
            byPlatform[platform].revenue += revenue;
            byPlatform[platform].bookings += 1;

            totalRevenue += revenue;
            totalNights += nights;
        });

        return { byBuilding, byPlatform, totalRevenue, totalNights, bookingCount: reservations.length, monthlyStats };
    }

    async function createMonthlyNotionReport(notion, parentPageId, yearMonth, companyId) {
        const stats = await aggregateMonthlyStats(yearMonth, companyId);
        const title = `📊 ${yearMonth} 월간 매출·가동률 리포트`;

        const buildingRows = Object.entries(stats.byBuilding)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .map(([name, s]) => ({
                type: "table_row",
                table_row: {
                    cells: [
                        [{ type: "text", text: { content: name } }],
                        [{ type: "text", text: { content: `¥${s.revenue.toLocaleString()}` } }],
                        [{ type: "text", text: { content: `${s.bookings}건` } }],
                        [{ type: "text", text: { content: `${s.nights}박` } }]
                    ]
                }
            }));

        const platformRows = Object.entries(stats.byPlatform)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .map(([name, s]) => {
                const ratio = stats.totalRevenue > 0
                    ? ((s.revenue / stats.totalRevenue) * 100).toFixed(1)
                    : "0.0";
                return {
                    type: "table_row",
                    table_row: {
                        cells: [
                            [{ type: "text", text: { content: name } }],
                            [{ type: "text", text: { content: `¥${s.revenue.toLocaleString()}` } }],
                            [{ type: "text", text: { content: `${s.bookings}건` } }],
                            [{ type: "text", text: { content: `${ratio}%` } }]
                        ]
                    }
                };
            });

        const children = [
            {
                type: "heading_2",
                heading_2: { rich_text: [{ type: "text", text: { content: "📈 월간 요약" } }] }
            },
            {
                type: "callout",
                callout: {
                    rich_text: [
                        { type: "text", text: { content: `총 매출: ¥${stats.totalRevenue.toLocaleString()}  |  예약 건수: ${stats.bookingCount}건  |  총 박수: ${stats.totalNights}박` } }
                    ],
                    icon: { type: "emoji", emoji: "💰" },
                    color: "blue_background"
                }
            },
            { type: "divider", divider: {} },
            {
                type: "heading_2",
                heading_2: { rich_text: [{ type: "text", text: { content: "🏢 건물별 매출" } }] }
            },
            ...(buildingRows.length > 0 ? [{
                type: "table",
                table: {
                    table_width: 4,
                    has_column_header: true,
                    has_row_header: false,
                    children: [
                        {
                            type: "table_row",
                            table_row: {
                                cells: [
                                    [{ type: "text", text: { content: "건물" } }],
                                    [{ type: "text", text: { content: "매출" } }],
                                    [{ type: "text", text: { content: "예약" } }],
                                    [{ type: "text", text: { content: "박수" } }]
                                ]
                            }
                        },
                        ...buildingRows
                    ]
                }
            }] : [{
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", text: { content: "데이터 없음" } }] }
            }]),
            { type: "divider", divider: {} },
            {
                type: "heading_2",
                heading_2: { rich_text: [{ type: "text", text: { content: "🌐 플랫폼별 매출 비율" } }] }
            },
            ...(platformRows.length > 0 ? [{
                type: "table",
                table: {
                    table_width: 4,
                    has_column_header: true,
                    has_row_header: false,
                    children: [
                        {
                            type: "table_row",
                            table_row: {
                                cells: [
                                    [{ type: "text", text: { content: "플랫폼" } }],
                                    [{ type: "text", text: { content: "매출" } }],
                                    [{ type: "text", text: { content: "예약" } }],
                                    [{ type: "text", text: { content: "비율" } }]
                                ]
                            }
                        },
                        ...platformRows
                    ]
                }
            }] : [{
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", text: { content: "데이터 없음" } }] }
            }]),
            { type: "divider", divider: {} },
            {
                type: "paragraph",
                paragraph: {
                    rich_text: [{
                        type: "text",
                        text: { content: `자동 생성: ${dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm")} (JST)` },
                        annotations: { color: "gray" }
                    }]
                }
            }
        ];

        const page = await notion.pages.create({
            parent: { type: "page_id", page_id: parentPageId },
            properties: {
                title: { title: [{ type: "text", text: { content: title } }] }
            },
            children
        });

        return page.id;
    }

    const scheduledMonthlyNotionReport = onSchedule({
        schedule: "0 9 1 * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 120,
        memory: "256MiB"
    }, async () => {
        const notion = getNotionClient();
        const parentPageId = process.env.NOTION_REPORT_PAGE_ID;
        if (!parentPageId || parentPageId === "YOUR_NOTION_PAGE_ID_HERE") {
            console.error("❌ NOTION_REPORT_PAGE_ID 환경변수가 설정되지 않았습니다.");
            return;
        }

        const prevMonth = dayjs().tz("Asia/Tokyo").subtract(1, "month").format("YYYY-MM");
        console.log(`📊 [Notion 월간 리포트] ${prevMonth} 리포트 생성 시작`);

        try {
            const pageId = await createMonthlyNotionReport(notion, parentPageId, prevMonth, DEFAULT_COMPANY_ID);
            console.log(`✅ [Notion 월간 리포트] 생성 완료 — pageId: ${pageId}`);
        } catch (e) {
            console.error("❌ [Notion 월간 리포트] 실패:", e.message);
        }
    });

    const sendNotionReport = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
        cors(req, res, async () => {
            try {
                const { companyId, yearMonth } = req.body;
                if (!companyId) return res.status(400).json({ error: "companyId 필수" });

                const targetMonth = yearMonth || dayjs().tz("Asia/Tokyo").format("YYYY-MM");
                const notion = getNotionClient();
                const parentPageId = process.env.NOTION_REPORT_PAGE_ID;

                if (!parentPageId || parentPageId === "YOUR_NOTION_PAGE_ID_HERE") {
                    return res.status(500).json({ error: "NOTION_REPORT_PAGE_ID 환경변수 미설정" });
                }

                const pageId = await createMonthlyNotionReport(notion, parentPageId, targetMonth, companyId);
                res.json({ success: true, pageId, yearMonth: targetMonth });
            } catch (e) {
                console.error("❌ [sendNotionReport]:", e.message);
                res.status(500).json({ error: e.message });
            }
        });
    });

    return {
        scheduledMonthlyNotionReport,
        sendNotionReport
    };
}

module.exports = {
    createNotionReportModule
};
