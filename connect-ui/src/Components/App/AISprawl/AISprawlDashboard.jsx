import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    AlertTriangle,
    DollarSign,
    Layers,
    UserCheck,
    UserX,
} from "lucide-react";
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import { cloudImageMapper } from "../../helpers/helpers";

const AI_TOOLS = [
    {
        name: "M365 Copilot",
        iconKey: "MICROSOFT_OFFICE_365",
        color: "#6366f1",
        spend: 2959,
        costPerActiveUser: 64,
        overage: 0,
        seatUtilization: 79,
        utilizationColor: "#6366f1",
        productivity: 50,
        adoption: 31,
        adoptionColor: "#d97706",
    },
    {
        name: "Gemini",
        iconKey: "GOOGLE_WORKSPACE",
        color: "#f97316",
        spend: 1440,
        costPerActiveUser: 24,
        overage: 0,
        seatUtilization: 88,
        utilizationColor: "#f97316",
        productivity: 55,
        adoption: 46,
        adoptionColor: "#d97706",
    },
    {
        name: "Claude",
        iconKey: "CLAUDE",
        color: "#a855f7",
        spend: 351,
        costPerActiveUser: 44,
        overage: 0,
        seatUtilization: 100,
        utilizationColor: "#a855f7",
        productivity: 80,
        adoption: 75,
        adoptionColor: "#16a34a",
    },
    {
        name: "Cursor",
        iconKey: "CURSOR_AI",
        color: "#16a34a",
        spend: 985,
        costPerActiveUser: 19,
        overage: 0,
        seatUtilization: 90,
        utilizationColor: "#16a34a",
        productivity: 70,
        adoption: 65,
        adoptionColor: "#16a34a",
    },
    {
        name: "OpenAI",
        iconKey: "OPENAI",
        color: "#334155",
        spend: 768,
        costPerActiveUser: 31,
        overage: 142,
        seatUtilization: 86,
        utilizationColor: "#334155",
        productivity: 45,
        adoption: 48,
        adoptionColor: "#d97706",
    },
    {
        name: "GitHub Copilot",
        iconKey: "GITHUB",
        color: "#ef4444",
        spend: 339,
        costPerActiveUser: 339,
        effRate: true,
        seatUtilization: 1,
        utilizationColor: "#ef4444",
        productivity: 10,
        adoption: 1,
        adoptionColor: "#d97706",
        critical: true,
    },
];

const SPEND_TREND = [
    { day: "Apr 1", "M365 Copilot": 86, Gemini: 42, Cursor: 28, OpenAI: 22, Claude: 10, GitHub: 11 },
    { day: "Apr 3", "M365 Copilot": 90, Gemini: 44, Cursor: 30, OpenAI: 24, Claude: 10, GitHub: 11 },
    { day: "Apr 5", "M365 Copilot": 102, Gemini: 48, Cursor: 32, OpenAI: 26, Claude: 12, GitHub: 11 },
    { day: "Apr 7", "M365 Copilot": 100, Gemini: 46, Cursor: 31, OpenAI: 24, Claude: 11, GitHub: 11 },
    { day: "Apr 9", "M365 Copilot": 108, Gemini: 52, Cursor: 34, OpenAI: 27, Claude: 13, GitHub: 11 },
    { day: "Apr 11", "M365 Copilot": 120, Gemini: 56, Cursor: 36, OpenAI: 28, Claude: 14, GitHub: 11 },
    { day: "Apr 13", "M365 Copilot": 102, Gemini: 50, Cursor: 32, OpenAI: 25, Claude: 12, GitHub: 11 },
    { day: "Apr 14", "M365 Copilot": 98, Gemini: 48, Cursor: 31, OpenAI: 24, Claude: 12, GitHub: 11 },
];

const TREND_SERIES = [
    { key: "M365 Copilot", color: "#0062ff" },
    { key: "Gemini", color: "#3385ff" },
    { key: "Cursor", color: "#66a8ff" },
    { key: "OpenAI", color: "#4287ff" },
    { key: "Claude", color: "#99caff" },
    { key: "GitHub", color: "#0062ff", dashed: true },
];

