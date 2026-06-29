import { useMemo, useState } from "react";
import { Activity, Pause } from "lucide-react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { cloudImageMapper } from "../../helpers/helpers";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import PiCharts from "../../Resuables/Charts/PiCharts";
import DailyUsagePatternBarChart from "../../Resuables/Charts/DailyUsagePatternBarChart";
import UsageTrendAreaChart from "../../Resuables/Charts/UsageTrendAreaChart";
import {
    DUMMY_DAILY_USAGE_PATTERN_DATA,
    DUMMY_DEPARTMENTS_DATA,
    DUMMY_USAGE_TREND_DATA,
    TOOL_USAGE_DATA,
} from "../AIHub/aiHubDemoData";

const getShortDay = (dayOfWeek) => {
    if (!dayOfWeek) return "";
    const d = String(dayOfWeek).slice(0, 3);
    return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
};

const DAILY_USAGE_PATTERN_DATA = DUMMY_DAILY_USAGE_PATTERN_DATA.map((d) => ({
    ...d,
    shortDay: getShortDay(d.dayOfWeek),
}));

const PROVISIONED_SEATS = 58;
const ACTIVE_SEATS = 46;
const INACTIVE_SEATS = PROVISIONED_SEATS - ACTIVE_SEATS;
const MONTHLY_SUBSCRIPTION = 2959;
const COST_PER_ACTIVE_USER = Math.round(MONTHLY_SUBSCRIPTION / ACTIVE_SEATS);
const ADOPTION_RATE = Math.round((ACTIVE_SEATS / PROVISIONED_SEATS) * 100);
const DEEPLY_ENGAGED_COUNT = 18;
const DEEPLY_ENGAGED_RATE = Math.round(
    (DEEPLY_ENGAGED_COUNT / PROVISIONED_SEATS) * 100,
);
const PRODUCTIVITY_SCORE = 50;

const DAILY_QUERIES = [
    { day: "Apr 1", queries: 840 },
    { day: "Apr 2", queries: 905 },
    { day: "Apr 3", queries: 930 },
    { day: "Apr 4", queries: 1040 },
    { day: "Apr 5", queries: 1105 },
    { day: "Apr 6", queries: 970 },
    { day: "Apr 7", queries: 905 },
    { day: "Apr 8", queries: 1120 },
    { day: "Apr 9", queries: 1310 },
    { day: "Apr 10", queries: 1450 },
    { day: "Apr 11", queries: 1560 },
    { day: "Apr 12", queries: 1485 },
    { day: "Apr 13", queries: 1390 },
    { day: "Apr 14", queries: 1020 },
];

const MODEL_USAGE = [
    { model: "gpt-4o", queries: 12480, color: "#0062ff" },
    { model: "gpt-4", queries: 7860, color: "#66a8ff" },
    { model: "gpt-3.5", queries: 2120, color: "#cce1ff" },
];

const USERS = [
    {
        id: "u-001",
        initials: "CA",
        name: "Carlos Reyes",
        email: "c.reyes@vantage.co",
        role: "Admin",
        status: "Active",
        activity: "8.2K queries",
        primaryModel: "gpt-4o",
        color: "#ede9fe",
        textColor: "#6d28d9",
        daily: [
            { date: "Apr 14", queries: 120, model: "gpt-4o" },
            { date: "Apr 13", queries: 340, model: "gpt-4o" },
            { date: "Apr 12", queries: 290, model: "gpt-4" },
            { date: "Apr 11", queries: 180, model: "gpt-4" },
        ],
    },
    {
        id: "u-002",
        initials: "TA",
        name: "Tanya Jackson",
        email: "t.jackson@vantage.co",
        role: "User",
        status: "Active",
        activity: "6.1K queries",
        primaryModel: "gpt-4o",
        color: "#dcfce7",
        textColor: "#166534",
        daily: [
            { date: "Apr 14", queries: 95, model: "gpt-4o" },
            { date: "Apr 13", queries: 210, model: "gpt-4o" },
            { date: "Apr 12", queries: 180, model: "gpt-4" },
            { date: "Apr 11", queries: 160, model: "gpt-4o" },
        ],
    },
    {
        id: "u-003",
        initials: "SE",
        name: "Selin Çelik",
        email: "s.celik@vantage.co",
        role: "User",
        status: "Active",
        activity: "3.8K queries",
        primaryModel: "gpt-4",
        color: "#e0e7ff",
        textColor: "#4338ca",
        daily: [
            { date: "Apr 14", queries: 40, model: "gpt-4" },
            { date: "Apr 13", queries: 95, model: "gpt-4" },
            { date: "Apr 12", queries: 120, model: "gpt-4o" },
            { date: "Apr 11", queries: 70, model: "gpt-4" },
        ],
    },
    {
        id: "u-004",
        initials: "PR",
        name: "Priya Nair",
        email: "p.nair@vantage.co",
        role: "User",
        status: "Inactive",
        activity: "0 queries (30d)",
        primaryModel: "—",
        color: "#f1f5f9",
        textColor: "#475569",
        daily: [],
    },
    {
        id: "u-005",
        initials: "MB",
        name: "Marcus Bell",
        email: "m.bell@vantage.co",
        role: "User",
        status: "Active",
        activity: "2.4K queries",
        primaryModel: "gpt-4o",
        color: "#fee2e2",
        textColor: "#b91c1c",
        daily: [
            { date: "Apr 14", queries: 60, model: "gpt-4o" },
            { date: "Apr 13", queries: 85, model: "gpt-4o" },
            { date: "Apr 12", queries: 70, model: "gpt-3.5" },
            { date: "Apr 11", queries: 55, model: "gpt-4o" },
        ],
    },
];

