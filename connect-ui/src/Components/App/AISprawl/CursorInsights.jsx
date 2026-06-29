import { useEffect, useMemo, useState } from "react";
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

const PROVISIONED_SEATS = 58;
const ACTIVE_SEATS = 52;
const ACCEPTANCE_RATE = 68;
const MONTHLY_SUBSCRIPTION = 985;
const COST_PER_ACTIVE_USER = Math.round(MONTHLY_SUBSCRIPTION / ACTIVE_SEATS);
const ADOPTION_RATE = Math.round((ACTIVE_SEATS / PROVISIONED_SEATS) * 100);
const DEEPLY_ENGAGED_RATE = 65;
const PRODUCTIVITY_SCORE = 70;

const LINES_TREND = [
    { day: "Apr 6", added: 620, accepted: 480 },
    { day: "Apr 7", added: 580, accepted: 510 },
    { day: "Apr 8", added: 340, accepted: 260 },
    { day: "Apr 9", added: 310, accepted: 220 },
    { day: "Apr 10", added: 380, accepted: 290 },
    { day: "Apr 11", added: 420, accepted: 340 },
    { day: "Apr 12", added: 760, accepted: 520 },
    { day: "Apr 13", added: 490, accepted: 380 },
    { day: "Apr 14", added: 350, accepted: 270 },
];

const AGENT_REQUESTS = [
    { day: "Apr 6", requests: 52 },
    { day: "Apr 7", requests: 48 },
    { day: "Apr 8", requests: 38 },
    { day: "Apr 9", requests: 55 },
    { day: "Apr 10", requests: 42 },
    { day: "Apr 11", requests: 60 },
    { day: "Apr 12", requests: 65 },
    { day: "Apr 13", requests: 35 },
    { day: "Apr 14", requests: 28 },
];

const USERS = [
    {
        id: "u-001",
        initials: "SA",
        name: "sai Tharun",
        email: "sai.tharun@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "2.7K lines",
        primaryModel: "claude-4.6-opus-high",
        color: "#dcfce7",
        textColor: "#166534",
        daily: [
            { date: "Apr 14", linesAdded: 194, linesDeleted: 162, tabsShown: 5, tabsAccepted: 2, agentReqs: 11, model: "claude-4.6-opus-high" },
            { date: "Apr 12", linesAdded: 897, linesDeleted: 61, tabsShown: 3, tabsAccepted: 1, agentReqs: 9, model: "claude-4.6-opus-high-thinking" },
            { date: "Apr 9", linesAdded: 18, linesDeleted: 2, tabsShown: 4, tabsAccepted: 1, agentReqs: 12, model: "default" },
            { date: "Apr 8", linesAdded: 6, linesDeleted: 3, tabsShown: 2, tabsAccepted: 1, agentReqs: 10, model: "claude-4.6-opus-high" },
            { date: "Apr 7", linesAdded: 663, linesDeleted: 160, tabsShown: 37, tabsAccepted: 3, agentReqs: 53, model: "cursor-4.6-opus-high" },
            { date: "Apr 6", linesAdded: 885, linesDeleted: 349, tabsShown: 1, tabsAccepted: 1, agentReqs: 12, model: "claude-4.6-opus-high" },
        ],
    },
    {
        id: "u-002",
        initials: "AN",
        name: "Arunareddy Dasari",
        email: "aruna.dasari@cloudfuze.com",
        role: "Admin",
        status: "Active",
        activity: "4.1K lines",
        primaryModel: "claude-4.6-opus-high",
        color: "#ede9fe",
        textColor: "#6d28d9",
        daily: [
            { date: "Apr 14", linesAdded: 320, linesDeleted: 95, tabsShown: 18, tabsAccepted: 7, agentReqs: 14, model: "claude-4.6-opus-high" },
            { date: "Apr 12", linesAdded: 540, linesDeleted: 210, tabsShown: 24, tabsAccepted: 11, agentReqs: 22, model: "claude-4.6-opus-high" },
            { date: "Apr 10", linesAdded: 78, linesDeleted: 34, tabsShown: 9, tabsAccepted: 4, agentReqs: 8, model: "claude-4.6-opus-high-thinking" },
        ],
    },
    {
        id: "u-003",
        initials: "LA",
        name: "Lakshmi Addatera",
        email: "lakshmi.a@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "1.8K lines",
        primaryModel: "claude-4.6-opus-high",
        color: "#fff7ed",
        textColor: "#c2410c",
        daily: [
            { date: "Apr 13", linesAdded: 210, linesDeleted: 96, tabsShown: 11, tabsAccepted: 4, agentReqs: 7, model: "claude-4.6-opus-high" },
            { date: "Apr 11", linesAdded: 145, linesDeleted: 58, tabsShown: 6, tabsAccepted: 2, agentReqs: 5, model: "claude-4.6-opus-high" },
        ],
    },
    {
        id: "u-004",
        initials: "KA",
        name: "Kodari Sai Lokman",
        email: "kodari.s@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "1.4K lines",
        primaryModel: "claude-4.6-opus-high",
        color: "#e0e7ff",
        textColor: "#4338ca",
        daily: [
            { date: "Apr 14", linesAdded: 92, linesDeleted: 41, tabsShown: 5, tabsAccepted: 2, agentReqs: 6, model: "claude-4.6-opus-high" },
            { date: "Apr 10", linesAdded: 68, linesDeleted: 22, tabsShown: 3, tabsAccepted: 1, agentReqs: 4, model: "default" },
        ],
    },
    {
        id: "u-005",
        initials: "KA",
        name: "kandarisatya abhiXena",
        email: "kandari.s@cloudfuze.com",
        role: "User",
        status: "Active",
        activity: "1.1K lines",
        primaryModel: "claude-4.6-opus-high",
        color: "#fef3c7",
        textColor: "#b45309",
        daily: [
            { date: "Apr 12", linesAdded: 124, linesDeleted: 60, tabsShown: 8, tabsAccepted: 3, agentReqs: 5, model: "claude-4.6-opus-high" },
            { date: "Apr 8", linesAdded: 48, linesDeleted: 18, tabsShown: 4, tabsAccepted: 1, agentReqs: 3, model: "claude-4.6-opus-high-thinking" },
        ],
    },
];

