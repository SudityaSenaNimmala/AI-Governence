import React, { useCallback, useMemo, useRef, useState } from "react";
import "./DataDashboard.css";
import { getCloudName, getFileIconsNew } from "../../helpers/helpers";
import { getSizeFormatted } from "../../helpers/utils";
import { FaFileAlt } from "react-icons/fa";
import DisplayDuplicates from "./DataDeepDrive/DisplayDuplicates";
import { SENSITIVE_CONTENT_CATEGORIES } from "./DataDashboardDummyData";
import Popup from "../../Resuables/Popup/Popup";

const SENSITIVE_LOADING_DELAY_MS = 800;

const clampScore = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

const getReadinessStatus = (score) => {
    if (score >= 80) return { label: "Good", variant: "good" };
    if (score >= 50) return { label: "Review", variant: "review" };
    return { label: "At Risk", variant: "risk" };
};

const READINESS_VARIANT_COLORS = {
    good: { bar: "#16a34a", ring: "#22c55e" },
    review: { bar: "#d97706", ring: "#f59e0b" },
    risk: { bar: "#dc2626", ring: "#ef4444" },
};

const ReadinessCategoryRow = ({ title, description, score }) => {
    const { label, variant } = getReadinessStatus(score);
    const colors = READINESS_VARIANT_COLORS[variant];
    return (
        <div className="data-dashboard__readiness-row">
            <div className="data-dashboard__readiness-donut-wrap" aria-hidden>
                <div
                    className="data-dashboard__readiness-donut"
                    style={{
                        background: `conic-gradient(${colors.ring} ${score}%, #e5e7eb 0)`,
                    }}
                >
                    <div className="data-dashboard__readiness-donut-inner">
                        <span className="data-dashboard__readiness-donut-score">{score}</span>
                        <span className="data-dashboard__readiness-donut-status" style={{ color: colors.bar }}>
                            {label}
                        </span>
                    </div>
                </div>
            </div>
            <div className="data-dashboard__readiness-row-body">
                <div className="data-dashboard__readiness-row-title">{title}</div>
                <p className="data-dashboard__readiness-row-desc">{description}</p>
                <div className="data-dashboard__readiness-bar-track">
                    <div
                        className="data-dashboard__readiness-bar-fill"
                        style={{ width: `${score}%`, backgroundColor: colors.bar }}
                    />
                </div>
            </div>
        </div>
    );
};

const getRelativeImageForSensitive = (action, row) => {
    const actionLower = (action || "").toLowerCase();
    const displayName = row?.displayName || row?.name || "—";
    if (actionLower === "folder") {
        return <img src={getFileIconsNew(displayName, "folder")} alt="" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
    }
    return <img src={getFileIconsNew(displayName)} alt="" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
};

