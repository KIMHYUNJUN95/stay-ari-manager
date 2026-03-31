/**
 * 구글 시트 리포트·대시보드 데이터를 노션 페이지에 동기화합니다.
 * NOTION_API_SECRET: .env 또는 Firebase params (배포 시 .env 로드)
 */
const { Client: NotionClient } = require("@notionhq/client");
const { defineString } = require("firebase-functions/params");
const NOTION_PAGES = require("../config/notionReportPages");
const { getDailyRevenueChartUrl, getBookingCountChartUrl, getCumulativeRevenueChartUrl, getCancelByDayChartUrl } = require("./chartImage");

const notionApiSecretParam = defineString("NOTION_API_SECRET", { default: "" });

const BLOCK_CHUNK_SIZE = 100; // Notion API limit per request
const TEXT_MAX = 2000;       // Notion rich text content limit per block

function getNotionClient() {
    let token = notionApiSecretParam.value() || process.env.NOTION_API_SECRET || process.env.NOTION_TOKEN;
    if (!token && typeof require("firebase-functions").config === "function") {
        try {
            const cfg = require("firebase-functions").config();
            token = cfg.notion && cfg.notion.api_secret;
        } catch (_) {}
    }
    token = token && String(token).trim();
    if (!token || token.startsWith("ntn_YOUR_") || token === "YOUR_NOTION_TOKEN_HERE") {
        return null;
    }
    return new NotionClient({
        auth: token,
        notionVersion: "2026-03-11"
    });
}

function richText(content) {
    const str = String(content ?? "").slice(0, TEXT_MAX);
    return [{ type: "text", text: { content: str } }];
}

/** rich_text with annotations (bold, color). color: "blue" | "gray" | "brown" | "orange" | "yellow" | "green" | "red" | "purple" | "pink" */
function richTextAnnotated(content, opts = {}) {
    const str = String(content ?? "").slice(0, TEXT_MAX);
    const annotations = {};
    if (opts.bold) annotations.bold = true;
    if (opts.color && opts.color !== "default") annotations.color = opts.color;
    if (opts.italic) annotations.italic = true;
    return [{ type: "text", text: { content: str }, annotations }];
}

/** 링크가 있는 rich_text (버튼/액션용) */
function richTextWithLink(content, url) {
    const str = String(content ?? "").slice(0, TEXT_MAX);
    const text = { content: str };
    if (url && String(url).startsWith("http")) text.link = { url: String(url).slice(0, 2000) };
    return [{ type: "text", text }];
}

/** 구분선 블록 */
function divider() {
    return { type: "divider", divider: {} };
}

/** 콜아웃(강조 박스). emoji 예: "📊", "💰". color 예: "gray_background", "blue_background", "green_background" */
function callout(content, emoji = "💡", color = "gray_background") {
    const icon = String(emoji).slice(0, 2) || "💡";
    return {
        type: "callout",
        callout: {
            rich_text: richText(content),
            icon: { emoji: icon },
            color: color || "gray_background"
        }
    };
}

function criteriaCallout(lines = []) {
    const normalized = (Array.isArray(lines) ? lines : [])
        .map((line) => String(line || "").trim())
        .filter(Boolean);
    const content = ["집계 기준", ...normalized.map((line) => `• ${line}`)].join("\n");
    return callout(content, "📌", "yellow_background");
}

/** 업데이트 시각 문구 (작은 설명용, 연하게) */
function updatedAt(tokyoNow) {
    return { type: "paragraph", paragraph: { rich_text: richTextAnnotated(`🕐 최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)`, { color: "gray", italic: true }) } };
}

/** 보고서 하단 문구 (내부용) */
function reportFooter() {
    return callout("Internal use only · 본 보고서는 내부 경영 목적으로 작성되었습니다.", "📋", "gray_background");
}

/** 페이지의 기존 블록을 삭제 (자식 블록만; 페이지 자체는 유지) */
async function clearPageBlocks(notion, pageId) {
    let hasMore = true;
    let startCursor;
    while (hasMore) {
        const res = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 100,
            start_cursor: startCursor
        });
        const blocks = res.results || [];
        for (const block of blocks) {
            try {
                await notion.blocks.delete({ block_id: block.id });
            } catch (e) {
                console.warn("[Notion] block delete skip:", e.message);
            }
        }
        hasMore = res.has_more;
        startCursor = res.next_cursor;
    }
}

/** 블록 배열을 100개 단위로 나누어 append */
async function appendBlocksInChunks(notion, blockId, blocks) {
    for (let i = 0; i < blocks.length; i += BLOCK_CHUNK_SIZE) {
        const chunk = blocks.slice(i, i + BLOCK_CHUNK_SIZE);
        await notion.blocks.children.append({
            block_id: blockId,
            children: chunk
        });
    }
}

/** 블록 append 후 생성된 블록 id 배열 반환 (토글 등 자식 추가용) */
async function appendBlocksAndReturnIds(notion, blockId, blocks) {
    if (!blocks.length) return [];
    const res = await notion.blocks.children.append({
        block_id: blockId,
        children: blocks.length > BLOCK_CHUNK_SIZE ? blocks.slice(0, BLOCK_CHUNK_SIZE) : blocks
    });
    const results = res.results || [];
    const ids = results.map((b) => b.id);
    for (let i = BLOCK_CHUNK_SIZE; i < blocks.length; i += BLOCK_CHUNK_SIZE) {
        const chunk = blocks.slice(i, i + BLOCK_CHUNK_SIZE);
        await notion.blocks.children.append({ block_id: blockId, children: chunk });
    }
    return ids;
}

/** 노션 페이지 제목 설정 (새 페이지 → 리포트 이름으로 표시). 페이지 조회 후 제목 속성 키로 업데이트 */
async function setPageTitle(notion, pageId, title) {
    if (!title || title.length > 255) return;
    const content = String(title).slice(0, 255);
    const titleValue = { title: [{ type: "text", text: { content } }] };
    let titleKey = null;
    try {
        const page = await notion.pages.retrieve({ page_id: pageId });
        const props = page.properties || {};
        titleKey = Object.keys(props).find((k) => props[k] && props[k].type === "title");
        if (titleKey) {
            await notion.pages.update({
                page_id: pageId,
                properties: { [titleKey]: titleValue }
            });
            return;
        }
    } catch (e) {
        console.warn("[Notion] 페이지 제목 설정(조회 후):", e.message);
    }
    // type 없이 반환되는 API 또는 제목 키를 못 찾은 경우: 흔한 키로 시도
    for (const key of ["title", "Title", "제목"]) {
        try {
            await notion.pages.update({
                page_id: pageId,
                properties: { [key]: titleValue }
            });
            return;
        } catch (_) {}
    }
}

/** 테이블 행 블록 */
function tableRow(cells, bold = false) {
    return {
        type: "table_row",
        table_row: {
            cells: cells.map((c) => [{
                type: "text",
                text: { content: String(c ?? "") },
                annotations: bold ? { bold: true } : {}
            }])
        }
    };
}

/** 점검플래그 문구에 따라 노션 텍스트 색상: 에어비앤비=분홍(pink), 부킹닷컴=하늘(blue) */
function flagColor(flag) {
    const s = String(flag ?? "").toLowerCase();
    if (s.includes("airbnb")) return "pink";
    if (s.includes("booking")) return "blue";
    return "default";
}

/** 테이블 행 블록 (셀별 rich_text 옵션). cellOpts: [{ content, bold?, color? }, ...] */
function tableRowWithOpts(cellOpts) {
    return {
        type: "table_row",
        table_row: {
            cells: cellOpts.map((opt) => [{
                type: "text",
                text: { content: String(opt.content ?? "").slice(0, 2000) },
                annotations: {
                    ...(opt.bold ? { bold: true } : {}),
                    ...(opt.color && opt.color !== "default" ? { color: opt.color } : {})
                }
            }])
        }
    };
}

/** 이미지 블록 */
function imageBlock(url, caption = "") {
    return {
        type: "image",
        image: {
            type: "external",
            external: { url },
            caption: caption ? richTextAnnotated(caption, { color: "gray", italic: true }) : []
        }
    };
}

/** heading_3 블록 */
function h3(text) {
    return { type: "heading_3", heading_3: { rich_text: richText(text) } };
}

/** quote 블록 */
function quote(text) {
    return { type: "quote", quote: { rich_text: richText(text) } };
}

function tableOfContentsBlock(color = "gray") {
    return { type: "table_of_contents", table_of_contents: { color } };
}

function pct(value, total, digits = 1) {
    if (!total) return `0.${"0".repeat(Math.max(0, digits))}`;
    return ((Number(value || 0) * 100) / Number(total)).toFixed(digits);
}

