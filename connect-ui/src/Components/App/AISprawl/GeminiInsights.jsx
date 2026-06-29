import { useEffect, useMemo, useState } from "react";
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
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import PiCharts from "../../Resuables/Charts/PiCharts";

const GEMINI_APP_USAGE = [
    { name: "gemini_app", y: 42 },
    { name: "docs", y: 28 },
    { name: "gmail", y: 21 },
    { name: "meet", y: 15 },
    { name: "slides", y: 11 },
    { name: "sheets", y: 9 },
    { name: "drive", y: 6 },
];

const GEMINI_FEATURE_SOURCE = [
    { name: "chat_with_gemini", y: 38 },
    { name: "help_me_write", y: 22 },
    { name: "smart_compose", y: 17 },
    { name: "summarize_thread", y: 12 },
    { name: "side_panel", y: 9 },
    { name: "context_menu", y: 5 },
];

const GEMINI_TOP_ACTIONS = [
    { action: "classic_use_case_gemini_app", count: 42, color: "#f97316" },
    { action: "summarize", count: 28, color: "#fb923c" },
    { action: "draft_email", count: 19, color: "#fdba74" },
    { action: "translate", count: 14, color: "#fed7aa" },
    { action: "generate_image", count: 9, color: "#ffedd5" },
    { action: "conversation", count: 6, color: "#fff7ed" },
];

const GEMINI_CATEGORY_DISTRIBUTION = [
    { category: "inactive", percent: 58.4, color: "#cbd5e1" },
    { category: "active_conversations", percent: 21.6, color: "#16a34a" },
    { category: "semi_active", percent: 11.3, color: "#fbbf24" },
    { category: "onboarding", percent: 5.2, color: "#60a5fa" },
    { category: "churned", percent: 3.5, color: "#ef4444" },
];

const PROVISIONED_SEATS = 67;
const ACTIVE_SEATS = 59;
const INACTIVE_SEATS = PROVISIONED_SEATS - ACTIVE_SEATS;
const MONTHLY_SUBSCRIPTION = 1440;
const COST_PER_ACTIVE_USER = Math.round(MONTHLY_SUBSCRIPTION / ACTIVE_SEATS);
const ADOPTION_RATE = Math.round((ACTIVE_SEATS / PROVISIONED_SEATS) * 100);
const DEEPLY_ENGAGED_RATE = 48;
const PRODUCTIVITY_SCORE = 55;

const DAILY_QUERIES = [
    { day: "Apr 5", queries: 820 },
    { day: "Apr 6", queries: 910 },
    { day: "Apr 7", queries: 1050 },
    { day: "Apr 8", queries: 980 },
    { day: "Apr 9", queries: 1120 },
    { day: "Apr 10", queries: 1280 },
    { day: "Apr 11", queries: 1510 },
    { day: "Apr 12", queries: 1350 },
    { day: "Apr 13", queries: 1620 },
    { day: "Apr 14", queries: 1780 },
];

const PRODUCT_USAGE = [
    { product: "Gemini Advanced", queries: 5820, color: "#0062ff" },
    { product: "Workspace", queries: 3640, color: "#66a8ff" },
    { product: "API", queries: 1120, color: "#cce1ff" },
];

