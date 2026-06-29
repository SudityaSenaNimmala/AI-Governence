import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
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
import UsageTrendAreaChart from "../../Resuables/Charts/UsageTrendAreaChart";

const CLAUDE_REQUESTS_BY_MODEL = [
    { name: "claude-sonnet-4-6", y: 11 },
    { name: "claude-haiku-4-5-20251001", y: 11 },
    { name: "claude-sonnet-4-20250514", y: 7 },
    { name: "claude-opus-4-6", y: 4 },
];

const CLAUDE_COST_BY_MODEL = [
    { name: "claude-sonnet-4-20250514", y: 3.02 },
    { name: "claude-sonnet-4-6", y: 2.74 },
    { name: "claude-opus-4-6", y: 1.95 },
    { name: "claude-haiku-4-5-20251001", y: 0.31 },
];

const CLAUDE_DAILY_REQUESTS = [
    { day: "Apr 7", requests: 9 },
    { day: "Apr 9", requests: 9 },
    { day: "Apr 10", requests: 9 },
    { day: "Apr 11", requests: 10 },
    { day: "Apr 12", requests: 10 },
    { day: "Apr 13", requests: 11 },
    { day: "Apr 14", requests: 12 },
    { day: "Apr 15", requests: 13 },
    { day: "Apr 16", requests: 15 },
    { day: "Apr 18", requests: 35 },
    { day: "Apr 19", requests: 33 },
];

const CLAUDE_DAILY_ACTIVE_USERS = [
    { date: "Apr 7", activeUserCount: 1 },
    { date: "Apr 9", activeUserCount: 1 },
    { date: "Apr 10", activeUserCount: 1 },
    { date: "Apr 11", activeUserCount: 1 },
    { date: "Apr 12", activeUserCount: 1 },
    { date: "Apr 13", activeUserCount: 1 },
    { date: "Apr 14", activeUserCount: 1 },
    { date: "Apr 15", activeUserCount: 1 },
    { date: "Apr 16", activeUserCount: 1 },
    { date: "Apr 18", activeUserCount: 3 },
    { date: "Apr 19", activeUserCount: 3 },
];

const PROVISIONED_SEATS = 8;
const ACTIVE_SEATS = 8;
const TOKENS_USED_LABEL = "231.1K";
const CACHED_TOKENS_LABEL = "17M";
const MONTHLY_SUBSCRIPTION = 351;
const COST_PER_ACTIVE_USER = 44;
const ADOPTION_RATE = 100;
const DEEPLY_ENGAGED_RATE = 75;
const PRODUCTIVITY_SCORE = 80;

const DAILY_COST = [
    { day: "Mar 19", cost: 58 },
    { day: "Mar 20", cost: 210 },
    { day: "Mar 21", cost: 410 },
    { day: "Mar 22", cost: 540 },
    { day: "Mar 23", cost: 600 },
    { day: "Mar 24", cost: 520 },
    { day: "Mar 25", cost: 380 },
    { day: "Mar 26", cost: 250 },
    { day: "Mar 27", cost: 170 },
    { day: "Mar 28", cost: 120 },
    { day: "Mar 29", cost: 85 },
    { day: "Mar 30", cost: 60 },
    { day: "Apr 1", cost: 95 },
    { day: "Apr 3", cost: 180 },
    { day: "Apr 5", cost: 260 },
    { day: "Apr 6", cost: 290 },
    { day: "Apr 7", cost: 255 },
    { day: "Apr 8", cost: 195 },
    { day: "Apr 9", cost: 140 },
    { day: "Apr 10", cost: 210 },
    { day: "Apr 11", cost: 330 },
    { day: "Apr 12", cost: 450 },
    { day: "Apr 13", cost: 420 },
    { day: "Apr 14", cost: 380 },
];

const MODEL_USAGE = [
    { model: "claude-sonnet-4-6", tokens: 13_200_000, color: "#0062ff" },
    { model: "claude-sonnet-4-6-thinking", tokens: 1_100_000, color: "#66a8ff" },
    { model: "claude-haiku-4-5", tokens: 2_300_000, color: "#3385ff" },
    { model: "claude-opus-4-5", tokens: 420_000, color: "#cce1ff" },
];

