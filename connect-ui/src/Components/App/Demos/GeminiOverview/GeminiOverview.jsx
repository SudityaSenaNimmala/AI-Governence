import { Activity, AlertTriangle, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import PiCharts from "../../../Resuables/Charts/PiCharts";
import UsageTrendAreaChart from "../../../Resuables/Charts/UsageTrendAreaChart";
import { getAIHubUsageTrend } from "../../AIHub/AIHubActions";

/** Demo org size: charts and KPIs stay consistent with this headcount. */
const GEMINI_ACTIVE_USERS = 10;

/** Eligible / licensed seats (denominator for adoption % vs adoption pie total). ~59% adoption. */
const GEMINI_LICENSED_ELIGIBLE = 12;

const sumGeminiAdoptionUsers = () => GEMINI_ADOPTION_BY_APP.reduce((s, a) => s + a.y, 0);

const sumGeminiFeatureInteractions = () =>
    GEMINI_FEATURE_BREAKDOWN.reduce((s, r) => s + Number(r.summarization || 0) + Number(r.generation || 0), 0);

/** Demo-only: minimum wait before charts render (simulates API latency). */
const FAKE_GEMINI_API_DELAY_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ~28-day DAU: unique users per day (max ≤ org size); weekends run lower than weekdays. */
const GEMINI_DAU_FALLBACK = (() => {
    const out = [];
    const anchor = new Date("2026-03-30");
    const n = GEMINI_ACTIVE_USERS;
    const weekendFactor = 0.62;
    const minDau = Math.max(1, Math.ceil(n * 0.35));
    const weekendMin = Math.max(1, Math.floor(n * 0.25));
    for (let i = 27; i >= 0; i--) {
        const d = new Date(anchor);
        d.setUTCDate(d.getUTCDate() - i);
        const t = 27 - i;
        const mid = n * 0.72;
        const amp = n * 0.12;
        const wave = mid + Math.sin(t / 3.5) * amp + t * 0.15;
        const spike = t === 27 ? Math.min(Math.max(2, Math.ceil(n * 0.18)), Math.max(0, n - wave)) : 0;
        const dow = d.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        let activeUserCount = Math.round(Math.min(n, Math.max(minDau, wave + spike)));
        if (isWeekend) {
            activeUserCount = Math.round(activeUserCount * weekendFactor);
            activeUserCount = Math.max(weekendMin, activeUserCount);
        }
        out.push({
            date: d.toISOString().slice(0, 10),
            activeUserCount,
        });
    }
    return out;
})();

/** Active users per app (primary app attribution); sums to GEMINI_ACTIVE_USERS. */
const GEMINI_ADOPTION_BY_APP = [
    { name: "Gmail", y: 2, color: "#ef4444" },
    { name: "Docs", y: 2, color: "#6366f1" },
    { name: "Sheets", y: 1, color: "#22c55e" },
    { name: "Meet", y: 1, color: "#06b6d4" },
    { name: "Chat", y: 1, color: "#a855f7" },
    { name: "Slides", y: 1, color: "#ec4899" },
    { name: "Gemini App", y: 1, color: "#eab308" },
    { name: "Drive", y: 1, color: "#f97316" },
];

/** Interaction counts; scaled for GEMINI_ACTIVE_USERS, preserves relative mix across apps. */
const GEMINI_FEATURE_BREAKDOWN = [
    { app: "Gmail", summarization: 35, generation: 32 },
    { app: "Docs", summarization: 17, generation: 19 },
    { app: "Sheets", summarization: 0, generation: 11 },
    { app: "Meet", summarization: 12, generation: 12 },
    { app: "Slides", summarization: 0, generation: 9 },
];

/** User counts by tier; sums to GEMINI_ACTIVE_USERS. */
const GEMINI_ENGAGEMENT_TIERS = [
    { name: "High (≥20 uses)", y: 2, color: "#22c55e" },
    { name: "Medium (5–19)", y: 4, color: "#93c5fd" },
    { name: "Low (1–4)", y: 3, color: "#eab308" },
    { name: "Zero", y: 1, color: "#475569" },
];

const formatYAxisK = (value) => {
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
    return String(value);
};

const FeatureInteractionBarChart = ({
    graphData = [],
    customHeight = 260,
    customWidth = "100%",
    fillContainer = false,
    fillMinHeight = 280,
}) => {
    const wrapperStyle = fillContainer
        ? {
            width: customWidth,
            height: "100%",
            minHeight: fillMinHeight,
            flex: 1,
            minWidth: 0,
        }
        : { width: customWidth, height: customHeight };

    if (!graphData?.length) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    fontSize: "14px",
                    ...wrapperStyle,
                }}
            >
                No data available
            </div>
        );
    }
    return (
        <div style={wrapperStyle}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={graphData} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                        dataKey="app"
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={formatYAxisK}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={{ stroke: "#e2e8f0" }}
                        width={44}
                    />
                    <Tooltip
                        formatter={(value, name) => [Number(value).toLocaleString(), name]}
                        labelStyle={{ color: "#0f172a", fontWeight: 600 }}
                        contentStyle={{
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                    />
                    <Legend
                        verticalAlign="top"
                        align="center"
                        wrapperStyle={{ paddingBottom: 8, fontSize: 12 }}
                    />
                    <Bar
                        dataKey="summarization"
                        name="Summarization"
                        fill="#7c3aed"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                    />
                    <Bar
                        dataKey="generation"
                        name="Generation"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

const TagPill = ({ children, variant = "reports" }) => {
    const isUser = variant === "user";
    return (
        <span
            style={{
                flexShrink: 0,
                fontSize: "11px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "999px",
                border: isUser ? "1px solid #ca8a04" : "1px solid #7c3aed",
                color: isUser ? "#a16207" : "#6d28d9",
                backgroundColor: isUser ? "rgba(234, 179, 8, 0.12)" : "rgba(124, 58, 237, 0.1)",
            }}
        >
            {children}
        </span>
    );
};

const cardShell = {
    backgroundColor: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
};

const rowStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.5rem",
    width: "100%",
};

const headerRow = {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "1rem 1.25rem",
    gap: "8px",
};

const chartLoadingStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    fontSize: "14px",
};

const geminiMetricsRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    width: "100%",
};

