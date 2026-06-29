/**
 * Shared demo roster for AI Hub (10 licensed users, 9 active).
 * Used by AITopDashboard + AIBottomDashboard dummy chart data.
 */

export const DEMO_AI_HUB_USERS = [
    { id: "1", displayName: "Alex Morgan", active: true, monthlySpend: 148.5, productivityScore: 162 },
    { id: "2", displayName: "Jordan Lee", active: true, monthlySpend: 136.0, productivityScore: 155 },
    { id: "3", displayName: "Sam Rivera", active: true, monthlySpend: 152.25, productivityScore: 168 },
    { id: "4", displayName: "Casey Nguyen", active: true, monthlySpend: 141.0, productivityScore: 150 },
    { id: "5", displayName: "Riley Chen", active: false, monthlySpend: 0, productivityScore: 118 },
    { id: "6", displayName: "Morgan Patel", active: true, monthlySpend: 139.75, productivityScore: 158 },
    { id: "7", displayName: "Taylor Brooks", active: true, monthlySpend: 145.0, productivityScore: 154 },
    { id: "8", displayName: "Jamie Ortiz", active: true, monthlySpend: 151.5, productivityScore: 161 },
    { id: "9", displayName: "Drew Kim", active: true, monthlySpend: 138.0, productivityScore: 149 },
    { id: "10", displayName: "Quinn Foster", active: true, monthlySpend: 144.5, productivityScore: 157 },
];

export const DEMO_TOTAL_USERS = DEMO_AI_HUB_USERS.length;
export const DEMO_ACTIVE_USERS = DEMO_AI_HUB_USERS.filter((u) => u.active).length;

export function aggregateDemoUserMetrics(users) {
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.active).length;
    const monthlySpend = users.reduce((sum, u) => sum + (Number(u.monthlySpend) || 0), 0);
    const productivityScores = users.map((u) => Number(u.productivityScore) || 0);
    const avgProductivity = Math.round(
        productivityScores.reduce((a, b) => a + b, 0) / Math.max(productivityScores.length, 1)
    );
    return { totalUsers, activeUsers, monthlySpend, avgProductivity };
}

/** Tool usage distribution (percentages, sum = 100). */
export const TOOL_USAGE_DATA = [
    { name: "Teams", y: 22, color: "#7dd3fc" },
    { name: "Outlook", y: 20, color: "#a78bfa" },
    { name: "Word", y: 18, color: "#86efac" },
    { name: "Excel", y: 15, color: "#fdba74" },
    { name: "Copilot Chat", y: 10, color: "#c4b5fd" },
    { name: "PowerPoint", y: 8, color: "#f9a8d4" },
    { name: "Teams Copilot", y: 4, color: "#67e8f9" },
    { name: "Loop", y: 2, color: "#fca5a5" },
    { name: "OneNote", y: 1, color: "#fde047" },
];

/** Weekly feature hits scaled from ~88 interactions @ 44 active → ~18 @ 9 active (all ≥1 for charts). */
export const DUMMY_FEATURE_DATA = [
    { name: "Teams", count: 3 },
    { name: "Outlook", count: 3 },
    { name: "Word", count: 3 },
    { name: "Excel", count: 3 },
    { name: "Copilot Chat", count: 2 },
    { name: "PowerPoint", count: 1 },
    { name: "Teams Copilot", count: 1 },
    { name: "Loop", count: 1 },
    { name: "OneNote", count: 1 },
];

export const MONTH_LABELS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export const DUMMY_SAR_TREND_DATA = [
    { name: "Oct", sar: 40.5 },
    { name: "Nov", sar: 44.2 },
    { name: "Dec", sar: 48.8 },
    { name: "Jan", sar: 53.0 },
    { name: "Feb", sar: 58.5 },
    { name: "Mar", sar: 64.0 },
];

/** Active user trend capped at DEMO_ACTIVE_USERS (9). */
export const DUMMY_USAGE_TREND_DATA = [
    { date: "2025-10-08", activeUserCount: 4 },
    { date: "2025-10-15", activeUserCount: 4 },
    { date: "2025-11-05", activeUserCount: 5 },
    { date: "2025-11-18", activeUserCount: 5 },
    { date: "2025-12-03", activeUserCount: 6 },
    { date: "2025-12-16", activeUserCount: 6 },
    { date: "2026-01-07", activeUserCount: 7 },
    { date: "2026-01-21", activeUserCount: 7 },
    { date: "2026-02-04", activeUserCount: 8 },
    { date: "2026-02-18", activeUserCount: 8 },
    { date: "2026-03-04", activeUserCount: 9 },
    { date: "2026-03-11", activeUserCount: 9 },
    { date: "2026-03-18", activeUserCount: 9 },
];

export const DUMMY_CPV_TREND_DATA = [
    { name: "Oct", cpv: 52.5, targetCPV: 55.0 },
    { name: "Nov", cpv: 49.2, targetCPV: 50.0 },
    { name: "Dec", cpv: 47.8, targetCPV: 48.0 },
    { name: "Jan", cpv: 45.0, targetCPV: 46.0 },
    { name: "Feb", cpv: 43.6, targetCPV: 44.0 },
    { name: "Mar", cpv: 42.2, targetCPV: 42.0 },
];

/** Department headcount sums to DEMO_ACTIVE_USERS (9). */
export const DUMMY_DEPARTMENTS_DATA = [
    { name: "Engineering", y: 3, color: "#7dd3fc" },
    { name: "Sales", y: 2, color: "#86efac" },
    { name: "Marketing", y: 2, color: "#f9a8d4" },
    { name: "Operations", y: 1, color: "#a78bfa" },
    { name: "Finance", y: 1, color: "#fdba74" },
];

/** Weekly total interactions = 18 (~9/44 of prior 88); daily active ≤ DEMO_ACTIVE_USERS. */
export const DUMMY_DAILY_USAGE_PATTERN_DATA = [
    { dayOfWeek: "Sunday", dayOfWeekNumber: 1, totalInteractions: 1, activeUserCount: 1, sar: 51.85, handoffRate: 33.33 },
    { dayOfWeek: "Monday", dayOfWeekNumber: 2, totalInteractions: 4, activeUserCount: 6, sar: 59.03, handoffRate: 16.67 },
    { dayOfWeek: "Tuesday", dayOfWeekNumber: 3, totalInteractions: 4, activeUserCount: 7, sar: 58.97, handoffRate: 15.38 },
    { dayOfWeek: "Wednesday", dayOfWeekNumber: 4, totalInteractions: 3, activeUserCount: 6, sar: 58.67, handoffRate: 20.0 },
    { dayOfWeek: "Thursday", dayOfWeekNumber: 5, totalInteractions: 3, activeUserCount: 6, sar: 59.09, handoffRate: 18.18 },
    { dayOfWeek: "Friday", dayOfWeekNumber: 6, totalInteractions: 2, activeUserCount: 4, sar: 54.17, handoffRate: 25.0 },
    { dayOfWeek: "Saturday", dayOfWeekNumber: 7, totalInteractions: 1, activeUserCount: 1, sar: 50.0, handoffRate: 40.0 },
];