/** 일일로그 (Daily_Log MTD) — 고도화 버전 */
async function syncNotionDailyLog(pageId, { rows, monthlySummaryRows, monthlyRevenueSummaryRows, mtdNew, mtdCancel, mtdRevenue, year, month, tokyoNow }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const cancelRate = (mtdNew + mtdCancel) > 0
        ? ((mtdCancel / (mtdNew + mtdCancel)) * 100).toFixed(1) : "0.0";
    const dataRows = Array.isArray(rows) ? rows : [];
    const totalRevenue = dataRows.reduce((s, r) => s + (Number(r[3]) || 0), 0);
    const avgRevPerDay = dataRows.length > 0 ? Math.round(totalRevenue / dataRows.length) : 0;
    const maxDayRev = dataRows.length > 0 ? Math.max(...dataRows.map(r => Number(r[3]) || 0)) : 0;
    const maxDayRow = dataRows.find(r => (Number(r[3]) || 0) === maxDayRev);

    // 차트 3개 병렬 생성
    const [revenueChartUrl, bookingChartUrl, cumulativeChartUrl] = await Promise.all([
        getDailyRevenueChartUrl(dataRows, yearMonth).catch(() => null),
        getBookingCountChartUrl(dataRows, yearMonth).catch(() => null),
        getCumulativeRevenueChartUrl(dataRows, yearMonth).catch(() => null)
    ]);

    const blocks = [];
    const monthlyRevenueMap = new Map(
        (Array.isArray(monthlyRevenueSummaryRows) ? monthlyRevenueSummaryRows : [])
            .map(([label, revenue]) => [String(label), Number(revenue || 0)])
    );

    // ━━ 헤더 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({
        type: "heading_1",
        heading_1: { rich_text: richText(`${year}년 ${month}월 경영 일일 보고서`) }
    });
    blocks.push({
        type: "paragraph",
        paragraph: {
            rich_text: [{
                type: "text",
                text: { content: `📅 ${year}년 ${month}월 Month-To-Date  ·  최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)` },
                annotations: { color: "gray", italic: true }
            }]
        }
    });
    blocks.push(criteriaCallout([
        "기간: 당월 1일~전일(JST). 신규는 bookDate 기준, 취소는 cancelTime 또는 modified 기준",
        "포함: Airbnb · Booking.com, companyId 기본 회사, 신규 예약은 confirmed + 매출 > 0",
        "제외: 다이쿄초, 수기예약(Direct), Expedia, Agoda 등 기타 채널",
        "취소 집계는 입실일이 취소일 기준 ±6개월 안인 예약만 반영"
    ]));
    blocks.push(divider());

    // ━━ KPI 요약 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 핵심 성과 지표 (KPI)") } });
    blocks.push(callout(
        `💴  누적 매출\n¥${Number(totalRevenue || 0).toLocaleString()}\n일평균 ¥${avgRevPerDay.toLocaleString()}  ·  최고 ¥${maxDayRev.toLocaleString()}${maxDayRow ? ` (${String(maxDayRow[0]).slice(5)})` : ""}`,
        "💴", "green_background"
    ));
    blocks.push(callout(
        `📥  신규 예약\n${mtdNew}건\n이번 달 누적 신규 예약`,
        "📥", "blue_background"
    ));
    blocks.push(callout(
        `🚫  취소\n${mtdCancel}건  (취소율 ${cancelRate}%)\n취소율 = 취소 ÷ (신규 + 취소)`,
        "🚫", "red_background"
    ));
    blocks.push(divider());

    // ━━ 인사이트 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const insight = generateInsight({ mtdNew, mtdCancel, cancelRate, avgRevPerDay, totalRevenue, month, dataRows });
    if (insight) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richText("💡 이달의 인사이트") } });
        blocks.push(quote(insight));
        blocks.push(divider());
    }

    // ━━ 차트: 누적 매출 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📈 누적 매출 추이") } });
    blocks.push(cumulativeChartUrl
        ? imageBlock(cumulativeChartUrl)
        : { type: "paragraph", paragraph: { rich_text: richText("차트 생성 중...") } });

    // ━━ 차트: 일별 매출 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 일별 매출 추이") } });
    blocks.push(revenueChartUrl
        ? imageBlock(revenueChartUrl)
        : { type: "paragraph", paragraph: { rich_text: richText("차트 생성 중...") } });

    // ━━ 차트: 신규/취소 건수 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 신규 · 취소 건수 추이") } });
    blocks.push(bookingChartUrl
        ? imageBlock(bookingChartUrl)
        : { type: "paragraph", paragraph: { rich_text: richText("차트 생성 중...") } });
    blocks.push(divider());

    // ━━ 입실 월별 분포 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (Array.isArray(monthlySummaryRows) && monthlySummaryRows.length) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📅 입실월별 누적 예약 현황") } });
        const tblChildren = [tableRow(["입실 월", "예약 건수", "비율", "매출(¥)"], true)];
        monthlySummaryRows.forEach(([label, cnt, ratio]) => {
            const revenue = monthlyRevenueMap.get(String(label)) || 0;
            tblChildren.push(tableRow([label, `${cnt}건`, `${(ratio * 100).toFixed(1)}%`, `¥${revenue.toLocaleString()}`]));
        });
        blocks.push({
            type: "table",
            table: { table_width: 4, has_column_header: true, has_row_header: false, children: tblChildren }
        });
        blocks.push(divider());
    }

    // ━━ 일별 상세 로그 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📋 일별 상세 로그") } });
    if (dataRows.length > 0) {
        const tblChildren = [tableRow(["날짜", "신규", "취소", "일 매출 (¥)", "누적 매출 (¥)"], true)];
        let cumRev = 0;
        dataRows.slice(0, 31).forEach((row) => {
            const [dateStr, newCnt, cancelCnt, revenue] = row;
            cumRev += Number(revenue) || 0;
            tblChildren.push(tableRow([
                String(dateStr),
                `+${newCnt}`,
                cancelCnt > 0 ? `-${cancelCnt}` : "—",
                `¥${Number(revenue || 0).toLocaleString()}`,
                `¥${cumRev.toLocaleString()}`
            ]));
        });
        blocks.push({
            type: "table",
            table: { table_width: 5, has_column_header: true, has_row_header: false, children: tblChildren }
        });
    }
    blocks.push(divider(), reportFooter());

    try {
        await setPageTitle(notion, pageId, `${year}년 ${month}월 경영 일일 보고서`);
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] Daily Log 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Daily Log 동기화 실패:", e.message);
    }
}

/** 이달 인사이트 자동 생성 */
function generateInsight({ mtdNew, mtdCancel, cancelRate, avgRevPerDay, totalRevenue, month, dataRows }) {
    const insights = [];
    if (parseFloat(cancelRate) >= 15) {
        insights.push(`취소율이 ${cancelRate}%로 높습니다. 취소 원인 분석을 권장합니다.`);
    } else if (parseFloat(cancelRate) <= 5 && mtdNew > 0) {
        insights.push(`취소율이 ${cancelRate}%로 매우 낮습니다. 안정적인 예약 유지 중입니다.`);
    }
    if (dataRows.length >= 7) {
        const last7 = dataRows.slice(-7);
        const last7Avg = Math.round(last7.reduce((s, r) => s + (Number(r[3]) || 0), 0) / 7);
        if (last7Avg > avgRevPerDay * 1.2) {
            insights.push(`최근 7일 평균 매출(¥${last7Avg.toLocaleString()})이 이달 평균(¥${avgRevPerDay.toLocaleString()})보다 높은 상승 추세입니다.`);
        } else if (last7Avg < avgRevPerDay * 0.8) {
            insights.push(`최근 7일 평균 매출(¥${last7Avg.toLocaleString()})이 이달 평균(¥${avgRevPerDay.toLocaleString()})보다 낮습니다.`);
        }
    }
    if (mtdNew > 0) {
        const revPerBooking = Math.round(totalRevenue / mtdNew);
        insights.push(`예약 1건당 평균 매출 ¥${revPerBooking.toLocaleString()}`);
    }
    return insights.join("  ·  ") || null;
}

/** 취소로그 → 노션 (경영 일일보고서와 동일 디자인: 헤더·KPI·가로형 차트·건물별 요약·테이블) */
async function syncNotionCancelLog(pageId, { cancelRows, cancelSummaryRows, buildingRateSections, year, month, tokyoNow }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const dataRows = Array.isArray(cancelRows) ? cancelRows : [];
    const summaryRows = Array.isArray(cancelSummaryRows) ? cancelSummaryRows : [];
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const totalCancel = summaryRows.length > 0
        ? (summaryRows.find((r) => r[0] === "합계") || summaryRows[summaryRows.length - 1])[1] || 0
        : dataRows.reduce((s, r) => s + (Number(r[1]) || 0), 0);
    const daysWithCancel = dataRows.filter((r) => (Number(r[1]) || 0) > 0).length;
    const maxDayCancel = dataRows.length > 0 ? Math.max(...dataRows.map((r) => Number(r[1]) || 0)) : 0;
    const maxDayRow = dataRows.find((r) => (Number(r[1]) || 0) === maxDayCancel);

    const cancelChartUrl = await getCancelByDayChartUrl(dataRows, yearMonth).catch(() => null);

    const blocks = [];

    // ━━ 헤더 (일일보고서와 동일 톤) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({
        type: "heading_1",
        heading_1: { rich_text: richText(`${year}년 ${month}월 취소 로그`) }
    });
    blocks.push({
        type: "paragraph",
        paragraph: {
            rich_text: [{
                type: "text",
                text: { content: `📅 ${year}년 ${month}월 Month-To-Date  ·  최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)` },
                annotations: { color: "gray", italic: true }
            }]
        }
    });
    blocks.push(criteriaCallout([
        "기간: 당월 1일~전일(JST), cancelTime 또는 modified 기준",
        "포함: cancelled 상태의 Airbnb · Booking.com 예약",
        "제외: 다이쿄초, 수기예약(Direct), Expedia, Agoda 등 기타 채널",
        "건물·객실 취소율 표의 분모는 같은 기간 bookDate 기준 confirmed + 매출 > 0 예약"
    ]));
    blocks.push(divider());

    // ━━ KPI 요약 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 핵심 지표 (KPI)") } });
    blocks.push(callout(
        `🚫  총 취소 건수\n${Number(totalCancel).toLocaleString()}건\n당월 취소 발생 건수`,
        "🚫", "red_background"
    ));
    blocks.push(callout(
        `📅  취소 발생 일수\n${daysWithCancel}일\n취소가 발생한 날짜 수`,
        "📅", "gray_background"
    ));
    if (maxDayCancel > 0 && maxDayRow) {
        blocks.push(callout(
            `⚠️  일별 최다 취소\n${maxDayCancel}건${maxDayRow[0] ? ` (${String(maxDayRow[0]).slice(5)})` : ""}\n해당 일자 건물·객실별 요약은 아래 테이블 참고`,
            "⚠️", "orange_background"
        ));
    }
    blocks.push(divider());

    // ━━ 날짜별 취소 건수 (가로형 차트) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 날짜별 취소 건수 (가로형)") } });
    blocks.push(cancelChartUrl
        ? imageBlock(cancelChartUrl)
        : { type: "paragraph", paragraph: { rich_text: richText("차트 생성 중...") } });
    blocks.push(divider());

    // ━━ 입실월별 취소 현황 (테이블) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const summaryWithoutTotal = summaryRows.filter((r) => r[0] !== "합계");
    if (summaryWithoutTotal.length > 0) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📅 입실월별 취소 현황") } });
        const tblChildren = [tableRow(["입실 월", "취소 건수", "비율"], true)];
        summaryWithoutTotal.forEach(([label, cnt, ratio]) => {
            tblChildren.push(tableRow([label, `${cnt}건`, `${(ratio * 100).toFixed(1)}%`]));
        });
        if (summaryRows.some((r) => r[0] === "합계")) {
            const totalRow = summaryRows.find((r) => r[0] === "합계");
            tblChildren.push(tableRow(["합계", `${totalRow[1]}건`, "100%"]));
        }
        blocks.push({
            type: "table",
            table: { table_width: 3, has_column_header: true, has_row_header: false, children: tblChildren }
        });
        blocks.push(divider());
    }

    // ━━ 건물별 객실 취소 요약 (구글 시트와 동일) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const buildingSections = Array.isArray(buildingRateSections) ? buildingRateSections : [];
    if (buildingSections.length > 0) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richText("🏢 건물별 객실 취소 요약 (취소 발생 객실 기준)") } });
        const tblChildren = [tableRow(["건물", "객실", "예약건수", "취소건수", "취소율"], true)];
        buildingSections.forEach((section) => {
            const rateStr = section.buildingRate != null ? `${(section.buildingRate * 100).toFixed(1)}%` : "-";
            (section.rows || []).forEach((row, i) => {
                const [room, reserved, cancelled, rate] = row;
                const cellRate = rate != null ? `${(rate * 100).toFixed(1)}%` : "-";
                tblChildren.push(tableRow([
                    i === 0 ? section.building : "",
                    String(room || "—"),
                    String(reserved ?? "—"),
                    String(cancelled ?? "—"),
                    cellRate
                ]));
            });
        });
        blocks.push({
            type: "table",
            table: { table_width: 5, has_column_header: true, has_row_header: false, children: tblChildren }
        });
        blocks.push(divider());
    }

    // ━━ 일별 취소 상세 (테이블) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📋 일별 취소 상세") } });
    if (dataRows.length > 0) {
        const tblChildren = [tableRow(["날짜", "취소 건수", "건물·객실 요약", "상세"], true)];
        dataRows.slice(0, 31).forEach((row) => {
            const [dateStr, cnt, breakdown, detail] = row;
            const detailShort = String(detail || "").slice(0, 200);
            tblChildren.push(tableRow([
                String(dateStr),
                `${Number(cnt) || 0}건`,
                String(breakdown || "—").slice(0, 150),
                detailShort || "—"
            ]));
        });
        blocks.push({
            type: "table",
            table: { table_width: 4, has_column_header: true, has_row_header: false, children: tblChildren }
        });
    }
    blocks.push(divider(), reportFooter());

    try {
        await setPageTitle(notion, pageId, `${year}년 ${month}월 취소 로그`);
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] Cancel Log 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Cancel Log 동기화 실패:", e.message);
    }
}