const USERS = [
    {
        id: "u-001",
        initials: "PR",
        name: "Pranavi",
        email: "pranavi@cloudfuze.com",
        role: "Admin",
        status: "Active",
        activity: "52K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#ede9fe",
        textColor: "#6d28d9",
        daily: [
            { date: "Apr 14", linesAdded: 194, linesDeleted: 162, tabsShown: 24, tabsAccepted: 9, agentReqs: 11, model: "claude-sonnet-4-6" },
            { date: "Apr 12", linesAdded: 897, linesDeleted: 55, tabsShown: 14, tabsAccepted: 6, agentReqs: 9, model: "claude-sonnet-4-6-thinking" },
            { date: "Apr 9", linesAdded: 16, linesDeleted: 2, tabsShown: 8, tabsAccepted: 5, agentReqs: 12, model: "default" },
            { date: "Apr 7", linesAdded: 663, linesDeleted: 160, tabsShown: 37, tabsAccepted: 3, agentReqs: 68, model: "claude-sonnet-4-6" },
            { date: "Apr 6", linesAdded: 885, linesDeleted: 349, tabsShown: 22, tabsAccepted: 11, agentReqs: 52, model: "claude-sonnet-4-6" },
        ],
    },
    {
        id: "u-002",
        initials: "RA",
        name: "Ravi",
        email: "ravi@cloudfuze.com",
        role: "Admin",
        status: "Active",
        activity: "41K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#ede9fe",
        textColor: "#6d28d9",
        daily: [
            { date: "Apr 14", linesAdded: 142, linesDeleted: 88, tabsShown: 18, tabsAccepted: 7, agentReqs: 14, model: "claude-sonnet-4-6" },
            { date: "Apr 12", linesAdded: 520, linesDeleted: 220, tabsShown: 26, tabsAccepted: 12, agentReqs: 22, model: "claude-sonnet-4-6" },
            { date: "Apr 10", linesAdded: 78, linesDeleted: 34, tabsShown: 9, tabsAccepted: 4, agentReqs: 6, model: "claude-haiku-4-5" },
        ],
    },
    {
        id: "u-003",
        initials: "SU",
        name: "Sujana",
        email: "sujana@cloudfuze.com",
        role: "Admin",
        status: "Inactive",
        activity: "12K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#dcfce7",
        textColor: "#166534",
        daily: [
            { date: "Apr 8", linesAdded: 210, linesDeleted: 96, tabsShown: 11, tabsAccepted: 4, agentReqs: 7, model: "claude-sonnet-4-6" },
            { date: "Apr 4", linesAdded: 58, linesDeleted: 22, tabsShown: 6, tabsAccepted: 2, agentReqs: 3, model: "claude-haiku-4-5" },
        ],
    },
    {
        id: "u-004",
        initials: "PA",
        name: "pavan",
        email: "pavan@cloudfuze.com",
        role: "User",
        status: "Inactive",
        activity: "8K tokens",
        primaryModel: "claude-haiku-4-5",
        color: "#e0e7ff",
        textColor: "#4338ca",
        daily: [
            { date: "Apr 5", linesAdded: 92, linesDeleted: 41, tabsShown: 5, tabsAccepted: 2, agentReqs: 4, model: "claude-haiku-4-5" },
        ],
    },
    {
        id: "u-005",
        initials: "BH",
        name: "Bharath",
        email: "bharath@cloudfuze.com",
        role: "User",
        status: "Inactive",
        activity: "14K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#fef3c7",
        textColor: "#b45309",
        daily: [
            { date: "Apr 7", linesAdded: 124, linesDeleted: 60, tabsShown: 8, tabsAccepted: 3, agentReqs: 5, model: "claude-sonnet-4-6" },
            { date: "Apr 2", linesAdded: 48, linesDeleted: 18, tabsShown: 4, tabsAccepted: 1, agentReqs: 2, model: "claude-haiku-4-5" },
        ],
    },
    {
        id: "u-006",
        initials: "RC",
        name: "RC",
        email: "rc@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "33K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#fee2e2",
        textColor: "#b91c1c",
        daily: [
            { date: "Apr 13", linesAdded: 305, linesDeleted: 112, tabsShown: 16, tabsAccepted: 8, agentReqs: 19, model: "claude-sonnet-4-6" },
            { date: "Apr 11", linesAdded: 440, linesDeleted: 180, tabsShown: 21, tabsAccepted: 10, agentReqs: 24, model: "claude-sonnet-4-6-thinking" },
        ],
    },
    {
        id: "u-007",
        initials: "SA",
        name: "Satya",
        email: "satya@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "27K tokens",
        primaryModel: "claude-sonnet-4-6",
        color: "#cffafe",
        textColor: "#0e7490",
        daily: [
            { date: "Apr 14", linesAdded: 210, linesDeleted: 78, tabsShown: 12, tabsAccepted: 5, agentReqs: 11, model: "claude-sonnet-4-6" },
            { date: "Apr 10", linesAdded: 150, linesDeleted: 42, tabsShown: 10, tabsAccepted: 4, agentReqs: 8, model: "claude-sonnet-4-6" },
        ],
    },
    {
        id: "u-008",
        initials: "SU",
        name: "suraj",
        email: "suraj@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "22K tokens",
        primaryModel: "claude-haiku-4-5",
        color: "#f1f5f9",
        textColor: "#475569",
        daily: [
            { date: "Apr 13", linesAdded: 175, linesDeleted: 64, tabsShown: 9, tabsAccepted: 4, agentReqs: 6, model: "claude-haiku-4-5" },
            { date: "Apr 8", linesAdded: 92, linesDeleted: 28, tabsShown: 7, tabsAccepted: 3, agentReqs: 5, model: "claude-haiku-4-5" },
        ],
    },
];

