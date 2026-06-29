import { Archive, ChevronDown, ChevronRight, Hash, Lock } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { globalDebounce } from "../../../helpers/utils";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getContentSprawlMessages } from "../DataDashboardActions";
import "../DataDeepDrive/DataDeepDrive.css";

const PAGE_SIZE = 50;
const COL_COUNT = 2; // toggle + team name

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

const TeamsMessageDeepDive = () => {
    const location = useLocation();
    const { contentSprawlId } = useParams();

    const [platform, setPlatform] = useState({});
    const [channels, setChannels] = useState([]);
    const [totalDocuments, setTotalDocuments] = useState(0);
    const [pageNo, setPageNo] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [isLoading, setIsLoading] = useState(false);

    // expandedTeams[teamId] = { isOpen, channels, isLoading }
    const [expandedTeams, setExpandedTeams] = useState({});

    const [search, setSearch] = useState("");
    const debouncedSetSearch = useMemo(() => globalDebounce((v) => setSearch(v ?? ""), 300), []);
    const [platformReady, setPlatformReady] = useState(false);

    const prevIdRef = useRef(null);

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
                vendorName: source.vendorName ?? "MICROSOFT_TEAMS",
                adminCloudId: source.adminCloudId ?? "",
                lastScan: source.modifiedTime ? new Date(source.modifiedTime).toLocaleString() : "—",
                publicChannels: source.publicChannelCount ?? 0,
                privateChannels: source.privateChannelCount ?? 0,
                dmCount: source.dmCount ?? 0,
            });
        }
        setPlatformReady(true);
    }, [contentSprawlId, location.state?.platform]);

    const buildBody = useCallback(
        (overrides = {}) => ({
            channelType: "TEAM",
            privateChannels: null,
            lastMessageTime: "ALL",
            createDate: "ALL",
            sortMembers: "ALL",
            sortMessageCount: "ALL",
            sortFilesCount: "ALL",
            pageNo: overrides.pageNo ?? pageNo,
            pageSize: overrides.pageSize ?? pageSize,
            searchValue: search.trim() || null,
            ...overrides,
        }),
        [pageNo, pageSize, search]
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
        if (!contentSprawlId || !platformReady) return;
        prevIdRef.current = contentSprawlId;
        setPageNo(1);
        fetchChannels(1, pageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentSprawlId, platformReady, search]);

    const toggleTeamExpand = async (teamId) => {
        const current = expandedTeams[teamId];

        if (current?.isOpen) {
            setExpandedTeams((prev) => ({ ...prev, [teamId]: { ...prev[teamId], isOpen: false } }));
            return;
        }

        if (current?.channels?.length > 0) {
            setExpandedTeams((prev) => ({ ...prev, [teamId]: { ...prev[teamId], isOpen: true } }));
            return;
        }

        setExpandedTeams((prev) => ({ ...prev, [teamId]: { isOpen: true, channels: [], isLoading: true } }));

        const res = await getContentSprawlMessages(contentSprawlId, {
            channelType: "CHANNEL",
            teamId,
            pageNo: 1,
            pageSize: 50,
            privateChannels: null,
            lastMessageTime: "ALL",
            createDate: "ALL",
            sortMembers: "ALL",
            sortMessageCount: "ALL",
            sortFilesCount: "ALL",
            searchValue: null,
        });

        setExpandedTeams((prev) => ({
            ...prev,
            [teamId]: {
                isOpen: true,
                channels: res?.status === "OK" ? (res?.res?.data ?? []) : [],
                isLoading: false,
            },
        }));
    };

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
                                <img src={cloudImageMapper(platform?.vendorName)} alt="Microsoft Teams" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
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
                            inputPlaceHolder="Search teams..."
                            onInputSearch={({ searchInput }) => debouncedSetSearch(searchInput)}
                            customStyles={{ minWidth: "220px" }}
                        />
                        <span style={{ marginLeft: "auto" }} />
                    </div>

                    <div className="deep-drive__table-card" style={{ marginTop: "20px" }}>
                        <table className="deep-drive__table">
                            <colgroup>
                                <col style={{ width: "36px" }} />
                                <col />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th />
                                    <th>
                                        <span className="deep-drive__th-content">
                                            Team Name
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan={COL_COUNT} className="deep-drive__loading-cell">{getCFTextLoader()}</td></tr>
                                ) : channels.length === 0 ? (
                                    <tr><td colSpan={COL_COUNT} className="deep-drive__empty-cell">No teams found.</td></tr>
                                ) : (
                                    channels.map((ch) => {
                                        const teamId = ch.teamId;
                                        const expanded = expandedTeams[teamId];
                                        const isOpen = expanded?.isOpen ?? false;

                                        return (
                                            <React.Fragment key={ch.id ?? teamId}>
                                                {/* Team row — name only */}
                                                <tr className="deep-drive__table-row">
                                                    <td style={{ padding: "8px 4px", textAlign: "center" }}>
                                                        <button
                                                            type="button"
                                                            className="deep-drive__sort-cycle-btn"
                                                            onClick={() => toggleTeamExpand(teamId)}
                                                            title={isOpen ? "Collapse channels" : "Expand channels"}
                                                        >
                                                            {isOpen
                                                                ? <ChevronDown size={14} aria-hidden />
                                                                : <ChevronRight size={14} aria-hidden />
                                                            }
                                                        </button>
                                                    </td>
                                                    <td>
                                                        <span className="deep-drive__name-cell">
                                                            <span className="deep-drive__name-text">{ch.channelName || ch.teamId || "—"}</span>
                                                            {ch.archived && (
                                                                <span title="Archived" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", color: "#b91c1c", marginLeft: 4 }}>
                                                                    <Archive size={13} />
                                                                </span>
                                                            )}
                                                        </span>
                                                    </td>
                                                </tr>

                                                {/* Expanded channels — own table with header */}
                                                {isOpen && (
                                                    <tr>
                                                        <td colSpan={COL_COUNT} style={{ padding: 0 }}>
                                                            <div style={{
                                                                margin: "10px 16px 12px 36px",
                                                                borderRadius: "8px",
                                                                border: "1px solid #e0e4f4",
                                                                overflow: "hidden",
                                                                boxShadow: "0 1px 4px rgba(0,98,255,0.06)",
                                                            }}>
                                                                {expanded?.isLoading ? (
                                                                    <div style={{ padding: "18px 20px", background: "#f8f9ff" }}>{getCFTextLoader()}</div>
                                                                ) : expanded?.channels?.length === 0 ? (
                                                                    <div style={{ padding: "14px 20px", fontSize: "12px", color: "#9ca3af", background: "#f8f9ff" }}>
                                                                        No channels found for this team.
                                                                    </div>
                                                                ) : (
                                                                    <table className="deep-drive__table" style={{ margin: 0 }}>
                                                                        <thead>
                                                                            <tr style={{ background: "#eef0ff" }}>
                                                                                <th style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Channel Name</th>
                                                                                <th style={{ textAlign: "center", width: "90px", padding: "10px 8px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Members</th>
                                                                                <th style={{ textAlign: "center", width: "100px", padding: "10px 8px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Messages</th>
                                                                                <th style={{ textAlign: "center", width: "80px", padding: "10px 8px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Files</th>
                                                                                <th style={{ width: "110px", padding: "10px 8px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Created</th>
                                                                                <th style={{ width: "130px", padding: "10px 16px 10px 8px", fontSize: "12px", fontWeight: 600, color: "#3d4eac" }}>Last Message</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {expanded.channels.map((sub, idx) => (
                                                                                <tr
                                                                                    key={sub.id ?? sub.channelId}
                                                                                    style={{
                                                                                        background: idx % 2 === 0 ? "#ffffff" : "#f5f7ff",
                                                                                        borderBottom: "1px solid #eef0f8",
                                                                                    }}
                                                                                >
                                                                                    <td style={{ padding: "10px 16px" }}>
                                                                                        <span className="deep-drive__name-cell">
                                                                                            {sub.privateChannel
                                                                                                ? <Lock size={13} style={{ flexShrink: 0, color: "#8b93a7" }} />
                                                                                                : <Hash size={13} style={{ flexShrink: 0, color: "#8b93a7" }} />
                                                                                            }
                                                                                            <span className="deep-drive__name-text" style={{ fontSize: "12px" }}>{sub.channelName || sub.channelId || "—"}</span>
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ textAlign: "center", padding: "10px 8px", fontSize: "12px", color: "#374151" }}>{formatCount(sub.memberCount ?? 0)}</td>
                                                                                    <td style={{ textAlign: "center", padding: "10px 8px", fontSize: "12px", color: "#374151" }}>{formatCount(sub.messageCount ?? 0)}</td>
                                                                                    <td style={{ textAlign: "center", padding: "10px 8px", fontSize: "12px", color: "#374151" }}>{formatCount(sub.fileCount ?? 0)}</td>
                                                                                    <td style={{ padding: "10px 8px", fontSize: "12px", color: "#374151" }}>{formatDate(sub.createdDate)}</td>
                                                                                    <td style={{ padding: "10px 16px 10px 8px", fontSize: "12px", color: "#374151" }}>{formatDate(sub.lastMessageTime)}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
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
        </div>
    );
};

export default TeamsMessageDeepDive;