/** YYYY-MM → "YYYY년 M월" 표시용 */
function formatMonthLabel(ym) {
    if (!ym || typeof ym !== "string") return ym || "—";
    const [y, m] = ym.split("-");
    const mn = parseInt(m, 10) || 0;
    return `${y}년 ${mn}월`;
}

/** 매출일지 → 노션 (당월 + 미래 5개월 = 6개월 전부, 월별 섹션으로 가독성 고도화) */
async function syncNotionSalesLog(pageId, { year, month, tokyoNow, salesLogRows, projectionMonths }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const rows = Array.isArray(salesLogRows) ? salesLogRows : [];
    const projMonths = Array.isArray(projectionMonths) ? projectionMonths : [];

    const currentMonthIndex = projMonths.indexOf(yearMonth);
    const colRevenue = currentMonthIndex >= 0 ? 1 + currentMonthIndex * 2 : 1;
    const colOccupancy = currentMonthIndex >= 0 ? 2 + currentMonthIndex * 2 : 2;

    const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
    const latestRevenue = lastRow ? Number(lastRow[colRevenue]) || 0 : 0;
    const latestOccupancy = lastRow && lastRow[colOccupancy] != null ? (Number(lastRow[colOccupancy]) * 100).toFixed(1) : "—";
    const maxRevenue = rows.length > 0 ? Math.max(...rows.map((r) => Number(r[colRevenue]) || 0)) : 0;
    const maxRow = rows.find((r) => (Number(r[colRevenue]) || 0) === maxRevenue);

    const chartRows = rows.map((r) => [r[0], 0, 0, Number(r[colRevenue]) || 0]);
    const chartUrl = await getDailyRevenueChartUrl(chartRows, yearMonth).catch(() => null);

    const blocks = [];

    blocks.push({
        type: "heading_1",
        heading_1: { rich_text: richText(`${year}년 ${month}월 매출일지`) }
    });
    blocks.push({
        type: "paragraph",
        paragraph: {
            rich_text: [{
                type: "text",
                text: { content: `📅 Booking Pace · 당월 ~ +5개월 (총 6개월)  ·  최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)` },
                annotations: { color: "gray", italic: true }
            }]
        }
    });
    blocks.push(criteriaCallout([
        "원본: 기록일 기준 sales_logs 일별 스냅샷",
        "포함: confirmed 상태의 Airbnb · Booking.com 예약",
        "제외: 다이쿄초, 사노시, 오쿠보A동, 수기예약(Direct), Expedia, Agoda",
        "집계 방식: 총매출을 숙박일수 기준 1박당으로 나눠 월별 배분, 표시는 당월~+5개월"
    ]));
    blocks.push(divider());

    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📊 핵심 지표 (당월 기준)") } });
    blocks.push(callout(
        `💰  당월 누적 매출 (최신 스냅샷)\n¥${Number(latestRevenue).toLocaleString()}\n기록일 ${lastRow ? String(lastRow[0]).slice(5) : "—"} 기준`,
        "💰", "green_background"
    ));
    blocks.push(callout(
        `📈  당월 가동률 (최신)\n${latestOccupancy}%\n동일 기록일 기준`,
        "📈", "blue_background"
    ));
    blocks.push(callout(
        `📅  기록 일수\n${rows.length}일  ·  아래 6개월 모두 기록일별 매출·가동률 표`,
        "📅", "gray_background"
    ));
    if (maxRevenue > 0 && maxRow) {
        blocks.push(callout(
            `📌  당월 기록일별 최고 매출\n¥${maxRevenue.toLocaleString()}${maxRow[0] ? ` (${String(maxRow[0]).slice(5)})` : ""}`,
            "📌", "orange_background"
        ));
    }
    blocks.push(divider());

    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📈 당월 기록일별 매출 추이") } });
    blocks.push(chartUrl
        ? imageBlock(chartUrl)
        : { type: "paragraph", paragraph: { rich_text: richText("차트 생성 중...") } });
    blocks.push(divider());

    if (projMonths.length > 0 && rows.length > 0) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richText("📋 6개월 기록일별 상세 (당월 ~ +5개월)") } });
        for (let i = 0; i < projMonths.length; i++) {
            const pm = projMonths[i];
            const revCol = 1 + i * 2;
            const occCol = 2 + i * 2;
            const label = formatMonthLabel(pm);
            blocks.push({ type: "heading_3", heading_3: { rich_text: richText(`▸ ${label}`) } });
            const tblChildren = [tableRow(["기록일", "매출 (¥)", "가동률"], true)];
            rows.slice(-31).forEach((r) => {
                const rev = Number(r[revCol]) || 0;
                const occ = r[occCol] != null ? `${(Number(r[occCol]) * 100).toFixed(1)}%` : "—";
                tblChildren.push(tableRow([String(r[0]), `¥${rev.toLocaleString()}`, occ]));
            });
            blocks.push({
                type: "table",
                table: { table_width: 3, has_column_header: true, has_row_header: false, children: tblChildren }
            });
            if (i < projMonths.length - 1) blocks.push(divider());
        }
    }

    blocks.push(divider(), reportFooter());

    try {
        await setPageTitle(notion, pageId, `${year}년 ${month}월 매출일지`);
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] Sales Log 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Sales Log 동기화 실패:", e.message);
    }
}

const PLATFORM_ANALYSIS_HIDE_SHARE_COLUMN_BUILDINGS = new Set([
    "오쿠보A동",
    "오쿠보B동",
    "오쿠보C동",
    "사노시"
]);

function buildPlatformAnalysisHeaderRow(hideShareColumn = false) {
    return tableRowWithOpts([
        { content: "객실", bold: true },
        ...(hideShareColumn ? [] : [{ content: "유입 비중(%)", bold: true }]),
        { content: "유입 A%", bold: true, color: "pink" },
        { content: "유입 B%", bold: true, color: "blue" },
        { content: "매출 A(¥)", bold: true, color: "pink" },
        { content: "매출 B(¥)", bold: true, color: "blue" },
        { content: "매출(¥)", bold: true, color: "green" },
        { content: "매출 A%", bold: true, color: "pink" },
        { content: "매출 B%", bold: true, color: "blue" },
        { content: "예약 A", bold: true, color: "pink" },
        { content: "예약 B", bold: true, color: "blue" },
        { content: "예약", bold: true },
        { content: "플래그", bold: true }
    ]);
}

function buildPlatformAnalysisRoomRow(room, hideShareColumn = false) {
    const flagStr = String(room.flag || "—").slice(0, 32);
    const color = flagColor(flagStr);

    return tableRowWithOpts([
        { content: String(room.room).slice(0, 24) },
        ...(hideShareColumn ? [] : [{ content: `${(room.sharePct || 0).toFixed(1)}%` }]),
        { content: `${(room.aOccPct || 0).toFixed(1)}%`, color: "pink" },
        { content: `${(room.bOccPct || 0).toFixed(1)}%`, color: "blue" },
        { content: `¥${Number(room.revA || 0).toLocaleString()}`, color: "pink" },
        { content: `¥${Number(room.revB || 0).toLocaleString()}`, color: "blue" },
        { content: `¥${Number(room.revAB || 0).toLocaleString()}`, color: "green" },
        { content: `${(room.aRevPct || 0).toFixed(1)}%`, color: "pink" },
        { content: `${(room.bRevPct || 0).toFixed(1)}%`, color: "blue" },
        { content: String(room.bookingA ?? "—"), color: "pink" },
        { content: String(room.bookingB ?? "—"), color: "blue" },
        { content: String(room.bookingAB ?? "—") },
        { content: flagStr, color: color !== "default" ? color : undefined }
    ]);
}