const USERS = [
    {
        id: "u-001",
        initials: "AN",
        name: "Anita Singh",
        email: "a.singh@vantage.co",
        role: "Admin",
        status: "Active",
        activity: "12.1K queries",
        primaryModel: "gemini-1.5-pro",
        color: "#fff7ed",
        textColor: "#c2410c",
        daily: [
            { date: "Apr 14", queries: 340, model: "gemini-1.5-pro" },
            { date: "Apr 13", queries: 600, model: "gemini-1.5-flash" },
            { date: "Apr 12", queries: 410, model: "gemini-2.0-flash" },
        ],
    },
    {
        id: "u-002",
        initials: "DK",
        name: "David Kawamura",
        email: "d.kawamura@vantage.co",
        role: "User",
        status: "Active",
        activity: "8.4K queries",
        primaryModel: "gemini-1.5-pro",
        color: "#dcfce7",
        textColor: "#166534",
        daily: [
            { date: "Apr 14", queries: 210, model: "gemini-1.5-pro" },
            { date: "Apr 13", queries: 380, model: "gemini-1.5-pro" },
            { date: "Apr 11", queries: 290, model: "gemini-1.5-flash" },
        ],
    },
    {
        id: "u-003",
        initials: "LM",
        name: "Lisa Moreno",
        email: "l.moreno@vantage.co",
        role: "User",
        status: "Active",
        activity: "5.7K queries",
        primaryModel: "gemini-1.5-flash",
        color: "#e0e7ff",
        textColor: "#4338ca",
        daily: [
            { date: "Apr 14", queries: 145, model: "gemini-1.5-flash" },
            { date: "Apr 12", queries: 260, model: "gemini-1.5-pro" },
            { date: "Apr 10", queries: 190, model: "gemini-1.5-flash" },
        ],
    },
    {
        id: "u-004",
        initials: "JW",
        name: "James Wei",
        email: "j.wei@vantage.co",
        role: "User",
        status: "Active",
        activity: "3.2K queries",
        primaryModel: "gemini-2.0-flash",
        color: "#fef3c7",
        textColor: "#b45309",
        daily: [
            { date: "Apr 13", queries: 110, model: "gemini-2.0-flash" },
            { date: "Apr 11", queries: 175, model: "gemini-1.5-pro" },
        ],
    },
];