const ClaudeInsights = () => {
    const [selectedUserId, setSelectedUserId] = useState(USERS[0].id);
    const selectedUser = useMemo(
        () => USERS.find((u) => u.id === selectedUserId) ?? USERS[0],
        [selectedUserId],
    );

    const iconSrc = cloudImageMapper("CLAUDE");

    return (
        <div className="cf_main_container">
            <SideNav activeTab="AI Hub" subMenuActive="AI Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Claude Insights" backLink="/AgentHub" />
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
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: "#faf5ff",
                                    border: "1px solid #f3e8ff",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                {iconSrc && (
                                    <img
                                        src={iconSrc}
                                        alt="Claude"
                                        style={{ width: 22, height: 22, objectFit: "contain" }}
                                    />
                                )}
                            </div>
                            <div>
                                <p style={{ fontSize: 18, fontWeight: 600, color: "#0f1729" }}>
                                    Claude
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

                        {/* Stat tiles */}
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
                                accent="#16a34a"
                            />
                            <MiniStat
                                label="Tokens Used"
                                value={TOKENS_USED_LABEL}
                                sub={`cached: ${CACHED_TOKENS_LABEL}`}
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

                        {/* Requests by Model + Cost by Model */}
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
                                        Requests by Model
                                    </p>
                                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                        Share of requests across models (last 30 days)
                                    </p>
                                </div>
                                <div style={{ padding: "0 0.5rem 1rem" }}>
                                    <PiCharts
                                        title=""
                                        graphData={CLAUDE_REQUESTS_BY_MODEL}
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
                                        Cost by Model (USD)
                                    </p>
                                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                        Spend distribution across Claude models
                                    </p>
                                </div>
                                <div style={{ padding: "0 0.5rem 1rem" }}>
                                    <PiCharts
                                        title=""
                                        graphData={CLAUDE_COST_BY_MODEL}
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

                        {/* Daily Requests + Daily Active Users */}
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
                                            Daily Requests
                                        </p>
                                        <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                            Total Claude requests per day
                                        </p>
                                    </div>
                                </div>
                                <div style={{ padding: "0 1.25rem 1rem" }}>
                                    <div style={{ width: "100%", height: 260 }}>
                                        <ResponsiveContainer>
                                            <BarChart
                                                data={CLAUDE_DAILY_REQUESTS}
                                                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                            >
                                                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                                <XAxis
                                                    dataKey="day"
                                                    tick={{ fontSize: 11, fill: "#64748b" }}
                                                    tickLine={false}
                                                    axisLine={{ stroke: "#e2e8f0" }}
                                                />
                                                <YAxis
                                                    tick={{ fontSize: 11, fill: "#64748b" }}
                                                    tickLine={false}
                                                    axisLine={false}
                                                />
                                                <Tooltip
                                                    formatter={(v) => `${v} requests`}
                                                    contentStyle={{ fontSize: 12 }}
                                                />
                                                <Bar
                                                    dataKey="requests"
                                                    fill="#7c3aed"
                                                    radius={[6, 6, 0, 0]}
                                                />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 1, padding: 0, overflow: "hidden" }}
                            >
                                <div style={{ padding: "16px 20px" }}>
                                    <p style={{ fontSize: 16, fontWeight: 700, color: "#001a6f" }}>
                                        Daily Active Users
                                    </p>
                                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                        Users active on Claude each day
                                    </p>
                                </div>
                                <div style={{ padding: "0 1.25rem 1rem" }}>
                                    <UsageTrendAreaChart
                                        graphData={CLAUDE_DAILY_ACTIVE_USERS}
                                        dataKey="activeUserCount"
                                        customHeight={260}
                                        customWidth="100%"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Daily cost + Token usage by model */}
                        <div
                            className="CF_d-flex"
                            style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
                        >
                            <div
                                className="cf_new_dashboard_info_pannel"
                                style={{ flex: 2, padding: "16px 20px" }}
                            >
                                <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                    Daily cost (USD)
                                </p>
                                <div style={{ width: "100%", height: 240, marginTop: 12 }}>
                                    <ResponsiveContainer>
                                        <LineChart
                                            data={DAILY_COST}
                                            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                            <XAxis
                                                dataKey="day"
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={{ stroke: "#e2e8f0" }}
                                                interval={2}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 11, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <Tooltip
                                                formatter={(v) => `$${v}`}
                                                contentStyle={{ fontSize: 12 }}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="cost"
                                                stroke="#0062ff"
                                                strokeWidth={2}
                                                dot={{ r: 3, fill: "#0062ff" }}
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
                                    Token usage by model
                                </p>
                                <div style={{ width: "100%", height: 240, marginTop: 12 }}>
                                    <ResponsiveContainer>
                                        <BarChart
                                            data={MODEL_USAGE}
                                            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                            <XAxis
                                                dataKey="model"
                                                tick={{ fontSize: 10, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={{ stroke: "#e2e8f0" }}
                                                interval={0}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 10, fill: "#64748b" }}
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={(v) => v.toLocaleString()}
                                            />
                                            <Tooltip
                                                formatter={(v) => `${v.toLocaleString()} tokens`}
                                                contentStyle={{ fontSize: 12 }}
                                            />
                                            <Bar dataKey="tokens" radius={[6, 6, 0, 0]}>
                                                {MODEL_USAGE.map((m) => (
                                                    <Cell key={m.model} fill={m.color} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Productivity + Adoption health */}
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
                                            valueColor="#16a34a"
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
                            <div style={{ display: "flex", minHeight: 360 }}>
                                <div
                                    style={{
                                        width: 240,
                                        borderRight: "1px solid #e2e8f0",
                                        padding: 10,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 4,
                                        overflowY: "auto",
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
                                                        ? "#faf5ff"
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

                                <div style={{ flex: 1, padding: 20, minWidth: 0, overflowX: "auto" }}>
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
                                            mono
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
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Lines Added
                                                    </th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Lines Deleted
                                                    </th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Tabs Shown
                                                    </th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Tabs Accepted
                                                    </th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Agent Reqs
                                                    </th>
                                                    <th style={{ ...thStyle, textAlign: "right" }}>
                                                        Model
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedUser.daily.length === 0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={7}
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
                                                            <td style={{ ...tdStyle, textAlign: "right" }}>
                                                                {d.linesAdded}
                                                            </td>
                                                            <td style={{ ...tdStyle, textAlign: "right" }}>
                                                                {d.linesDeleted}
                                                            </td>
                                                            <td style={{ ...tdStyle, textAlign: "right" }}>
                                                                {d.tabsShown}
                                                            </td>
                                                            <td style={{ ...tdStyle, textAlign: "right" }}>
                                                                {d.tabsAccepted}
                                                            </td>
                                                            <td style={{ ...tdStyle, textAlign: "right" }}>
                                                                {d.agentReqs}
                                                            </td>
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

const DetailCell = ({ label, value, valueColor, mono }) => (
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
                fontFamily: mono
                    ? "ui-monospace, SFMono-Regular, Menlo, monospace"
                    : undefined,
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
    whiteSpace: "nowrap",
};

const tdStyle = {
    padding: "12px",
    color: "#0f1729",
    whiteSpace: "nowrap",
};

export default ClaudeInsights;
