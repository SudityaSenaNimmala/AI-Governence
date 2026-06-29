import { CalendarDays, ChevronDown, ChevronRight, Contact, Folder, FolderOpen } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { globalDebounce } from "../../../helpers/utils";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getContentSprawlEmails } from "../DataDashboardActions";
import "../DataDeepDrive/DataDeepDrive.css";

const PAGE_SIZE = 50;
const FOLDER_COL_COUNT = 2;
const CALENDAR_COL_COUNT = 2;

const TABS = [
    { key: "FOLDERS", value: "Folders", icon: Folder },
    { key: "CALENDARS", value: "Calendars", icon: CalendarDays },
];

const formatCount = (n) => {
    const val = Number(n);
    if (Number.isNaN(val)) return "0";
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return String(val);
};

const EmailDeepDive = () => {
    const location = useLocation();
    const { contentSprawlId } = useParams();

    const [platform, setPlatform] = useState({});
    const [activeTab, setActiveTab] = useState(TABS[0]);

    // --- Folders state ---
    const [folderItems, setFolderItems] = useState([]);
    const [folderTotal, setFolderTotal] = useState(0);
    const [folderPageNo, setFolderPageNo] = useState(1);
    const [folderPageSize, setFolderPageSize] = useState(PAGE_SIZE);
    const [folderLoading, setFolderLoading] = useState(false);
    const [expanded, setExpanded] = useState(new Set());
    const [subFolderCache, setSubFolderCache] = useState({});
    const [folderSearch, setFolderSearch] = useState("");
    const debouncedFolderSearch = useMemo(() => globalDebounce((v) => setFolderSearch(v ?? ""), 300), []);

    // --- Calendars state ---
    const [calendarItems, setCalendarItems] = useState([]);
    const [calendarTotal, setCalendarTotal] = useState(0);
    const [calendarPageNo, setCalendarPageNo] = useState(1);
    const [calendarPageSize, setCalendarPageSize] = useState(PAGE_SIZE);
    const [calendarLoading, setCalendarLoading] = useState(false);

    useEffect(() => {
        const fromState = location.state?.platform;
        const fromStorage = (() => {
            try {
                const raw = localStorage.getItem("emailSprawl_" + contentSprawlId);
                return raw ? JSON.parse(raw) : null;
            } catch { return null; }
        })();
        const source = fromState || fromStorage;
        if (source) {
            setPlatform({
                email: source.email ?? "—",
                vendorName: source.vendorName ?? "OUTLOOK",
                lastScan: source.modifiedTime ? new Date(source.modifiedTime).toLocaleString() : "—",
                folderCount:
                    source.totalFilesFolder ??
                    source.folderCount ??
                    (source.inboxCount ?? 0) + (source.sentCount ?? 0) + (source.draftCount ?? 0) +
                    (source.trashCount ?? 0) + (source.archiveCount ?? 0) + (source.customLabelCount ?? 0),
                calendarCount: source.totalCalendarsCount ?? 0,
                calendarEventCount: source.totalCalendarEventsCount ?? 0,
                contactCount: source.totalContactsCount ?? 0,
            });
        }
    }, [contentSprawlId, location.state?.platform]);

    // ── Folders fetch ──
    const fetchFolders = useCallback(
        async (pg = 1, ps = folderPageSize) => {
            setFolderLoading(true);
            const res = await getContentSprawlEmails(contentSprawlId, {
                itemType: "FOLDER",
                parentId: "/",
                lastModifiedDateTime: "ALL",
                sortSize: "ALL",
                pageNo: pg,
                pageSize: ps,
                searchValue: folderSearch.trim() || null,
            });
            if (res?.status === "OK") {
                setFolderItems(res?.res?.data ?? []);
                if (pg === 1 && res?.res?.totalDocuments != null) setFolderTotal(res.res.totalDocuments);
            } else {
                setFolderItems([]);
            }
            setFolderLoading(false);
        },
        [contentSprawlId, folderPageSize, folderSearch]
    );

    useEffect(() => {
        if (!contentSprawlId) return;
        setFolderPageNo(1);
        fetchFolders(1, folderPageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentSprawlId, folderSearch]);

    // ── Calendars fetch ──
    const fetchCalendars = useCallback(
        async (pg = 1, ps = calendarPageSize) => {
            setCalendarLoading(true);
            const res = await getContentSprawlEmails(contentSprawlId, {
                itemType: "CALENDARS",
                lastModifiedDateTime: "ALL",
                sortSize: "ALL",
                pageNo: pg,
                pageSize: ps,
                searchValue: null,
            });
            if (res?.status === "OK") {
                setCalendarItems(res?.res?.data ?? []);
                if (pg === 1 && res?.res?.totalDocuments != null) setCalendarTotal(res.res.totalDocuments);
            } else {
                setCalendarItems([]);
            }
            setCalendarLoading(false);
        },
        [contentSprawlId, calendarPageSize]
    );

    useEffect(() => {
        if (!contentSprawlId || activeTab?.key !== "CALENDARS") return;
        setCalendarPageNo(1);
        fetchCalendars(1, calendarPageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentSprawlId, activeTab]);

    // ── Folder tree expand ──
    const toggleExpand = async (folderId) => {
        if (expanded.has(folderId)) {
            setExpanded((prev) => { const next = new Set(prev); next.delete(folderId); return next; });
            return;
        }
        setExpanded((prev) => new Set(prev).add(folderId));
        if (subFolderCache[folderId]) return;
        setSubFolderCache((prev) => ({ ...prev, [folderId]: { items: [], isLoading: true } }));
        const res = await getContentSprawlEmails(contentSprawlId, {
            itemType: "FOLDER",
            parentId: folderId,
            lastModifiedDateTime: "ALL",
            sortSize: "ALL",
            pageNo: 1,
            pageSize: 100,
            searchValue: null,
        });
        setSubFolderCache((prev) => ({
            ...prev,
            [folderId]: {
                items: res?.status === "OK" ? (res?.res?.data ?? []) : [],
                isLoading: false,
            },
        }));
    };

    const renderFolderRow = (item, level = 0) => {
        const folderId = item.folderId ?? item.id ?? item.displayId;
        const folderName = item.folderName || item.name || "—";
        const isExpandable = (item.childFolderCount ?? item.childCount ?? 1) > 0;
        const isOpen = expanded.has(folderId);
        const cache = subFolderCache[folderId];
        const isLoadingChildren = cache?.isLoading ?? false;
        const childItems = cache?.items ?? [];

        return (
            <React.Fragment key={folderId ?? `${level}-${folderName}`}>
                <tr className="deep-drive__table-row">
                    <td style={{ paddingLeft: 12 + level * 24 }}>
                        <span className="deep-drive__name-cell">
                            {isExpandable ? (
                                <button type="button" className="deep-drive__expand-btn" onClick={() => toggleExpand(folderId)} aria-expanded={isOpen}>
                                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </button>
                            ) : (
                                <span className="deep-drive__expand-placeholder" />
                            )}
                            {isOpen
                                ? <FolderOpen size={14} style={{ flexShrink: 0, color: "#0062ff" }} />
                                : <Folder size={14} style={{ flexShrink: 0, color: level === 0 ? "#0062ff" : "#8b93a7" }} />
                            }
                            <span className="deep-drive__name-text" title={folderName}>{folderName}</span>
                        </span>
                    </td>
                    <td style={{ fontSize: "13px", color: "#374151" }}>
                        {formatCount(item.totalCount ?? item.emailCount ?? 0)}
                    </td>
                </tr>
                {isExpandable && isOpen && isLoadingChildren && childItems.length === 0 && (
                    <tr className="deep-drive__table-row">
                        <td colSpan={FOLDER_COL_COUNT} style={{ paddingLeft: 12 + (level + 1) * 24 }}>
                            <span className="deep-drive__row-loading">{getCFTextLoader()}</span>
                        </td>
                    </tr>
                )}
                {isExpandable && isOpen && childItems.map((child) => renderFolderRow(child, level + 1))}
                {isExpandable && isOpen && isLoadingChildren && childItems.length > 0 && (
                    <tr className="deep-drive__table-row">
                        <td colSpan={FOLDER_COL_COUNT} style={{ paddingLeft: 12 + (level + 1) * 24 }}>
                            <span className="deep-drive__row-loading">{getCFTextLoader()}</span>
                        </td>
                    </tr>
                )}
                {isExpandable && isOpen && !isLoadingChildren && childItems.length === 0 && (
                    <tr className="deep-drive__table-row">
                        <td colSpan={FOLDER_COL_COUNT} style={{ paddingLeft: 12 + (level + 1) * 24, fontSize: "12px", color: "#9ca3af" }}>
                            No sub-folders
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    // ── Pagination handlers ──
    const handleFolderPagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") { setFolderPageSize(+value); setFolderPageNo(1); fetchFolders(1, +value); }
        else if (name === "pageNo") { setFolderPageNo(+value); fetchFolders(+value, folderPageSize); }
    };

    const handleCalendarPagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") { setCalendarPageSize(+value); setCalendarPageNo(1); fetchCalendars(1, +value); }
        else if (name === "pageNo") { setCalendarPageNo(+value); fetchCalendars(+value, calendarPageSize); }
    };

    const folderTotalPages = Math.ceil(folderTotal / folderPageSize) || 1;
    const calendarTotalPages = Math.ceil(calendarTotal / calendarPageSize) || 1;

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data Hub" subMenuActive="Email Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Email Deep Dive" backLink="/EmailSprawl" activeTab="Data" />
                <div className="cf_main_content_place_main deep-drive">

                    <header className="deep-drive__header">
                        <div className="deep-drive__header-left">
                            <div className="deep-drive__header-left-icon">
                                <img src={cloudImageMapper(platform?.vendorName)} alt={platform?.vendorName} style={{ width: "28px", height: "28px", objectFit: "contain" }} />
                            </div>
                            <div>
                                <h1 className="deep-drive__title">{platform.email}</h1>
                                <p className="deep-drive__subtitle">{getCloudName(platform?.vendorName)}</p>
                            </div>
                        </div>
                        <div className="deep-drive__header-right">
                            <span className="deep-drive__last-scan">Last scan: {platform.lastScan}</span>
                        </div>
                    </header>

                    {/* Stat cards */}
                    <div className="deep-drive__cards" style={{ marginTop: "20px", gridTemplateColumns: "repeat(3, 1fr)" }}>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">
                                <Folder size={13} style={{ marginRight: "5px", color: "#0062ff", verticalAlign: "middle" }} />
                                Folders
                            </span>
                            <span className="deep-drive__stat-value">{formatCount(platform.folderCount ?? 0)}</span>
                        </div>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">
                                <CalendarDays size={13} style={{ marginRight: "5px", color: "#0062ff", verticalAlign: "middle" }} />
                                Calendars
                            </span>
                            <span style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                                <span className="deep-drive__stat-value">{formatCount(platform.calendarCount ?? 0)}</span>
                                <span style={{ fontSize: "12px", color: "#001a6f", fontWeight: 600 }}>
                                    {formatCount(platform.calendarEventCount ?? 0)}
                                    <span style={{ fontSize: "11px", marginLeft: "3px" }}>events</span>
                                </span>
                            </span>
                        </div>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">
                                <Contact size={13} style={{ marginRight: "5px", color: "#0062ff", verticalAlign: "middle" }} />
                                Contacts
                            </span>
                            <span className="deep-drive__stat-value">{formatCount(platform.contactCount ?? 0)}</span>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div style={{ marginTop: "20px" }} className="CF_d-flex ai-center">
                        <div className="cf_fulltab_switcher">
                            {TABS.map((tab) => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.key}
                                        className={`cf_fulltab_switcher_button ${activeTab?.key === tab.key ? "cf_fulltab_switcher_button_active" : ""} ${tab.key}`}
                                        onClick={() => setActiveTab(tab)}
                                    >
                                        <div className="CF_d-flex ai-center" style={{ gap: "6px" }}>
                                            <Icon size={13} style={{ color: "inherit" }} />
                                            <p>{tab.value}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Folders tab ── */}
                    {activeTab?.key === "FOLDERS" && (
                        <>
                            <div className="deep-drive__toolbar CF_d-flex" style={{ marginTop: "16px", gap: "8px", flexWrap: "wrap" }}>
                                <SearchComponent
                                    autoOpen
                                    defaultVal={folderSearch}
                                    canResetDefaultVal
                                    inputPlaceHolder="Search folders..."
                                    onInputSearch={({ searchInput }) => debouncedFolderSearch(searchInput)}
                                    customStyles={{ minWidth: "220px" }}
                                />
                                <span style={{ marginLeft: "auto" }} />
                            </div>

                            <div className="deep-drive__table-card" style={{ marginTop: "12px" }}>
                                <table className="deep-drive__table" style={{ tableLayout: "fixed", width: "100%" }}>
                                    <colgroup>
                                        <col />
                                        <col style={{ width: "120px" }} />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th><span className="deep-drive__th-content">Folder Name</span></th>
                                            <th>Emails</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {folderLoading ? (
                                            <tr><td colSpan={FOLDER_COL_COUNT} className="deep-drive__loading-cell">{getCFTextLoader()}</td></tr>
                                        ) : folderItems.length === 0 ? (
                                            <tr><td colSpan={FOLDER_COL_COUNT} className="deep-drive__empty-cell">No folders found.</td></tr>
                                        ) : (
                                            folderItems.map((item) => renderFolderRow(item, 0))
                                        )}
                                    </tbody>
                                </table>

                                <div className="cf_new_tables_footer" style={{ border: "0", borderTop: "1px solid #e0e0e0" }}>
                                    <span>Total: {folderTotal}</span>
                                    <span style={{ marginLeft: "auto" }} />
                                    <span style={{ opacity: "0.5" }}>Showing {folderPageNo} of {folderTotalPages} Page</span>
                                    <span>
                                        Showing :{" "}
                                        <select className="cf_message_pagination_select" name="pageSize" value={folderPageSize} onChange={handleFolderPagination}>
                                            <option value="50">50</option>
                                            <option value="100">100</option>
                                            <option value="200">200</option>
                                            <option value="500">500</option>
                                        </select>
                                        &nbsp;Rows
                                    </span>
                                    <span>
                                        Go to :{" "}
                                        <select className="cf_message_pagination_select" name="pageNo" value={folderPageNo} onChange={handleFolderPagination}>
                                            {Array.from({ length: folderTotalPages }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>{i + 1}</option>
                                            ))}
                                        </select>
                                    </span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── Calendars tab ── */}
                    {activeTab?.key === "CALENDARS" && (
                        <div className="deep-drive__table-card" style={{ marginTop: "16px" }}>
                            <table className="deep-drive__table" style={{ tableLayout: "fixed", width: "100%" }}>
                                <colgroup>
                                    <col style={{ width: "50%" }} />
                                    <col style={{ width: "20%" }} />
                                    {/* <col /> */}
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th><span className="deep-drive__th-content">Calendar Name</span></th>
                                        <th>Events</th>
                                        {/* <th>Last Modified</th> */}
                                    </tr>
                                </thead>
                                <tbody>
                                    {calendarLoading ? (
                                        <tr><td colSpan={CALENDAR_COL_COUNT} className="deep-drive__loading-cell">{getCFTextLoader()}</td></tr>
                                    ) : calendarItems.length === 0 ? (
                                        <tr><td colSpan={CALENDAR_COL_COUNT} className="deep-drive__empty-cell">No calendars found.</td></tr>
                                    ) : (
                                        calendarItems.map((item, idx) => {
                                            const name = item.calendarName || "—";
                                            const modified = item.modifiedTime
                                                ? new Date(item.modifiedTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                                                : "—";
                                            return (
                                                <tr key={item.calendarId ?? idx} className="deep-drive__table-row">
                                                    <td>
                                                        <span className="deep-drive__name-cell">
                                                            <CalendarDays size={13} style={{ flexShrink: 0, color: "#0062ff" }} />
                                                            <span className="deep-drive__name-text" title={name}>{name}</span>
                                                        </span>
                                                    </td>
                                                    <td style={{ fontSize: "13px", color: "#374151" }}>{formatCount(item.eventCount ?? 0)}</td>
                                                    {/* <td style={{ fontSize: "12px", color: "#6b7280" }}>{modified}</td> */}
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>

                            <div className="cf_new_tables_footer" style={{ border: "0", borderTop: "1px solid #e0e0e0" }}>
                                <span>Total: {calendarTotal}</span>
                                <span style={{ marginLeft: "auto" }} />
                                <span style={{ opacity: "0.5" }}>Showing {calendarPageNo} of {calendarTotalPages} Page</span>
                                <span>
                                    Showing :{" "}
                                    <select className="cf_message_pagination_select" name="pageSize" value={calendarPageSize} onChange={handleCalendarPagination}>
                                        <option value="50">50</option>
                                        <option value="100">100</option>
                                        <option value="200">200</option>
                                        <option value="500">500</option>
                                    </select>
                                    &nbsp;Rows
                                </span>
                                <span>
                                    Go to :{" "}
                                    <select className="cf_message_pagination_select" name="pageNo" value={calendarPageNo} onChange={handleCalendarPagination}>
                                        {Array.from({ length: calendarTotalPages }, (_, i) => (
                                            <option key={i + 1} value={i + 1}>{i + 1}</option>
                                        ))}
                                    </select>
                                </span>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default EmailDeepDive;