/** Light KPI cards: label + icon row, large value, muted subtitle (Demos reference layout). */
const GeminiMetricTile = ({ title, icon: Icon, value, valueColor = "#0f172a", subtitle }) => (
    <div
        style={{
            flex: "1 1 min(200px, 100%)",
            minWidth: "min(100%, 220px)",
            backgroundColor: "#fff",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            padding: "18px 20px 20px",
            display: "flex",
            flexDirection: "column",
        }}
    >
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
                marginBottom: "14px",
            }}
        >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155", lineHeight: 1.35 }}>{title}</span>
            {Icon ? (
                <Icon
                    size={20}
                    strokeWidth={2}
                    color="#64748b"
                    style={{ flexShrink: 0, marginTop: "1px" }}
                    aria-hidden
                />
            ) : null}
        </div>
        <div
            style={{
                fontSize: "28px",
                fontWeight: 700,
                color: valueColor,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
            }}
        >
            {value}
        </div>
        <div style={{ fontSize: "13px", color: "#64748b", marginTop: "10px", lineHeight: 1.45 }}>{subtitle}</div>
    </div>
);

const formatGeminiInteractionTotal = (n) => {
    const v = Number(n) || 0;
    if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
    return v.toLocaleString();
};

const GeminiTopMetricsRow = ({
    activeUsersLabel,
    dauGrowthPct,
    licensedUsersLabel,
    adoptionPct,
    highUsageCount,
    zeroUsageCount,
    totalInteractionsLabel,
    interactionsGrowthPct,
}) => {
    const dauArrow = dauGrowthPct >= 0 ? "↑" : "↓";
    const intArrow = interactionsGrowthPct >= 0 ? "↑" : "↓";
    const dauColor = dauGrowthPct >= 0 ? "#16a34a" : "#dc2626";
    const intColor = interactionsGrowthPct >= 0 ? "#16a34a" : "#dc2626";

    return (
        <div style={geminiMetricsRowStyle}>
            <GeminiMetricTile
                title="Active Gemini Users"
                icon={Sparkles}
                value={activeUsersLabel}
                valueColor="#0f172a"
                subtitle={
                    <>
                        <span style={{ color: dauColor, fontWeight: 600 }}>
                            {dauArrow} {Math.abs(dauGrowthPct)}%
                        </span>
                        <span> vs prior 28 days</span>
                    </>
                }
            />
            <GeminiMetricTile
                title="Licensed Users"
                icon={Users}
                value={licensedUsersLabel}
                valueColor="#0f172a"
                subtitle={`${adoptionPct}% adoption rate`}
            />
            <GeminiMetricTile
                title="Users at Feature Limit"
                icon={AlertTriangle}
                value={String(highUsageCount)}
                valueColor="#b45309"
                subtitle={
                    <>
                        <span style={{ color: "#dc2626", fontWeight: 600 }}>↑ {zeroUsageCount}</span>
                        <span> zero-usage users</span>
                    </>
                }
            />
            <GeminiMetricTile
                title="Total Interactions"
                icon={Activity}
                value={totalInteractionsLabel}
                valueColor="#5b21b6"
                subtitle={
                    <>
                        <span style={{ color: intColor, fontWeight: 600 }}>
                            {intArrow} {Math.abs(interactionsGrowthPct)}%
                        </span>
                        <span> vs prior half-period</span>
                    </>
                }
            />
        </div>
    );
};

