import { useContext, useEffect, useMemo, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Puzzle } from "lucide-react";
import { getAIUsageInfo, getAIUsageInsight, getClaudCodeUsage } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { formatDateForGraph } from "../../../helpers/utils";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const cardStyle = {
    height: "fit-content",
    paddingBottom: "10px",
    gap: "20px",
    display: "flex",
    flexDirection: "column",
};

const formatCompactNumber = (value) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return value;
    if (Math.abs(num) < 1000) return `${num}`;
    return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(num);
};

const tooltipValueFormatter = (value) => formatCompactNumber(value);
const costTickFormatter = (value) => `$${formatCompactNumber(value)}`;
const costTooltipFormatter = (value) => [`$${formatCompactNumber(value)}`, "Cost (USD)"];

const NoDataCard = ({ message = "No data available" }) => (
    <div className="cf_new_dashboard_info_graph_container" style={{ height: "320px", padding: "10px 1.5rem" }}>
        <div
            className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
            style={{
                alignItems: "center",
                height: "300px",
                border: "1px dotted #ddd",
                justifyContent: "center",
                borderRadius: "0.75rem",
            }}
        >
            <div>
                <Puzzle size={50} color="#64748b" />
            </div>
            <p style={{ fontSize: "14px" }}>{message}</p>
        </div>
    </div>
);

const GraphCard = ({ title, subtitle, hasData, children }) => (
    <div className="cf_border cf_border_radius cf_overflow_hidden" style={cardStyle}>
        <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>{title}</p>
            <p className="cf_new_dashboard_pannel_info">{subtitle}</p>
        </div>
        {hasData ? children : <NoDataCard />}
    </div>
);

