import { Activity, CheckCircle, ChevronUp, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AcceptanceRateAreaChart from "../../Resuables/Charts/AcceptanceRateAreaChart";
import DailyUsagePatternBarChart from "../../Resuables/Charts/DailyUsagePatternBarChart";
import CPVTrendLineChart from "../../Resuables/Charts/CPVTrendLineChart";
import PiCharts from "../../Resuables/Charts/PiCharts";
import UsageTrendAreaChart from "../../Resuables/Charts/UsageTrendAreaChart";
import { getAIHubCPVTrend, getAIHubDailyUsagePattern, getAIHubDepartments, getAIHubFeatures, getAIHubSARTrend, getAIHubUsageTrend } from "./AIHubActions";
import {
    DUMMY_CPV_TREND_DATA,
    DUMMY_DAILY_USAGE_PATTERN_DATA,
    DUMMY_DEPARTMENTS_DATA,
    DUMMY_FEATURE_DATA,
    DUMMY_SAR_TREND_DATA,
    DUMMY_USAGE_TREND_DATA,
    TOOL_USAGE_DATA,
} from "./aiHubDemoData";

/** Maps API keys to display names for Microsoft 365 / Copilot tools (same set used across tool/feature data). */
const FEATURE_LABELS = {
    word: "Word",
    excel: "Excel",
    teams: "Teams",
    outlook: "Outlook",
    powerpoint: "PowerPoint",
    loop: "Loop",
    copilotChat: "Copilot Chat",
    microsoftTeamsCopilot: "Teams Copilot",
    oneNote: "OneNote",
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

const getShortDay = (dayOfWeek) => {
    if (!dayOfWeek) return "";
    const d = String(dayOfWeek).slice(0, 3);
    return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
};

const AIBottomDashboard = () => {
    const [apiHubFeatures, setApiHubFeatures] = useState(null);
    const [apiHubSARTrend, setApiHubSARTrend] = useState(null);
    const [apiHubUsageTrend, setApiHubUsageTrend] = useState(null);
    const [apiHubCPVTrend, setApiHubCPVTrend] = useState(null);
    const [apiHubDepartments, setApiHubDepartments] = useState(null);
    const [apiHubDailyUsagePattern, setApiHubDailyUsagePattern] = useState(null);
    useEffect(() => {
        fetchApiHubFeatures();
        fetchApiHubSARTrend();
        fetchApiHubUsageTrend();
        fetchApiHubCPVTrend();
        fetchApiHubDepartments();
        fetchApiHubDailyUsagePattern();
    }, []);

    const fetchApiHubFeatures = async () => {
        const res = await getAIHubFeatures();
        if (res?.status === "OK") {
            setApiHubFeatures(res?.res);
        }
    };

    const featureGraphData = useMemo(() => {
        if (!apiHubFeatures || typeof apiHubFeatures !== "object") return [];
        const list = Object.entries(apiHubFeatures).map(([key, value]) => ({
            name: FEATURE_LABELS[key] ?? key,
            count: Number(value) ?? 0,
        }));
        // const isEmptyOrAllZero = list.length === 0 || list.every((d) => d.count === 0);
        const isEmptyOrAllZero = true;
        if (isEmptyOrAllZero) return DUMMY_FEATURE_DATA;
        return list;
    }, [apiHubFeatures]);

    const fetchApiHubSARTrend = async () => {
        const res = await getAIHubSARTrend();
        if (res?.status === "OK") {
            setApiHubSARTrend(res?.res);
        }
    };

    const sarChartData = useMemo(() => {
        if (!Array.isArray(apiHubSARTrend)) return [];
        const list =
            apiHubSARTrend.length === 0
                ? []
                : apiHubSARTrend.map((item) => ({
                    name: item.monthLabel ?? item.monthDate ?? "",
                    sar: Number(item.sar) ?? 0,
                }));
        // const isEmptyOrAllZero = list.length === 0 || list.every((d) => d.sar === 0);
        const isEmptyOrAllZero = true;
        if (isEmptyOrAllZero) return DUMMY_SAR_TREND_DATA;
        return list;
    }, [apiHubSARTrend]);

    const { currentSAR, momChange } = useMemo(() => {
        if (!sarChartData.length) return { currentSAR: null, momChange: null };
        const current = sarChartData[sarChartData.length - 1]?.sar ?? 0;
        const previous = sarChartData.length >= 2 ? sarChartData[sarChartData.length - 2]?.sar ?? 0 : current;
        return {
            currentSAR: Math.round(current * 10) / 10,
            momChange: sarChartData.length >= 2 ? Math.round((current - previous) * 10) / 10 : null,
        };
    }, [sarChartData]);


    const fetchApiHubUsageTrend = async () => {
        const res = await getAIHubUsageTrend();
        if (res?.status === "OK") {
            setApiHubUsageTrend(res?.res);
        }
    };

    const usageTrendChartData = useMemo(() => {
        const content = apiHubUsageTrend?.content;
        if (!Array.isArray(content)) return [];
        const list = content.map((item) => ({
            date: item.date ?? "",
            activeUserCount: Number(item.activeUserCount) ?? 0,
        }));
        // const isEmptyOrAllZero = list.length === 0 || list.every((d) => d.activeUserCount === 0);
        const isEmptyOrAllZero = true;
        if (isEmptyOrAllZero) return DUMMY_USAGE_TREND_DATA;
        return list;
    }, [apiHubUsageTrend]);


    const fetchApiHubCPVTrend = async () => {
        const res = await getAIHubCPVTrend();
        if (res?.status === "OK") {
            setApiHubCPVTrend(res?.res);
        }
    };

    const cpvChartData = useMemo(() => {
        if (!Array.isArray(apiHubCPVTrend)) return [];
        const list = apiHubCPVTrend.map((item) => ({
            name: item.monthLabel ?? item.monthDate ?? "",
            cpv: Number(item.cpv) ?? 0,
            targetCPV: Number(item.targetCPV) ?? 0,
        }));
        const isEmptyOrAllZero =
            // list.length === 0 || (list.every((d) => d.cpv === 0) && list.every((d) => d.targetCPV === 0));
            true;
        if (isEmptyOrAllZero) return DUMMY_CPV_TREND_DATA;
        return list;
    }, [apiHubCPVTrend]);

    const { currentCPV, targetCPV, cpvMomChange } = useMemo(() => {
        if (!cpvChartData.length) return { currentCPV: null, targetCPV: null, cpvMomChange: null };
        const current = cpvChartData[cpvChartData.length - 1];
        const prev = cpvChartData.length >= 2 ? cpvChartData[cpvChartData.length - 2] : null;
        const currVal = current?.cpv ?? 0;
        const prevVal = prev?.cpv ?? currVal;
        const momPct = prevVal !== 0 ? ((currVal - prevVal) / prevVal) * 100 : null;
        return {
            currentCPV: currVal,
            targetCPV: current?.targetCPV ?? currVal,
            cpvMomChange: momPct != null ? Math.round(momPct * 10) / 10 : null,
        };
    }, [cpvChartData]);


    const fetchApiHubDepartments = async () => {
        const res = await getAIHubDepartments();
        if (res?.status === "OK") {
            setApiHubDepartments(res?.res);
        }
    };

    const departmentsChartData = useMemo(() => {
        const content = apiHubDepartments?.content;
        if (!Array.isArray(content)) return [];
        const list = content.map((item) => ({
            name: item.departmentName ?? "",
            y: Number(item.activeUsers) ?? 0,
        })).filter((d) => d.name);
        // const isEmptyOrAllZero = list.length === 0 || list.every((d) => d.y === 0);
        const isEmptyOrAllZero = true;
        if (isEmptyOrAllZero) return DUMMY_DEPARTMENTS_DATA;
        return list;
    }, [apiHubDepartments]);

    const fetchApiHubDailyUsagePattern = async () => {
        const res = await getAIHubDailyUsagePattern();
        if (res?.status === "OK") {
            setApiHubDailyUsagePattern(res?.res);
        }
    };

    const dailyUsagePatternData = useMemo(() => {
        const raw = Array.isArray(apiHubDailyUsagePattern) ? apiHubDailyUsagePattern : apiHubDailyUsagePattern?.content;
        if (!Array.isArray(raw) || raw.length === 0) {
            return DUMMY_DAILY_USAGE_PATTERN_DATA.map((d) => ({ ...d, shortDay: getShortDay(d.dayOfWeek) }));
        }
        const list = raw.map((item) => ({
            ...item,
            dayOfWeek: item.dayOfWeek ?? "",
            dayOfWeekNumber: Number(item.dayOfWeekNumber) ?? 0,
            totalInteractions: Number(item.totalInteractions) ?? 0,
            activeUserCount: Number(item.activeUserCount) ?? 0,
            sar: Number(item.sar) ?? 0,
            handoffRate: Number(item.handoffRate) ?? 0,
            shortDay: getShortDay(item.dayOfWeek),
        }));
        list.sort((a, b) => (a.dayOfWeekNumber || 0) - (b.dayOfWeekNumber || 0));
        const isEmptyOrAllZero = true;
        // const isEmptyOrAllZero = list.every(
        //     (d) => d.totalInteractions === 0 && d.sar === 0 && d.handoffRate === 0
        // );
        if (isEmptyOrAllZero) return DUMMY_DAILY_USAGE_PATTERN_DATA.map((d) => ({ ...d, shortDay: getShortDay(d.dayOfWeek) }));
        return list;
    }, [apiHubDailyUsagePattern]);

    const rowStyle = {
        display: "flex",
        flexWrap: "wrap",
        gap: "1.5rem",
        width: "100%",
    };
    const twoCardItemStyle = {
        flex: "1 1 calc(50% - 0.75rem)",
        minWidth: "320px",
        maxWidth: "none",
    };
    const singleCardItemStyle = { width: "100%" };

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
            {/* Row 1: SAR + Tool Usage (max 2 cards) */}
            <div style={rowStyle}>
                {/* AI Quality Score (SAR) */}
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    Tool Usage Distribution
                                </p>
                                <p className="cf_new_dashboard_pannel_info" style={{ margin: "4px 0 0", fontSize: "12px" }}>
                                    Share of interactions by tool.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "0 0.5rem 1rem" }}>
                        {departmentsChartData.length > 0
                            ?
                            <PiCharts
                                title=""
                                graphData={TOOL_USAGE_DATA}
                                options={{
                                    customWidth: null,
                                    customHeight: null,
                                    dataLabels: "true",
                                    showInLegend: "false",
                                }}
                                viewType="DEPARTMENT"
                                customLink={false}
                            />
                            :
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "300px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading tool usage data...
                            </div>
                        }
                    </div>
                </div>
                {/* <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div
                                style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    backgroundColor: "rgba(0, 98, 255, 0.12)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <CheckCircle size={18} strokeWidth={2} color="#0062ff" />
                            </div>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    AI Quality Score (SAR)
                                </p>
                                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                    Suggestion Acceptance Rate - How often users accept AI suggestions
                                </p>
                            </div>
                        </div>
                    </div>

                    <div style={{ padding: "0 1.25rem 1rem" }}>
                        {sarChartData.length > 0 ? (
                            <>
                                <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "16px" }}>
                                    <span style={{ fontSize: "32px", fontWeight: 700, color: "#0f172a" }}>
                                        {currentSAR != null ? `${currentSAR}%` : "—"}
                                    </span>
                                    {momChange != null && momChange !== 0 && (
                                        <span
                                            style={{
                                                fontSize: "14px",
                                                fontWeight: 500,
                                                color: momChange >= 0 ? "#16a34a" : "#dc2626",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "2px",
                                            }}
                                        >
                                            {momChange >= 0 ? "↑" : "↓"} {Math.abs(momChange)}% MoM
                                        </span>
                                    )}
                                </div>

                                <p style={{ fontSize: "13px", fontWeight: 600, color: "#334155", margin: "0 0 8px 0" }}>
                                    Acceptance rate this month
                                </p>
                                <AcceptanceRateAreaChart
                                    graphData={sarChartData}
                                    dataKey="sar"
                                    customHeight={220}
                                    customWidth="100%"
                                />

                                <div
                                    style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: "16px 24px",
                                        marginTop: "16px",
                                        paddingTop: "12px",
                                        borderTop: "1px solid #f1f5f9",
                                        width: "100%",
                                        justifyContent: "space-around",
                                    }}
                                >
                                    {sarChartData.map((point, i) => (
                                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                            <span style={{ fontSize: "12px", color: "#64748b" }}>{point.name}</span>
                                            <span style={{ fontSize: "15px", fontWeight: 700, color: "#334155" }}>
                                                {Number(point.sar).toFixed(1)}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "300px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading SAR trend...
                            </div>
                        )}
                    </div>
                </div> */}
                {/* Adoption by Department - pie chart */}
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    Adoption by Department
                                </p>
                                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                    Active users by department
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "0 0.5rem 1rem" }}>
                        {departmentsChartData.length > 0 ? (
                            <PiCharts
                                title=""
                                graphData={departmentsChartData}
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
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "300px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading department data...
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Row 2: Adoption by Department + CPV (max 2 cards) */}
            {/* <div style={rowStyle}> */}

            {/* <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    Tool Usage Distribution
                                </p>
                                <p className="cf_new_dashboard_pannel_info" style={{ margin: "4px 0 0", fontSize: "12px" }}>
                                    Share of interactions by tool.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "0 0.5rem 1rem" }}>
                        <PiCharts
                            title=""
                            graphData={TOOL_USAGE_DATA}
                            options={{
                                customWidth: null,
                                customHeight: null,
                                dataLabels: "true",
                                showInLegend: "false",
                            }}
                            viewType="TOOL_USAGE"
                            customLink={false}
                        />
                    </div>
                </div> */}

            {/* Cost Per Value (CPV) Efficiency Trend */}
            {/* <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div
                                style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    backgroundColor: "rgba(22, 163, 74, 0.12)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <TrendingUp size={18} strokeWidth={2} color="#16a34a" />
                            </div>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    Cost Per Value (CPV) Efficiency Trend
                                </p>
                                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                    7-month trend with target benchmark
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "0 1.25rem 1rem" }}>
                        {cpvChartData.length > 0 ? (
                            <>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: "12px",
                                        flexWrap: "wrap",
                                        marginBottom: "16px",
                                    }}
                                >
                                    <div
                                        style={{
                                            flex: "1 1 100px",
                                            minWidth: "90px",
                                            padding: "10px 12px",
                                            borderRadius: "8px",
                                            backgroundColor: "#f1f5f9",
                                        }}
                                    >
                                        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>
                                            Current CPV
                                        </div>
                                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#16a34a" }}>
                                            ${currentCPV != null ? currentCPV.toFixed(2) : "—"}
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            flex: "1 1 100px",
                                            minWidth: "90px",
                                            padding: "10px 12px",
                                            borderRadius: "8px",
                                            backgroundColor: "#f1f5f9",
                                        }}
                                    >
                                        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>
                                            Target CPV
                                        </div>
                                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
                                            ${targetCPV != null ? targetCPV.toFixed(2) : "—"}
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            flex: "1 1 100px",
                                            minWidth: "90px",
                                            padding: "10px 12px",
                                            borderRadius: "8px",
                                            backgroundColor: "rgba(22, 163, 74, 0.08)",
                                        }}
                                    >
                                        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>
                                            MoM Change
                                        </div>
                                        <div
                                            style={{
                                                fontSize: "18px",
                                                fontWeight: 700,
                                                color: cpvMomChange != null && cpvMomChange < 0 ? "#16a34a" : "#0f172a",
                                            }}
                                        >
                                            {cpvMomChange != null
                                                ? `${cpvMomChange >= 0 ? "↑" : "↓"} ${Math.abs(cpvMomChange)}%`
                                                : "—"}
                                        </div>
                                    </div>
                                </div>
                                <CPVTrendLineChart
                                    graphData={cpvChartData}
                                    customHeight={220}
                                    customWidth="100%"
                                />
                            </>
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "280px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading CPV trend...
                            </div>
                        )}
                    </div>
                </div> */}
            {/* </div> */}

            {/* Row 3: Daily Usage Pattern (single card) */}
            <div style={rowStyle}>
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div
                                style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    backgroundColor: "rgba(124, 58, 237, 0.12)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <Activity size={18} strokeWidth={2} color="#7c3aed" />
                            </div>
                            <div>
                                <p style={{ fontWeight: 600, color: "#0f172a", margin: 0, fontSize: "15px" }}>
                                    Daily Usage Pattern with Quality Metrics
                                </p>
                                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                                    Daily interactions with acceptance rate and handoff indicators
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: "0 1.25rem 1rem" }}>
                        {departmentsChartData.length > 0 ? (
                            <DailyUsagePatternBarChart
                                graphData={dailyUsagePatternData}
                                customHeight={260}
                                customWidth="100%"
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "280px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading daily usage pattern...
                            </div>
                        )}
                    </div>
                </div>
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...twoCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div>
                            <p style={{ fontWeight: 700, color: "#001a6f", margin: 0, fontSize: "16px" }}>
                                Usage Trend
                            </p>
                        </div>
                    </div>
                    <div style={{ padding: "0 1.25rem 1rem" }}>
                        {usageTrendChartData.length > 0 ? (
                            <UsageTrendAreaChart
                                graphData={usageTrendChartData}
                                dataKey="activeUserCount"
                                customHeight={260}
                                customWidth="100%"
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "260px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading usage trend...
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Row 4: Usage Trend (single card, full width) */}
            {/* <div style={rowStyle}>
                <div
                    className="cf_border cf_border_radius cf_overflow_hidden cf_box_shadow"
                    style={{
                        backgroundColor: "#fff",
                        ...singleCardItemStyle,
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            padding: "1rem 1.25rem",
                            gap: "8px",
                        }}
                    >
                        <div>
                            <p style={{ fontWeight: 700, color: "#001a6f", margin: 0, fontSize: "16px" }}>
                                Usage Trend
                            </p>
                        </div>
                    </div>
                    <div style={{ padding: "0 1.25rem 1rem" }}>
                        {usageTrendChartData.length > 0 ? (
                            <UsageTrendAreaChart
                                graphData={usageTrendChartData}
                                dataKey="activeUserCount"
                                customHeight={260}
                                customWidth="100%"
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "260px",
                                    color: "#64748b",
                                    fontSize: "14px",
                                }}
                            >
                                Loading usage trend...
                            </div>
                        )}
                    </div>
                </div>
            </div> */}
        </div>
    );
};

export default AIBottomDashboard;
