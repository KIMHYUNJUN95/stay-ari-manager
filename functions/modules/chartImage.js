/**
 * 리포트용 차트 이미지 생성 (SVG → PNG) 후 Firebase Storage 업로드.
 * 회사 보고서용 라이트 테마 — 고해상도, 포멀 톤.
 */
const sharp = require("sharp");

const W    = 1280;
const H    = 520;
const PAD  = { top: 72, right: 56, bottom: 64, left: 96 };
const IW   = W - PAD.left - PAD.right;
const IH   = H - PAD.top  - PAD.bottom;

// ── 회사 보고서용 팔레트 (라이트·포멀) ───────────────────────────────────
const R_BG           = "#FFFFFF";
const R_HEADER       = "#0F172A";
const R_HEADER_BAR   = "#1E3A5F";
const R_TITLE        = "#0F172A";
const R_SUBTITLE     = "#64748B";
const R_TEXT         = "#475569";
const R_TEXT_LIGHT   = "#94A3B8";
const R_GRID         = "#E2E8F0";
const R_GRID_BOLD    = "#CBD5E1";
const R_ACCENT       = "#1D4ED8";
const R_ACCENT_LIGHT = "#3B82F6";
const R_BLUE_SOFT    = "#DBEAFE";
const R_RED          = "#B91C1C";
const R_RED_LIGHT    = "#FEE2E2";
const R_GREEN        = "#059669";
const R_GREEN_LIGHT  = "#D1FAE5";
const R_AMBER        = "#D97706";
const R_AMBER_LIGHT  = "#FEF3C7";
const R_BORDER       = "#E2E8F0";
const R_FOOTER       = "#94A3B8";

// 기존 다크 팔레트 (호환용)
const BG        = "#0B1121";
const BG_CARD   = "#111827";
const GRID      = R_GRID;
const GRID_BOLD = R_GRID_BOLD;
const TEXT_H    = "#F8FAFC";
const TEXT_S    = R_TEXT;
const TEXT_XS   = R_SUBTITLE;
const BLUE_A    = R_ACCENT;
const BLUE_B    = R_ACCENT_LIGHT;
const RED_A     = R_RED;
const RED_B     = "#FCA5A5";
const GREEN_A   = R_GREEN;
const GREEN_B   = "#34D399";
const AMBER     = R_AMBER;
const PURPLE    = "#6D28D9";

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtYen(v) {
    const n = Number(v) || 0;
    if (n >= 1_000_000) return `¥${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000)    return `¥${(n / 1_000).toFixed(0)}K`;
    if (n >= 1_000)     return `¥${(n / 1_000).toFixed(1)}K`;
    return `¥${n}`;
}

function fmtYenFull(v) {
    return `¥${Number(v || 0).toLocaleString()}`;
}

// ── 공통 SVG 래퍼 (회사 보고서 스타일) ─────────────────────────────────
function reportDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function svgOpen(title, subtitle, badge) {
    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

    // 배경 (흰색 + 테두리)
    lines.push(`<rect width="${W}" height="${H}" fill="${R_BG}"/>`);
    lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${R_BORDER}" stroke-width="1"/>`);

    // 상단 헤더 바 (네이비)
    lines.push(`<rect x="0" y="0" width="${W}" height="44" fill="${R_HEADER_BAR}"/>`);
    lines.push(`<rect x="0" y="44" width="${W}" height="1" fill="${R_GRID_BOLD}"/>`);

    // 제목 (헤더 바 안)
    lines.push(`<text x="${PAD.left}" y="28" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="16" font-weight="600" fill="${R_BG}" letter-spacing="-0.3">${esc(title)}</text>`);
    if (badge) {
        const bx = W - PAD.right - badge.length * 6.5 - 16;
        lines.push(`<rect x="${bx}" y="14" width="${badge.length * 6.5 + 16}" height="18" fill="rgba(255,255,255,0.2)" rx="4"/>`);
        lines.push(`<text x="${bx + (badge.length * 6.5 + 16)/2}" y="27" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${R_BG}">${esc(badge)}</text>`);
    }

    // 부제 (헤더 아래)
    if (subtitle) {
        lines.push(`<text x="${PAD.left}" y="62" font-family="system-ui,sans-serif" font-size="12" fill="${R_SUBTITLE}">${esc(subtitle)}</text>`);
    }

    // 하단 푸터 (Internal Report · 날짜)
    lines.push(`<line x1="${PAD.left}" y1="${H - 28}" x2="${PAD.left + IW}" y2="${H - 28}" stroke="${R_GRID}" stroke-width="1"/>`);
    lines.push(`<text x="${PAD.left}" y="${H - 10}" font-family="system-ui,sans-serif" font-size="10" fill="${R_FOOTER}">Internal Report · ${reportDate()}</text>`);

    return lines;
}