const M365CopilotInsights = () => {
    const [selectedUserId, setSelectedUserId] = useState(USERS[0].id);
    const selectedUser = useMemo(
        () => USERS.find((u) => u.id === selectedUserId) ?? USERS[0],
        [selectedUserId],
    );

    const iconSrc = cloudImageMapper("MICROSOFT_OFFICE_365");

    return (
        <div className="cf_main_container">
            <SideNav activeTab="AI Hub" subMenuActive="AI Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="M365 Copilot Insights" backLink="/AgentHub" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{
                        padding: "10px 0",
                        flexDirection: "column",
                        gap: "15px",
                        overflowY: "auto",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 15,
                            flexShrink: 0,
                        }}
                    >
                        {/* Header */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                            }}
                        >
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: "#ede9fe",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                {iconSrc ? (
                                    <img
                                        src={iconSrc}
                                        alt="M365 Copilot"
                                        style={{ width: 22, height: 22, objectFit: "contain" }}
                                    />
                                ) : (
                                    <Pause size={18} color="#6d28d9" />
                                )}
                            </div>
                            <div>
                                <p style={{ fontSize: 18, fontWeight: 600, color: "#0f1729" }}>
                                    M365 Copilot
                                </p>
                                <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                                    Usage analytics · last 30 days
                                </p>
                            </div>
                            <div style={{ marginLeft: "auto" }}>
                                <select
                                    style={{
                                        border: "1px solid #e2e8f0",
                                        background: "#fff",
                                        borderRadius: 8,
                                        padding: "6px 10px",
                                        fontSize: 13,
                                        color: "#0f1729",
                                        cursor: "pointer",
                                    }}
                                    defaultValue="30"
                                >
                                    <option value="7">Last 7 days</option>
                                    <option value="30">Last 30 days</option>
                                    <option value="90">Last 90 days</option>
                                </select>
                            </div>
                        </div>

                        {/* Stat cards row */}
                        <div
                            className="cf_new_dashboard_resourceApps_container"
                            style={{ gap: 15, gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
                        >
                            <MiniStat
                                label="Users"
                                value={PROVISIONED_SEATS}
                                sub="provisioned"
                            />
                            <MiniStat
                                label="Active"
                                value={ACTIVE_SEATS}
                                sub="last 30 days"
                            />
                            <MiniStat
                                label="Inactive"
                                value={INACTIVE_SEATS}
                                sub="no activity"
                                accent="#ef4444"
                            />
                            <MiniStat
                                label="Subscription"
                                value={`$${MONTHLY_SUBSCRIPTION.toLocaleString()}`}
                                sub="monthly"
                            />
                            <MiniStat
                                label="Cost / Active User"
                                value={`$${COST_PER_ACTIVE_USER}`}
                                sub="per month"
                            />
                        </div>
                        {/* Tool Usage Distribution + Adoption by Department */}
                        <div
                            className="CF_d-flex"
                            style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                        >
                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: 0, overflow: "hidden" }}
                            >
                                <div style={{ padding: "16px 20px" }}>
                                    <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                        Tool Usage Distribution
                                    </p>
                                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                        Share of interactions by tool.
                                    </p>
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
                                        viewType="DEPARTMENT"
                                        customLink={false}
                                    />
                                </div>
                            </div>

                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: 0, overflow: "hidden" }}
                            >
                                <div style={{ padding: "16px 20px" }}>
                                    <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                        Adoption by Department
                                    </p>
                                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                        Active users by department
                                    </p>
                                </div>
                                <div style={{ padding: "0 0.5rem 1rem" }}>
                                    <PiCharts
                                        title=""
                                        graphData={DUMMY_DEPARTMENTS_DATA}
                                        options={{
                                            customWidth: null,
                                            customHeight: null,
                                            dataLabels: "true",
                                            showInLegend: "false",
                                        }}
                                        viewType="DEPARTMENT"
                                        customLink={false}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Daily Usage Pattern + Usage Trend */}
                        <div
                            className="CF_d-flex"
                            style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                        >
                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: 0, overflow: "hidden" }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 10,
                                        padding: "16px 20px",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: 8,
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
                                        <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                            Daily Usage Pattern with Quality Metrics
                                        </p>
                                        <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                            Daily interactions with acceptance rate and handoff indicators
                                        </p>
                                    </div>
                                </div>
                                <div style={{ padding: "0 1.25rem 1rem" }}>
                                    <DailyUsagePatternBarChart
                                        graphData={DAILY_USAGE_PATTERN_DATA}
                                        customHeight={260}
                                        customWidth="100%"
                                    />
                                </div>
                            </div>

                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: 0, overflow: "hidden" }}
                            >
                                <div style={{ padding: "16px 20px" }}>
                                    <p style={{ fontSize: 16, fontWeight: 700, color: "#001a6f" }}>
                                        Usage Trend
                                    </p>
                                </div>
                                <div style={{ padding: "0 1.25rem 1rem" }}>
                                    <UsageTrendAreaChart
                                        graphData={DUMMY_USAGE_TREND_DATA}
                                        dataKey="activeUserCount"
                                        customHeight={260}
                                        customWidth="100%"
                                    />
                                </div>
                            </div>
                        </div>
                        {/* Daily queries + Queries by model */}
                        <div
                            className="CF_d-flex"
                            style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                        >
                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 2, padding: "16px 20px" }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    Daily queries
                                </p>
                                <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                                    <ResponsiveContainer>
                                        <LineChart
                                            data={DAILY_QUERIES}
                                            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                            <XAxis
                                                dataKey="day"
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={{ stroke: "#e2e8f0" }}
                                                interval={1}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <Tooltip
                                                formatter={(v) => v.toLocaleString()}
                                                contentStyle={{ fontSize: 12 }}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="queries"
                                                stroke="#0062ff"
                                                strokeWidth={2}
                                                dot={{ r: 3 }}
                                                activeDot={{ r: 5 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: "16px 20px" }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    Queries by model
                                </p>
                                <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                                    <ResponsiveContainer>
                                        <BarChart
                                            data={MODEL_USAGE}
                                            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                            <XAxis
                                                dataKey="model"
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={{ stroke: "#e2e8f0" }}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={(v) => v.toLocaleString()}
                                            />
                                            <Tooltip
                                                formatter={(v) => v.toLocaleString()}
                                                contentStyle={{ fontSize: 12 }}
                                            />
                                            <Bar dataKey="queries" radius={[6, 6, 0, 0]}>
                                                {MODEL_USAGE.map((m) => (
                                                    <Cell key={m.model} fill={m.color} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Productivity index + Adoption health */}
                        <div
                            className="CF_d-flex"
                            style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                        >
                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: "16px 20px" }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    Productivity index
                                </p>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 20,
                                        marginTop: 16,
                                    }}
                                >
                                    <BigDial value={PRODUCTIVITY_SCORE} color="#0062ff" />
                                    <div style={{ flex: 1 }}>
                                        <MetricRow
                                            label="Adoption rate"
                                            value={`${ADOPTION_RATE}%`}
                                        />
                                        <MetricRow
                                            label="Deeply engaged"
                                            value={`${DEEPLY_ENGAGED_RATE}%`}
                                        />
                                        <MetricRow
                                            label="Score / 100"
                                            value={PRODUCTIVITY_SCORE}
                                            valueColor="#d97706"
                                        />
                                        <p
                                            style={{
                                                fontSize: 11,
                                                color: "#94a3b8",
                                                marginTop: 10,
                                            }}
                                        >
                                            Adoption 40% · Engagement 30% · Acceptance 30%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: "16px 20px" }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    Adoption health
                                </p>
                                <div style={{ marginTop: 16 }}>
                                    <AdoptionBar
                                        label="Provisioned"
                                        trailing={`${PROVISIONED_SEATS} seats`}
                                        pct={100}
                                        color="#cce1ff"
                                    />
                                    <AdoptionBar
                                        label="Active (last 30 days)"
                                        trailing={`${ADOPTION_RATE}%`}
                                        pct={ADOPTION_RATE}
                                        color="#0062ff"
                                    />
                                    <AdoptionBar
                                        label="Deeply engaged"
                                        trailing={`${DEEPLY_ENGAGED_RATE}%`}
                                        pct={DEEPLY_ENGAGED_RATE}
                                        color="#66a8ff"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* User activity */}
                        <div
                            className="cf_new_dashboard_info_pannel"
                            style={{ padding: 0, flexShrink: 0 }}
                        >
                            <div
                                style={{
                                    padding: "14px 20px",
                                    borderBottom: "1px solid #e2e8f0",
                                }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    User activity
                                </p>
                            </div>
                            <div style={{ display: "flex", minHeight: 320 }}>
                                <div
                                    style={{
                                        width: 240,
                                        borderRight: "1px solid #e2e8f0",
                                        padding: 10,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 4,
                                    }}
                                >
                                    {USERS.map((u) => (
                                        <div
                                            key={u.id}
                                            onClick={() => setSelectedUserId(u.id)}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                padding: "8px 10px",
                                                borderRadius: 8,
                                                cursor: "pointer",
                                                background:
                                                    selectedUserId === u.id
                                                        ? "#eef2ff"
                                                        : "transparent",
                                            }}
                                        >
                                            <Avatar user={u} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <p
                                                    style={{
                                                        fontSize: 13,
                                                        fontWeight: 500,
                                                        color: "#0f1729",
                                                    }}
                                                >
                                                    {u.name}
                                                </p>
                                                <p style={{ fontSize: 11, color: "#64748b" }}>
                                                    {u.role}
                                                </p>
                                            </div>
                                            <span
                                                style={{
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: "50%",
                                                    background:
                                                        u.status === "Active"
                                                            ? "#16a34a"
                                                            : "#cbd5e1",
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div style={{ flex: 1, padding: 20 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 12,
                                        }}
                                    >
                                        <Avatar user={selectedUser} size={36} />
                                        <div>
                                            <p
                                                style={{
                                                    fontSize: 15,
                                                    fontWeight: 600,
                                                    color: "#0f1729",
                                                }}
                                            >
                                                {selectedUser.name}
                                            </p>
                                            <p style={{ fontSize: 12, color: "#64748b" }}>
                                                {selectedUser.email}
                                            </p>
                                        </div>
                                        <div
                                            style={{
                                                marginLeft: "auto",
                                                display: "flex",
                                                gap: 6,
                                            }}
                                        >
                                            <Pill
                                                text={selectedUser.status}
                                                color={
                                                    selectedUser.status === "Active"
                                                        ? "#16a34a"
                                                        : "#64748b"
                                                }
                                                bg={
                                                    selectedUser.status === "Active"
                                                        ? "#dcfce7"
                                                        : "#f1f5f9"
                                                }
                                            />
                                            <Pill
                                                text={selectedUser.role}
                                                color="#4338ca"
                                                bg="#e0e7ff"
                                            />
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                                            gap: 12,
                                            marginTop: 16,
                                        }}
                                    >
                                        <DetailCell label="Activity" value={selectedUser.activity} />
                                        <DetailCell
                                            label="Primary model"
                                            value={selectedUser.primaryModel}
                                        />
                                        <DetailCell
                                            label="Status"
                                            value={selectedUser.status}
                                            valueColor={
                                                selectedUser.status === "Active"
                                                    ? "#16a34a"
                                                    : "#64748b"
                                            }
                                        />
                                        <DetailCell label="Role" value={selectedUser.role} />
                                    </div>

                                    <div style={{ marginTop: 18 }}>
                                        <table
                                            style={{
                                                width: "100%",
                                                borderCollapse: "collapse",
                                                fontSize: 13,
                                            }}
                                        >
                                            <thead>
                                                <tr>
                                                    <th style={thStyle}>Date</th>
                                                    <th style={thStyle}>Queries / Requests</th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Model
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedUser.daily.length === 0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={3}
                                                            style={{
                                                                ...tdStyle,
                                                                color: "#64748b",
                                                                textAlign: "center",
                                                                padding: 24,
                                                            }}
                                                        >
                                                            No recent activity for this user
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    selectedUser.daily.map((d) => (
                                                        <tr
                                                            key={d.date}
                                                            style={{ borderTop: "1px solid #f1f5f9" }}
                                                        >
                                                            <td style={tdStyle}>{d.date}</td>
                                                            <td style={tdStyle}>{d.queries}</td>
                                                            <td
                                                                style={{
                                                                    ...tdStyle,
                                                                    textAlign: "right",
                                                                }}
                                                            >
                                                                <span
                                                                    style={{
                                                                        fontFamily:
                                                                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                                        fontSize: 12,
                                                                        background: "#f8fafc",
                                                                        border: "1px solid #e2e8f0",
                                                                        borderRadius: 6,
                                                                        padding: "2px 8px",
                                                                        color: "#0f1729",
                                                                    }}
                                                                >
                                                                    {d.model}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MiniStat = ({ label, value, sub, accent }) => (
    <div
        className="cf_new_dashboard_info_pannel"
        style={{ padding: "14px 18px" }}
    >
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
        <p
            style={{
                fontSize: 24,
                fontWeight: 600,
                color: accent ?? "#0f1729",
                marginTop: 6,
                lineHeight: 1.1,
            }}
        >
            {value}
        </p>
        {sub && (
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</p>
        )}
    </div>
);

const MetricRow = ({ label, value, valueColor }) => (
    <div
        style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
        }}
    >
        <span style={{ fontSize: 13, color: "#475569" }}>{label}</span>
        <span
            style={{
                fontSize: 13,
                fontWeight: 600,
                color: valueColor ?? "#0f1729",
            }}
        >
            {value}
        </span>
    </div>
);

const AdoptionBar = ({ label, trailing, pct, color }) => (
    <div style={{ marginBottom: 12 }}>
        <div
            style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#475569",
                marginBottom: 4,
            }}
        >
            <span>{label}</span>
            <span style={{ fontWeight: 600, color: "#0f1729" }}>{trailing}</span>
        </div>
        <div
            style={{
                width: "100%",
                height: 8,
                background: "#f1f5f9",
                borderRadius: 999,
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: color,
                    borderRadius: 999,
                }}
            />
        </div>
    </div>
);