/** 플랫폼 분석 → 노션 (경영용: KPI·점검필요·건물별 객실 테이블, 구글시트 연동) */
async function syncNotionPlatformAnalysis(pageId, { year, month, tokyoNow, platformData, summaryText }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const blocks = [];

    blocks.push({
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: `${year}년 ${month}월 플랫폼별 매출 및 예약 유입 분석` }, annotations: { color: "blue" } }] }
    });
    const periodNote = (platformData && platformData.reportEndDate) ? `  ·  집계: ${year}-${String(month).padStart(2, "0")}-01 ~ ${platformData.reportEndDate} (예약일 기준)` : "";
    blocks.push({
        type: "paragraph",
        paragraph: {
            rich_text: [{
                type: "text",
                text: { content: `객실단위 플랫폼 편중 리스크 모니터링 (유입 비중: 건물 내 100% 기준, A=Airbnb, B=Booking.com, 목표 5:5)${periodNote}  ·  최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)  ·  갱신주기: 1시간` },
                annotations: { color: "gray", italic: true }
            }]
        }
    });
    blocks.push(criteriaCallout([
        `기간: ${year}-${String(month).padStart(2, "0")}-01부터 보고서 기준일(${platformData && platformData.reportEndDate ? platformData.reportEndDate : "당월 말"})까지, bookDate 기준`,
        "포함: confirmed 상태의 Airbnb · Booking.com 예약",
        "제외: 다이쿄초, 수기예약(Direct), Expedia, Agoda 등 기타 채널",
        "유입 비중은 건물 내 객실별 예약박 비중, 매출은 예약 금액 합산 기준",
        "오쿠보A/B/C와 사노시는 유입 비중(%) 열을 표시하지 않음"
    ]));
    blocks.push(divider());

    if (!platformData || !platformData.buildings || platformData.buildings.length === 0) {
        blocks.push(callout(summaryText || "데이터 없음", "📈", "gray_background"));
        blocks.push(divider(), reportFooter());
        try {
            await setPageTitle(notion, pageId, "플랫폼 분석");
            await clearPageBlocks(notion, pageId);
            await appendBlocksInChunks(notion, pageId, blocks);
            console.log("✅ [Notion] Platform Analysis 동기화 완료");
        } catch (e) {
            console.error("❌ [Notion] Platform Analysis 동기화 실패:", e.message);
        }
        return;
    }

    const { totalRev, totalRevA, totalRevB, totalBookA, totalBookB, aRevPct, bRevPct, aOccPct, bOccPct, buildings } = platformData;

    blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "📊 핵심 지표 (전체)" }, annotations: { color: "purple", bold: true } }] } });
    blocks.push(callout(
        `💰  전체 매출 비중\nAirbnb ${aRevPct.toFixed(1)}%  ·  Booking.com ${bRevPct.toFixed(1)}%\n총 ¥${Number(totalRev || 0).toLocaleString()}`,
        "💰", "green_background"
    ));
    blocks.push(callout(
        `📈  예약 유입 비중 (목표 5:5)\nA ${aOccPct.toFixed(1)}%  ·  B ${bOccPct.toFixed(1)}%\n예약건수 A ${totalBookA}건 / B ${totalBookB}건`,
        "📈", "blue_background"
    ));
    blocks.push(divider());

    blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "🏢 건물별 · 객실별 상세" }, annotations: { color: "brown", bold: true } }] } });
    for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        const hideShareColumn = PLATFORM_ANALYSIS_HIDE_SHARE_COLUMN_BUILDINGS.has(b.name);
        blocks.push({ type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: `▸ ${b.name} (${b.roomCount}개 객실)  ·  매출 A ${b.aRevPct.toFixed(1)}% / B ${b.bRevPct.toFixed(1)}%` }, annotations: { color: "gray" } }] } });
        const tblChildren = [buildPlatformAnalysisHeaderRow(hideShareColumn)];
        b.rooms.forEach((r) => {
            tblChildren.push(buildPlatformAnalysisRoomRow(r, hideShareColumn));
        });
        blocks.push({
            type: "table",
            table: {
                table_width: hideShareColumn ? 12 : 13,
                has_column_header: true,
                has_row_header: false,
                children: tblChildren
            }
        });
        if (i < buildings.length - 1) blocks.push(divider());
    }

    blocks.push(divider(), reportFooter());

    try {
        await setPageTitle(notion, pageId, `${year}년 ${month}월 플랫폼 분석`);
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] Platform Analysis 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Platform Analysis 동기화 실패:", e.message);
    }
}

/** 인원현황(PAX) → 노션 (구글 시트 인원현황 연동, 보고서 형식) */
async function syncNotionPaxOccupancy(pageId, { title, tokyoNow, summaryText, paxData }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const blocks = [];

    blocks.push({
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: `👥 ${title || "인원현황"}` }, annotations: { color: "blue" } }] }
    });
    const periodNote = paxData && paxData.start && paxData.end
        ? `  ·  집계기간: ${paxData.start} ~ ${paxData.end} (예약일·confirmed·OTA·다이쿄초 제외·매출>0, 일일로그 예약건수와 동일 기준)`
        : "";
    blocks.push({
        type: "paragraph",
        paragraph: {
            rich_text: [{
                type: "text",
                text: { content: `인원별·국가별 점유 현황 리포트${periodNote}  ·  최종 업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} (JST)  ·  갱신주기: 매일 08:50 JST` },
                annotations: { color: "gray", italic: true }
            }]
        }
    });
    blocks.push(criteriaCallout([
        `기간: ${paxData && paxData.start ? paxData.start : "시작일"} ~ ${paxData && paxData.end ? paxData.end : "종료일"}, bookDate 기준`,
        "포함: confirmed 상태의 Airbnb · Booking.com 예약 + 매출 > 0",
        "제외: 다이쿄초, 수기예약(Direct), Expedia, Agoda 등 기타 채널",
        "일일로그 예약건수와 동일 기준으로 집계"
    ]));
    blocks.push(divider());

    if (!paxData || !paxData.buildings || paxData.buildings.length === 0) {
        blocks.push(callout(summaryText || "데이터 없음. 구글 시트 인원현황 시트가 갱신되면 반영됩니다.", "📋", "gray_background"));
        blocks.push(divider(), reportFooter());
        try {
            await setPageTitle(notion, pageId, "인원현황");
            await clearPageBlocks(notion, pageId);
            await appendBlocksInChunks(notion, pageId, blocks);
            console.log("✅ [Notion] PAX Occupancy 동기화 완료");
        } catch (e) {
            console.error("❌ [Notion] PAX Occupancy 동기화 실패:", e.message);
        }
        return;
    }

    const { grandTotal, grandOne, grandTwo, grandThree, grandFour, grandFivep, countryTop10, past3Months, buildings } = paxData;
    const pct = (n, d) => (d > 0 ? ((Number(n) * 100) / d).toFixed(1) : "0.0");

    blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "📊 핵심 지표 (전 건물 당월)" }, annotations: { color: "purple", bold: true } }] } });
    blocks.push(callout(
        `총 예약 ${Number(grandTotal || 0).toLocaleString()}건  ·  기간: ${paxData.start} ~ ${paxData.end}`,
        "📌", "green_background"
    ));
    blocks.push(callout(
        `1인 ${grandOne || 0}건 (${pct(grandOne, grandTotal)}%)  ·  2인 ${grandTwo || 0}건 (${pct(grandTwo, grandTotal)}%)  ·  3인 ${grandThree || 0}건 (${pct(grandThree, grandTotal)}%)\n4인 ${grandFour || 0}건 (${pct(grandFour, grandTotal)}%)  ·  5인+ ${grandFivep || 0}건 (${pct(grandFivep, grandTotal)}%)`,
        "👥", "blue_background"
    ));
    if (countryTop10 && countryTop10.length > 0) {
        const top3 = countryTop10.slice(0, 3).map((c) => `${c.country} ${c.count}건(${c.pct}%)`).join("  ·  ");
        blocks.push(callout(`국가 TOP3: ${top3}`, "🌏", "gray_background"));
    }
    blocks.push(divider());

    blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "🏢 건물별 · 객실별 인원 통계" }, annotations: { color: "brown", bold: true } }] } });

    for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        blocks.push({
            type: "heading_3",
            heading_3: { rich_text: [{ type: "text", text: { content: `▸ ${b.name}  ·  총 ${b.total}건 (1인 ${pct(b.one, b.total)}% / 2인 ${pct(b.two, b.total)}% / 3인 ${pct(b.three, b.total)}% / 4인 ${pct(b.four, b.total)}% / 5인+ ${pct(b.fivep, b.total)}%)` }, annotations: { color: "gray" } }] }
        });

        const roomHeader = tableRowWithOpts([
            { content: "객실", bold: true },
            { content: "총 예약", bold: true, color: "green" },
            { content: "1인", bold: true },
            { content: "2인", bold: true },
            { content: "3인", bold: true },
            { content: "4인", bold: true },
            { content: "5인+", bold: true }
        ]);
        const roomRows = [roomHeader];
        (b.rooms || []).forEach((r) => {
            roomRows.push(tableRowWithOpts([
                { content: String(r.room).slice(0, 28) },
                { content: `${r.total}건`, color: "green" },
                { content: `${r.one}건` },
                { content: `${r.two}건` },
                { content: `${r.three}건` },
                { content: `${r.four}건` },
                { content: `${r.fivep}건` }
            ]));
        });
        roomRows.push(tableRowWithOpts([
            { content: "합계", bold: true },
            { content: `${b.total}건`, bold: true, color: "green" },
            { content: `${b.one}건`, bold: true },
            { content: `${b.two}건`, bold: true },
            { content: `${b.three}건`, bold: true },
            { content: `${b.four}건`, bold: true },
            { content: `${b.fivep}건`, bold: true }
        ]));
        blocks.push({ type: "table", table: { table_width: 7, has_column_header: true, has_row_header: false, children: roomRows } });

        if (b.countryTop10 && b.countryTop10.length > 0) {
            const countryHeader = tableRowWithOpts([{ content: "국가", bold: true }, { content: "예약건수", bold: true, color: "green" }, { content: "점유율", bold: true, color: "blue" }]);
            const countryRows = [countryHeader, ...b.countryTop10.map((c) => tableRowWithOpts([{ content: c.country }, { content: `${c.count}건`, color: "green" }, { content: `${c.pct}%`, color: "blue" }]))];
            blocks.push({ type: "table", table: { table_width: 3, has_column_header: true, has_row_header: false, children: countryRows } });
        }
        if (i < buildings.length - 1) blocks.push(divider());
    }

    blocks.push(divider());
    blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "🌏 전 건물 국가별 TOP10" }, annotations: { color: "brown", bold: true } }] } });
    const countryHeader = tableRowWithOpts([
        { content: "국가", bold: true },
        { content: "예약건수", bold: true, color: "green" },
        { content: "점유율", bold: true }
    ]);
    const countryRows = [countryHeader, ...(countryTop10 || []).map((c) => tableRowWithOpts([
        { content: c.country },
        { content: `${c.count}건`, color: "green" },
        { content: `${c.pct}%`, color: "blue" }
    ]))];
    blocks.push({ type: "table", table: { table_width: 3, has_column_header: true, has_row_header: false, children: countryRows } });

    if (past3Months && past3Months.length > 0) {
        blocks.push(divider());
        blocks.push({ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "📅 과거 3개월 인원별 요약" }, annotations: { color: "brown", bold: true } }] } });
        const pastHeader = tableRowWithOpts([
            { content: "월", bold: true },
            { content: "총예약", bold: true, color: "green" },
            { content: "1인", bold: true },
            { content: "2인", bold: true },
            { content: "3인", bold: true },
            { content: "4인", bold: true },
            { content: "5인+", bold: true }
        ]);
        const pastRows = [pastHeader, ...past3Months.map((row) => tableRowWithOpts([
            { content: row.month },
            { content: `${row.total}건`, color: "green" },
            { content: `${row.one}건` },
            { content: `${row.two}건` },
            { content: `${row.three}건` },
            { content: `${row.four}건` },
            { content: `${row.fivep}건` }
        ]))];
        const pSum = past3Months.reduce(
            (acc, row) => ({
                total: acc.total + row.total,
                one: acc.one + row.one,
                two: acc.two + row.two,
                three: acc.three + row.three,
                four: acc.four + row.four,
                fivep: acc.fivep + row.fivep
            }),
            { total: 0, one: 0, two: 0, three: 0, four: 0, fivep: 0 }
        );
        pastRows.push(tableRowWithOpts([
            { content: `합계 (${past3Months.length}개월)`, bold: true },
            { content: `${pSum.total}건`, bold: true, color: "green" },
            { content: `${pSum.one}건`, bold: true },
            { content: `${pSum.two}건`, bold: true },
            { content: `${pSum.three}건`, bold: true },
            { content: `${pSum.four}건`, bold: true },
            { content: `${pSum.fivep}건`, bold: true }
        ]));
        blocks.push({ type: "table", table: { table_width: 7, has_column_header: true, has_row_header: false, children: pastRows } });
    }

    blocks.push(divider(), reportFooter());

    const pageTitle = paxData.yearMonth
        ? `${String(paxData.yearMonth).replace("_", "년 ")}월 인원현황`
        : "인원현황";
    try {
        await setPageTitle(notion, pageId, pageTitle);
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] PAX Occupancy 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] PAX Occupancy 동기화 실패:", e.message);
    }
}