// ── Y축 그리드 (통화) ──────────────────────────────────────────────────
function yGridYen(maxVal, ticks = 5) {
    const lines = [];
    for (let i = 0; i <= ticks; i++) {
        const y = PAD.top + IH - (IH * i / ticks);
        const v = maxVal * i / ticks;
        const isBold = i === 0 || i === ticks;
        lines.push(`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + IW}" y2="${y}" stroke="${isBold ? GRID_BOLD : GRID}" stroke-width="${isBold ? 1 : 0.8}"/>`);
        lines.push(`<text x="${PAD.left - 12}" y="${y + 5}" text-anchor="end" font-family="system-ui,sans-serif" font-size="12" fill="${TEXT_XS}">${fmtYen(v)}</text>`);
    }
    return lines;
}

// ── Y축 그리드 (건수) ──────────────────────────────────────────────────
function yGridCount(maxVal, ticks = 4) {
    const lines = [];
    for (let i = 0; i <= ticks; i++) {
        const y = PAD.top + IH - (IH * i / ticks);
        const v = Math.round(maxVal * i / ticks);
        const isBold = i === 0 || i === ticks;
        lines.push(`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + IW}" y2="${y}" stroke="${isBold ? GRID_BOLD : GRID}" stroke-width="${isBold ? 1 : 0.8}"/>`);
        lines.push(`<text x="${PAD.left - 12}" y="${y + 5}" text-anchor="end" font-family="system-ui,sans-serif" font-size="12" fill="${TEXT_XS}">${v}</text>`);
    }
    return lines;
}

function axes() {
    return [
        `<line x1="${PAD.left}" y1="${PAD.top - 4}" x2="${PAD.left}" y2="${PAD.top + IH}" stroke="${R_GRID_BOLD}" stroke-width="1"/>`,
        `<line x1="${PAD.left}" y1="${PAD.top + IH}" x2="${PAD.left + IW}" y2="${PAD.top + IH}" stroke="${R_GRID_BOLD}" stroke-width="1"/>`
    ];
}

