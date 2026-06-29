import { Archive, ArrowDownUp, Calendar, Hash, Lock, MoveDown, MoveUp } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BiFilterAlt } from "react-icons/bi";
import { useLocation, useParams } from "react-router-dom";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { globalDebounce } from "../../../helpers/utils";
import CustomCalendar, { parseCalendarDateRangeString } from "../../../Resuables/CustomCalendar/CustomCalendar";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import CollaboratorsPopup from "../DataDeepDrive/CollaboratorsPopup";
import { getChannelMembers, getContentSprawlMessages } from "../DataDashboardActions";
import "../DataDeepDrive/DataDeepDrive.css";

const PAGE_SIZE = 50;

/** Cycle: "" -> "DESC" -> "ASC" -> "" */
const nextSortCycle = (cur) => (cur === "" ? "DESC" : cur === "DESC" ? "ASC" : "");

const SortCycleIcon = ({ value, size = 14 }) => {
    if (value === "DESC") return <MoveDown size={size} aria-hidden />;
    if (value === "ASC") return <MoveUp size={size} aria-hidden />;
    return <ArrowDownUp size={size} aria-hidden />;
};

const CHANNEL_TYPE_OPTIONS = [
    { key: "CHANNEL", value: "Channel" },
    { key: "DIRECT_MESSAGE", value: "Direct Message" },
    { key: "GROUP_DM", value: "Group DM" },
];

const PRIVATE_OPTIONS = [
    { key: "", value: "All" },
    { key: "false", value: "Public" },
    { key: "true", value: "Private" },
];

const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
    } catch {
        return dateStr || "—";
    }
};

const formatCount = (n) => {
    const val = Number(n);
    if (Number.isNaN(val)) return "0";
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return String(val);
};