const TOP_ACTIONS = [
    {
        tone: "critical",
        icon: <AlertTriangle size={16} color="#ef4444" />,
        title: "GitHub Copilot — 108 idle seats",
        body: "109 provisioned, 1 active. Cursor already deployed to same team with 68% acceptance rate.",
        saving: "→ $336/mo recoverable",
    },
    {
        tone: "warn",
        icon: <AlertTriangle size={16} color="#d97706" />,
        title: "Copilot + Gemini — 22 users on both",
        body: "Overlapping productivity AI. $4,399/mo combined. Consolidate to one platform.",
        saving: "→ $720–$1,200/mo recoverable",
    },
    {
        tone: "warn",
        icon: <AlertTriangle size={16} color="#d97706" />,
        title: "138 idle seats across all tools",
        body: "Copilot (12) · Gemini (8) · Cursor (6) · OpenAI (4) · GitHub (108). Reclaim and reassign.",
        saving: "→ $447/mo recoverable",
    },
];

const formatMoney = (v) =>
    "$" + Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

const StatCard = ({ label, value, sub, accent, icon, pill }) => (
    <div
        className="cf_new_dashboard_info_pannel"
        style={{ flex: 1, minWidth: 220 }}
    >
        <div className="cf_new_dashboard_info_pannel_title" style={{ gap: 8 }}>
            <p
                style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: "#64748b",
                }}
            >
                {label}
            </p>
            <span style={{ marginLeft: "auto" }}></span>
            {icon}
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
            <p
                className="cf_new_dashboard_Data"
                style={accent ? { color: accent } : undefined}
            >
                {value}
            </p>
            {sub && (
                <p
                    style={{
                        fontSize: 12,
                        color: "#64748b",
                        marginTop: 4,
                    }}
                >
                    {sub}
                </p>
            )}
            {pill && (
                <span
                    style={{
                        display: "inline-block",
                        marginTop: 8,
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: pill.bg,
                        color: pill.color,
                    }}
                >
                    {pill.text}
                </span>
            )}
        </div>
    </div>
);

const TOOL_ROUTES = {
    "M365 Copilot": "/AgentHub/M365Copilot",
    Claude: "/AgentHub/Claude",
    Gemini: "/AgentHub/Gemini",
    OpenAI: "/AgentHub/OpenAI",
    Cursor: "/AgentHub/Cursor",
    "GitHub Copilot": "/AgentHub/GitHubCopilot",
};

