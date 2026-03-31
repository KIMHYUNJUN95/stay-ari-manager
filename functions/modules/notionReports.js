const { Client: NotionClient } = require("@notionhq/client");
const { computeRevenueDashboardData } = require("./revenueDashboardData");

function createNotionReportModule({
    onSchedule,
    onRequest,
    cors,
    db,
    dayjs,
    DEFAULT_COMPANY_ID,
    BUILDING_ROOMS
}) {
    function getNotionClient() {
        const token = process.env.NOTION_API_SECRET || process.env.NOTION_TOKEN;
        if (!token || token === "ntn_YOUR_NOTION_TOKEN_HERE") {
            throw new Error("NOTION_TOKEN 환경변수가 설정되지 않았습니다.");
        }
        return new NotionClient({ auth: token });
    }

    function formatYen(value) {
        return `¥${Math.round(Number(value || 0)).toLocaleString()}`;
    }

    async function aggregateMonthlyStats(yearMonth, companyId) {
        const salesData = await computeRevenueDashboardData(db, {
            companyId,
            BUILDING_ROOMS,
            forYearMonth: yearMonth
        });

        if (!salesData) {
            return null;
        }

        const coreRevenue = Number(salesData.currentMonthRevenue) || 0;
        const referenceRevenue = Number(salesData.referenceRevenue) || 0;
        const totalRevenueWithReference = Number(salesData.totalRevenueWithReference || (coreRevenue + referenceRevenue)) || 0;
        const adr = salesData.occupiedRoomNights > 0
            ? Math.round(coreRevenue / salesData.occupiedRoomNights)
            : 0;

        const byBuilding = [
            ...(Array.isArray(salesData.coreBuildingStats) ? salesData.coreBuildingStats : []),
            ...(Array.isArray(salesData.okuboHomeStats) ? salesData.okuboHomeStats : []),
            ...(Array.isArray(salesData.referenceBuildingStats) ? salesData.referenceBuildingStats : [])
        ].sort((a, b) => b.revenue - a.revenue);

        const rawPlatformRows = Array.isArray(salesData.platformBreakdown) && salesData.platformBreakdown.length > 0
            ? salesData.platformBreakdown
            : [
                { key: "airbnb", name: "Airbnb", revenue: Number(salesData.platformAirbnb) || 0 },
                { key: "booking", name: "Booking.com", revenue: Number(salesData.platformBooking) || 0 },
                { key: "expedia", name: "Expedia", revenue: Number(salesData.platformExpedia) || 0 },
                { key: "agoda", name: "Agoda", revenue: Number(salesData.platformAgoda) || 0 },
                { key: "direct", name: "Direct(수기)", revenue: Number(salesData.platformDirect) || 0 },
                { key: "other", name: "Other", revenue: Number(salesData.platformOther) || 0 }
            ];

        const byPlatform = rawPlatformRows
            .filter((row) => row && (row.key !== "other" || Number(row.revenue) > 0))
            .map((row) => ({
                ...row,
                revenue: Number(row.revenue) || 0,
                sharePct: coreRevenue > 0 ? Number((((Number(row.revenue) || 0) / coreRevenue) * 100).toFixed(1)) : 0
            }));

        return {
            salesData,
            coreRevenue,
            referenceRevenue,
            totalRevenueWithReference,
            adr,
            byBuilding,
            byPlatform
        };
    }

    async function createMonthlyNotionReport(notion, parentPageId, yearMonth, companyId) {
        const stats = await aggregateMonthlyStats(yearMonth, companyId);
        if (!stats) {
            throw new Error("월간 매출·가동률 데이터를 생성할 수 없습니다.");
        }
        const title = `📊 ${yearMonth} 월간 매출·가동률 리포트`;

        const changePct = Number(stats.salesData.changePct) || 0;
        const buildingRows = stats.byBuilding
            .map((item) => ({
                type: "table_row",
                table_row: {
                    cells: [
                        [{ type: "text", text: { content: item.building } }],
                        [{ type: "text", text: { content: item.buildingType || "기타" } }],
                        [{ type: "text", text: { content: `${item.roomCount || 0}개` } }],
                        [{ type: "text", text: { content: formatYen(item.revenue) } }],
                        [{ type: "text", text: { content: `${Number(item.occupancyPct || 0).toFixed(1)}%` } }],
                        [{ type: "text", text: { content: formatYen(item.adr) } }]
                    ]
                }
            }));

        const platformRows = stats.byPlatform.map((item) => ({
            type: "table_row",
            table_row: {
                cells: [
                    [{ type: "text", text: { content: item.name } }],
                    [{ type: "text", text: { content: formatYen(item.revenue) } }],
                    [{ type: "text", text: { content: `${item.sharePct.toFixed(1)}%` } }]
                ]
            }
        }));

        const children = [
            {
                type: "heading_2",
                heading_2: { rich_text: [{ type: "text", text: { content: "📈 월간 요약" } }] }
            },
            {
                type: "callout",
                callout: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content: `운영 객실: ${stats.salesData.totalRooms || 0}개  |  점유 객실박: ${stats.salesData.occupiedRoomNights || 0}/${stats.salesData.totalRoomNights || 0}  |  월 기준: ${yearMonth}`
                            }
                        }
                    ],
                    icon: { type: "emoji", emoji: "💰" },
                    color: "blue_background"
                }
            },
            {
                type: "paragraph",
                paragraph: {
                    rich_text: [{
                        type: "text",
                        text: {
                            content: `시스템 Revenue / Occupancy Dashboard 기준 집계입니다. 매출은 날짜 overlap 배분, 가동률은 객실별 점유일 중복 제거 기준으로 계산합니다.`
                        },
                        annotations: { color: "gray", italic: true }
                    }]
                }
            },
            {
                type: "callout",
                callout: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content: `운영 매출: ${formatYen(stats.coreRevenue)}  |  참고 매출: ${formatYen(stats.referenceRevenue)}  |  전체 노출 매출: ${formatYen(stats.totalRevenueWithReference)}`
                            }
                        }
                    ],
                    icon: { type: "emoji", emoji: "🏢" },
                    color: "green_background"
                }
            },
            {
                type: "callout",
                callout: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content: `가동률: ${Number(stats.salesData.occupancyPct || 0).toFixed(1)}%  |  ADR: ${formatYen(stats.adr)}  |  체크인 예약 건수: ${stats.salesData.checkinReservationCount ?? stats.salesData.stayMonthReservationCount ?? 0}건  |  생성 예약 건수(bookDate 기준): ${stats.salesData.bookingCreatedCount || stats.salesData.bookingCount || 0}건  |  전월 대비: ${changePct >= 0 ? "+" : ""}${changePct}%`
                            }
                        }
                    ],
                    icon: { type: "emoji", emoji: changePct >= 0 ? "📈" : "📉" },
                    color: changePct >= 0 ? "blue_background" : "yellow_background"
                }
            },
            { type: "divider", divider: {} },
            {
                type: "heading_2",
                heading_2: { rich_text: [{ type: "text", text: { content: "🏢 건물별 운영 현황" } }] }
            },
            ...(buildingRows.length > 0 ? [{
                type: "table",
                table: {
                    table_width: 6,
                    has_column_header: true,
                    has_row_header: false,
                    children: [
                        {
                            type: "table_row",
                            table_row: {
                                cells: [
                                    [{ type: "text", text: { content: "건물" } }],
                                    [{ type: "text", text: { content: "유형" } }],
                                    [{ type: "text", text: { content: "객실수" } }],
                                    [{ type: "text", text: { content: "매출" } }],
                                    [{ type: "text", text: { content: "가동률" } }],
                                    [{ type: "text", text: { content: "ADR" } }]
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
                    table_width: 3,
                    has_column_header: true,
                    has_row_header: false,
                    children: [
                        {
                            type: "table_row",
                            table_row: {
                                cells: [
                                    [{ type: "text", text: { content: "플랫폼" } }],
                                    [{ type: "text", text: { content: "매출" } }],
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
