import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, ScanSearch } from "lucide-react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { cloudImageMapper, getCloudName, getRandomArray } from "../../../helpers/helpers";
import { getMessageSprawlInfo, runScanContentSprawl } from "../DataDashboardActions";
import RunScanContentSprawlPopup from "../RunScanContentSprawlPopup";
import "../DataDashboard.css";

const MESSAGE_VENDORS = ["SLACK", "GOOGLE_CHAT", "TEAMS"];

const formatCount = (n) => {
    const val = Number(n);
    if (Number.isNaN(val)) return "0";
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return String(val);
};

const MessageDashboard = () => {
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

    const fetchData = async (pageNo = pagination.pageNo, pageSize = pagination.pageSize) => {
        setIsLoading(true);
        const res = await getMessageSprawlInfo(true, pageNo, pageSize);
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
        const totalWorkspaces = data.length;
        const totalPublicChannels = data.reduce((s, i) => s + (i.publicChannelCount ?? 0), 0);
        const totalPrivateChannels = data.reduce((s, i) => s + (i.privateChannelCount ?? 0), 0);
        const totalDMs = data.reduce((s, i) => s + (i.dmCount ?? 0), 0);
        const totalChannels = totalPublicChannels + totalPrivateChannels + totalDMs;
        const uniqueVendors = [...new Set(data.map((i) => i.vendorName).filter(Boolean))];
        return { totalWorkspaces, totalPublicChannels, totalPrivateChannels, totalDMs, totalChannels, uniqueVendors };
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
        localStorage.setItem("contentSprawl_" + row.id, JSON.stringify(row));
        navigate(`/Messages/${row.id}`, {
            state: { platform: { ...row, platform: getCloudName(row.vendorName) || row.vendorName } },
        });
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
        fetchData(pagination.pageNo, pagination.pageSize);
    };

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data" subMenuActive="Message Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Message Sprawl" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
                >
                    {/* Header */}
                    <header className="data-sprawl-header">
                        <div className="data-sprawl-header__left">
                            <h1 className="data-sprawl-header__title">Message Sprawl</h1>
                            <p className="data-sprawl-header__subtitle">
                                Last scan: {lastScanFormatted}
                            </p>
                        </div>
                        <div className="data-sprawl-header__right">
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
                        dataSprawl="MESSAGE"
                    />

                    {/* Stat cards */}
                    <div className="data-dashboard">
                        <div className="data-dashboard__grid">
                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Total Channels/DMs</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalChannels)}</div>
                                </div>
                            </div>

                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Channels</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalPublicChannels)}</div>
                                </div>
                            </div>

                            {/* <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">Private Channels</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalPrivateChannels)}</div>
                                </div>
                            </div> */}

                            <div className="data-dashboard__card">
                                <div className="data-dashboard__card-inner">
                                    <div className="data-dashboard__card-title data-dashboard__card-title--small">DM's</div>
                                    <div className="data-dashboard__big-number">{formatCount(aggregates.totalDMs)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Platform table */}
                    <div className="data-dashboard__comparison-card">
                        <div className="data-dashboard__comparison-header">
                            <h2 className="data-dashboard__comparison-title">Messaging Platforms</h2>
                            <button
                                type="button"
                                className={`data-dashboard__view-risks${isLoading ? " data-dashboard__view-risks--loading" : ""}`}
                                onClick={handleRefresh}
                                disabled={isLoading}
                                title="Refresh"
                                aria-label="Refresh messaging platforms"
                            >
                                <RefreshCw size={16} aria-hidden />
                                <span>Refresh</span>
                            </button>
                        </div>
                        <div className="data-dashboard__comparison-table-wrap">
                            <table className="data-dashboard__comparison-table">
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th>Email</th>
                                        <th>Public Channels</th>
                                        <th>Private Channels</th>
                                        <th>Direct Messages</th>
                                        <th>Total Channels</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr>
                                            <td colSpan={7} className="data-dashboard__empty-row">{getCFTextLoader()}</td>
                                        </tr>
                                    ) : platformData.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="data-dashboard__empty-row">No messaging platforms found.</td>
                                        </tr>
                                    ) : (
                                        platformData.map((row) => (
                                            <tr
                                                key={row.id}
                                                className="CF_Pointer"
                                                onClick={() => handleRowClick(row)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => e.key === "Enter" && handleRowClick(row)}
                                            >
                                                <td className="data-dashboard__platform-icon-cell">
                                                    <img
                                                        src={cloudImageMapper(row.vendorName)}
                                                        alt={getCloudName(row.vendorName) || row.vendorName}
                                                        className="data-dashboard__platform-icon"
                                                    />
                                                </td>
                                                <td className="data-dashboard__email-cell">{row.email ?? "—"}</td>
                                                <td>{formatCount(row.publicChannelCount ?? 0)}</td>
                                                <td>{formatCount(row.privateChannelCount ?? 0)}</td>
                                                <td>{formatCount(row.dmCount ?? 0)}</td>
                                                <td>{formatCount(row.totalChannelCount ?? 0)}</td>
                                                <td>
                                                    <span className={`data-dashboard__status-pill data-dashboard__status-pill--${(row.processStatus || "").toLowerCase()}`}>
                                                        {getCloudName(row.processStatus || "—")}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
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
                                        <option value={data} key={`${data}_MDB`}>{data}</option>
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

export default MessageDashboard;
