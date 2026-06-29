import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, Calendar, ChevronRight, FileDown, Link2, ListTree, Lock, MoveDown, MoveUp, RotateCw, Users } from "lucide-react";
import { BiFilterAlt } from "react-icons/bi";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import CustomCalendar, { parseCalendarDateRangeString } from "../../../Resuables/CustomCalendar/CustomCalendar";
import "./DataDeepDrive.css";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { downloadGlobalCSV, notifyToast } from "../../../helpers/utils";
import { getDownloadSaaSReport, getDownloadStatus } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { exportContentSprawlReport } from "../DataDashboardActions";

const MAX_CRUMB_CHARS = 30;

const SortCycleIcon = ({ value, size = 14 }) => {
    if (value === "DESC") return <MoveDown size={size} aria-hidden />;
    if (value === "ASC") return <MoveUp size={size} aria-hidden />;
    return <ArrowDownUp size={size} aria-hidden />;
};

const truncateCrumb = (text) => {
    if (!text || typeof text !== "string") return "";
    return text.length > MAX_CRUMB_CHARS ? text.slice(0, MAX_CRUMB_CHARS).trim() + "…" : text;
};

const CONTENT_SPRAWL_REPORT = "CONTENT_SPRAWL_REPORT";

/** Initial month shown when opening calendar; uses start of range if value is `start|end`. */
const calendarSeedDateFromFilterValue = (val) => {
    const parsed = parseCalendarDateRangeString(val);
    if (parsed?.startYmd) {
        const d = new Date(`${parsed.startYmd}T12:00:00`);
        return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    if (val && typeof val === "string" && !val.includes("|")) {
        const d = new Date(`${val}T12:00:00`);
        return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
};

const DataFolderDisplay = ({
    contentSprawlId,
    getExportPayload,
    breadcrumbPath,
    currentItems,
    isLoading,
    platform,
    onBreadcrumbClick,
    onFolderClick,
    onCollaboratorsClick,
    normalizeRow,
    getRelativeImage,
    isRootLoading,
    filterConfig = {},
    onOpenVersions,
}) => {
    const { globalContext } = useContext(GlobalContext);
    const userId = globalContext?.user?.id;
    const [downloadStatus, setDownloadStatus] = useState(null);
    const [isDownloading, setIsDownloading] = useState(false);

    const isAtRoot = breadcrumbPath.length === 0;
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [calendarPortal, setCalendarPortal] = useState(null);
    const calendarWrapRef = useRef(null);

    const listDateFilters = filterConfig.listDateFilters;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!calendarPortal) return;
        const onDocMouseDown = (e) => {
            if (calendarWrapRef.current?.contains(e.target)) return;
            if (e.target.closest?.(".deep-drive__date-filter-trigger")) return;
            setCalendarPortal(null);
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [calendarPortal]);

    const openDateCalendar = (type, e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const width = 450;
        const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        const top = Math.min(rect.bottom + 6, window.innerHeight - 440);
        setCalendarPortal({ type, top, left });
    };

    const handleCalendarApply = (data) => {
        const dr = (data?.dateRange || "").trim();
        if (!dr || !dr.includes("|") || !listDateFilters) {
            setCalendarPortal(null);
            return;
        }
        if (data?.channelId === "lastAccessed") listDateFilters.lastAccessedFrom?.onChange(dr);
        if (data?.channelId === "modified") listDateFilters.modifiedFrom?.onChange(dr);
        setCalendarPortal(null);
    };

    const closeCalendarPortal = () => setCalendarPortal(null);

    const showDropdown = breadcrumbPath.length > 4;
    const middleSegments = showDropdown ? breadcrumbPath.slice(0, -1) : [];
    const lastSegment = showDropdown ? breadcrumbPath[breadcrumbPath.length - 1] : null;

    const downloadSaaSReport = useCallback(
        async (action) => {
            if (!contentSprawlId) {
                notifyToast("error", "User session not available");
                return;
            }
            setIsDownloading(true);
            const res = await getDownloadSaaSReport(contentSprawlId, action);
            if (res?.status === "OK") {
                if (res?.res) {
                    setIsDownloading(false);
                    if (res?.headers["content-type"] === "text/csv") {
                        downloadGlobalCSV(res?.res, `ContentSprawlReport_`);
                        setDownloadStatus((prev) => ({
                            ...(prev || {}),
                            status: "Downloaded",
                        }));
                    } else {
                        setDownloadStatus((prev) => ({
                            ...(prev || {}),
                            status: "IN_PROGRESS",
                        }));
                    }
                } else {
                    initiateExport();
                }
            } else {
                setIsDownloading(false);
                notifyToast("error", "Failed downloading CSV");
            }
        },
        [contentSprawlId]
    );

    const getCSVStatus = useCallback(async () => {
        if (!contentSprawlId) {
            notifyToast("error", "User session not available");
            return;
        }
        setIsDownloading(true);
        const res = await getDownloadStatus(contentSprawlId, CONTENT_SPRAWL_REPORT);
        if (res?.status === "OK") {
            if (res?.res) {
                setDownloadStatus({ ...res.res });
                if (res.res.status === "PROCESSED") {
                    downloadSaaSReport(CONTENT_SPRAWL_REPORT);
                }
            } else {
                initiateExport();
            }
            setIsDownloading(false);
        } else {
            setIsDownloading(false);
        }
    }, [userId, downloadSaaSReport]);

    const initiateExport = async () => {
        if (!contentSprawlId) {
            notifyToast("error", "Export is not available");
            return;
        }
        setIsDownloading(true);
        const base = JSON.parse(localStorage.getItem("contentSprawl_filterConfig")) || {};
        localStorage.removeItem("contentSprawl_filterConfig");
        let storedAdminCloudId;
        try {
            const raw = localStorage.getItem("contentSprawl_" + contentSprawlId);
            if (raw) {
                const row = JSON.parse(raw);
                const ac = row?.adminCloudId;
                if (ac != null && String(ac).trim() !== "" && ac !== "—") {
                    storedAdminCloudId = ac;
                }
            }
        } catch {
            /* ignore bad storage */
        }
        const payload =
            storedAdminCloudId != null ? { ...base, adminCloudId: storedAdminCloudId } : { ...base };
        const res = await exportContentSprawlReport(payload);
        setIsDownloading(false);
        if (res?.status === "OK") {
            if (res?.res?.status === "PROCESSED") {
                downloadSaaSReport(CONTENT_SPRAWL_REPORT);
            }
            const info = res?.res && typeof res.res === "object" ? res.res : {};
            setDownloadStatus({
                ...info,
                status: info?.status ?? "IN_PROGRESS",
            });
            notifyToast("success", "Report export started");
        } else {
            notifyToast("error", res?.message || "Failed to start export");
        }
    };

    const handleExportReport = useCallback(() => {
        if (isDownloading) return;
        if (downloadStatus?.status === "IN_PROGRESS") {
            getCSVStatus();
        } else {
            getCSVStatus();
        }
    }, [isDownloading, downloadStatus?.status, getCSVStatus, initiateExport]);

    return (
        <div className="deep-drive__list-view">
            {/* Breadcrumb: Root > [dropdown] or ... > Folder */}
            <div className="deep-drive__breadcrumb">
                <button
                    type="button"
                    className="deep-drive__breadcrumb-segment"
                    onClick={() => onBreadcrumbClick(0)}
                    aria-current={isAtRoot ? "page" : undefined}
                    title="Root"
                >
                    {platform?.vendorName === "GOOGLE_SHARED_DRIVES" || platform?.vendorName === "GOOGLE_WORKSPACE" ? "Google Workspace" : "Root"}
                </button>
                {showDropdown ? (
                    <>
                        <span className="deep-drive__breadcrumb-separator" aria-hidden>
                            <ChevronRight size={14} />
                        </span>
                        <div className="deep-drive__breadcrumb-dropdown" ref={dropdownRef}>
                            <button
                                type="button"
                                className="deep-drive__breadcrumb-segment deep-drive__breadcrumb-dropdown-trigger"
                                onClick={() => setDropdownOpen((o) => !o)}
                                aria-expanded={dropdownOpen}
                                aria-haspopup="true"
                                title="View path"
                            >
                                <ListTree size={16} />
                            </button>
                            {dropdownOpen && (
                                <div className="deep-drive__breadcrumb-dropdown-menu" role="menu">
                                    {middleSegments.map((seg, index) => (
                                        <button
                                            key={seg.id ?? index}
                                            type="button"
                                            role="menuitem"
                                            className="deep-drive__breadcrumb-dropdown-item"
                                            onClick={() => {
                                                onBreadcrumbClick(index + 1);
                                                setDropdownOpen(false);
                                            }}
                                            title={seg.displayName}
                                        >
                                            {truncateCrumb(seg.displayName)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <span className="deep-drive__breadcrumb-separator" aria-hidden>
                            <ChevronRight size={14} />
                        </span>
                        <span
                            className="deep-drive__breadcrumb-segment deep-drive__breadcrumb-current"
                            title={lastSegment?.displayName}
                            aria-current="page"
                        >
                            {truncateCrumb(lastSegment?.displayName)}
                        </span>
                    </>
                ) : (
                    breadcrumbPath.map((seg, index) => (
                        <React.Fragment key={seg.id ?? index}>
                            <span className="deep-drive__breadcrumb-separator" aria-hidden>
                                <ChevronRight size={14} />
                            </span>
                            <button
                                type="button"
                                className="deep-drive__breadcrumb-segment"
                                onClick={() => onBreadcrumbClick(index + 1)}
                                aria-current={index === breadcrumbPath.length - 1 ? "page" : undefined}
                                title={seg.displayName}
                            >
                                {truncateCrumb(seg.displayName)}
                            </button>
                        </React.Fragment>
                    ))
                )}
                <span style={{ marginLeft: "auto" }}></span>
                <ActionButton
                    buttonType="button"
                    buttonClickAction={handleExportReport}
                    customClass="data-sprawl-header__btn data-sprawl-header__btn--primary CF_d-flex ai-center"
                    customStyles={{ gap: "6px" }}
                    title={
                        isDownloading ? "" :
                            downloadStatus?.status === "IN_PROGRESS"
                                ? "Exporting report..."
                                : "Export report (server CSV)"
                    }
                >
                    {isDownloading ? (
                        <div
                            className="cf_domainSpinner"
                            style={{ width: "15px", height: "15px", border: "2px solid #fff" }}
                        ></div>
                    ) : downloadStatus?.status === "IN_PROGRESS" ? (
                        <RotateCw size={18} strokeWidth={2} aria-hidden />
                    ) : (
                        <FileDown size={18} aria-hidden />
                    )}
                    {isDownloading ? "" : "Export Report"}
                </ActionButton>
            </div>

            {/* List header */}
            <div className="deep-drive__list-header">
                <span>Name</span>
                <span>Owner</span>
                <span className="deep-drive__list-header-cell" style={{ paddingLeft: "10px" }}>
                    Size
                    {filterConfig.sizeSort && (
                        <button
                            type="button"
                            className="deep-drive__sort-cycle-btn"
                            onClick={() => filterConfig.sizeSort.onCycle()}
                            title={filterConfig.sizeSort.value === "DESC" ? "Largest first" : filterConfig.sizeSort.value === "ASC" ? "Smallest first" : "Sort by Size"}
                        >
                            <SortCycleIcon value={filterConfig.sizeSort.value} size={14} />
                        </button>
                    )}
                </span>
                <span className="deep-drive__list-header-cell">
                    Sharing
                    {filterConfig.sharing && (
                        <CustomDropDown
                            customDropDownStyles={{ width: "120px", right: 0, lineHeight: 0 }}
                            defaultVal={filterConfig.sharing.options.find((o) => o.key === filterConfig.sharing.value) || filterConfig.sharing.options[0]}
                            dropDownList={filterConfig.sharing.options}
                            selectFilter={(data) => filterConfig.sharing.onChange(data)}
                        >
                            <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                        </CustomDropDown>
                    )}
                </span>
                <span className="deep-drive__list-header-cell">
                    Sensitivity
                    {filterConfig.sensitivity && (
                        <CustomDropDown
                            customDropDownStyles={{ width: "120px", right: 0, lineHeight: 0 }}
                            defaultVal={filterConfig.sensitivity.options.find((o) => o.key === filterConfig.sensitivity.value) || filterConfig.sensitivity.options[0]}
                            dropDownList={filterConfig.sensitivity.options}
                            selectFilter={(data) => filterConfig.sensitivity.onChange(data)}
                        >
                            <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                        </CustomDropDown>
                    )}
                </span>
                <span className="deep-drive__list-header-cell" style={{ textAlign: "center" }}>
                    Collaborators
                    {filterConfig.collaboratorsSort && (
                        <button
                            type="button"
                            className="deep-drive__sort-cycle-btn"
                            onClick={() => filterConfig.collaboratorsSort.onCycle()}
                            title={filterConfig.collaboratorsSort.value === "DESC" ? "Most first" : filterConfig.collaboratorsSort.value === "ASC" ? "Least first" : "Sort by Collaborators"}
                        >
                            <SortCycleIcon value={filterConfig.collaboratorsSort.value} size={14} />
                        </button>
                    )}
                </span>
                {platform.vendorName !== "MICROSOFT_OFFICE_365" && <span className="deep-drive__list-header-cell">
                    {platform.vendorName === "BOX_BUSINESS" ? "Versions" : (<>
                        Stale
                        {filterConfig.staleType && (
                            <CustomDropDown
                                customDropDownStyles={{ width: "120px", right: 0, lineHeight: 0 }}
                                defaultVal={filterConfig.staleType.options.find((o) => o.key === filterConfig.staleType.value) || filterConfig.staleType.options[0]}
                                dropDownList={filterConfig.staleType.options}
                                selectFilter={(data) => filterConfig.staleType.onChange(data)}
                            >
                                <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                            </CustomDropDown>
                        )}
                    </>)}
                </span>}
                {platform?.vendorName === "GOOGLE_WORKSPACE" ? <span className="deep-drive__list-header-cell deep-drive__list-header-cell--date" style={{ paddingLeft: "10px" }}>
                    <span className="deep-drive__list-header-cell-inner">
                        Last Accessed
                        {listDateFilters?.lastAccessedFrom && (
                            <button
                                type="button"
                                className="deep-drive__date-filter-trigger deep-drive__sort-cycle-btn"
                                onClick={(e) => openDateCalendar("lastAccessed", e)}
                                title={
                                    listDateFilters.lastAccessedFrom.value
                                        ? `Filtered: ${listDateFilters.lastAccessedFrom.value} (change)`
                                        : "Filter by last accessed date"
                                }
                            >
                                <Calendar size={14} aria-hidden />
                            </button>
                        )}
                    </span>
                </span> : ""}
                <span className="deep-drive__list-header-cell deep-drive__list-header-cell--date" style={{ paddingLeft: "10px" }}>
                    <span className="deep-drive__list-header-cell-inner">
                        Modified Date
                        {listDateFilters?.modifiedFrom && (
                            <button
                                type="button"
                                className="deep-drive__date-filter-trigger deep-drive__sort-cycle-btn"
                                onClick={(e) => openDateCalendar("modified", e)}
                                title={
                                    listDateFilters.modifiedFrom.value
                                        ? `Filtered: ${listDateFilters.modifiedFrom.value} (change)`
                                        : "Filter by modified date"
                                }
                            >
                                <Calendar size={14} aria-hidden />
                            </button>
                        )}
                    </span>
                </span>
            </div>

            {calendarPortal &&
                listDateFilters &&
                createPortal(
                    <div
                        ref={calendarWrapRef}
                        className="deep-drive__calendar-popover"
                        style={{
                            position: "fixed",
                            top: calendarPortal.top,
                            left: calendarPortal.left,
                            zIndex: 100020,
                            width: 450,
                            minHeight: 500,
                        }}
                    >
                        <CustomCalendar
                            allowRangeSelection
                            cancelButtonLabel="Reset Filter"
                            onResetFilter={() => {
                                if (calendarPortal.type === "lastAccessed") {
                                    listDateFilters.lastAccessedFrom?.onChange(null);
                                } else {
                                    listDateFilters.modifiedFrom?.onChange(null);
                                }
                            }}
                            initialDateRange={
                                calendarPortal.type === "lastAccessed"
                                    ? listDateFilters.lastAccessedFrom?.value || ""
                                    : listDateFilters.modifiedFrom?.value || ""
                            }
                            customDate={calendarSeedDateFromFilterValue(
                                calendarPortal.type === "lastAccessed"
                                    ? listDateFilters.lastAccessedFrom?.value
                                    : listDateFilters.modifiedFrom?.value
                            )}
                            originalDate={new Date(1970, 0, 1)}
                            isDisabled={false}
                            closeDate={closeCalendarPortal}
                            applyChangeDate={handleCalendarApply}
                            customData={{
                                positionX: 500,
                                positionY: 350,
                                channelId: calendarPortal.type,
                                currentIndex: 0,
                            }}
                        />
                    </div>,
                    document.body
                )}

            {/* Rows */}
            {isRootLoading || (isLoading && currentItems.length === 0) ? (
                <div className="deep-drive__list-loading-cell">{getCFTextLoader()}</div>
            ) : currentItems.length === 0 ? (
                <div className="deep-drive__list-empty">
                    {isAtRoot ? "No folders or drives found." : "This folder is empty."}
                </div>
            ) : (
                currentItems.map((item) => {
                    const row = normalizeRow(item, 0, platform.vendorName);
                    const isFolder = row.isFolder === true || row.type === "SITE" || (row.type === "DRIVE" && platform.vendorName === "MICROSOFT_OFFICE_365");
                    const displayName =
                        row.root && platform?.platform ? platform.platform : row.displayName;

                    return (
                        <div
                            key={row.id}
                            className={`deep-drive__list-item ${isFolder ? "deep-drive__list-item--clickable" : ""}`}
                            role={isFolder ? "button" : undefined}
                            tabIndex={isFolder ? 0 : undefined}
                            onClick={isFolder ? () => onFolderClick(row) : undefined}
                            onKeyDown={
                                isFolder
                                    ? (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onFolderClick(row);
                                        }
                                    }
                                    : undefined
                            }
                        >
                            <span className="deep-drive__list-item-name">
                                {getRelativeImage(row.type, row, platform?.vendorName === "GOOGLE_WORKSPACE" ? row?.driveType === "SHARED_DRIVE" ? "GOOGLE_SHARED_DRIVES" : row?.driveType === "DRIVE" ? "G_SUITE" : platform?.vendorName : platform?.vendorName)}
                                <span className="deep-drive__name-text">{displayName}</span>
                                {row.containAnnonimouslink && (
                                    <span className="deep-drive__anon-link-icon" title="Anonymous link">
                                        <Link2 size={14} color="red" />
                                    </span>
                                )}
                            </span>
                            <span className="deep-drive__list-item-meta">
                                <span>
                                    {row.root && platform?.platform ? platform.platform : row.owner}
                                </span>
                                <span>{row.size}</span>
                                <span
                                    className={`deep-drive__pill deep-drive__pill--${(row.sharing || "internal").toLowerCase()}`}
                                    style={{ width: "fit-content" }}
                                >
                                    {row.sharing === "Internal" ? (
                                        <Users size={10} />
                                    ) : (
                                        <Lock size={10} />
                                    )}
                                    <span>{row.sharing}</span>
                                </span>
                                <span>
                                    {isFolder ? "-" : row.sensitivity && row.sensitivity !== "—" ? (
                                        <span
                                            className={`deep-drive__pill deep-drive__pill--${String(row.sensitivity).toLowerCase()}`}
                                            style={{ fontSize: "10px" }}
                                        >
                                            {row.sensitivity}
                                        </span>
                                    ) : (
                                        "—"
                                    )}
                                </span>
                                <span
                                    style={{ textAlign: "center" }}
                                    className={row.totalCollaborators > 0 ? "cf_make_link" : ""}
                                    role={row.totalCollaborators > 0 ? "button" : undefined}
                                    tabIndex={row.totalCollaborators > 0 ? 0 : undefined}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (row.totalCollaborators > 0) onCollaboratorsClick?.(row.filefolderId, row.displayName);
                                    }}
                                    onKeyDown={(e) => {
                                        if (row.totalCollaborators > 0 && (e.key === "Enter" || e.key === " ")) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onCollaboratorsClick?.(row.filefolderId, row.displayName);
                                        }
                                    }}
                                >
                                    {row.totalCollaborators ?? "—"}
                                </span>
                                {
                                    platform.vendorName === "MICROSOFT_OFFICE_365" ? "" : platform.vendorName === "BOX_BUSINESS" ? (<span style={{ paddingLeft: "10px", position: "relative" }} title={`Found ${row.versionCount} versions. Click to view versions.`} className={row?.versionCount > 0 ? "cf_make_link" : ""}
                                        onClick={() => onOpenVersions?.(row.filefolderId, row.displayName)}

                                    >{row?.versionCount > 0 ?
                                        <>
                                            <span className="cf_make_link cf_versions" title={`Found ${row.versionCount} versions. Click to view versions.`}>{row.versionCount ?? "-"} {row.versionCount === 1 ? "V" : "V's"}</span>
                                            {row.totalVersionSize ? <span className="cf_versions_size cf_make_link">{row.totalVersionSize}</span> : ""}
                                        </>
                                        : "-"}</span>) : (<span style={{ paddingLeft: "10px" }}>{row.staleType === "DAYS_90" ? "90 days" : row.staleType === "DAYS_180" ? "180 days" : row.staleType === "DAYS_360" ? "360 days" : row.staleType === "DAYS_365" ? "365 days" : "—"}</span>)
                                }
                                {platform?.vendorName === "GOOGLE_WORKSPACE" ? <span style={{ paddingLeft: "10px" }} title={row?.lastAcessByTime ? `Last accessed by ${row.lastAcessEmail} at ${row.lastAcessByTime}` : null}>{row?.lastAcessByTime ? row.lastAcessByTime : row.viewedByMeTime ?? "-"}</span> : ""}
                                <span style={{ paddingLeft: "10px" }}>{row.modified ?? "-"}</span>
                            </span>
                        </div>
                    );
                })
            )}
            {isLoading && currentItems.length > 0 && (
                <div className="deep-drive__list-loading-more">
                    {getCFTextLoader()}
                    {/* <span>Loading more…</span> */}
                </div>
            )}
        </div>
    );
};

export default DataFolderDisplay;