const GeminiOverview = () => {
    const [apiHubUsageTrend, setApiHubUsageTrend] = useState(null);
    const [chartsReady, setChartsReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setChartsReady(false);
            const [res] = await Promise.all([getAIHubUsageTrend(), sleep(FAKE_GEMINI_API_DELAY_MS)]);
            if (cancelled) return;
            if (res?.status === "OK") {
                setApiHubUsageTrend(res?.res);
            }
            setChartsReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const dauChartData = useMemo(() => {
        const content = apiHubUsageTrend?.content;
        if (!Array.isArray(content) || content.length === 0) {
            return GEMINI_DAU_FALLBACK;
        }
        const list = content.map((item) => ({
            date: item.date ?? "",
            activeUserCount: Number(item.activeUserCount) ?? 0,
        }));
        const hasSignal = list.some((d) => d.activeUserCount > 0);
        return hasSignal ? list : GEMINI_DAU_FALLBACK;
    }, [apiHubUsageTrend]);

    const topMetrics = useMemo(() => {
        const points = dauChartData;
        const avgSlice = (slice) => {
            if (!slice.length) return 0;
            return slice.reduce((s, p) => s + Number(p.activeUserCount ?? 0), 0) / slice.length;
        };
        let dauGrowthPct = 0;
        if (points.length >= 4) {
            const mid = Math.floor(points.length / 2);
            const a = avgSlice(points.slice(0, mid));
            const b = avgSlice(points.slice(mid));
            dauGrowthPct = a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : 0;
        } else if (points.length >= 2) {
            const first = Number(points[0]?.activeUserCount ?? 0);
            const last = Number(points[points.length - 1]?.activeUserCount ?? 0);
            dauGrowthPct = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;
        }

        const activeFromAdoptionPie = sumGeminiAdoptionUsers();
        const activeUsersDisplay = activeFromAdoptionPie.toLocaleString();

        const licensed = GEMINI_LICENSED_ELIGIBLE;
        const adoptionPct = Math.min(100, Math.round((activeFromAdoptionPie / Math.max(1, licensed)) * 100));

        const highTier = GEMINI_ENGAGEMENT_TIERS.find((t) => t.name.includes("High"))?.y ?? 0;
        const zeroTier = GEMINI_ENGAGEMENT_TIERS.find((t) => t.name.includes("Zero"))?.y ?? 0;

        const totalIx = sumGeminiFeatureInteractions();
        const interactionsGrowthPct = dauGrowthPct;

        return {
            activeUsersLabel: activeUsersDisplay,
            dauGrowthPct,
            licensedUsersLabel: licensed.toLocaleString(),
            adoptionPct,
            highUsageCount: highTier,
            zeroUsageCount: zeroTier,
            totalInteractionsLabel: formatGeminiInteractionTotal(totalIx),
            interactionsGrowthPct,
        };
    }, [dauChartData]);

    return (
        <div
            className="cf_new_dashboard_resourceApps_container"
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
                padding: "0 0 1rem",
            }}
        >
            <GeminiTopMetricsRow
                activeUsersLabel={topMetrics.activeUsersLabel}
                dauGrowthPct={topMetrics.dauGrowthPct}
                licensedUsersLabel={topMetrics.licensedUsersLabel}
                adoptionPct={topMetrics.adoptionPct}
                highUsageCount={topMetrics.highUsageCount}
                zeroUsageCount={topMetrics.zeroUsageCount}
                totalInteractionsLabel={topMetrics.totalInteractionsLabel}
                interactionsGrowthPct={topMetrics.interactionsGrowthPct}
            />
            <div style={rowStyle}>
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        ...cardShell,
                        flex: "2 1 min(520px, 100%)",
                        minWidth: "320px",
                        minHeight: "440px",
                        display: "flex",
                        flexDirection: "column",
                        alignSelf: "stretch",
                    }}
                >
                    <div style={headerRow}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                Daily Active Users — 28 Day Trend
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                Unique users triggering any Gemini feature per day
                            </p>
                        </div>
                        <TagPill>Reports API</TagPill>
                    </div>
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            padding: "0 1.25rem 1rem",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        {chartsReady && dauChartData.length > 0 ? (
                            <UsageTrendAreaChart
                                graphData={dauChartData}
                                dataKey="activeUserCount"
                                customWidth="100%"
                                fillContainer
                                fillMinHeight={300}
                            />
                        ) : (
                            <div
                                style={{
                                    ...chartLoadingStyle,
                                    flex: 1,
                                    minHeight: "300px",
                                }}
                            >
                                Loading usage trend...
                            </div>
                        )}
                    </div>
                </div>

                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        ...cardShell,
                        flex: "1 1 320px",
                        minWidth: "280px",
                    }}
                >
                    <div style={headerRow}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                Adoption by App
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                Active users per Workspace app
                            </p>
                        </div>
                        <TagPill>Reports API</TagPill>
                    </div>
                    <div style={{ padding: "0 0.5rem 1rem", minHeight: chartsReady ? undefined : 320 }}>
                        {chartsReady ? (
                            <PiCharts
                                title=""
                                graphData={GEMINI_ADOPTION_BY_APP}
                                options={{
                                    customWidth: null,
                                    customHeight: null,
                                    dataLabels: "true",
                                    showInLegend: "false",
                                }}
                                viewType="DEPARTMENT"
                                customLink={false}
                            />
                        ) : (
                            <div style={{ ...chartLoadingStyle, minHeight: 300 }}>Loading adoption data...</div>
                        )}
                    </div>
                </div>
            </div>

            <div style={rowStyle}>
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        ...cardShell,
                        flex: "1 1 calc(50% - 0.75rem)",
                        minWidth: "320px",
                        minHeight: "440px",
                        display: "flex",
                        flexDirection: "column",
                        alignSelf: "stretch",
                    }}
                >
                    <div style={headerRow}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                Feature Interaction Breakdown
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                Summarization vs generation counts per app
                            </p>
                        </div>
                        <TagPill>Reports API</TagPill>
                    </div>
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            padding: "0 1.25rem 1rem",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        {chartsReady ? (
                            <FeatureInteractionBarChart
                                graphData={GEMINI_FEATURE_BREAKDOWN}
                                fillContainer
                                fillMinHeight={300}
                            />
                        ) : (
                            <div
                                style={{
                                    ...chartLoadingStyle,
                                    flex: 1,
                                    minHeight: 300,
                                }}
                            >
                                Loading feature breakdown...
                            </div>
                        )}
                    </div>
                </div>

                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        ...cardShell,
                        flex: "1 1 calc(50% - 0.75rem)",
                        minWidth: "320px",
                    }}
                >
                    <div style={headerRow}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                User Engagement Tiers
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                High / Medium / Low / Zero usage users
                            </p>
                        </div>
                        <TagPill variant="user">User Reports</TagPill>
                    </div>
                    <div style={{ padding: "0 0.5rem 1rem", minHeight: chartsReady ? undefined : 320 }}>
                        {chartsReady ? (
                            <PiCharts
                                title=""
                                graphData={GEMINI_ENGAGEMENT_TIERS}
                                options={{
                                    customWidth: null,
                                    customHeight: null,
                                    dataLabels: "true",
                                    showInLegend: "false",
                                }}
                                viewType="DEPARTMENT"
                                customLink={false}
                            />
                        ) : (
                            <div style={{ ...chartLoadingStyle, minHeight: 300 }}>Loading engagement tiers...</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeminiOverview;
