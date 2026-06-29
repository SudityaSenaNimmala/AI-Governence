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

const PROVISIONED_SEATS = 109;
const ACTIVE_USERS = 1;
const IDLE_SEATS = PROVISIONED_SEATS - ACTIVE_USERS;
const MONTHLY_SUBSCRIPTION = 339;
const COST_PER_ACTIVE_USER = 339;
const ADOPTION_RATE = 1;
const DEEPLY_ENGAGED_RATE = 1;
const PRODUCTIVITY_SCORE = 10;

const ACTIVE_USERS_TREND = [
    { day: "Mar 15", users: 4 },
    { day: "Mar 22", users: 2 },
    { day: "Mar 29", users: 1 },
    { day: "Apr 5", users: 1 },
    { day: "Apr 12", users: 1 },
    { day: "Apr 14", users: 1 },
];

const ACCEPTED_SUGGESTIONS = [
    { user: "admin saas", accepted: 23, color: "#0062ff" },
    { user: "others (108)", accepted: 2, color: "#cce1ff" },
];

const USERS = [
    {
        id: "u-001",
        initials: "AD",
        name: "admin saas",
        email: "adminsaas@iss.com",
        role: "Admin",
        status: "Active",
        activity: "23 accepted",
        primaryModel: "copilot",
        color: "#fae8ff",
        textColor: "#a21caf",
        daily: [
            { date: "Apr 14", queries: 5, model: "copilot" },
            { date: "Apr 13", queries: 8, model: "copilot" },
            { date: "Apr 12", queries: 10, model: "copilot" },
        ],
    },
    {
        id: "u-002",
        initials: "LA",
        name: "Lakshmi Addatera",
        email: "lakshmi.a@iss.com",
        role: "User",
        status: "Inactive",
        activity: "2 accepted",
        primaryModel: "copilot",
        color: "#e0e7ff",
        textColor: "#4338ca",
        daily: [
            { date: "Mar 20", queries: 2, model: "copilot" },
        ],
    },
    {
        id: "u-003",
        initials: "SA",
        name: "Sangeeta Arora",
        email: "sangeeta.a@iss.com",
        role: "User",
        status: "Inactive",
        activity: "1 accepted",
        primaryModel: "copilot",
        color: "#dcfce7",
        textColor: "#166534",
        daily: [
            { date: "Mar 18", queries: 1, model: "copilot" },
        ],
    },
    {
        id: "u-004",
        initials: "YR",
        name: "Yarrabothlu Roopa",
        email: "roopa.y@iss.com",
        role: "User",
        status: "Inactive",
        activity: "1 accepted",
        primaryModel: "copilot",
        color: "#fef3c7",
        textColor: "#b45309",
        daily: [
            { date: "Mar 16", queries: 1, model: "copilot" },
        ],
    },
];

const GitHubCopilotInsights = () => {
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

    const iconSrc = cloudImageMapper("GITHUB");

    return (
        <div className="cf_main_container">
            <SideNav activeTab="AI Hub" subMenuActive="AI Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="GitHub Copilot Insights" backLink="/AgentHub" />
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
                            {getCFTextLoader("Loading GitHub Copilot analytics…")}
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
                        background: "#fae8ff",
                        border: "1px solid #f0abfc",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    {iconSrc ? (
                        <img
                            src={iconSrc}
                            alt="GitHub Copilot"
                            style={{ width: 22, height: 22, objectFit: "contain" }}
                        />
                    ) : (
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#a21caf" }}>
                            G
                        </span>
                    )}
                </div>
                <div>
                    <p style={{ fontSize: 18, fontWeight: 600, color: "#0f1729" }}>
                        GitHub Copilot
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
                <MiniStat label="Provisioned" value={PROVISIONED_SEATS} sub="seats total" />
                <MiniStat label="Active Users" value={ACTIVE_USERS} sub="last 30 days" />
                <MiniStat
                    label="Idle Seats"
                    value={IDLE_SEATS}
                    sub="zero activity"
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
                    sub="effective rate"
                />
            </div>

            {/* Active users over time + Accepted suggestions */}
            <div
                className="CF_d-flex"
                style={{ gap: 15, alignItems: "stretch", flexShrink: 0 }}
            >
                <div
                    className="cf_new_dashboard_info_pannel"
                    style={{ flex: 2, padding: "16px 20px" }}
                >
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#0f1729" }}>
                        Active users over time
                    </p>
                    <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                        <ResponsiveContainer>
                            <LineChart
                                data={ACTIVE_USERS_TREND}
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
                                    allowDecimals={false}
                                />
                                <Tooltip contentStyle={{ fontSize: 12 }} />
                                <Line
                                    type="monotone"
                                    dataKey="users"
                                    stroke="#0062ff"
                                    strokeWidth={2}
                                    dot={{ r: 4, fill: "#0062ff", stroke: "#fff", strokeWidth: 2 }}
                                    activeDot={{ r: 6 }}
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
                        Accepted suggestions
                    </p>
                    <div style={{ width: "100%", height: 220, marginTop: 12 }}>
                        <ResponsiveContainer>
                            <BarChart
                                data={ACCEPTED_SUGGESTIONS}
                                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                            >
                                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                <XAxis
                                    dataKey="user"
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
                                <Tooltip contentStyle={{ fontSize: 12 }} />
                                <Bar dataKey="accepted" radius={[6, 6, 0, 0]}>
                                    {ACCEPTED_SUGGESTIONS.map((d) => (
                                        <Cell key={d.user} fill={d.color} />
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
                                valueColor="#ef4444"
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
                                            ? "#fdf4ff"
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
                                    color="#a21caf"
                                    bg="#fae8ff"
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
                    minWidth: pct > 0 ? 4 : 0,
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

export default GitHubCopilotInsights;