/** 금액 포맷 (円) */
function fmtYen(num) {
    return `${Number(num).toLocaleString()}円`;
}

/** 노션 DB 속성 이름 → ID 매핑 (create/update 시 ID 사용) */
function getPropertyNameToId(db) {
    const out = {};
    const props = db.properties || {};
    for (const [id, p] of Object.entries(props)) {
        const name = (p && p.name) ? String(p.name).trim() : "";
        if (name) out[name] = id;
    }
    return out;
}

/** 매출 요약 데이터를 노션 DB에 동기화 (검색/필터용). DB 속성: Name(title), Category(select: 월별|건물별|플랫폼), Revenue(number), Note(rich_text) */
async function syncNotionSalesDashboardDatabase(notion, databaseId, salesData) {
    if (!notion || !databaseId || !salesData) return;
    const rows = [];
    (salesData.monthlySeries || []).forEach((s) => {
        rows.push({ name: `월별_${s.month}`, category: "월별", revenue: Number(s.revenue) || 0, note: s.month });
    });
    (salesData.buildingBreakdown || []).forEach((b) => {
        rows.push({ name: `건물_${b.building}`, category: "건물별", revenue: Number(b.revenue) || 0, note: b.building });
    });
    rows.push({ name: "플랫폼_Airbnb", category: "플랫폼", revenue: Number(salesData.platformAirbnb) || 0, note: "Airbnb" });
    rows.push({ name: "플랫폼_Booking", category: "플랫폼", revenue: Number(salesData.platformBooking) || 0, note: "Booking.com" });

    let db;
    try {
        db = await notion.databases.retrieve({ database_id: databaseId });
    } catch (e) {
        console.warn("[Notion] Sales DB retrieve 실패:", e.message);
        return;
    }
    const nameToId = getPropertyNameToId(db);
    const nameKey = "Name";
    const categoryKey = "Category";
    const revenueKey = "Revenue";
    const noteKey = "Note";
    const titleId = nameToId[nameKey] || nameToId["이름"];
    const categoryId = nameToId[categoryKey] || nameToId["구분"];
    const revenueId = nameToId[revenueKey] || nameToId["매출"];
    const noteId = nameToId[noteKey] || nameToId["비고"];
    if (!titleId || !categoryId || !revenueId) {
        console.warn("[Notion] Sales DB 속성 부족 (Name/Category/Revenue 또는 이름/구분/매출 필요)");
        return;
    }

    const existingByTitle = {};
    let cursor;
    do {
        const res = await notion.databases.query({
            database_id: databaseId,
            page_size: 100,
            start_cursor: cursor || undefined
        });
        const pages = res.results || [];
        for (const page of pages) {
            const titleProp = page.properties && (page.properties[titleId] || page.properties[nameToId["이름"]]);
            const title = titleProp && titleProp.title && titleProp.title[0] ? titleProp.title[0].plain_text : "";
            if (title) existingByTitle[title] = page.id;
        }
        cursor = res.next_cursor;
    } while (cursor);

    const buildProps = (row) => {
        const props = {
            [titleId]: { title: [{ type: "text", text: { content: String(row.name).slice(0, 2000) } }] },
            [categoryId]: { select: { name: String(row.category).slice(0, 100) } },
            [revenueId]: { number: row.revenue }
        };
        if (noteId) props[noteId] = { rich_text: [{ type: "text", text: { content: String(row.note || "").slice(0, 2000) } }] };
        return props;
    };

    for (const row of rows) {
        try {
            if (existingByTitle[row.name]) {
                await notion.pages.update({
                    page_id: existingByTitle[row.name],
                    properties: buildProps(row)
                });
            } else {
                await notion.pages.create({
                    parent: { database_id: databaseId },
                    properties: buildProps(row)
                });
            }
        } catch (e) {
            console.warn("[Notion] Sales DB row sync 실패:", row.name, e.message);
        }
    }
    console.log("✅ [Notion] Sales Dashboard DB 동기화 완료");
}

/** 임베드 블록 (URL 삽입) */
function embedBlock(url) {
    if (!url || !String(url).startsWith("http")) return null;
    return { type: "embed", embed: { url: String(url).slice(0, 2000) } };
}

/** 북마크 블록 (링크 미리보기) */
function bookmarkBlock(url, caption) {
    if (!url || !String(url).startsWith("http")) return null;
    return {
        type: "bookmark",
        bookmark: {
            url: String(url).slice(0, 2000),
            caption: caption ? richText(caption) : []
        }
    };
}

function getDiagnosisColor(diagnosis) {
    if (diagnosis === "저평가 가능성") return "blue";
    if (diagnosis === "고평가 가능성") return "red";
    if (diagnosis === "프리미엄 정당화") return "green";
    if (diagnosis === "상품/노출 점검") return "orange";
    if (diagnosis === "판단 유보") return "gray";
    return "purple";
}

function buildBuildingDetailSections(coreBuildingStats = []) {
    return (coreBuildingStats || [])
        .filter((building) => Array.isArray(building.rooms) && building.rooms.length > 0)
        .map((building) => {
            const roomRows = [
                tableRowWithOpts([
                    { content: "객실", bold: true, color: "gray" },
                    { content: "매출", bold: true, color: "blue" },
                    { content: "가동률", bold: true, color: "purple" },
                    { content: "ADR", bold: true, color: "green" },
                    { content: "예약수", bold: true, color: "gray" },
                    { content: "진단", bold: true, color: "brown" }
                ]),
                ...building.rooms.map((room) => tableRowWithOpts([
                    { content: room.room },
                    { content: fmtYen(room.revenue) },
                    { content: `${room.occupancyPct}%` },
                    { content: fmtYen(room.adr) },
                    { content: `${room.reservationCount}건` },
                    { content: room.diagnosis, color: getDiagnosisColor(room.diagnosis) }
                ]))
            ];

            const diagnosisRows = [
                tableRowWithOpts([
                    { content: "객실", bold: true, color: "gray" },
                    { content: "가격 적정성 해석", bold: true, color: "brown" }
                ]),
                ...building.rooms.map((room) => tableRowWithOpts([
                    { content: room.room },
                    { content: room.diagnosisReason || "-" }
                ]))
            ];

            return {
                buildingName: building.building,
                totalRevenue: building.revenue,
                occupancyPct: building.occupancyPct,
                roomCount: building.roomCount,
                childBlocks: [
                    callout(
                        `${building.buildingType} · 객실 ${building.roomCount}개 · 매출 ${fmtYen(building.revenue)} · 가동률 ${building.occupancyPct}% · ADR ${fmtYen(building.adr)}`,
                        "🏢",
                        "gray_background"
                    ),
                    { type: "table", table: { table_width: 6, has_column_header: true, has_row_header: false, children: roomRows } },
                    { type: "table", table: { table_width: 2, has_column_header: true, has_row_header: false, children: diagnosisRows } }
                ]
            };
        });
}