const GeminiInsights = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [selectedUserId, setSelectedUserId] = useState(USERS[0].id);
    const selectedUser = useMemo(
        () => USERS.find((u) => u.id === selectedUserId) ?? USERS[0],
        [selectedUserId],
    );

    useEffect(() => {
        const t = setTimeout(() => setIsLoading(false), 900);
        return () => clearTimeout(t);
    }, []);

    const iconSrc = cloudImageMapper("GOOGLE_WORKSPACE");

    return (
        <div className="cf_main_container">
            <SideNav activeTab="AI Hub" subMenuActive="AI Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Gemini Insights" backLink="/AgentHub" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{
                        padding: "10px 0",
                        flexDirection: "column",
                        gap: "15px",
                        overflowY: "auto",
                    }}
                >
                    {isLoading ? (
                        <div style={{ padding: 40 }}>
                            {getCFTextLoader("Loading Gemini analytics…")}
                        </div>
                    ) : (
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
                                        background: "#fff7ed",
                                        border: "1px solid #fed7aa",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {iconSrc && (
                                        <img
                                            src={iconSrc}
                                            alt="Gemini"
                                            style={{ width: 22, height: 22, objectFit: "contain" }}
                                        />
                                    )}
                                </div>
                                <div>
                                    <p style={{ fontSize: 18, fontWeight: 600, color: "#0f1729" }}>
                                        Gemini
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
                                <MiniStat label="Users" value={PROVISIONED_SEATS} sub="provisioned" />
                                <MiniStat label="Active" value={ACTIVE_SEATS} sub="last 30 days" />
                                <MiniStat label="Inactive" value={INACTIVE_SEATS} sub="no activity" accent="#ef4444" />
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

                            {/* App Usage + Top Actions */}
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
                                            App Usage
                                        </p>
                                        <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                            Events by Google Workspace app
                                        </p>
                                    </div>
                                    <div style={{ padding: "0 0.5rem 1rem" }}>
                                        <PiCharts
                                            title=""
                                            graphData={GEMINI_APP_USAGE}
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
                                                backgroundColor: "rgba(249, 115, 22, 0.12)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                flexShrink: 0,
                                            }}
                                        >
                                            <Activity size={18} strokeWidth={2} color="#f97316" />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                                                Top Actions
                                            </p>
                                            <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                                Most performed Gemini actions
                                            </p>
                                        </div>
                                    </div>
                                    <div style={{ padding: "0 1.25rem 1rem" }}>
                                        <div style={{ width: "100%", height: 260 }}>
                                            <ResponsiveContainer>
                                                <BarChart
                                                    data={GEMINI_TOP_ACTIONS}
                                                    layout="vertical"
                                                    margin={{ top: 8, right: 20, left: 20, bottom: 0 }}
                                                >
                                                    <CartesianGrid stroke="#f1f5f9" horizontal={false} />
                                                    <XAxis
                                                        type="number"
                                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                                        tickLine={false}
                                                        axisLine={false}
                                                    />
                                                    <YAxis
                                                        type="category"
                                                        dataKey="action"
                                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                                        tickLine={false}
                                                        axisLine={{ stroke: "#e2e8f0" }}
                                                        width={170}
                                                    />
                                                    <Tooltip
                                                        formatter={(v) => `${v} events`}
                                                        contentStyle={{ fontSize: 12 }}
                                                    />
                                                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                                                        {GEMINI_TOP_ACTIONS.map((a) => (
                                                            <Cell key={a.action} fill={a.color} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Feature Source + Category Distribution */}
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
                                            Feature Source Distribution
                                        </p>
                                        <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                            Where users invoke Gemini from
                                        </p>
                                    </div>
                                    <div style={{ padding: "0 0.5rem 1rem" }}>
                                        <PiCharts
                                            title=""
                                            graphData={GEMINI_FEATURE_SOURCE}
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
                                        <p style={{ fontSize: 16, fontWeight: 700, color: "#001a6f" }}>
                                            Category Distribution
                                        </p>
                                        <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                            Active conversations vs inactive time
                                        </p>
                                    </div>
                                    <div style={{ padding: "0 1.25rem 1rem" }}>
                                        <div style={{ width: "100%", height: 260 }}>
                                            <ResponsiveContainer>
                                                <BarChart
                                                    data={GEMINI_CATEGORY_DISTRIBUTION}
                                                    layout="vertical"
                                                    margin={{ top: 8, right: 20, left: 20, bottom: 0 }}
                                                >
                                                    <CartesianGrid stroke="#f1f5f9" horizontal={false} />
                                                    <XAxis
                                                        type="number"
                                                        domain={[0, 100]}
                                                        tickFormatter={(v) => `${v}%`}
                                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                                        tickLine={false}
                                                        axisLine={false}
                                                    />
                                                    <YAxis
                                                        type="category"
                                                        dataKey="category"
                                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                                        tickLine={false}
                                                        axisLine={{ stroke: "#e2e8f0" }}
                                                        width={150}
                                                    />
                                                    <Tooltip
                                                        formatter={(v) => `${v}%`}
                                                        contentStyle={{ fontSize: 12 }}
                                                    />
                                                    <Bar dataKey="percent" radius={[0, 6, 6, 0]}>
                                                        {GEMINI_CATEGORY_DISTRIBUTION.map((c) => (
                                                            <Cell key={c.category} fill={c.color} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* Daily queries + Queries by product */}
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
                                        Queries by product
                                    </p>
                                    <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                                        <ResponsiveContainer>
                                            <BarChart
                                                data={PRODUCT_USAGE}
                                                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                                            >
                                                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                                <XAxis
                                                    dataKey="product"
                                                    tick={{ fontSize: 11, fill: "#64748b" }}
                                                    tickLine={false}
                                                    axisLine={{ stroke: "#e2e8f0" }}
                                                    interval={0}
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
                                                    {PRODUCT_USAGE.map((m) => (
                                                        <Cell key={m.product} fill={m.color} />
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
                                            <MetricRow label="Adoption rate" value={`${ADOPTION_RATE}%`} />
                                            <MetricRow label="Deeply engaged" value={`${DEEPLY_ENGAGED_RATE}%`} />
                                            <MetricRow
                                                label="Score / 100"
                                                value={PRODUCTIVITY_SCORE}
                                                valueColor="#f97316"
                                            />
                                            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
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
                                                            ? "#fff7ed"
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
                                                    color="#c2410c"
                                                    bg="#fff7ed"
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
                    )}
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
};

const tdStyle = {
    padding: "12px",
    color: "#0f1729",
};

export default GeminiInsights;