const BigDial = ({ value, color }) => {
    const pct = Math.max(0, Math.min(100, value));
    const gradient = `conic-gradient(${color} ${pct * 3.6}deg, #e2e8f0 0)`;
    return (
        <div
            style={{
                width: 90,
                height: 90,
                borderRadius: "50%",
                background: gradient,
                position: "relative",
                flexShrink: 0,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 10,
                    borderRadius: "50%",
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#0f1729",
                }}
            >
                {value}
            </div>
        </div>
    );
};

const Avatar = ({ user, size = 28 }) => (
    <div
        style={{
            width: size,
            height: size,
            borderRadius: 8,
            background: user.color,
            color: user.textColor,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
        }}
    >
        {user.initials}
    </div>
);

const Pill = ({ text, color, bg }) => (
    <span
        style={{
            fontSize: 11,
            fontWeight: 500,
            color,
            background: bg,
            borderRadius: 999,
            padding: "3px 10px",
        }}
    >
        {text}
    </span>
);

const DetailCell = ({ label, value, valueColor }) => (
    <div
        style={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
            background: "#fff",
        }}
    >
        <p
            style={{
                fontSize: 11,
                color: "#94a3b8",
                fontWeight: 500,
                letterSpacing: 0.3,
            }}
        >
            {label}
        </p>
        <p
            style={{
                fontSize: 14,
                fontWeight: 600,
                color: valueColor ?? "#0f1729",
                marginTop: 2,
            }}
        >
            {value}
        </p>
    </div>
);

const thStyle = {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    color: "#64748b",
    textTransform: "uppercase",
    borderBottom: "1px solid #e2e8f0",
};

const tdStyle = {
    padding: "12px",
    color: "#0f1729",
};

export default M365CopilotInsights;