function buildTopRoomTable(title, rows, columns) {
    const header = tableRowWithOpts(columns.map((column) => ({
        content: column.label,
        bold: true,
        color: column.color || "gray"
    })));
    const children = [
        header,
        ...rows.map((row, index) => tableRowWithOpts(columns.map((column) => ({
            content: String(column.render(row, index) ?? ""),
            color: column.cellColor ? column.cellColor(row, index) : undefined
        }))))
    ];

    return {
        type: "table",
        table: {
            table_width: columns.length,
            has_column_header: true,
            has_row_header: false,
            children
        }
    };
}

/** 한 달치 매출+가동률 통합 보고서: { blocksBeforePricing, blocksAfterPricing, buildingToggles } */
function buildOneMonthReportBlocks(report) {
    const salesData = report && report.salesData;
    const chartUrl = report && report.chartUrl;
    const buildingChartUrl = report && report.buildingChartUrl;
    if (!salesData) return { blocksBeforePricing: [callout("데이터 없음", "📊", "gray_background")], blocksAfterPricing: [], buildingToggles: [] };

    const d = salesData;
    const coreRevenue = Number(d.currentMonthRevenue) || 0;
    const referenceRevenue = Number(d.referenceRevenue) || 0;
    const totalRevenueWithReference = Number(d.totalRevenueWithReference || (coreRevenue + referenceRevenue)) || 0;
    const changePct = Number(d.changePct) || 0;
    const adr = d.occupiedRoomNights > 0 ? Math.round(coreRevenue / d.occupiedRoomNights) : 0;
    const revPar = d.totalRoomNights > 0 ? Math.round(coreRevenue / d.totalRoomNights) : 0;
    const coreBuildings = Array.isArray(d.coreBuildingStats) ? d.coreBuildingStats : [];
    const okuboHomes = Array.isArray(d.okuboHomeStats) ? d.okuboHomeStats : [];
    const referenceBuildings = Array.isArray(d.referenceBuildingStats) ? d.referenceBuildingStats : [];
    const platformSummary = [
        { name: "Airbnb", revenue: Number(d.platformAirbnb) || 0 },
        { name: "Booking.com", revenue: Number(d.platformBooking) || 0 }
    ].map((row) => ({
        ...row,
        share: pct(row.revenue, coreRevenue)
    })).sort((a, b) => b.revenue - a.revenue);
    const dominantPlatform = platformSummary[0] || null;
    const topCoreBuilding = coreBuildings[0] || null;
    const topOkuboHome = okuboHomes[0] || null;
    const topRoom = (d.buildingRoomBreakdown || [])[0] || null;
    const occupancyBand = Number(d.occupancyPct) >= 80 ? "매우 우수" : Number(d.occupancyPct) >= 65 ? "안정" : Number(d.occupancyPct) >= 50 ? "보통" : "보완 필요";
    const priorityRooms = coreBuildings
        .flatMap((building) => (building.rooms || []).map((room) => ({
            building: building.building,
            room: room.room,
            occupancyPct: room.occupancyPct,
            adr: room.adr,
            diagnosis: room.diagnosis,
            diagnosisReason: room.diagnosisReason,
            revenue: room.revenue
        })))
        .filter((room) => room.diagnosis !== "적정" && room.diagnosis !== "판단 유보")
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    const executiveSummary = [
        "Executive Brief",
        `운영 포트폴리오(사노시 제외) 기준 총매출 ${fmtYen(coreRevenue)} / 전월 대비 ${changePct >= 0 ? "+" : ""}${changePct}%`,
        topCoreBuilding ? `일반 건물군 핵심 건물은 ${topCoreBuilding.building}이며, 객실 ${topCoreBuilding.roomCount}개 기준 ${fmtYen(topCoreBuilding.revenue)}를 기록했습니다.` : "일반 건물군 데이터가 아직 충분하지 않습니다.",
        topOkuboHome ? `오쿠보 단독주택군에서는 ${topOkuboHome.building}이 ${fmtYen(topOkuboHome.revenue)}로 가장 높았습니다.` : "오쿠보 단독주택 데이터가 부족합니다.",
        dominantPlatform ? `주요 플랫폼은 ${dominantPlatform.name}이며, core 매출 비중 ${dominantPlatform.share}%입니다.` : "플랫폼별 집계 데이터가 없습니다.",
        topRoom ? `일반 건물군 상대 성과 상위 객실은 ${topRoom.building} · ${topRoom.room} (${topRoom.relativePerformanceScore || 0}점, ${topRoom.relativePerformanceLabel || "보통"})입니다.` : "일반 건물 객실 성과 데이터가 없습니다."
    ].join("\n");

    const strategicNotes = [
        changePct >= 0
            ? `전월 대비 성장세가 유지되고 있으며, core 매출 모멘텀이 ${changePct}% 수준으로 확인됩니다.`
            : `전월 대비 ${Math.abs(changePct)}% 조정이 발생해 가격·가동률·채널 믹스 재점검이 필요합니다.`,
        `core 가동률은 ${d.occupancyPct}%로 ${occupancyBand} 구간이며, ADR ${fmtYen(adr)} / RevPAR ${fmtYen(revPar)} 수준입니다.`,
        topCoreBuilding
            ? `${topCoreBuilding.building}은 객실 ${topCoreBuilding.roomCount}개 운영 기준 매출 ${fmtYen(topCoreBuilding.revenue)}, 객실당 ${fmtYen(topCoreBuilding.revenuePerRoom)} 수준입니다.`
            : "일반 건물군 객실 수 기반 분석을 위한 데이터가 부족합니다.",
        topOkuboHome
            ? `오쿠보 단독주택은 일반 건물과 분리 비교하며, 최고 성과 주택은 ${topOkuboHome.building} (${fmtYen(topOkuboHome.revenue)}, 가동률 ${topOkuboHome.occupancyPct}%)입니다.`
            : "오쿠보 단독주택군 비교 데이터가 부족합니다.",
        priorityRooms[0]
            ? `가격 적정성 점검 우선순위 객실은 ${priorityRooms[0].building} ${priorityRooms[0].room} (${priorityRooms[0].diagnosis})입니다.`
            : "이번 달에는 건물 내 객실 가격 적정성 진단에서 즉시 조정이 필요한 객실이 두드러지지 않았습니다."
    ];

    const blocks = [
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("Executive Summary", { bold: true, color: "blue" }) } },
        { type: "paragraph", paragraph: { rich_text: richTextAnnotated(`${d.yearMonth} · overlap 기준 · 사노시는 참고 매출만 별도 표시`, { color: "gray", italic: true }) } },
        callout(`운영 포트폴리오 총매출 ${fmtYen(coreRevenue)}`, "💠", "blue_background"),
        callout(
            `전월 대비 ${changePct >= 0 ? "+" : ""}${changePct}% · 전월 ${fmtYen(d.lastMonthRevenue)}`,
            changePct >= 0 ? "📈" : "📉",
            changePct > 0 ? "green_background" : changePct < 0 ? "red_background" : "gray_background"
        ),
        callout(`운영 객실 ${d.totalRooms}개 · 예약 ${d.bookingCount}건 · 가동률 ${d.occupancyPct}% · ADR ${fmtYen(adr)}`, "🏛️", "green_background")
    ];
    if (referenceRevenue > 0) {
        blocks.push(callout(`참고 매출(사노시 대행 운영) ${fmtYen(referenceRevenue)} · 전체 노출 매출 ${fmtYen(totalRevenueWithReference)}`, "🏠", "yellow_background"));
    }
    blocks.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("경영진 인사이트", { bold: true, color: "purple" }) } },
        quote(executiveSummary),
        ...strategicNotes.map((note) => ({
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: richText(note) }
        })),
        {
            type: "table",
            table: {
                table_width: 3,
                has_column_header: true,
                has_row_header: false,
                children: [
                    tableRowWithOpts([
                        { content: "지표", bold: true, color: "gray" },
                        { content: "값", bold: true, color: "blue" },
                        { content: "메모", bold: true, color: "purple" }
                    ]),
                    tableRowWithOpts([{ content: "운영 포트폴리오 매출" }, { content: fmtYen(coreRevenue) }, { content: "사노시 제외 core 기준" }]),
                    tableRowWithOpts([{ content: "참고 매출" }, { content: fmtYen(referenceRevenue) }, { content: "사노시 대행 운영" }]),
                    tableRowWithOpts([{ content: "ADR" }, { content: fmtYen(adr) }, { content: "점유 1박당 평균 매출" }]),
                    tableRowWithOpts([{ content: "RevPAR" }, { content: fmtYen(revPar) }, { content: "전체 가능 객실박 기준" }]),
                    tableRowWithOpts([{ content: "예약건수" }, { content: `${d.bookingCount}건` }, { content: "bookDate 기준, 사노시 제외" }]),
                    tableRowWithOpts([{ content: "가동률" }, { content: `${d.occupancyPct}%` }, { content: `${d.occupiedRoomNights}/${d.totalRoomNights} room-nights` }])
                ]
            }
        },
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("월별 매출 추이", { bold: true, color: "purple" }) } }
    );

    if (chartUrl) blocks.push(imageBlock(chartUrl, "최근 6개월 core 매출 흐름입니다. 사노시 reference 매출은 제외하고 본 운영 포트폴리오 기준으로 표시합니다."));
    else blocks.push(callout("차트 데이터 없음", "📊", "gray_background"));

    blocks.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("일반 건물 운영 비교", { bold: true, color: "brown" }) } }
    );

    if (buildingChartUrl) blocks.push(imageBlock(buildingChartUrl, "일반 건물군(core) 기준 매출 비교입니다. 오쿠보 단독주택과 사노시는 별도 섹션에서 봅니다."));
    else blocks.push(callout("일반 건물 차트 없음", "🏢", "gray_background"));

    const coreBuildingRows = [
        tableRowWithOpts([
            { content: "건물", bold: true, color: "gray" },
            { content: "유형", bold: true, color: "gray" },
            { content: "객실수", bold: true, color: "purple" },
            { content: "매출", bold: true, color: "blue" },
            { content: "객실당 매출", bold: true, color: "green" },
            { content: "가동률", bold: true, color: "brown" },
            { content: "ADR", bold: true, color: "green" }
        ]),
        ...coreBuildings.map((building) => tableRowWithOpts([
            { content: building.building },
            { content: building.buildingType },
            { content: `${building.roomCount}개` },
            { content: fmtYen(building.revenue) },
            { content: fmtYen(building.revenuePerRoom) },
            { content: `${building.occupancyPct}%` },
            { content: fmtYen(building.adr) }
        ]))
    ];
    if (coreBuildingRows.length > 1) {
        blocks.push({ type: "table", table: { table_width: 7, has_column_header: true, has_row_header: false, children: coreBuildingRows } });
    } else {
        blocks.push(callout("일반 건물군 데이터 없음", "🏢", "gray_background"));
    }
    if (topCoreBuilding) {
        blocks.push(callout(`일반 건물군 1위는 ${topCoreBuilding.building} · 매출 ${fmtYen(topCoreBuilding.revenue)} · 객실 ${topCoreBuilding.roomCount}개 · 객실당 ${fmtYen(topCoreBuilding.revenuePerRoom)}`, "🏆", "yellow_background"));
    }

    blocks.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("오쿠보 단독주택 비교", { bold: true, color: "brown" }) } },
        callout("오쿠보 A/B/C는 단독주택 운영 구조이므로 일반 객실형 건물과 직접 비교하지 않고, 오쿠보 그룹 내부에서만 비교합니다.", "🏡", "blue_background")
    );

    const okuboRows = [
        tableRowWithOpts([
            { content: "주택", bold: true, color: "gray" },
            { content: "매출", bold: true, color: "blue" },
            { content: "가동률", bold: true, color: "brown" },
            { content: "ADR", bold: true, color: "green" },
            { content: "예약수", bold: true, color: "purple" }
        ]),
        ...okuboHomes.map((home) => tableRowWithOpts([
            { content: home.building },
            { content: fmtYen(home.revenue) },
            { content: `${home.occupancyPct}%` },
            { content: fmtYen(home.adr) },
            { content: `${home.reservationCount}건` }
        ]))
    ];
    if (okuboRows.length > 1) {
        blocks.push({ type: "table", table: { table_width: 5, has_column_header: true, has_row_header: false, children: okuboRows } });
    } else {
        blocks.push(callout("오쿠보 단독주택 데이터 없음", "🏡", "gray_background"));
    }

    if (referenceBuildings.length > 0) {
        blocks.push(
            divider(),
            { type: "heading_3", heading_3: { rich_text: richTextAnnotated("사노시 참고 매출", { bold: true, color: "brown" }) } },
            callout("사노시는 대행 운영 자산으로, 숫자는 참고용으로만 표시하고 경영 분석/랭킹/핵심 건물 판단에서는 제외합니다.", "📎", "gray_background")
        );
        const referenceRows = [
            tableRowWithOpts([
                { content: "건물", bold: true, color: "gray" },
                { content: "매출", bold: true, color: "blue" },
                { content: "가동률", bold: true, color: "brown" },
                { content: "ADR", bold: true, color: "green" }
            ]),
            ...referenceBuildings.map((building) => tableRowWithOpts([
                { content: building.building },
                { content: fmtYen(building.revenue) },
                { content: `${building.occupancyPct}%` },
                { content: fmtYen(building.adr) }
            ]))
        ];
        blocks.push({ type: "table", table: { table_width: 4, has_column_header: true, has_row_header: false, children: referenceRows } });
    }

    blocks.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("플랫폼 믹스", { bold: true, color: "brown" }) } }
    );
    const platformRows = [
        tableRowWithOpts([
            { content: "플랫폼", bold: true, color: "gray" },
            { content: "매출", bold: true, color: "blue" },
            { content: "비중", bold: true, color: "purple" }
        ]),
        ...platformSummary.map((row) => tableRowWithOpts([
            { content: row.name },
            { content: fmtYen(row.revenue) },
            { content: `${row.share}%` }
        ]))
    ];
    blocks.push({ type: "table", table: { table_width: 3, has_column_header: true, has_row_header: false, children: platformRows } });
    if (dominantPlatform) {
        blocks.push(callout(`주력 플랫폼은 ${dominantPlatform.name}이며, core 매출의 ${dominantPlatform.share}%를 차지합니다.`, "🎯", "gray_background"));
    }

    blocks.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("건물별 객실 · 가격 적정성", { bold: true, color: "brown" }) } },
        callout("건물별로 펼치면 해당 건물 전체 객실의 매출·가동률·ADR·가격 적정성 진단과 해석을 한 번에 볼 수 있습니다. 같은 건물 안에서만 비교합니다. 오쿠보·사노시는 제외.", "🔎", "blue_background"),
        criteriaCallout([
            "우수 운영: 절대 매출·가동률이 최상위이거나, 매출·RevPAR·수요를 모두 잘 잡은 객실",
            "적정: 예약수·가동률·ADR·매출이 모두 중간권에서 균형을 이루는 객실",
            "저평가 가능성: 예약수 또는 가동률은 강한데 ADR·매출·RevPAR이 약해 가격 인상 여지가 있음",
            "고평가 가능성: ADR은 높은데 가동률·예약이 약해 가격 재검토가 필요함",
            "저성과 주의: 같은 건물 유사 객실 대비 매출 또는 RevPAR이 낮아 우선 점검 필요",
            "수요 부족/노출 문제: 가격보다 노출·상품력·전환 문제 가능성이 큼",
            "장기숙박형/단기회전형: 예약 패턴 차이로 해석이 필요한 객실",
            "판단 유보: 표본이 적어 성급한 판단을 피해야 함"
        ])
    );

    const buildingToggles = buildBuildingDetailSections(coreBuildings);

    const blocksBeforePricing = blocks.slice(0);
    const blocksAfterPricing = [];

    blocksAfterPricing.push(
        divider(),
        { type: "heading_3", heading_3: { rich_text: richTextAnnotated("건물 내 상대 성과 Top 10", { bold: true, color: "brown" }) } },
        callout("같은 건물 안에서만 비교한 상대 성과 자료입니다. 매출 절대값이 아니라 건물 내부 순위와 RevPAR, 가동률, 진단을 함께 봅니다.", "📊", "gray_background")
    );

    const roomBreakdown = Array.isArray(d.buildingRoomBreakdown) ? d.buildingRoomBreakdown : [];
    const revenueTop10 = [...roomBreakdown]
        .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
        .slice(0, 10);
    const relativeTop10 = [...roomBreakdown]
        .sort((a, b) => Number(b.relativePerformanceScore || 0) - Number(a.relativePerformanceScore || 0))
        .slice(0, 10);
    const relativeBottom10 = [...roomBreakdown]
        .sort((a, b) => {
            const scoreDiff = Number(a.relativePerformanceScore || 0) - Number(b.relativePerformanceScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const revParDiff = Number(a.revPar || 0) - Number(b.revPar || 0);
            if (revParDiff !== 0) return revParDiff;
            return Number(a.revenue || 0) - Number(b.revenue || 0);
        })
        .slice(0, 10);

    if (roomBreakdown.length > 0) {
        blocksAfterPricing.push(
            { type: "heading_3", heading_3: { rich_text: richTextAnnotated("매출 Top 10", { bold: true, color: "blue" }) } },
            buildTopRoomTable("매출 Top 10", revenueTop10, [
                { label: "순위", render: (_, index) => `#${index + 1}` },
                { label: "건물", render: (row) => row.building || "(미지정)" },
                { label: "객실", render: (row) => row.room || "(미지정)" },
                { label: "매출", color: "blue", render: (row) => fmtYen(row.revenue) },
                { label: "가동률", color: "brown", render: (row) => `${row.occupancyPct}%` }
            ]),
            { type: "heading_3", heading_3: { rich_text: richTextAnnotated("상대 성과 Top 10", { bold: true, color: "purple" }) } },
            buildTopRoomTable("상대 성과 Top 10", relativeTop10, [
                { label: "순위", render: (_, index) => `#${index + 1}` },
                { label: "건물", render: (row) => row.building || "(미지정)" },
                { label: "객실", render: (row) => row.room || "(미지정)" },
                { label: "상대 성과", color: "purple", render: (row) => `${Number(row.relativePerformanceScore || 0).toFixed(1)}점 · ${row.relativePerformanceLabel || "보통"}` },
                { label: "진단", color: "green", render: (row) => row.diagnosis || "-", cellColor: (row) => getDiagnosisColor(row.diagnosis) }
            ]),
            { type: "heading_3", heading_3: { rich_text: richTextAnnotated("상대 성과 하위 10", { bold: true, color: "red" }) } },
            buildTopRoomTable("상대 성과 하위 10", relativeBottom10, [
                { label: "순위", render: (_, index) => `#${index + 1}` },
                { label: "건물", render: (row) => row.building || "(미지정)" },
                { label: "객실", render: (row) => row.room || "(미지정)" },
                { label: "상대 성과", color: "red", render: (row) => `${Number(row.relativePerformanceScore || 0).toFixed(1)}점 · ${row.relativePerformanceLabel || "보통"}` },
                { label: "RevPAR", color: "green", render: (row) => fmtYen(row.revPar) },
                { label: "진단", color: "green", render: (row) => row.diagnosis || "-", cellColor: (row) => getDiagnosisColor(row.diagnosis) }
            ])
        );
    } else {
        blocksAfterPricing.push(callout("일반 건물 객실 데이터 없음", "🚪", "gray_background"));
    }

    return { blocksBeforePricing, blocksAfterPricing, buildingToggles };
}