const DataDashboardTop = ({ platformData = [], totalDocuments = 0 }) => {
    const [sensitivePopupOpen, setSensitivePopupOpen] = useState(false);
    const [sensitiveLoading, setSensitiveLoading] = useState(false);
    const [sensitivePopupData, setSensitivePopupData] = useState({ data: [], totalDocuments: 0 });
    const [selectedSensitiveCategory, setSelectedSensitiveCategory] = useState(null);
    const [readinessPopupOpen, setReadinessPopupOpen] = useState(false);
    const sensitiveLoadTimerRef = useRef(null);
    const aggregates = useMemo(() => {
        const totalPublicLinks = (platformData || []).reduce((s, i) => s + (i.publicLinkCount ?? 0), 0);
        const totalExternal = (platformData || []).reduce((s, i) => s + (i.externalCount ?? 0), 0);
        const total90 = (platformData || []).reduce((s, i) => s + (i.filesCount90days ?? 0), 0);
        const total180 = (platformData || []).reduce((s, i) => s + (i.filesCount180days ?? 0), 0);
        const total365 = (platformData || []).reduce((s, i) => s + (i.filesCount365days ?? 0), 0);
        const totalVersionSize = (platformData || []).reduce((s, i) => s + (i.totalVersionSize ?? 0), 0);
        const totalSize = (platformData || []).reduce((s, i) => s + (i.totalSize ?? 0), 0);
        const totalDuplicates = (platformData || []).reduce(
            (s, i) => s + (i.duplicateCount ?? i.duplicatesCount ?? 0),
            0
        );
        const maxFiles = (platformData || []).reduce((s, i) => s + (i.totalFilesFolder ?? 0), 0);
        // const maxFiles = i.totalFilesFolder ? i.totalFilesFolder : Math.max(total90, total180, total365, 1);
        const uniqueVendors = [...new Set((platformData || []).map((i) => i.vendorName).filter(Boolean))];
        return { totalPublicLinks, totalExternal, total90, total180, total365, totalVersionSize, totalSize, totalDuplicates, maxFiles, uniqueVendors };
    }, [platformData]);

    const readinessTenantLabel = useMemo(() => {
        const email = (platformData || []).find((p) => p?.email)?.email;
        if (email && typeof email === "string" && email.includes("@")) {
            return `${email.split("@")[1]} tenant`;
        }
        return "All connected accounts";
    }, [platformData]);

    const readinessByCategoryRows = useMemo(() => {
        const m = Math.max(aggregates.maxFiles, 1);
        const risk = aggregates.totalExternal + aggregates.totalPublicLinks;
        const staleWeight = (aggregates.total90 + aggregates.total180 + aggregates.total365) / m;
        const identityScore = clampScore(92 - risk / 60, 55, 95);
        const unclassified = Math.max(50, Math.min(99999, Math.round(m * 0.05)));
        const dataClassScore = clampScore(68 - staleWeight * 25 - aggregates.totalDuplicates / (m * 0.02 + 1), 38, 88);
        const externalScore = clampScore(76 - (aggregates.totalExternal / m) * 4000 - risk / 120, 32, 90);
        const highRiskFlag = Math.max(0, Math.round(risk / 25));
        const stalePermScore = clampScore(58 - staleWeight * 45, 28, 85);
        const excessUsers = Math.min(200, Math.round(aggregates.total90 + aggregates.totalExternal * 0.5 + 20));
        const licenseScore = clampScore(86 - risk / 90 - aggregates.totalDuplicates / (m * 0.03 + 1), 58, 94);
        const aiAgentsScore = clampScore(72 - (aggregates.totalExternal / m) * 3500 - risk / 100, 40, 88);

        return [
            {
                id: "data",
                title: "Data Classification",
                // description: `${unclassified} unclassified sensitive documents detected`,
                description: `132 unclassified sensitive documents detected`,
                // score: dataClassScore,
                score: dataClassScore,
            },
            {
                id: "external",
                title: "External Sharing",
                description: `${aggregates.totalExternal} files shared externally, ${highRiskFlag} flagged high-risk`,
                score: externalScore,
            },
            {
                id: "stale",
                title: "Stale Permissions",
                description: `${excessUsers} users with excessive SharePoint access`,
                score: stalePermScore,
            },
            {
                id: "license",
                title: "License Assignment",
                description: "AI licenses assigned to active users",
                score: licenseScore,
            },

        ];
    }, [aggregates]);

    const aiReadinessScore = useMemo(() => {
        if (!readinessByCategoryRows.length) return 0;
        return Math.round(
            readinessByCategoryRows.reduce((sum, row) => sum + row.score, 0) / readinessByCategoryRows.length
        );
    }, [readinessByCategoryRows]);

    const formatCount = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

    const handleSensitiveCategoryClick = useCallback((cat) => {
        if (sensitiveLoadTimerRef.current) clearTimeout(sensitiveLoadTimerRef.current);
        setSelectedSensitiveCategory(cat.key);
        setSensitivePopupOpen(true);
        setSensitiveLoading(true);
        setSensitivePopupData({ data: [], totalDocuments: 0 });
        const fileNames = cat.fileNames || [];
        sensitiveLoadTimerRef.current = setTimeout(() => {
            const data = fileNames.map((name, i) => ({
                id: `sensitive-${cat.key}-${i}`,
                name,
                displayName: name,
                fileSize: null,
                modifiedDate: null,
                path: "",
                type: "FILE",
            }));
            setSensitivePopupData({ data, totalDocuments: data.length });
            setSensitiveLoading(false);
            sensitiveLoadTimerRef.current = null;
        }, SENSITIVE_LOADING_DELAY_MS);
    }, []);

    const handleCloseSensitivePopup = useCallback(() => {
        if (sensitiveLoadTimerRef.current) {
            clearTimeout(sensitiveLoadTimerRef.current);
            sensitiveLoadTimerRef.current = null;
        }
        setSensitivePopupOpen(false);
        setSelectedSensitiveCategory(null);
        setSensitivePopupData({ data: [], totalDocuments: 0 });
        setSensitiveLoading(false);
    }, []);

    return (
        <div className="data-dashboard">
            <div className="data-dashboard__grid">
                {/* Content Health Score */}
                {window.location.host?.includes("sales") && <div className="data-dashboard__card data-dashboard__card--clickable">
                    <div
                        className="data-dashboard__card-inner data-dashboard__card--health"
                        role="button"
                        tabIndex={0}
                        onClick={() => setReadinessPopupOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setReadinessPopupOpen(true);
                            }
                        }}
                        title="View readiness by category"
                    >
                        <div className="data-dashboard__health-circle-wrap">
                            <div
                                className="data-dashboard__health-circle"
                                style={{ "--progress": aggregates?.maxFiles ? aiReadinessScore : 0 }}
                            />
                            <div className="data-dashboard__health-value">
                                <span className="data-dashboard__health-number">
                                    {aggregates?.maxFiles ? aiReadinessScore : 0}
                                </span>
                                <span className="data-dashboard__health-max">/100</span>
                            </div>
                        </div>
                        <div className="data-dashboard__health-label">
                            <div className="data-dashboard__card-title">AI Readiness Score</div>
                            <div className="data-dashboard__card-subtitle">Target: 85+ for safe rollout</div>
                        </div>
                    </div>
                </div>}
                {/* <div className="data-dashboard__card-subtitle">Across all connected platforms</div> */}
                {/* <p className="data-dashboard__health-target">
                            Target: 85+ for safe rollout
                        </p> */}

                {/* Total Files Scanned */}
                <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner">
                        <div className="data-dashboard__card-title data-dashboard__card-title--small">Total Files Scanned</div>
                        <div className="data-dashboard__big-number">{formatCount(aggregates.maxFiles)} <span style={{ fontSize: "12px", color: "#4b5563", fontWeight: "500" }}>({getSizeFormatted(aggregates.totalSize)})</span></div>
                        <div className="data-dashboard__pills">
                            {aggregates.uniqueVendors.map((vendor) => (
                                <span key={vendor} className="data-dashboard__pill">{getCloudName(vendor) || vendor}</span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Active Risks */}
                <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner">
                        <div className="data-dashboard__risks-header">
                            <span className="data-dashboard__card-title data-dashboard__card-title--small">Active Risks</span>
                            <span className="data-dashboard__risk-badge">{aggregates.totalPublicLinks + aggregates.totalExternal}</span>
                        </div>
                        <div className="data-dashboard__big-number data-dashboard__big-number--red">{aggregates.totalPublicLinks + aggregates.totalExternal}</div>
                        <div className="data-dashboard__risk-list">
                            <div className="data-dashboard__risk-item">
                                <span className="data-dashboard__risk-icon" aria-hidden>🔗</span>
                                <span>Public Links</span>
                                <span className="data-dashboard__risk-count">{aggregates.totalPublicLinks}</span>
                            </div>
                            <div className="data-dashboard__risk-item">
                                <span className="data-dashboard__risk-icon" aria-hidden>↗</span>
                                <span>External Shares</span>
                                <span className="data-dashboard__risk-count">{aggregates.totalExternal}</span>
                            </div>
                            {/* <div className="data-dashboard__risk-item">
                                <span className="data-dashboard__risk-icon" aria-hidden>📄</span>
                                <span>Sensitive Files</span>
                                <span className="data-dashboard__risk-count">5</span>
                            </div> */}
                        </div>
                    </div>
                </div>

                {/* Stale & Orphaned Content */}
                {/* <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner">
                        <div className="data-dashboard__card-title data-dashboard__card-title--small">Stale Content</div>
                        <div className="data-dashboard__bars">
                            <div className="data-dashboard__bar-row">
                                <span className="data-dashboard__bar-label">90 days</span>
                                <div className="data-dashboard__bar-track">
                                    <div className="data-dashboard__bar-fill" style={{ width: `${Math.min(100, (aggregates.total90 / aggregates.maxFiles) * 100)}%` }} />
                                </div>
                                <span className="data-dashboard__bar-value">{aggregates.total90}</span>
                            </div>
                            <div className="data-dashboard__bar-row">
                                <span className="data-dashboard__bar-label">180 days</span>
                                <div className="data-dashboard__bar-track">
                                    <div className="data-dashboard__bar-fill" style={{ width: `${Math.min(100, (aggregates.total180 / aggregates.maxFiles) * 100)}%` }} />
                                </div>
                                <span className="data-dashboard__bar-value">{aggregates.total180}</span>
                            </div>
                            <div className="data-dashboard__bar-row">
                                <span className="data-dashboard__bar-label">365 days</span>
                                <div className="data-dashboard__bar-track">
                                    <div className="data-dashboard__bar-fill" style={{ width: `${Math.min(100, (aggregates.total365 / aggregates.maxFiles) * 100)}%` }} />
                                </div>
                                <span className="data-dashboard__bar-value">{aggregates.total365}</span>
                            </div>
                        </div>
                    </div>
                </div> */}

                {/* <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner">
                        <div className="data-dashboard__risks-header">
                            <span className="data-dashboard__card-title data-dashboard__card-title--small">Data Size</span>
                        </div>
                        <div className="data-dashboard__big-number">{getSizeFormatted(aggregates.totalSize)}</div>
                        <div className="data-dashboard__risk-list">
                            <div className="data-dashboard__risk-item" />
                            <div className="data-dashboard__risk-item" />
                            <div className="data-dashboard__risk-item" />
                            <div className="data-dashboard__risk-item" />
                            <div className="data-dashboard__risk-item">
                                <span>Versions Size</span>
                                <span className="data-dashboard__risk-count">{getSizeFormatted(aggregates.totalVersionSize)}</span>
                            </div>
                        </div>
                    </div>
                </div> */}

                {/* Duplicate Files */}
                <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner data-dashboard__card--duplicates">
                        <div className="data-dashboard__card-title data-dashboard__card-title--small">Duplicate Files</div>
                        <div className="data-dashboard__dup-left">
                            <div className="data-dashboard__dup-circle-wrap">
                                <div
                                    className="data-dashboard__dup-circle"
                                    style={{ "--progress": (aggregates.totalDuplicates / aggregates.maxFiles) * 100 }}
                                />
                            </div>
                            <div className="data-dashboard__dup-stats">
                                <div className="data-dashboard__dup-number">{formatCount(aggregates.totalDuplicates)}</div>
                                <div className="data-dashboard__dup-sub">{totalDocuments} connected account{totalDocuments !== 1 ? "s" : ""}</div>
                            </div>
                        </div>
                        {/* <button type="button" className="data-dashboard__btn data-dashboard__btn--review">
                            <span className="data-dashboard__btn-icon" aria-hidden>📋</span>
                            Review Duplicates
                        </button> */}
                    </div>
                </div>

                {/* Sensitive Content */}
                {window.location.host?.includes("sales") && <div className="data-dashboard__card">
                    <div className="data-dashboard__card-inner">
                        <div className="data-dashboard__card-title data-dashboard__card-title--small">Sensitive Content</div>
                        <div className="data-dashboard__sensitive-list">
                            {SENSITIVE_CONTENT_CATEGORIES.map((cat) => (
                                <div
                                    key={cat.key}
                                    className="data-dashboard__sensitive-item data-dashboard__sensitive-item--clickable"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleSensitiveCategoryClick(cat)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSensitiveCategoryClick(cat)}
                                >
                                    <span className={`data-dashboard__sensitive-dot data-dashboard__sensitive-dot--${cat.dotVariant}`} />
                                    <span>{cat.key}</span>
                                    <span className="data-dashboard__sensitive-count">{cat.count}</span>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>}

                {/* Risk by Content Category */}
                {window.location.host?.includes("sales") && <div className="data-dashboard__card data-dashboard__card--risk-category">
                    <div className="data-dashboard__card-inner data-dashboard__card-inner--risk-category">
                        <h3 className="data-dashboard__risk-category-title">Risk by Content Category</h3>
                        <div className="data-dashboard__risk-category-list">
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">HR Documents</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--critical" style={{ width: "95%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--critical">Critical</span>
                            </div>
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">Finance / M&A</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--critical" style={{ width: "80%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--critical">Critical</span>
                            </div>
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">Legal Contracts</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--high" style={{ width: "65%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--high">High</span>
                            </div>
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">Customer PII</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--high" style={{ width: "60%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--high">High</span>
                            </div>
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">IT Config / Keys</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--medium" style={{ width: "45%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--medium">Medium</span>
                            </div>
                            <div className="data-dashboard__risk-category-row">
                                <span className="data-dashboard__risk-category-label">General Content</span>
                                <div className="data-dashboard__risk-category-bar-track">
                                    <div className="data-dashboard__risk-category-bar-fill data-dashboard__risk-category-bar-fill--low" style={{ width: "15%" }} />
                                </div>
                                <span className="data-dashboard__risk-category-level data-dashboard__risk-category-level--low">Low</span>
                            </div>
                        </div>
                    </div>
                </div>}

                {/* Active Enforcement Policies */}
                {/* <div className="data-dashboard__card data-dashboard__card--policies">
                    <div className="data-dashboard__card-inner data-dashboard__card-inner--policies">
                        <h3 className="data-dashboard__policies-title">Active Enforcement Policies</h3>
                        <div className="data-dashboard__policies-table-wrap">
                            <table className="data-dashboard__policies-table">
                                <thead>
                                    <tr>
                                        <th className="data-dashboard__policies-th data-dashboard__policies-th--policy">Policy</th>
                                        <th className="data-dashboard__policies-th data-dashboard__policies-th--scope">Scope</th>
                                        <th className="data-dashboard__policies-th data-dashboard__policies-th--status">Status</th>
                                        <th className="data-dashboard__policies-th data-dashboard__policies-th--last">Last Run</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--policy">No external sharing — HR & Legal</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--scope">Box Business</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--status">
                                            <span className="data-dashboard__status-badge data-dashboard__status-badge--active">Active</span>
                                        </td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--last">2h ago</td>
                                    </tr>
                                    <tr>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--policy">Sensitivity labels on financial docs</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--scope">Microsoft 365</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--status">
                                            <span className="data-dashboard__status-badge data-dashboard__status-badge--active">Active</span>
                                        </td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--last">4h ago</td>
                                    </tr>
                                    <tr>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--policy">Revoke Everyone links on creation</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--scope">Microsoft 365</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--status">
                                            <span className="data-dashboard__status-badge data-dashboard__status-badge--active">Active</span>
                                        </td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--last">Continuous</td>
                                    </tr>
                                    <tr>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--policy">90-day stale access revocation</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--scope">Google Workspace</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--status">
                                            <span className="data-dashboard__status-badge data-dashboard__status-badge--active">Active</span>
                                        </td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--last">Daily</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div> */}
                {/* <tr>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--policy">Guest access review — quarterly</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--scope">Teams</td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--status">
                                            <span className="data-dashboard__status-badge data-dashboard__status-badge--scheduled">Scheduled</span>
                                        </td>
                                        <td className="data-dashboard__policies-td data-dashboard__policies-td--last">Mar 31</td>
                                    </tr> */}

            </div>

            <DisplayDuplicates
                isOpen={sensitivePopupOpen}
                onClose={handleCloseSensitivePopup}
                duplicatesData={sensitivePopupData}
                getRelativeImage={getRelativeImageForSensitive}
                isLoading={sensitiveLoading}
                user={selectedSensitiveCategory || "Sensitive"}
                type="sensitive"
            />

            <Popup
                toggleOpen={() => setReadinessPopupOpen(false)}
                options={{
                    isOpen: readinessPopupOpen,
                    title: "Readiness by Category",
                    subTitle: "",
                    popupTop: "100px",
                    popupWidth: "min(520px, 96vw)",
                    popupHeight: "auto",
                    customStyles: {
                        minHeight: "300px",
                        height: "450px",
                        overflowY: "auto",
                    },
                }}
            >
                <div className="data-dashboard__readiness-popup-body">
                    {/* <p className="data-dashboard__readiness-popup-tenant">{readinessTenantLabel}</p> */}
                    <div className="data-dashboard__readiness-list">
                        {readinessByCategoryRows.map((row) => (
                            <ReadinessCategoryRow
                                key={row.id}
                                title={row.title}
                                description={row.description}
                                score={row.score}
                            />
                        ))}
                    </div>
                </div>
            </Popup>
        </div>
    );
};

export default DataDashboardTop;