const CursorInsights = () => {
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

    const iconSrc = cloudImageMapper("CURSOR_AI");

    return (
        <div className="cf_main_container">
            <SideNav activeTab="AI Hub" subMenuActive="AI Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Cursor Insights" backLink="/AgentHub" />
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
                            {getCFTextLoader("Loading Cursor analytics…")}
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
                        background: "#dcfce7",
                        border: "1px solid #bbf7d0",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    {iconSrc ? (
                        <img
                            src={iconSrc}
                            alt="Cursor"
                            style={{ width: 22, height: 22, objectFit: "contain" }}
                        />
                    ) : (
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                            C
                        </span>
                    )}
                </div>
                <div>
                    <p style={{ fontSize: 18, fontWeight: 600, color: "#0f1729" }}>
                        Cursor
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
                <MiniStat
                    label="Acceptance Rate"
                    value={`${ACCEPTANCE_RATE}%`}
                    sub="AI suggestions"
                    accent="#16a34a"
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

            {/* Lines added vs accepted + Agent requests per day */}
            <div
                className="CF_d-flex"
                style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
            >
                <div
                    className="cf_new_dashboard_info_pannel"
                    style={{ flex: 2, padding: "16px 20px" }}
                >
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                        Lines added vs accepted (dashed)
                    </p>
                    <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                        <ResponsiveContainer>
                            <LineChart
                                data={LINES_TREND}
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
                                    dataKey="added"
                                    stroke="#0062ff"
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: "#0062ff" }}
                                    activeDot={{ r: 5 }}
                                    name="Lines added"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="accepted"
                                    stroke="#66a8ff"
                                    strokeWidth={2}
                                    strokeDasharray="6 3"
                                    dot={{ r: 3, fill: "#66a8ff" }}
                                    activeDot={{ r: 5 }}
                                    name="Accepted"
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
                        Agent requests per day
                    </p>
                    <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                        <ResponsiveContainer>
                            <BarChart
                                data={AGENT_REQUESTS}
                                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                            >
                                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                <XAxis
                                    dataKey="day"
                                    tick={{ fontSize: 10, fill: "#64748b" }}
                                    tickLine={false}
                                    axisLine={{ stroke: "#e2e8f0" }}
                                    interval={0}
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
                                <Bar dataKey="requests" radius={[6, 6, 0, 0]}>
                                    {AGENT_REQUESTS.map((d) => (
                                        <Cell key={d.day} fill="#0062ff" />
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
                                valueColor="#16a34a"
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
                                            ? "#f0fdf4"
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
                                    color="#166534"
                                    bg="#dcfce7"
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
                                        <th style={{ ...thStyle, textAlign: "right" }}>Lines Added</th>
                                        <th style={{ ...thStyle, textAlign: "right" }}>Lines Deleted</th>
                                        <th style={{ ...thStyle, textAlign: "right" }}>Tabs Shown</th>
                                        <th style={{ ...thStyle, textAlign: "right" }}>Tabs Accepted</th>
                                        <th style={{ ...thStyle, textAlign: "right" }}>Agent Reqs</th>
                                        <th style={{ ...thStyle, textAlign: "right" }}>Model</th>
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
                                                <td style={{ ...tdStyle, textAlign: "right" }}>{d.linesAdded}</td>
                                                <td style={{ ...tdStyle, textAlign: "right" }}>{d.linesDeleted}</td>
                                                <td style={{ ...tdStyle, textAlign: "right" }}>{d.tabsShown}</td>
                                                <td style={{ ...tdStyle, textAlign: "right" }}>{d.tabsAccepted}</td>
                                                <td style={{ ...tdStyle, textAlign: "right" }}>{d.agentReqs}</td>
                                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                                    <span
                                                        style={{
                                                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
    <div className="cf_new_dashboard_info_pannel" style={{ padding: "14px 18px" }}>
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
        {sub && <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</p>}
    </div>
);

const MetricRow = ({ label, value, valueColor }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
        <span style={{ fontSize: 13, color: "#475569" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: valueColor ?? "#0f1729" }}>
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

export default CursorInsights;