const ClaudeOverview = ({ setClaudeMetrics }) => {
    const { globalContext } = useContext(GlobalContext);
    const { id } = {
        ...globalContext?.saasCloud,
    };
    const [isPageLoading, setIsPageLoading] = useState(true);
    const [claudCodeUsage, setClaudCodeUsage] = useState([]);
    const [aiAssestedTab, setAIAssestedTab] = useState([]);
    const [aiUsage, setAIUsage] = useState([]);

    useEffect(() => {
        if (!id) return;
        const fetchAll = async () => {
            setIsPageLoading(true);
            try {
                const [codeRes, tabRes, usageRes] = await Promise.all([
                    getClaudCodeUsage(id),
                    getAIUsageInsight(id),
                    getAIUsageInfo(id, "30D"),
                ]);
                const usageRows = codeRes?.status === "OK" && Array.isArray(codeRes?.res) ? codeRes.res : [];
                const aiUsageRows = usageRes?.status === "OK" && Array.isArray(usageRes?.res) ? usageRes.res : [];
                if (codeRes?.status === "OK") {
                    setClaudCodeUsage(usageRows);
                }
                if (tabRes?.status === "OK") {
                    setAIAssestedTab(Array.isArray(tabRes?.res) ? tabRes.res : []);
                }
                if (usageRes?.status === "OK") {
                    setAIUsage(aiUsageRows);
                }
                setClaudeMetrics({
                    totalTokens: usageRows.reduce((acc, row) => {
                        const models = Array.isArray(row?.model_breakdown) ? row.model_breakdown : [];
                        return (
                            acc +
                            models.reduce(
                                (mAcc, m) =>
                                    mAcc + Number(m?.tokens?.input || 0) + Number(m?.tokens?.output || 0),
                                0
                            )
                        );
                    }, 0),
                    cachedTokens: usageRows.reduce((acc, row) => {
                        const models = Array.isArray(row?.model_breakdown) ? row.model_breakdown : [];
                        return (
                            acc +
                            models.reduce(
                                (mAcc, m) =>
                                    mAcc +
                                    Number(m?.tokens?.cache_read || 0) +
                                    Number(m?.tokens?.cache_creation || 0),
                                0
                            )
                        );
                    }, 0),
                    totalCost: (() => {
                        if (!aiUsageRows.length) return 0;
                        const latest = [...aiUsageRows].sort(
                            (a, b) => Number(b?.usageOn ?? b?.usegeOn ?? 0) - Number(a?.usageOn ?? a?.usegeOn ?? 0)
                        )[0];
                        return Number(latest?.costAmount || 0);
                    })(),
                });
            } finally {
                setIsPageLoading(false);
            }
        };
        fetchAll();
    }, [id, setClaudeMetrics]);

    const costOverTime = useMemo(
        () =>
            aiUsage.map((d) => ({
                name: formatDateForGraph(d?.usageOn ?? d?.usegeOn),
                "Cost (USD)": Number(d?.costAmount || 0),
            })),
        [aiUsage]
    );

    const tabsAndRequestsOverTime = useMemo(
        () =>
            aiAssestedTab.map((d) => ({
                name: formatDateForGraph(d?.usageOn ?? d?.usegeOn),
                "Tabs Shown": Number(d?.totalTabsShown || 0),
                "Tabs Accepted": Number(d?.totalTabsAccepted || 0),
                "Agent Requests": Number(d?.agentRequests || 0),
            })),
        [aiAssestedTab]
    );

    const tokenTypeOverTime = useMemo(
        () =>
            aiAssestedTab.map((d) => ({
                name: formatDateForGraph(d?.usageOn ?? d?.usegeOn),
                "Uncached Input": Number(d?.uncachedInputTokens ?? d?.uncached_input_tokens ?? 0),
                "Cache Read Input": Number(d?.cacheReadInputTokens ?? d?.cache_read_input_tokens ?? 0),
                "Output Tokens": Number(d?.outputTokens ?? d?.output_tokens ?? 0),
                "Cache Creation": Number(d?.cacheCreationTokens ?? 0),
            })),
        [aiAssestedTab]
    );

    const modelUsageByTokens = useMemo(() => {
        const modelMap = {};
        claudCodeUsage.forEach((entry) => {
            const breakdown = Array.isArray(entry?.model_breakdown) ? entry.model_breakdown : [];
            breakdown.forEach((m) => {
                const model = m?.model || "unknown";
                if (!modelMap[model]) {
                    modelMap[model] = {
                        model,
                        "Input Tokens": 0,
                        "Output Tokens": 0,
                        "Cache Read": 0,
                        "Cache Creation": 0,
                    };
                }
                modelMap[model]["Input Tokens"] += Number(m?.tokens?.input || 0);
                modelMap[model]["Output Tokens"] += Number(m?.tokens?.output || 0);
                modelMap[model]["Cache Read"] += Number(m?.tokens?.cache_read || 0);
                modelMap[model]["Cache Creation"] += Number(m?.tokens?.cache_creation || 0);
            });
        });
        return Object.values(modelMap);
    }, [claudCodeUsage]);

    const toolActionsByType = useMemo(() => {
        const totals = {
            edit_tool: { accepted: 0, rejected: 0 },
            write_tool: { accepted: 0, rejected: 0 },
            multi_edit_tool: { accepted: 0, rejected: 0 },
            notebook_edit_tool: { accepted: 0, rejected: 0 },
        };
        claudCodeUsage.forEach((entry) => {
            const actions = entry?.tool_actions || {};
            Object.keys(totals).forEach((tool) => {
                totals[tool].accepted += Number(actions?.[tool]?.accepted || 0);
                totals[tool].rejected += Number(actions?.[tool]?.rejected || 0);
            });
        });
        return [
            { name: "Edit", Accepted: totals.edit_tool.accepted, Rejected: totals.edit_tool.rejected },
            { name: "Write", Accepted: totals.write_tool.accepted, Rejected: totals.write_tool.rejected },
            { name: "MultiEdit", Accepted: totals.multi_edit_tool.accepted, Rejected: totals.multi_edit_tool.rejected },
            { name: "NotebookEdit", Accepted: totals.notebook_edit_tool.accepted, Rejected: totals.notebook_edit_tool.rejected },
        ];
    }, [claudCodeUsage]);

    const sessionAndCodeByEntry = useMemo(
        () =>
            claudCodeUsage.map((entry, idx) => ({
                name: `Entry ${idx + 1}`,
                Sessions: Number(entry?.core_metrics?.num_sessions || 0),
                "Lines Added": Number(entry?.core_metrics?.lines_of_code?.added || 0),
                "Lines Removed": Number(entry?.core_metrics?.lines_of_code?.removed || 0),
            })),
        [claudCodeUsage]
    );

    return (
        <>
            <div className="cf_dBottom_Info_2Pannel" style={{ gap: "2rem 2rem" }}>
                <GraphCard
                    title="AI Usage Cost Over Time"
                    subtitle=""
                    hasData={costOverTime.length > 0}
                >
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={costOverTime} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={costTickFormatter} />
                            <Tooltip formatter={costTooltipFormatter} />
                            <Legend />
                            <Line type="monotone" dataKey="Cost (USD)" stroke="#1d4ed8" strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </GraphCard>
                <GraphCard
                    title="Model Token Usage"
                    subtitle=""
                    hasData={modelUsageByTokens.length > 0}
                >
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={modelUsageByTokens} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="model" />
                            <YAxis tickFormatter={formatCompactNumber} />
                            <Tooltip formatter={tooltipValueFormatter} />
                            <Legend />
                            <Bar dataKey="Input Tokens" fill="#2563eb" />
                            <Bar dataKey="Output Tokens" fill="#16a34a" />
                            <Bar dataKey="Cache Read" fill="#7c3aed" />
                            <Bar dataKey="Cache Creation" fill="#f97316" />
                        </BarChart>
                    </ResponsiveContainer>
                </GraphCard>
                <GraphCard
                    title="Tool Actions by Type"
                    subtitle="Accepted vs Rejected"
                    hasData={toolActionsByType.some((d) => d.Accepted > 0 || d.Rejected > 0)}
                >
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={toolActionsByType} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={formatCompactNumber} />
                            <Tooltip formatter={tooltipValueFormatter} />
                            <Legend />
                            <Bar dataKey="Accepted" fill="#16a34a" />
                            <Bar dataKey="Rejected" fill="#ef4444" />
                        </BarChart>
                    </ResponsiveContainer>
                </GraphCard>
                <GraphCard
                    title="Token Types Over Time"
                    subtitle="Token Over View"
                    hasData={tokenTypeOverTime.length > 0}
                >
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={tokenTypeOverTime} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={formatCompactNumber} />
                            <Tooltip formatter={tooltipValueFormatter} />
                            <Legend />
                            <Line type="monotone" dataKey="Cache Read Input" stroke="#7c3aed" strokeWidth={2} />
                            <Line type="monotone" dataKey="Cache Creation" stroke="#0ea5e9" strokeWidth={2} />
                            <Line type="monotone" dataKey="Output Tokens" stroke="#f97316" strokeWidth={2} />
                            <Line type="monotone" dataKey="Uncached Input" stroke="#ef4444" strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </GraphCard>

                <GraphCard
                    title="Sessions and LOC by Entry"
                    subtitle=""
                    hasData={sessionAndCodeByEntry.length > 0}
                >
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={sessionAndCodeByEntry} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={formatCompactNumber} />
                            <Tooltip formatter={tooltipValueFormatter} />
                            <Legend />
                            <Bar dataKey="Sessions" fill="#2563eb" />
                            <Bar dataKey="Lines Added" fill="#16a34a" />
                            <Bar dataKey="Lines Removed" fill="#ef4444" />
                        </BarChart>
                    </ResponsiveContainer>
                </GraphCard>
            </div>
            {isPageLoading && getCFLoader()}
        </>
    );
};

export default ClaudeOverview;