/** 매출 대시보드(DB 집계) → 노션 · 2026년 1월~당월 월별 토글 + 보고서 */
async function syncNotionSalesDashboard(pageId, { tokyoNow, summaryText, monthlyReports, runReportUrl, appDashboardUrl }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const reports = Array.isArray(monthlyReports) && monthlyReports.length > 0
        ? monthlyReports
        : [];
    const monthLabels = reports.map((r) => {
        const [y, m] = (r.yearMonth || "").split("-");
        const year = Number(y) || new Date().getFullYear();
        const month = Number(m) || 0;
        return { label: `${year}년 ${month}월`, yearMonth: r.yearMonth };
    });

    const blocks = [
        { type: "heading_1", heading_1: { rich_text: richTextAnnotated("매출 · 가동률 Executive Dashboard", { color: "blue", bold: true }) } },
        {
            type: "quote",
            quote: {
                rich_text: richText("경영진 의사결정을 위한 월별 매출·가동률 통합 브리프입니다. 일반 건물, 오쿠보 단독주택, 사노시 참고 매출을 분리해 비교하고, 같은 건물 내 객실 가격 적정성까지 함께 진단합니다.")
            }
        },
        criteriaCallout([
            "매출: confirmed 전체 플랫폼 기준(Direct · Expedia · Agoda 포함), 다이쿄초 제외, 숙박일수 overlap 방식으로 월별 배분",
            "사노시는 reference revenue로 분리 표기하고 운영 포트폴리오 총매출과는 구분",
            "가동률: 운영 건물(core + 오쿠보A/B/C) 기준, 사노시 제외",
            "체크인 예약건수: Airbnb · Booking.com만 포함, 사노시 제외"
        ]),
        callout("Overlap 기준 집계입니다. 사노시는 참고 매출만 별도 표기하고, 오쿠보 A/B/C는 일반 객실형 건물과 분리해 해석합니다.", "📌", "gray_background"),
        updatedAt(tokyoNow),
        tableOfContentsBlock("gray"),
        divider()
    ];

    if (appDashboardUrl) {
        blocks.push({ type: "heading_2", heading_2: { rich_text: richTextAnnotated("앱 대시보드 바로가기", { color: "purple", bold: true }) } });
        blocks.push(callout("날짜·건물·플랫폼별 상세 필터와 인터랙티브 차트는 앱 Revenue / Occupancy Dashboard에서 함께 확인할 수 있습니다.", "🔍", "blue_background"));
        const embed = embedBlock(appDashboardUrl);
        if (embed) blocks.push(embed);
        blocks.push(divider());
    }

    blocks.push({ type: "heading_2", heading_2: { rich_text: richTextAnnotated("🔗 Executive Links", { color: "gray", bold: true }) } });
    if (runReportUrl) {
        const refreshBookmark = bookmarkBlock(runReportUrl, "수동 갱신 실행");
        if (refreshBookmark) blocks.push(refreshBookmark);
    }
    if (appDashboardUrl) {
        const appBookmark = bookmarkBlock(appDashboardUrl, "Revenue Dashboard 열기");
        if (appBookmark) blocks.push(appBookmark);
    }
    blocks.push(divider());

    blocks.push({ type: "heading_2", heading_2: { rich_text: richTextAnnotated("월별 Executive Brief", { color: "brown", bold: true }) } });
    blocks.push(callout("월을 펼치면 Executive Summary, 일반 건물 운영 비교, 오쿠보 단독주택 비교, 사노시 참고 매출, 객실 가격 적정성 진단, 건물별 드릴다운을 순서대로 볼 수 있습니다.", "👆", "blue_background"));

    if (monthLabels.length === 0) {
        blocks.push(callout(summaryText || "데이터 없음 (overlap 집계 미수행)", "📊", "gray_background"));
        blocks.push(divider(), reportFooter());
    }

    try {
        await setPageTitle(notion, pageId, "매출 · 가동률 대시보드");
        await clearPageBlocks(notion, pageId);
        if (monthLabels.length === 0) {
            await appendBlocksInChunks(notion, pageId, blocks);
        } else {
            const mainBlocks = blocks;
            await appendBlocksInChunks(notion, pageId, mainBlocks);
            const toggleBlocks = reports.map((reportItem, index) => ({
                type: "heading_2",
                heading_2: {
                    rich_text: [
                        ...richTextAnnotated(`${monthLabels[index].label} Executive Brief`, { bold: true, color: "blue" }),
                        { type: "text", text: { content: "  ·  " }, annotations: { color: "gray" } },
                        { type: "text", text: { content: fmtYen(reportItem?.salesData?.currentMonthRevenue || 0) }, annotations: { bold: true, color: "green" } },
                        ...(index === reports.length - 1 ? [{ type: "text", text: { content: "  당월" }, annotations: { bold: true, color: "orange" } }] : [])
                    ],
                    is_toggleable: true
                }
            }));
            const toggleIds = await appendBlocksAndReturnIds(notion, pageId, toggleBlocks);
            for (let i = 0; i < toggleIds.length && i < reports.length; i++) {
                const { blocksBeforePricing, blocksAfterPricing, buildingToggles } = buildOneMonthReportBlocks(reports[i]);
                await appendBlocksInChunks(notion, toggleIds[i], blocksBeforePricing);
                if (buildingToggles.length > 0) {
                    try {
                        const toggleBlocks = buildingToggles.map((t) => ({
                            type: "heading_3",
                            heading_3: {
                                rich_text: [
                                    { type: "text", text: { content: `🏢 ${t.buildingName}  ·  ` } },
                                    { type: "text", text: { content: fmtYen(t.totalRevenue) }, annotations: { bold: true, color: "green" } },
                                    { type: "text", text: { content: `  ·  가동률 ${t.occupancyPct}%  ·  객실 ${t.roomCount}개` }, annotations: { color: "gray" } }
                                ],
                                is_toggleable: true
                            }
                        }));
                        const buildingToggleIds = await appendBlocksAndReturnIds(notion, toggleIds[i], toggleBlocks);
                        for (let j = 0; j < buildingToggleIds.length && j < buildingToggles.length; j++) {
                            await appendBlocksInChunks(notion, buildingToggleIds[j], buildingToggles[j].childBlocks || []);
                        }
                    } catch (err) {
                        console.warn(`[Notion] Sales Dashboard 건물별 토글 실패 (${reports[i]?.yearMonth || i}):`, err.message);
                    }
                }
                await appendBlocksInChunks(notion, toggleIds[i], blocksAfterPricing);
            }
            await appendBlocksInChunks(notion, pageId, [divider(), reportFooter()]);
        }
        console.log("✅ [Notion] Sales Dashboard 동기화 완료");

        const latestData = reports.length > 0 ? reports[reports.length - 1].salesData : null;
        if (latestData && NOTION_PAGES.salesDashboardDatabaseId) {
            await syncNotionSalesDashboardDatabase(notion, NOTION_PAGES.salesDashboardDatabaseId, latestData);
        }
    } catch (e) {
        console.error("❌ [Notion] Sales Dashboard 동기화 실패:", e.message, e.stack);
        throw e;
    }
}

