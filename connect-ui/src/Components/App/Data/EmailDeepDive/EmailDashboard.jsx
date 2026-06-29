import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, ScanSearch, ArrowRight } from "lucide-react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { cloudImageMapper, getCloudName, getRandomArray } from "../../../helpers/helpers";
import { getEmailSprawlInfo, runScanContentSprawl } from "../DataDashboardActions";
import RunScanContentSprawlPopup from "../RunScanContentSprawlPopup";
import "../DataDashboard.css";

const EMAIL_VENDORS = ["GMAIL", "OUTLOOK", "MICROSOFT_OFFICE_365"];

const formatCount = (n) => {
    const val = Number(n);
    if (Number.isNaN(val)) return "0";
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return String(val);
};

const isCompleted = (row) => (row.processStatus || "").toUpperCase() === "COMPLETED";

const EmailDashboard = () => {
    const navigate = useNavigate();
    const [platformData, setPlatformData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [runScanPopupOpen, setRunScanPopupOpen] = useState(false);
    const [pagination, setPagination] = useState({
        pageNo: 1,
        pageSize: 100,
        totalDocuments: 0,
        totalPages: 1,
    });

    const [selectedIds, setSelectedIds] = useState(new Set());

    const completedRows = useMemo(() => platformData.filter(isCompleted), [platformData]);
    const allCompletedSelected =
        completedRows.length > 0 && completedRows.every((r) => selectedIds.has(r.id));
    const someSelected = selectedIds.size > 0;

    const fetchData = async (pageNo = pagination.pageNo, pageSize = pagination.pageSize) => {
        setIsLoading(true);
        const res = await getEmailSprawlInfo(true, pageNo, pageSize);
        if (res?.status === "OK") {
            const payload = res?.res ?? {};
            setPlatformData(payload?.data ?? []);
            setPagination({
                pageNo,
                pageSize,
                totalDocuments: payload?.totalDocuments ?? 0,
                totalPages: Math.ceil((payload?.totalDocuments ?? 0) / pageSize) || 1,
            });
        } else {
            setPlatformData([]);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const aggregates = useMemo(() => {
        const data = platformData || [];
        const totalAccounts = data.length;
        const totalEmails = data.reduce((s, i) => s + (i.totalEmailCount ?? i.emailCount ?? i.messageCount ?? 0), 0);
        const totalFolders = data.reduce(
            (s, i) =>
                s +
                (
                    i.totalFilesFolder ??
                    i.folderCount ??
                    (i.inboxCount ?? 0) +
                    (i.sentCount ?? 0) +
                    (i.draftCount ?? 0) +
                    (i.trashCount ?? 0) +
                    (i.archiveCount ?? 0) +
                    (i.customLabelCount ?? 0)
                ),
            0
        );
        const totalCalendars = data.reduce((s, i) => s + (i.totalCalendarsCount ?? 0), 0);
        const totalCalendarEvents = data.reduce((s, i) => s + (i.totalCalendarEventsCount ?? 0), 0);
        const totalContacts = data.reduce((s, i) => s + (i.totalContactsCount ?? 0), 0);
        return { totalAccounts, totalEmails, totalFolders, totalCalendars, totalCalendarEvents, totalContacts };
    }, [platformData]);

    const lastScanFormatted = useMemo(() => {
        const latest = (platformData || []).reduce((best, p) => {
            const t = p?.modifiedTime ? new Date(p.modifiedTime).getTime() : 0;
            return t > (best ? new Date(best).getTime() : 0) ? p.modifiedTime : best;
        }, null);
        return latest
            ? new Date(latest).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
            })
            : "—";
    }, [platformData]);

    const handleRowClick = (row) => {
        localStorage.setItem("emailSprawl_" + row.id, JSON.stringify(row));
        navigate(`/Emails/${row.id}`, {
            state: { platform: { ...row, platform: getCloudName(row.vendorName) || row.vendorName } },
        });
    };

    const handleCheckboxChange = (e, row) => {
        e.stopPropagation();
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(row.id) ? next.delete(row.id) : next.add(row.id);
            return next;
        });
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(new Set(completedRows.map((r) => r.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleInitiateMigration = () => {
        const selected = platformData.filter((r) => selectedIds.has(r.id));
        navigate("/Migrations/Email", { state: { preSelectedUsers: selected } });
    };

    const handlePagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") {
            fetchData(1, +value);
        } else if (name === "pageNo") {
            fetchData(+value, pagination.pageSize);
        }
    };

    const handleRefresh = () => {
        if (isLoading) return;
        setSelectedIds(new Set());
        fetchData(pagination.pageNo, pagination.pageSize);
    };

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data" subMenuActive="Email Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Email Sprawl" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
                >
                    {/* Header */}
                    <header className="data-sprawl-header">
                        <div className="data-sprawl-header__left">
                            <h1 className="data-sprawl-header__title">Email Sprawl</h1>
                            <p className="data-sprawl-header__subtitle">
                                Last scan: {lastScanFormatted}
                            </p>
                        </div>
                        <div className="data-sprawl-header__right" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            {someSelected && (
                                <ActionButton
                                    buttonType="button"
                                    buttonClickAction={handleInitiateMigration}
                                    customClass="data-sprawl-header__btn data-sprawl-header__btn--primary"
                                    title="Initiate Migration"
                                    style={{ background: "#0062ff", borderColor: "#0062ff" }}
                                >
                                    <ArrowRight size={18} />
                                    Initiate Migration ({selectedIds.size})
                                </ActionButton>
                            )}
                            <ActionButton
                                buttonType="button"
                                buttonClickAction={() => setRunScanPopupOpen(true)}
                                customClass="data-sprawl-header__btn data-sprawl-header__btn--primary"
                                title="Run Scan"
                            >
                                <ScanSearch size={18} />
                                Run Scan
                            </ActionButton>
                        </div>
                    </header>

                    <RunScanContentSprawlPopup
                        isOpen={runScanPopupOpen}
                        setIsOpen={setRunScanPopupOpen}
                        pageSize={pagination.pageSize}
                        onScanSuccess={() => fetchData(1, 100)}
                        dataSprawl="EMAIL"
                    />

                    {/* Stat cards */}
                    <div className="data-dashboard">
                        <div className="data-dashboard__grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Total Emails</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalEmails)}</div>
                                </div>
                            </div>
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Total Folders</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalFolders)}</div>
                                </div>
                            </div>
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Calendars</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalCalendars)}</div>
                                </div>
                            </div>
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Calendar Events</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalCalendarEvents)}</div>
                                </div>
                            </div>
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Contacts</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalContacts)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Platform table */}
                    <div className="data-dashboard__comparison-card">
                        <div className="data-dashboard__comparison-header">
                            <h2 className="data-dashboard__comparison-title">Email Platforms</h2>
                            <button
                                type="button"
                                className={`data-dashboard__view-risks${isLoading ? " data-dashboard__view-risks--loading" : ""}`}
                                onClick={handleRefresh}
                                disabled={isLoading}
                                title="Refresh"
                                aria-label="Refresh email platforms"
                            >
                                <RefreshCw size={16} aria-hidden />
                                <span>Refresh</span>
                            </button>
                        </div>
                        <div className="data-dashboard__comparison-table-wrap">
                            <table className="data-dashboard__comparison-table">
                                <thead>
                                    <tr>
                                        {/* <th style={{ width: "40px" }}>
                                            <input
                                                type="checkbox"
                                                checked={allCompletedSelected}
                                                onChange={handleSelectAll}
                                                disabled={completedRows.length === 0}
                                                title="Select all completed"
                                                style={{ cursor: "pointer" }}
                                            />
                                        </th> */}
                                        <th></th>
                                        <th>Email</th>
                                        <th>Total Emails</th>
                                        <th>Folders</th>
                                        <th>Calendars</th>
                                        <th>Calendar Events</th>
                                        <th>Contacts</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr>
                                            <td colSpan={9} className="data-dashboard__empty-row">{getCFTextLoader()}</td>
                                        </tr>
                                    ) : platformData.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="data-dashboard__empty-row">No email platforms found.</td>
                                        </tr>
                                    ) : (
                                        platformData.map((row) => {
                                            const completed = isCompleted(row);
                                            const checked = selectedIds.has(row.id);
                                            return (
                                                <tr
                                                    key={row.id}
                                                    className="CF_Pointer"
                                                    onClick={() => handleRowClick(row)}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => e.key === "Enter" && handleRowClick(row)}
                                                    style={checked ? { background: "rgba(0,98,255,0.05)" } : {}}
                                                >
                                                    {/* <td onClick={(e) => e.stopPropagation()} style={{ width: "40px" }}>
                                                        {completed && (
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(e) => handleCheckboxChange(e, row)}
                                                                style={{ cursor: "pointer" }}
                                                            />
                                                        )}
                                                    </td> */}
                                                    <td className="data-dashboard__platform-icon-cell">
                                                        <img
                                                            src={cloudImageMapper(row.vendorName)}
                                                            alt={getCloudName(row.vendorName) || row.vendorName}
                                                            className="data-dashboard__platform-icon"
                                                        />
                                                    </td>
                                                    <td className="data-dashboard__email-cell">{row.email ?? "—"}</td>
                                                    <td>{formatCount(row.totalEmailCount ?? row.emailCount ?? row.messageCount ?? 0)}</td>
                                                    <td>
                                                        {formatCount(
                                                            row.totalFilesFolder ??
                                                            row.folderCount ??
                                                            (row.inboxCount ?? 0) +
                                                            (row.sentCount ?? 0) +
                                                            (row.draftCount ?? 0) +
                                                            (row.trashCount ?? 0) +
                                                            (row.archiveCount ?? 0) +
                                                            (row.customLabelCount ?? 0)
                                                        )}
                                                    </td>
                                                    <td>{formatCount(row.totalCalendarsCount ?? 0)}</td>
                                                    <td>{formatCount(row.totalCalendarEventsCount ?? 0)}</td>
                                                    <td>{formatCount(row.totalContactsCount ?? 0)}</td>
                                                    <td>
                                                        <span className={`data-dashboard__status-pill data-dashboard__status-pill--${(row.processStatus || "").toLowerCase()}`}>
                                                            {getCloudName(row.processStatus || "—")}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="cf_new_tables_footer" style={{ border: "0", borderTop: "1px solid #e0e0e0" }}>
                            <span>Total: {pagination.totalDocuments}</span>
                            <span style={{ marginLeft: "auto" }} />
                            <span style={{ opacity: "0.5" }}>
                                Showing {pagination.pageNo} of {pagination.totalPages || 1} Page
                            </span>
                            <span>
                                Showing :{" "}
                                <select
                                    className="cf_message_pagination_select"
                                    name="pageSize"
                                    value={pagination.pageSize}
                                    onChange={handlePagination}
                                >
                                    <option value="100">100</option>
                                    <option value="200">200</option>
                                    <option value="300">300</option>
                                    <option value="500">500</option>
                                </select>
                                &nbsp;Rows
                            </span>
                            <span>
                                Go to:{" "}
                                <select
                                    className="cf_message_pagination_select"
                                    name="pageNo"
                                    value={pagination.pageNo}
                                    onChange={handlePagination}
                                >
                                    {getRandomArray(pagination.totalPages || 1)?.map((data) => (
                                        <option value={data} key={`${data}_EDB`}>{data}</option>
                                    ))}
                                </select>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailDashboard;