const calendarSeedDate = (val) => {
    const parsed = parseCalendarDateRangeString(val);
    if (parsed?.startYmd) {
        const d = new Date(`${parsed.startYmd}T12:00:00`);
        return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
};

const formatDateRange = (val) => {
    if (!val || !val.includes("|")) return null;
    const [a, b] = val.split("|");
    if (!a || !b) return null;
    const fmt = (s) => {
        const d = new Date(`${s}T12:00:00`);
        return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };
    return `${fmt(a)} – ${fmt(b)}`;
};

const MessageDeepDive = () => {
    const location = useLocation();
    const { contentSprawlId } = useParams();

    const [platform, setPlatform] = useState({});
    const [channels, setChannels] = useState([]);
    const [totalDocuments, setTotalDocuments] = useState(0);
    const [pageNo, setPageNo] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [isLoading, setIsLoading] = useState(false);
    const [membersPopup, setMembersPopup] = useState({ isOpen: false, channelName: "", members: [], isLoading: false });

    // Filters
    const [search, setSearch] = useState("");
    const debouncedSetSearch = useMemo(() => globalDebounce((v) => setSearch(v ?? ""), 300), []);
    const [channelTypeFilter, setChannelTypeFilter] = useState("");
    const [privateFilter, setPrivateFilter] = useState("");
    const [lastMessageDateRange, setLastMessageDateRange] = useState(null);
    const [createDateRange, setCreateDateRange] = useState(null);

    // Sorts
    const [sortMembers, setSortMembers] = useState("");
    const [sortMessageCount, setSortMessageCount] = useState("");
    const [sortFilesCount, setSortFilesCount] = useState("");

    const [calendarPortal, setCalendarPortal] = useState(null);
    const calendarWrapRef = useRef(null);
    const prevIdRef = useRef(null);

    useEffect(() => {
        if (!calendarPortal) return;
        const onDocMouseDown = (e) => {
            if (calendarWrapRef.current?.contains(e.target)) return;
            if (e.target.closest?.(".msg-calendar-trigger")) return;
            setCalendarPortal(null);
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [calendarPortal]);

    const openCalendar = (type, e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const width = 450;
        const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        const top = Math.min(rect.bottom + 6, window.innerHeight - 440);
        setCalendarPortal({ type, top, left });
    };

    const handleCalendarApply = (data) => {
        const dr = (data?.dateRange || "").trim();
        if (!dr || !dr.includes("|")) { setCalendarPortal(null); return; }
        if (data?.channelId === "lastMessage") setLastMessageDateRange(dr);
        if (data?.channelId === "created") setCreateDateRange(dr);
        setCalendarPortal(null);
    };

    const handleCalendarReset = () => {
        if (calendarPortal?.type === "lastMessage") setLastMessageDateRange(null);
        if (calendarPortal?.type === "created") setCreateDateRange(null);
        setCalendarPortal(null);
    };

    useEffect(() => {
        const fromState = location.state?.platform;
        const fromStorage = (() => {
            try {
                const raw = localStorage.getItem("contentSprawl_" + contentSprawlId);
                return raw ? JSON.parse(raw) : null;
            } catch { return null; }
        })();
        const source = fromState || fromStorage;
        if (source) {
            setPlatform({
                email: source.email ?? "—",
                vendorName: source.vendorName ?? "SLACK",
                adminCloudId: source.adminCloudId ?? "",
                lastScan: source.modifiedTime ? new Date(source.modifiedTime).toLocaleString() : "—",
                publicChannels: source.publicChannelCount ?? 0,
                privateChannels: source.privateChannelCount ?? 0,
                dmCount: source.dmCount ?? 0,
            });
        }
    }, [contentSprawlId, location.state?.platform]);

    const buildBody = useCallback(
        (overrides = {}) => ({
            channelType: channelTypeFilter || "CHANNEL",
            privateChannels: privateFilter === "" ? null : privateFilter === "true",
            lastMessageTime: lastMessageDateRange || "ALL",
            createDate: createDateRange || "ALL",
            sortMembers: sortMembers || "ALL",
            sortMessageCount: sortMessageCount || "ALL",
            sortFilesCount: sortFilesCount || "ALL",
            pageNo: overrides.pageNo ?? pageNo,
            pageSize: overrides.pageSize ?? pageSize,
            searchValue: search.trim() || null,
            ...overrides,
        }),
        [channelTypeFilter, privateFilter, lastMessageDateRange, createDateRange, sortMembers, sortMessageCount, sortFilesCount, pageNo, pageSize, search]
    );

    const fetchChannels = useCallback(
        async (pg = 1, ps = pageSize) => {
            setIsLoading(true);
            const body = buildBody({ pageNo: pg, pageSize: ps });
            const res = await getContentSprawlMessages(contentSprawlId, body);
            if (res?.status === "OK") {
                setChannels(res?.res?.data ?? []);
                if (pg === 1 && res?.res?.totalDocuments != null) setTotalDocuments(res.res.totalDocuments);
            } else {
                setChannels([]);
            }
            setIsLoading(false);
        },
        [contentSprawlId, buildBody, pageSize]
    );

    useEffect(() => {
        if (!contentSprawlId) return;
        prevIdRef.current = contentSprawlId;
        setPageNo(1);
        fetchChannels(1, pageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentSprawlId, search, channelTypeFilter, privateFilter, lastMessageDateRange, createDateRange, sortMembers, sortMessageCount, sortFilesCount]);

    const handlePagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") {
            const ps = +value;
            setPageSize(ps);
            setPageNo(1);
            fetchChannels(1, ps);
        } else if (name === "pageNo") {
            const pg = +value;
            setPageNo(pg);
            fetchChannels(pg, pageSize);
        }
    };

    const openMembersPopup = async (channel) => {
        setMembersPopup({ isOpen: true, channelName: channel.name || channel.channelId || "", members: [], isLoading: true });
        const res = await getChannelMembers(channel.channelId, contentSprawlId);
        setMembersPopup((prev) => ({
            ...prev,
            members: res?.status === "OK" ? (res?.res?.data ?? res?.res ?? []) : [],
            isLoading: false,
        }));
    };

    const totalPages = Math.ceil(totalDocuments / pageSize) || 1;

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data Hub" subMenuActive="Message Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Message Deep Dive" backLink="/MessageSprawl" activeTab="Data" />
                <div className="cf_main_content_place_main deep-drive">

                    <header className="deep-drive__header">
                        <div className="deep-drive__header-left">
                            <div className="deep-drive__header-left-icon">
                                <img src={cloudImageMapper(platform?.vendorName)} alt="Slack" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
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

                    <div className="deep-drive__cards" style={{ marginTop: "20px", gridTemplateColumns: "repeat(3, 1fr)" }}>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">Public Channels</span>
                            <span className="deep-drive__stat-value">{formatCount(platform.publicChannels ?? 0)}</span>
                        </div>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">Private Channels</span>
                            <span className="deep-drive__stat-value">{formatCount(platform.privateChannels ?? 0)}</span>
                        </div>
                        <div className="deep-drive__stat-card">
                            <span className="deep-drive__stat-label">Direct Messages</span>
                            <span className="deep-drive__stat-value">{formatCount(platform.dmCount ?? 0)}</span>
                        </div>
                    </div>

                    <div className="deep-drive__toolbar CF_d-flex" style={{ marginTop: "20px", gap: "8px", flexWrap: "wrap" }}>
                        <SearchComponent
                            autoOpen
                            defaultVal={search}
                            canResetDefaultVal
                            inputPlaceHolder="Search channels..."
                            onInputSearch={({ searchInput }) => debouncedSetSearch(searchInput)}
                            customStyles={{ minWidth: "220px" }}
                        />
                        <span style={{ marginLeft: "auto" }} />
                    </div>

                    <div className="deep-drive__table-card" style={{ marginTop: "20px" }}>
                        <table className="deep-drive__table">
                            <thead>
                                <tr>
                                    <th>
                                        <span className="deep-drive__th-content">
                                            Channel Name
                                            <CustomDropDown
                                                customDropDownStyles={{ width: "130px", right: 0 }}
                                                defaultVal={PRIVATE_OPTIONS.find((o) => o.key === privateFilter) || PRIVATE_OPTIONS[0]}
                                                dropDownList={PRIVATE_OPTIONS}
                                                selectFilter={(data) => setPrivateFilter(data?.key ?? "")}
                                            >
                                                <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap">
                                                    <BiFilterAlt size={14} aria-hidden />
                                                </span>
                                            </CustomDropDown>
                                        </span>
                                    </th>
                                    <th>
                                        <span className="deep-drive__th-content">
                                            Type
                                            <CustomDropDown
                                                customDropDownStyles={{ width: "160px", right: 0 }}
                                                defaultVal={CHANNEL_TYPE_OPTIONS.find((o) => o.key === channelTypeFilter) || CHANNEL_TYPE_OPTIONS[0]}
                                                dropDownList={CHANNEL_TYPE_OPTIONS}
                                                selectFilter={(data) => setChannelTypeFilter(data?.key ?? "")}
                                            >
                                                <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap">
                                                    <BiFilterAlt size={14} aria-hidden />
                                                </span>
                                            </CustomDropDown>
                                        </span>
                                    </th>
                                    <th style={{ textAlign: "center" }}>
                                        <span className="deep-drive__th-content">
                                            Members
                                            <button type="button" className="deep-drive__sort-cycle-btn" onClick={() => setSortMembers((p) => nextSortCycle(p))} title="Sort by Members">
                                                <SortCycleIcon value={sortMembers} size={14} />
                                            </button>
                                        </span>
                                    </th>
                                    <th style={{ textAlign: "center" }}>
                                        <span className="deep-drive__th-content">
                                            Messages
                                            <button type="button" className="deep-drive__sort-cycle-btn" onClick={() => setSortMessageCount((p) => nextSortCycle(p))} title="Sort by Messages">
                                                <SortCycleIcon value={sortMessageCount} size={14} />
                                            </button>
                                        </span>
                                    </th>
                                    <th style={{ textAlign: "center" }}>
                                        <span className="deep-drive__th-content">
                                            Files
                                            <button type="button" className="deep-drive__sort-cycle-btn" onClick={() => setSortFilesCount((p) => nextSortCycle(p))} title="Sort by Files">
                                                <SortCycleIcon value={sortFilesCount} size={14} />
                                            </button>
                                        </span>
                                    </th>
                                    <th>
                                        <span className="deep-drive__th-content">
                                            Created
                                            <button type="button" className={`deep-drive__sort-cycle-btn msg-calendar-trigger${createDateRange ? " deep-drive__view-btn--active" : ""}`} onClick={(e) => openCalendar("created", e)} title={createDateRange ? `Filtered: ${formatDateRange(createDateRange)}` : "Filter by created date"}>
                                                <Calendar size={14} aria-hidden />
                                            </button>
                                        </span>
                                    </th>
                                    <th>
                                        <span className="deep-drive__th-content">
                                            Last Message
                                            <button type="button" className={`deep-drive__sort-cycle-btn msg-calendar-trigger${lastMessageDateRange ? " deep-drive__view-btn--active" : ""}`} onClick={(e) => openCalendar("lastMessage", e)} title={lastMessageDateRange ? `Filtered: ${formatDateRange(lastMessageDateRange)}` : "Filter by last message date"}>
                                                <Calendar size={14} aria-hidden />
                                            </button>
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan={7} className="deep-drive__loading-cell">{getCFTextLoader()}</td></tr>
                                ) : channels.length === 0 ? (
                                    <tr><td colSpan={7} className="deep-drive__empty-cell">No channels found.</td></tr>
                                ) : (
                                    channels.map((ch) => (
                                        <tr key={ch.id} className="deep-drive__table-row">
                                            <td>
                                                <span className="deep-drive__name-cell">
                                                    {ch.privateChannel ? <Lock size={14} style={{ flexShrink: 0, color: "#5f6368" }} /> : <Hash size={14} style={{ flexShrink: 0, color: "#5f6368" }} />}
                                                    <span className="deep-drive__name-text">{ch.channelName || ch.channelId || "—"}</span>
                                                    {ch.archived && (
                                                        <span title="Archived" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", color: "#b91c1c", marginLeft: 4 }}>
                                                            <Archive size={13} />
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="deep-drive__pill deep-drive__pill--internal" style={{ fontSize: "11px" }}>
                                                    {ch.channelType ? CHANNEL_TYPE_OPTIONS.find((o) => o.key === ch.channelType)?.value || ch.channelType : "—"}
                                                </span>
                                            </td>
                                            <td className="cf_make_link" style={{ textAlign: "center" }} onClick={() => openMembersPopup(ch)} title="View members">
                                                {formatCount(ch.memberCount ?? 0)}
                                            </td>
                                            <td style={{ textAlign: "center" }}>{formatCount(ch.messageCount ?? 0)}</td>
                                            <td style={{ textAlign: "center" }}>{formatCount(ch.fileCount ?? 0)}</td>
                                            <td>{formatDate(ch.createdDate)}</td>
                                            <td>{formatDate(ch.lastMessageTime)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>

                        <div className="cf_new_tables_footer" style={{ border: "0", borderTop: "1px solid #e0e0e0" }}>
                            <span>Total: {totalDocuments}</span>
                            <span style={{ marginLeft: "auto" }} />
                            <span style={{ opacity: "0.5" }}>Showing {pageNo} of {totalPages} Page</span>
                            <span>
                                Showing :{" "}
                                <select className="cf_message_pagination_select" name="pageSize" value={pageSize} onChange={handlePagination}>
                                    <option value="50">50</option>
                                    <option value="100">100</option>
                                    <option value="200">200</option>
                                    <option value="500">500</option>
                                </select>
                                &nbsp;Rows
                            </span>
                            <span>
                                Go to :{" "}
                                <select className="cf_message_pagination_select" name="pageNo" value={pageNo} onChange={handlePagination}>
                                    {Array.from({ length: totalPages }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                                    ))}
                                </select>
                            </span>
                        </div>
                    </div>

                </div>
            </div>

            <CollaboratorsPopup
                isOpen={membersPopup.isOpen}
                onClose={() => setMembersPopup((prev) => ({ ...prev, isOpen: false }))}
                collaborators={membersPopup.members}
                itemName={membersPopup.channelName}
                isLoading={membersPopup.isLoading}
            />

            {calendarPortal && createPortal(
                <div ref={calendarWrapRef} className="deep-drive__calendar-popover" style={{ position: "fixed", top: calendarPortal.top, left: calendarPortal.left, zIndex: 100020, width: 450, minHeight: 500 }}>
                    <CustomCalendar
                        allowRangeSelection
                        cancelButtonLabel="Reset Filter"
                        onResetFilter={handleCalendarReset}
                        initialDateRange={calendarPortal.type === "lastMessage" ? lastMessageDateRange || "" : createDateRange || ""}
                        customDate={calendarSeedDate(calendarPortal.type === "lastMessage" ? lastMessageDateRange : createDateRange)}
                        originalDate={new Date(1970, 0, 1)}
                        isDisabled={false}
                        closeDate={() => setCalendarPortal(null)}
                        applyChangeDate={handleCalendarApply}
                        customData={{ positionX: 500, positionY: 350, channelId: calendarPortal.type, currentIndex: 0 }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

export default MessageDeepDive;