const AISprawlDashboard = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [tools, setTools] = useState([]);

    const handleToolClick = (tool) => {
        const route = TOOL_ROUTES[tool.name];
        if (route) navigate(route);
    };

    useEffect(() => {
        const t = setTimeout(() => {
            setTools(AI_TOOLS);
            setIsLoading(false);
        }, 900);
        return () => clearTimeout(t);
    }, []);

    const totals = useMemo(() => {
        const totalSpend = AI_TOOLS.reduce((a, b) => a + b.spend, 0);
        return {
            totalSpend,
            toolCount: AI_TOOLS.length,
            activeUsers: 220,
            provisionedSeats: 372,
            idleSeats: 152,
            wastedSpend: 1510,
            multiToolUsers: 34,
            multiToolHeavy: 11,
        };
    }, []);

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Agent Hub" subMenuActive="AI Usage" />
            <div className="cf_main_content_place">
                <TopNav pageName="AI Usage" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{
                        padding: "10px 0",
                        flexDirection: "column",
                        gap: "15px",
                        overflowY: "auto",
                    }}
                >
                    {/* Top stat cards */}
                    <div
                        className="cf_new_dashboard_resourceApps_container"
                        style={{ gap: 15, flexShrink: 0 }}
                    >
                        <StatCard
                            label="Total AI Spend"
                            value={formatMoney(totals.totalSpend)}
                            sub={`${totals.toolCount} tools · last 30 days`}
                            icon={<DollarSign size={16} color="#64748b" />}
                            pill={{
                                text: "↑ 12% vs last month",
                                bg: "#fee2e2",
                                color: "#b91c1c",
                            }}
                        />
                        <StatCard
                            label="Active Users"
                            value={totals.activeUsers}
                            sub={`of ${totals.provisionedSeats} provisioned seats`}
                            icon={<UserCheck size={16} color="#64748b" />}
                            pill={{
                                text: `${Math.round(
                                    (totals.activeUsers /
                                        totals.provisionedSeats) *
                                    100,
                                )}% utilization`,
                                bg: "#e0e7ff",
                                color: "#4338ca",
                            }}
                        />
                        <StatCard
                            label="Idle Seats"
                            value={totals.idleSeats}
                            accent="#ef4444"
                            sub="no activity in 30 days"
                            icon={<UserX size={16} color="#64748b" />}
                            pill={{
                                text: `${formatMoney(
                                    totals.wastedSpend,
                                )} wasted/mo`,
                                bg: "#fee2e2",
                                color: "#b91c1c",
                            }}
                        />
                        <StatCard
                            label="Multi-tool Users"
                            value={totals.multiToolUsers}
                            accent="#16a34a"
                            sub="using 2+ AI tools"
                            icon={<Layers size={16} color="#64748b" />}
                            pill={{
                                text: `${totals.multiToolHeavy} using 3+ tools`,
                                bg: "#dcfce7",
                                color: "#166534",
                            }}
                        />
                    </div>

                    {/* All AI tools table */}
                    <div
                        className="cf_new_dashboard_info_pannel"
                        style={{ width: "100%", flexShrink: 0 }}
                    >
                        <div
                            style={{
                                padding: "16px 20px",
                                borderBottom: "1px solid #e2e8f0",
                            }}
                        >
                            <p
                                style={{
                                    fontSize: 15,
                                    fontWeight: 600,
                                    color: "#0f1729",
                                }}
                            >
                                All AI tools
                            </p>
                            <p
                                style={{
                                    fontSize: 12,
                                    color: "#64748b",
                                    marginTop: 2,
                                }}
                            >
                                Click any tool to see full analytics
                            </p>
                        </div>
                        {isLoading ? (
                            <div style={{ padding: 40 }}>
                                {getCFTextLoader("Loading AI tool usage…")}
                            </div>
                        ) : (
                            <div style={{ overflowX: "auto" }}>
                                <table
                                    style={{
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        fontSize: 13,
                                    }}
                                >
                                    <thead>
                                        <tr style={{ background: "#f8fafc" }}>
                                            <th style={thStyle}>Tool</th>
                                            <th style={{ ...thStyle, textAlign: "right" }}>Spend</th>
                                            <th style={{ ...thStyle, textAlign: "right" }}>Cost / Active User</th>
                                            <th style={thStyle}>Seat Utilization</th>
                                            <th style={thStyle}>Productivity</th>
                                            <th style={{ ...thStyle, textAlign: "right" }}>Adoption</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tools.map((t, idx) => (
                                            <tr
                                                key={t.name}
                                                onClick={() => handleToolClick(t)}
                                                style={{
                                                    background: t.critical
                                                        ? "#fef2f2"
                                                        : idx % 2 === 0
                                                            ? "#fff"
                                                            : "#fff",
                                                    borderTop: "1px solid #f1f5f9",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <td style={tdStyle}>
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 10,
                                                        }}
                                                    >
                                                        <ToolIcon tool={t} />
                                                        <span style={{ fontWeight: 500, color: "#0f1729" }}>
                                                            {t.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdStyle,
                                                        textAlign: "right",
                                                        color: t.critical ? "#b91c1c" : "#0f1729",
                                                        fontWeight: 500,
                                                    }}
                                                >
                                                    ${t.spend.toLocaleString()}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdStyle,
                                                        textAlign: "right",
                                                        color: t.critical ? "#b91c1c" : "#0284c7",
                                                    }}
                                                >
                                                    ${t.costPerActiveUser}
                                                    {t.overage ? (
                                                        <span style={{ color: "#b91c1c", marginLeft: 6, fontSize: 12 }}>
                                                            +${t.overage} overage
                                                        </span>
                                                    ) : null}
                                                    {t.effRate ? (
                                                        <span style={{ color: "#64748b", marginLeft: 6, fontSize: 11 }}>
                                                            eff. rate
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td style={tdStyle}>
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 10,
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                flex: 1,
                                                                height: 6,
                                                                borderRadius: 999,
                                                                background: "#e2e8f0",
                                                                overflow: "hidden",
                                                                maxWidth: 140,
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: `${t.seatUtilization}%`,
                                                                    height: "100%",
                                                                    background: t.utilizationColor,
                                                                    borderRadius: 999,
                                                                }}
                                                            />
                                                        </div>
                                                        <span
                                                            style={{
                                                                color: "#0f1729",
                                                                minWidth: 36,
                                                                fontVariantNumeric: "tabular-nums",
                                                            }}
                                                        >
                                                            {t.seatUtilization}%
                                                        </span>
                                                    </div>
                                                </td>
                                                <td style={tdStyle}>
                                                    <ProductivityDial value={t.productivity} />
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdStyle,
                                                        textAlign: "right",
                                                        color: t.adoptionColor,
                                                        fontWeight: 500,
                                                    }}
                                                >
                                                    {t.adoption}% engaged
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Spend trend + Top actions */}
                    <div
                        className="CF_d-flex"
                        style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                    >
                        <div
                            className="cf_new_dashboard_info_pannel"
                            style={{ flex: 2, padding: "16px 20px" }}
                        >
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                Spend by tool
                            </p>
                            <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                                Last 30 days · USD per day
                            </p>
                            <div style={{ width: "100%", height: 260, marginTop: 12 }}>
                                <ResponsiveContainer>
                                    <LineChart data={SPEND_TREND} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                                        <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                                        <Tooltip formatter={(v) => `$${v}`} contentStyle={{ fontSize: 12 }} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                                        {TREND_SERIES.map((s) => (
                                            <Line
                                                key={s.key}
                                                type="monotone"
                                                dataKey={s.key}
                                                stroke={s.color}
                                                strokeWidth={2}
                                                strokeDasharray={s.dashed ? "4 4" : undefined}
                                                dot={{ r: 2 }}
                                                activeDot={{ r: 4 }}
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div
                            className="cf_new_dashboard_info_pannel"
                            style={{ flex: 1, padding: "16px 20px" }}
                        >
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                Top actions
                            </p>
                            <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                                Ranked by recoverable spend
                            </p>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                    marginTop: 12,
                                }}
                            >
                                {TOP_ACTIONS.map((a, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            borderRadius: 10,
                                            border: `1px solid ${a.tone === "critical" ? "#fecaca" : "#fde68a"
                                                }`,
                                            background:
                                                a.tone === "critical" ? "#fef2f2" : "#fffbeb",
                                            padding: "10px 12px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 8,
                                                alignItems: "center",
                                            }}
                                        >
                                            {a.icon}
                                            <p style={{ fontSize: 13, fontWeight: 600, color: "#0f1729" }}>
                                                {a.title}
                                            </p>
                                        </div>
                                        <p style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                                            {a.body}
                                        </p>
                                        <p style={{ fontSize: 12, color: "#16a34a", fontWeight: 500, marginTop: 4 }}>
                                            {a.saving}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ToolIcon = ({ tool }) => {
    const src = cloudImageMapper(tool.iconKey);
    if (src) {
        return (
            <img
                src={src}
                alt={tool.name}
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    objectFit: "contain",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    padding: 2,
                }}
            />
        );
    }
    return (
        <span
            style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: `${tool.color}1a`,
                border: `1px solid ${tool.color}55`,
                color: tool.color,
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            {tool.name.charAt(0)}
        </span>
    );
};

const ProductivityDial = ({ value }) => {
    const pct = Math.max(0, Math.min(100, value));
    const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#ef4444";
    const gradient = `conic-gradient(${color} ${pct * 3.6}deg, #e2e8f0 0)`;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: gradient,
                    position: "relative",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 4,
                        borderRadius: "50%",
                        background: "#fff",
                    }}
                />
            </div>
            <span style={{ color: "#0f1729", fontVariantNumeric: "tabular-nums" }}>
                {value}
            </span>
        </div>
    );
};

const thStyle = {
    textAlign: "left",
    padding: "10px 16px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    color: "#64748b",
    textTransform: "uppercase",
    borderBottom: "1px solid #e2e8f0",
    whiteSpace: "nowrap",
};

const tdStyle = {
    padding: "14px 16px",
    verticalAlign: "middle",
    color: "#0f1729",
};

export default AISprawlDashboard;