// ══════════════════════════════════════════════════════════════════════
// 1. 일별 매출 막대차트
// ══════════════════════════════════════════════════════════════════════
function buildDailyRevenueSvg(rows) {
    const data = (rows || []).slice(-31).map(r => ({
        label: String(r[0]).slice(5),
        value: Number(r[3]) || 0
    }));
    if (data.length === 0) return "";

    const maxVal  = Math.max(1, ...data.map(d => d.value));
    const avg     = data.reduce((s, d) => s + d.value, 0) / data.length;
    const total   = data.reduce((s, d) => s + d.value, 0);
    const maxDay  = data.reduce((a, b) => b.value > a.value ? b : a, data[0]);
    const step    = IW / data.length;
    const barW    = Math.max(8, step * 0.62);

    const lines = svgOpen(
        "일별 매출 추이",
        `총 ${fmtYenFull(total)}  ·  일평균 ${fmtYen(avg)}  ·  최고 ${fmtYen(maxDay.value)} (${maxDay.label})`,
        `${data.length}일`
    );

    lines.push(`<defs>
      <linearGradient id="bG1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_ACCENT_LIGHT}"/>
        <stop offset="100%" stop-color="${R_ACCENT}"/>
      </linearGradient>
      <linearGradient id="bG2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_ACCENT_LIGHT}"/>
        <stop offset="100%" stop-color="#2563EB"/>
      </linearGradient>
    </defs>`);

    lines.push(...yGridYen(maxVal));
    lines.push(...axes());

    const avgY = PAD.top + IH - (avg / maxVal) * IH;
    lines.push(`<line x1="${PAD.left}" y1="${avgY}" x2="${PAD.left + IW}" y2="${avgY}" stroke="${R_AMBER}" stroke-width="1.5" stroke-dasharray="8,4"/>`);
    lines.push(`<rect x="${PAD.left + IW + 4}" y="${avgY - 9}" width="42" height="18" fill="${R_AMBER_LIGHT}" rx="4"/>`);
    lines.push(`<text x="${PAD.left + IW + 25}" y="${avgY + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${R_AMBER}">평균</text>`);

    data.forEach((d, i) => {
        const x    = PAD.left + i * step + (step - barW) / 2;
        const barH = Math.max(d.value > 0 ? 3 : 0, (d.value / maxVal) * IH);
        const y    = PAD.top + IH - barH;
        const isMax = d.value === maxDay.value;
        const isAboveAvg = d.value > avg;

        if (isMax) {
            lines.push(`<rect x="${x - 3}" y="${PAD.top}" width="${barW + 6}" height="${IH}" fill="${R_BLUE_SOFT}" rx="4"/>`);
        }
        lines.push(`<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${isMax ? "url(#bG2)" : "url(#bG1)"}" rx="4"/>`);
        if (d.value > avg * 0.6 && data.length <= 20) {
            lines.push(`<text x="${x + barW / 2}" y="${y - 7}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="${isMax ? 700 : 500}" fill="${isMax ? R_ACCENT : R_TEXT}">${fmtYen(d.value)}</text>`);
        }
        const showLabel = data.length <= 16 || i % Math.ceil(data.length / 16) === 0;
        if (showLabel) {
            lines.push(`<text x="${x + barW / 2}" y="${PAD.top + IH + 20}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${R_SUBTITLE}">${esc(d.label)}</text>`);
        }
    });

    lines.push("</svg>");
    return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// 2. 신규/취소 그룹 막대차트
// ══════════════════════════════════════════════════════════════════════
function buildBookingCountSvg(rows) {
    const data = (rows || []).slice(-31).map(r => ({
        label:     String(r[0]).slice(5),
        newCnt:    Number(r[1]) || 0,
        cancelCnt: Number(r[2]) || 0
    }));
    if (data.length === 0) return "";

    const maxVal     = Math.max(1, ...data.map(d => Math.max(d.newCnt, d.cancelCnt)));
    const totalNew   = data.reduce((s, d) => s + d.newCnt, 0);
    const totalCancel = data.reduce((s, d) => s + d.cancelCnt, 0);
    const cancelRate = (totalNew + totalCancel) > 0
        ? ((totalCancel / (totalNew + totalCancel)) * 100).toFixed(1) : "0.0";
    const step  = IW / data.length;
    const barW  = Math.max(5, step * 0.36);

    const lines = svgOpen(
        "신규 · 취소 건수 추이",
        `신규 ${totalNew}건  ·  취소 ${totalCancel}건  ·  취소율 ${cancelRate}%`,
        `${data.length}일`
    );

    lines.push(`<defs>
      <linearGradient id="nG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_ACCENT_LIGHT}"/>
        <stop offset="100%" stop-color="${R_ACCENT}"/>
      </linearGradient>
      <linearGradient id="cG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_RED_LIGHT}"/>
        <stop offset="100%" stop-color="${R_RED}"/>
      </linearGradient>
    </defs>`);

    const lgX = W - PAD.right - 160;
    lines.push(`<rect x="${lgX}" y="56" width="12" height="12" fill="${R_ACCENT}" rx="3"/>`);
    lines.push(`<text x="${lgX + 16}" y="67" font-family="system-ui,sans-serif" font-size="12" fill="${R_TEXT}">신규</text>`);
    lines.push(`<rect x="${lgX + 66}" y="56" width="12" height="12" fill="${R_RED}" rx="3"/>`);
    lines.push(`<text x="${lgX + 82}" y="67" font-family="system-ui,sans-serif" font-size="12" fill="${R_TEXT}">취소</text>`);

    lines.push(...yGridCount(maxVal));
    lines.push(...axes());

    data.forEach((d, i) => {
        const gx = PAD.left + i * step;
        const cx = gx + (step - barW * 2 - 4) / 2;

        const hN = Math.max(d.newCnt > 0 ? 3 : 0, (d.newCnt / maxVal) * IH);
        const yN = PAD.top + IH - hN;
        lines.push(`<rect x="${cx}" y="${yN}" width="${barW}" height="${hN}" fill="url(#nG)" rx="4 4 2 2"/>`);
        if (d.newCnt > 0 && data.length <= 20) {
            lines.push(`<text x="${cx + barW / 2}" y="${yN - 6}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${R_ACCENT}">${d.newCnt}</text>`);
        }
        const hC = Math.max(d.cancelCnt > 0 ? 3 : 0, (d.cancelCnt / maxVal) * IH);
        const yC = PAD.top + IH - hC;
        lines.push(`<rect x="${cx + barW + 4}" y="${yC}" width="${barW}" height="${hC}" fill="url(#cG)" rx="4"/>`);
        if (d.cancelCnt > 0 && data.length <= 20) {
            lines.push(`<text x="${cx + barW + 4 + barW / 2}" y="${yC - 6}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${R_RED}">${d.cancelCnt}</text>`);
        }
        const showLabel = data.length <= 16 || i % Math.ceil(data.length / 16) === 0;
        if (showLabel) {
            lines.push(`<text x="${gx + step / 2}" y="${PAD.top + IH + 20}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${R_SUBTITLE}">${esc(d.label)}</text>`);
        }
    });

    lines.push("</svg>");
    return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// 3. 누적 매출 라인차트
// ══════════════════════════════════════════════════════════════════════
function buildCumulativeRevenueSvg(rows) {
    const raw = (rows || []).slice(-31);
    if (raw.length === 0) return "";

    let cum = 0;
    const data = raw.map(r => {
        cum += Number(r[3]) || 0;
        return { label: String(r[0]).slice(5), cum, daily: Number(r[3]) || 0 };
    });

    const maxVal = Math.max(1, data[data.length - 1].cum);
    const step   = IW / Math.max(data.length - 1, 1);
    const final  = data[data.length - 1].cum;

    const lines = svgOpen(
        "누적 매출 추이",
        `최종 누적 ${fmtYenFull(final)}`,
        `${data.length}일`
    );

    lines.push(`<defs>
      <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_GREEN}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${R_GREEN}" stop-opacity="0.02"/>
      </linearGradient>
      <linearGradient id="lineG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${R_GREEN}"/>
        <stop offset="100%" stop-color="${R_GREEN_LIGHT}"/>
      </linearGradient>
    </defs>`);

    lines.push(...yGridYen(maxVal));
    lines.push(...axes());

    const target80Y = PAD.top + IH - IH * 0.8;
    lines.push(`<line x1="${PAD.left}" y1="${target80Y}" x2="${PAD.left + IW}" y2="${target80Y}" stroke="${R_AMBER_LIGHT}" stroke-width="1" stroke-dasharray="6,4"/>`);

    // 포인트 좌표
    const pts = data.map((d, i) => ({
        x: PAD.left + i * step,
        y: PAD.top + IH - (d.cum / maxVal) * IH,
        ...d
    }));

    // 면적
    if (pts.length > 1) {
        const area = `M ${pts[0].x},${PAD.top + IH} ` +
            pts.map(p => `L ${p.x},${p.y}`).join(" ") +
            ` L ${pts[pts.length-1].x},${PAD.top + IH} Z`;
        lines.push(`<path d="${area}" fill="url(#areaG)"/>`);

        // 라인
        const path = "M " + pts.map(p => `${p.x},${p.y}`).join(" L ");
        lines.push(`<path d="${path}" fill="none" stroke="url(#lineG)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    }

    // 점
    pts.forEach((p, i) => {
        const isLast = i === pts.length - 1;
        const showLabel = data.length <= 16 || i % Math.ceil(data.length / 16) === 0;

        if (isLast) {
            lines.push(`<circle cx="${p.x}" cy="${p.y}" r="6" fill="${R_GREEN}"/>`);
            lines.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="${R_BG}"/>`);
            const lbl = fmtYenFull(p.cum);
            const lbw = lbl.length * 8.5 + 24;
            const lbx = Math.min(p.x - lbw / 2, PAD.left + IW - lbw);
            lines.push(`<rect x="${lbx}" y="${p.y - 36}" width="${lbw}" height="24" fill="${R_GREEN}" rx="8"/>`);
            lines.push(`<text x="${lbx + lbw/2}" y="${p.y - 19}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${R_BG}">${esc(lbl)}</text>`);
        } else {
            lines.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${R_BG}" stroke="${R_GREEN}" stroke-width="2"/>`);
        }
        if (showLabel) {
            lines.push(`<text x="${p.x}" y="${PAD.top + IH + 20}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${R_SUBTITLE}">${esc(p.label)}</text>`);
        }
    });

    lines.push("</svg>");
    return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// 5. 월별 매출 막대차트 (매출 대시보드용, 최근 6개월)
// ══════════════════════════════════════════════════════════════════════
function buildMonthlyRevenueSvg(monthlySeries = []) {
    const data = (monthlySeries || []).slice(0, 6).map((d) => ({
        label: String(d.month || "").replace(/^(\d{4})-(\d{2})$/, "$2월"),
        value: Number(d.revenue) || 0
    }));
    if (data.length === 0) return "";

    const maxVal = Math.max(1, ...data.map((d) => d.value));
    const total = data.reduce((s, d) => s + d.value, 0);
    const avg = total / Math.max(1, data.length);
    const step = IW / data.length;
    const barW = Math.max(24, step * 0.58);

    const lines = svgOpen(
        "월별 매출 추이 (최근 6개월)",
        `총 ${fmtYenFull(total)}  ·  overlap 기준 (Revenue Dashboard 동일)`,
        `${data.length}개월`
    );

    lines.push(`<defs>
      <linearGradient id="mBarG1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_ACCENT_LIGHT}"/>
        <stop offset="100%" stop-color="${R_ACCENT}"/>
      </linearGradient>
      <linearGradient id="mBarG2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${R_GREEN_LIGHT}"/>
        <stop offset="100%" stop-color="${R_GREEN}"/>
      </linearGradient>
    </defs>`);

    lines.push(...yGridYen(maxVal));
    lines.push(...axes());
    const avgY = PAD.top + IH - (avg / maxVal) * IH;
    lines.push(`<line x1="${PAD.left}" y1="${avgY}" x2="${PAD.left + IW}" y2="${avgY}" stroke="${R_AMBER}" stroke-width="1.5" stroke-dasharray="8,4"/>`);
    lines.push(`<rect x="${PAD.left + IW - 48}" y="${avgY - 10}" width="44" height="18" fill="${R_AMBER_LIGHT}" rx="4"/>`);
    lines.push(`<text x="${PAD.left + IW - 26}" y="${avgY + 3}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="${R_AMBER}">평균</text>`);

    const maxItem = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
    data.forEach((d, i) => {
        const x = PAD.left + i * step + (step - barW) / 2;
        const barH = Math.max(d.value > 0 ? 4 : 0, (d.value / maxVal) * IH);
        const y = PAD.top + IH - barH;
        const isCurrent = i === data.length - 1;

        if (d.value === maxItem.value && d.value > 0) {
            lines.push(`<rect x="${x - 4}" y="${PAD.top}" width="${barW + 8}" height="${IH}" fill="${R_BLUE_SOFT}" rx="4"/>`);
        }
        lines.push(`<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${isCurrent ? "url(#mBarG2)" : "url(#mBarG1)"}" rx="4"/>`);
        if (isCurrent) {
            lines.push(`<rect x="${x - 6}" y="${PAD.top - 28}" width="${barW + 12}" height="18" fill="${R_GREEN_LIGHT}" rx="6"/>`);
            lines.push(`<text x="${x + barW / 2}" y="${PAD.top - 15}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="${R_GREEN}">CURRENT</text>`);
        }
        if (d.value > maxVal * 0.15) {
            lines.push(`<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="${isCurrent ? 700 : 500}" fill="${isCurrent ? R_GREEN : R_TEXT}">${fmtYen(d.value)}</text>`);
        }
        lines.push(`<text x="${x + barW / 2}" y="${PAD.top + IH + 20}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${R_SUBTITLE}">${esc(d.label)}</text>`);
    });

    lines.push("</svg>");
    return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// 6. 건물별 매출 가로 막대차트 (월별 보고서용)
// ══════════════════════════════════════════════════════════════════════
function buildBuildingRevenueSvg(buildingBreakdown = []) {
    const data = (buildingBreakdown || []).slice(0, 16).map((d) => ({
        label: String(d.building || "").slice(0, 12),
        value: Number(d.revenue) || 0
    }));
    if (data.length === 0) return "";

    const maxVal = Math.max(1, ...data.map((d) => d.value));
    const total = data.reduce((s, d) => s + d.value, 0);
    const n = data.length;
    const rowHeight = IH / n;
    const barHeight = Math.max(14, rowHeight * 0.65);
    const labelW = 88;

    const lines = svgOpen(
        "건물별 매출",
        `총 ${fmtYenFull(total)}  ·  overlap 기준`,
        `${n}개 건물`
    );

    lines.push(`<defs>
      <linearGradient id="bBarG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${R_ACCENT_LIGHT}"/>
        <stop offset="100%" stop-color="${R_ACCENT}"/>
      </linearGradient>
    </defs>`);

    const barMaxW = IW - labelW - 50;
    lines.push(`<line x1="${PAD.left + labelW}" y1="${PAD.top}" x2="${PAD.left + labelW}" y2="${PAD.top + IH}" stroke="${R_GRID_BOLD}" stroke-width="1"/>`);
    const top = data[0];

    data.forEach((d, i) => {
        const y = PAD.top + i * rowHeight + (rowHeight - barHeight) / 2;
        const barW = Math.max(0, (d.value / maxVal) * barMaxW);
        const barX = PAD.left + labelW + 8;
        const share = total > 0 ? ((d.value * 100) / total).toFixed(1) : "0.0";
        const isTop = i === 0;

        lines.push(`<text x="${PAD.left + labelW - 6}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="${R_TEXT}">${esc(d.label)}</text>`);
        if (isTop) {
            lines.push(`<rect x="${PAD.left + 4}" y="${y - 6}" width="${IW}" height="${barHeight + 12}" fill="${R_BLUE_SOFT}" rx="8"/>`);
            lines.push(`<text x="${PAD.left + 10}" y="${y + barHeight / 2 + 4}" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="${R_ACCENT}">#1</text>`);
        }
        lines.push(`<rect x="${barX}" y="${y}" width="${barW}" height="${barHeight}" fill="url(#bBarG)" rx="4"/>`);
        if (barW > 60) {
            lines.push(`<text x="${barX + barW - 4}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" font-weight="${isTop ? 700 : 500}" fill="${R_TEXT}">${fmtYen(d.value)} · ${share}%</text>`);
        } else if (barW > 10) {
            lines.push(`<text x="${barX + barW + 6}" y="${y + barHeight / 2 + 4}" font-family="system-ui,sans-serif" font-size="10" fill="${R_TEXT}">${fmtYen(d.value)} · ${share}%</text>`);
        }
    });

    lines.push("</svg>");
    return lines.join("\n");
}

// ── SVG → PNG → Storage ───────────────────────────────────────────────
async function svgToPngBuffer(svg) {
    return sharp(Buffer.from(svg)).png().toBuffer();
}

async function uploadChartToStorage(pngBuffer, path) {
    try {
        const admin  = require("firebase-admin");
        const bucket = admin.storage().bucket("my-booking-app-3f0e7.firebasestorage.app");
        const file   = bucket.file(path);
        await file.save(pngBuffer, {
            contentType: "image/png",
            metadata: { cacheControl: "public, max-age=0, no-cache" }
        });
        await file.makePublic();
        return `https://storage.googleapis.com/${bucket.name}/${path}?t=${Date.now()}`;
    } catch (e) {
        console.warn("[chartImage] Storage upload failed:", e.message);
        return null;
    }
}

async function getDailyRevenueChartUrl(rows, yearMonth = "") {
    const svg = buildDailyRevenueSvg(rows);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/daily-revenue-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getDailyRevenueChartUrl:", e.message); return null; }
}

async function getBookingCountChartUrl(rows, yearMonth = "") {
    const svg = buildBookingCountSvg(rows);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/booking-count-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getBookingCountChartUrl:", e.message); return null; }
}

async function getCumulativeRevenueChartUrl(rows, yearMonth = "") {
    const svg = buildCumulativeRevenueSvg(rows);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/cumulative-revenue-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getCumulativeRevenueChartUrl:", e.message); return null; }
}

// ══════════════════════════════════════════════════════════════════════
// 4. 날짜별 취소 건수 — 가로형 막대 (Y=날짜, X=건수)
// ══════════════════════════════════════════════════════════════════════
function buildCancelByDaySvg(cancelRows) {
    const raw = (cancelRows || []).slice(0, 31);
    const data = raw.map(r => ({
        label: String(r[0]).replace(/^\d{4}-/, ""),
        value: Number(r[1]) || 0
    }));
    if (data.length === 0) return "";

    const maxVal = Math.max(1, ...data.map(d => d.value));
    const totalCancel = data.reduce((s, d) => s + d.value, 0);
    const maxDay = data.reduce((a, b) => b.value > a.value ? b : a, data[0]);

    const n = data.length;
    const rowHeight = IH / n;
    const barHeight = Math.max(10, rowHeight * 0.68);
    const labelW = 56;

    const lines = svgOpen(
        "날짜별 취소 건수",
        `총 ${totalCancel}건  ·  최다 ${maxDay.value}건 (${maxDay.label})`,
        `${n}일`
    );

    lines.push(`<defs>
      <linearGradient id="hBarG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${R_RED_LIGHT}"/>
        <stop offset="100%" stop-color="${R_RED}"/>
      </linearGradient>
      <linearGradient id="hBarGMax" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="#FECACA"/>
        <stop offset="100%" stop-color="${R_RED}"/>
      </linearGradient>
    </defs>`);

    for (let i = 0; i <= 5; i++) {
        const v = Math.round(maxVal * i / 5);
        const x = PAD.left + labelW + (IW - labelW) * (i / 5);
        const isBold = i === 0 || i === 5;
        lines.push(`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + IH}" stroke="${isBold ? R_GRID_BOLD : R_GRID}" stroke-width="${isBold ? 1 : 0.8}"/>`);
        lines.push(`<text x="${x}" y="${PAD.top + IH + 18}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${R_SUBTITLE}">${v}</text>`);
    }
    lines.push(`<line x1="${PAD.left + labelW}" y1="${PAD.top + IH}" x2="${PAD.left + IW}" y2="${PAD.top + IH}" stroke="${R_GRID_BOLD}" stroke-width="1"/>`);

    data.forEach((d, i) => {
        const y = PAD.top + (i + 0.5) * rowHeight;
        const barW = maxVal > 0 ? (d.value / maxVal) * (IW - labelW - 24) : 0;
        const isMax = d.value === maxDay.value && d.value > 0;

        lines.push(`<text x="${PAD.left + labelW - 6}" y="${y + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="${R_TEXT}">${esc(d.label)}</text>`);
        if (d.value > 0) {
            lines.push(`<rect x="${PAD.left + labelW}" y="${y - barHeight / 2}" width="${Math.max(4, barW)}" height="${barHeight}" fill="${isMax ? "url(#hBarGMax)" : "url(#hBarG)"}" rx="3"/>`);
            if (barW > 30) {
                lines.push(`<text x="${PAD.left + labelW + barW - 6}" y="${y + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" font-weight="${isMax ? 700 : 500}" fill="${isMax ? R_RED_LIGHT : R_RED}">${d.value}건</text>`);
            }
        }
    });

    lines.push("</svg>");
    return lines.join("\n");
}

async function getCancelByDayChartUrl(cancelRows, yearMonth = "") {
    const svg = buildCancelByDaySvg(cancelRows);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/cancel-by-day-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getCancelByDayChartUrl:", e.message); return null; }
}

async function getMonthlyRevenueChartUrl(monthlySeries = [], yearMonth = "") {
    const svg = buildMonthlyRevenueSvg(monthlySeries);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/monthly-revenue-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getMonthlyRevenueChartUrl:", e.message); return null; }
}

async function getBuildingRevenueChartUrl(buildingBreakdown = [], yearMonth = "") {
    const svg = buildBuildingRevenueSvg(buildingBreakdown);
    if (!svg) return null;
    try {
        return await uploadChartToStorage(await svgToPngBuffer(svg), `notion-charts/building-revenue-${yearMonth || "report"}.png`);
    } catch (e) { console.warn("[chartImage] getBuildingRevenueChartUrl:", e.message); return null; }
}

module.exports = {
    buildDailyRevenueSvg,
    buildBookingCountSvg,
    buildCumulativeRevenueSvg,
    buildCancelByDaySvg,
    buildMonthlyRevenueSvg,
    getDailyRevenueChartUrl,
    getBookingCountChartUrl,
    getCumulativeRevenueChartUrl,
    getCancelByDayChartUrl,
    getMonthlyRevenueChartUrl,
    getBuildingRevenueChartUrl,
    buildBuildingRevenueSvg,
    uploadChartToStorage
};