/** 가동률 대시보드(DB 집계) → 노션 */
async function syncNotionOccupancyDashboard(pageId, { tokyoNow, summaryText }) {
    const notion = getNotionClient();
    if (!notion || !pageId) return;

    const blocks = [
        { type: "heading_1", heading_1: { rich_text: richText("가동률 대시보드") } },
        updatedAt(tokyoNow),
        divider(),
        callout("이 페이지의 상세 가동률 분석은 `매출 · 가동률 대시보드`로 통합되었습니다.", "📈", "blue_background"),
        callout(summaryText || "데이터 없음", "🏠", "green_background"),
        quote("이제 노션에서는 매출, 가동률, 일반 건물 비교, 오쿠보 단독주택 비교, 사노시 참고 매출, 객실 가격 적정성을 한 페이지에서 함께 해석합니다.")
    ];

    try {
        await setPageTitle(notion, pageId, "가동률 대시보드");
        await clearPageBlocks(notion, pageId);
        await appendBlocksInChunks(notion, pageId, blocks);
        console.log("✅ [Notion] Occupancy Dashboard 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Occupancy Dashboard 동기화 실패:", e.message);
    }
}

/** 배포된 환경에서 실제 로드된 토큰 앞자리만 반환 (디버깅용, 노출해도 안전) */
function getTokenPreview() {
    const token = notionApiSecretParam.value() || process.env.NOTION_API_SECRET || process.env.NOTION_TOKEN;
    if (!token || token.startsWith("ntn_YOUR_") || token === "YOUR_NOTION_TOKEN_HERE") return null;
    return token.slice(0, 14) + "...";
}

/** 디버그: 1) users.list로 토큰 검증 2) 페이지에 블록 append 시도 */
async function testNotionConnection(pageId) {
    const notion = getNotionClient();
    const tokenPresent = !!notion;
    const tokenPreview = getTokenPreview();
    if (!notion) {
        return { ok: false, tokenPresent, tokenPreview, error: "토큰 없음 (NOTION_API_SECRET 또는 config 확인)" };
    }
    // 1) 페이지 없이 토큰만 검증 (401이면 토큰 자체가 무효)
    let tokenValid = false;
    try {
        await notion.users.list({ page_size: 1 });
        tokenValid = true;
    } catch (e) {
        return { ok: false, tokenPresent, tokenPreview, tokenValid: false, error: e.message, code: e.code, status: e.status, hint: "토큰이 노션에서 거부됨. 노션 연동에서 시크릿을 '다시 생성' 후 새 값을 .env에 넣고 재배포하세요." };
    }
    if (!pageId) {
        return { ok: true, tokenPresent, tokenPreview, tokenValid: true, message: "토큰 유효 (users.list 성공). pageId 없어 블록 테스트는 생략." };
    }
    // 2) 페이지 조회로 접근 권한 확인 (블록 추가 없음)
    try {
        await notion.pages.retrieve({ page_id: pageId });
        return { ok: true, tokenPresent, tokenPreview, tokenValid: true, message: "연결 성공" };
    } catch (e) {
        return { ok: false, tokenPresent, tokenPreview, tokenValid: true, error: e.message, code: e.code, status: e.status, hint: "토큰은 유효. 해당 노션 페이지에 연동(Connections)으로 이 연동을 추가했는지 확인하세요." };
    }
}

module.exports = {
    getNotionClient,
    NOTION_PAGES,
    testNotionConnection,
    syncNotionDailyLog,
    syncNotionCancelLog,
    syncNotionSalesLog,
    syncNotionPlatformAnalysis,
    syncNotionPaxOccupancy,
    syncNotionSalesDashboard,
    syncNotionOccupancyDashboard
};
