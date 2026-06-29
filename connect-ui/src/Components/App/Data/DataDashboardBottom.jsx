import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Zap } from "lucide-react";
import { BiFilterAlt } from "react-icons/bi";
import "./DataDashboard.css";
import { cloudImageMapper, getCloudName, getRandomArray } from "../../helpers/helpers";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import { getSizeFormatted, notifyToast } from "../../helpers/utils";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";
import { initiateDeltaScan } from "./DataDashboardActions";

const StorageBar = ({ used, total }) => {
    if (!total || total <= 0) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
    const pct = Math.min(100, (used / total) * 100);
    const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#3b82f6";
    return (
        <div style={{ minWidth: 100 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, color: "#454545" }}>
                <span>{getSizeFormatted(used)}</span>
                <span style={{ color: "#9ca3af" }}>{getSizeFormatted(total)}</span>
            </div>
            <div style={{ width: "100%", height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.3s ease" }} />
            </div>
            {/* <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, textAlign: "right" }}>{pct.toFixed(1)}%</div> */}
        </div>
    );
};

const DataDashboardBottom = ({ platformData = [], isLoading = false, pagination = {}, fetchContentSprawlInfo }) => {
    const navigate = useNavigate();
    const [typeFilter, setTypeFilter] = useState("ALL");
    const [vendorFilter, setVendorFilter] = useState("ALL");
    const [deltaLoadingId, setDeltaLoadingId] = useState(null);
    const typeFilterOptions = [
        { key: "ALL", value: "All" },
        { key: "SHARED_DRIVE", value: "Shared Drive" },
        { key: "DRIVE", value: "My Drive" },
    ];

    const vendorFilterOptions = useMemo(() => {
        const uniqueVendors = Array.from(
            new Set((platformData || []).map((r) => r?.vendorName).filter(Boolean)),
        ).sort();
        return [
            { key: "ALL", value: "All" },
            ...uniqueVendors.map((v) => ({
                key: v,
                value: getCloudName(v) || v,
            })),
        ];
    }, [platformData]);

    const handleRowClick = (row) => {
        localStorage.setItem("contentSprawl_" + row.id, JSON.stringify(row));
        if (row.vendorName === "SLACK") {
            navigate(`/Messages/${row.id}`, { state: { platform: { ...row, platform: getCloudName(row.vendorName) || row.vendorName } } });
        } else {
            navigate(`/Data/${row.id}`, { state: { platform: { ...row, platform: getCloudName(row.vendorName) || row.vendorName } } });
        }
    };

    const data = platformData || [];
    const filteredData = useMemo(() => {
        return data.filter((row) => {
            const typeMatch = typeFilter === "ALL" || row?.type === typeFilter;
            const vendorMatch =
                vendorFilter === "ALL" || row?.vendorName === vendorFilter;
            return typeMatch && vendorMatch;
        });
    }, [data, typeFilter, vendorFilter]);

    const handlePagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") {
            fetchContentSprawlInfo(1, +value);
        } else if (name === "pageNo") {
            fetchContentSprawlInfo(+value, pagination?.pageSize);
        }
    };

    const handleDelta = async (e, row) => {
        e?.stopPropagation?.();
        if (deltaLoadingId) return;
        setDeltaLoadingId(row.id);
        const res = await initiateDeltaScan(row.id);
        setDeltaLoadingId(null);
        if (res?.status === "OK") {
            notifyToast("success", "Delta scan initiated successfully");
            handleRefresh();
        } else {
            notifyToast("error", res?.message || "Failed to initiate delta scan");
        }
    };

    const handleRefresh = () => {
        if (typeof fetchContentSprawlInfo !== "function" || isLoading) return;
        const pageNo = pagination?.pageNo ?? 1;
        const pageSize = pagination?.pageSize ?? 100;
        fetchContentSprawlInfo(pageNo, pageSize);
    };

    return (
        <div className="data-dashboard__comparison-card">
            <div className="data-dashboard__comparison-header">
                <h2 className="data-dashboard__comparison-title">Platform Comparison</h2>
                <button
                    type="button"
                    className={`data-dashboard__view-risks${isLoading ? " data-dashboard__view-risks--loading" : ""}`}
                    onClick={handleRefresh}
                    disabled={isLoading || typeof fetchContentSprawlInfo !== "function"}
                    title="Refresh platform list"
                    aria-label="Refresh platform comparison"
                >
                    <RefreshCw size={16} aria-hidden />
                    <span>Refresh</span>
                </button>
            </div>
            <div className="data-dashboard__comparison-table-wrap">
                <table className="data-dashboard__comparison-table">
                    <thead>
                        <tr>
                            <th>
                                <div className="CF_d-flex ai-center" style={{ gap: "8px", justifyContent: "center" }}>

                                </div>
                            </th>
                            <th>
                                <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                                    <span>Email</span>
                                    <CustomDropDown
                                        defaultVal={vendorFilterOptions.find((o) => o.key === vendorFilter) || vendorFilterOptions[0]}
                                        dropDownList={vendorFilterOptions}
                                        selectFilter={(data) => setVendorFilter(data?.key || "ALL")}
                                        customDropDownStyles={{ width: "200px", left: 0 }}
                                    >
                                        <span className="CF_Pointer CF_d-flex ai-center" aria-label="Filter by vendor">
                                            <BiFilterAlt />
                                        </span>
                                    </CustomDropDown>
                                    {/* <CustomDropDown
                                        defaultVal={typeFilterOptions.find((o) => o.key === typeFilter) || typeFilterOptions[0]}
                                        dropDownList={typeFilterOptions}
                                        selectFilter={(data) => setTypeFilter(data?.key || "ALL")}
                                        customDropDownStyles={{ width: "120px", right: "-100%" }}
                                    >
                                        <span className="CF_Pointer CF_d-flex ai-center" aria-label="Filter by drive type">
                                            <BiFilterAlt />
                                        </span>
                                    </CustomDropDown> */}
                                </div>
                            </th>
                            <th>Public Links</th>
                            <th>External</th>
                            <th>Total File/Folder</th>
                            <th>Duplicate File/Folder</th>
                            {/* <th>Stale & Orphaned File/Folder</th> */}
                            <th>Scanned Data Size</th>
                            <th>Storage</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? <tr>
                            <td colSpan={9} className="data-dashboard__empty-row">{getCFTextLoader()}</td>
                        </tr> : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="data-dashboard__empty-row">No data for selected filter.</td>
                            </tr>
                        ) : (
                            filteredData.map((row) => (
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
                                            src={cloudImageMapper(row.vendorName === "GOOGLE_WORKSPACE" ? row.type === "SHARED_DRIVE" ? "GOOGLE_SHARED_DRIVES" : row.type === "DRIVE" ? "G_SUITE" : row.vendorName : row.vendorName)}
                                            alt=""
                                            className="data-dashboard__platform-icon"
                                        />
                                    </td>
                                    <td className="data-dashboard__email-cell">{row.email ?? "—"}</td>
                                    <td>{row.publicLinkCount ?? 0}</td>
                                    <td>{row.externalCount ?? 0}</td>
                                    <td>{row.totalFilesFolder ?? 0}</td>
                                    <td>{row.duplicateCount ?? 0}</td>
                                    <td>{getSizeFormatted(row.totalSize)}</td>
                                    <td><StorageBar used={row.usageQuota ?? 0} total={row.totalQuota ?? 0} /></td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                        <div className="CF_d-flex ai-center" style={{ gap: "8px", flexWrap: "wrap" }}>
                                            <span className={`data-dashboard__status-pill data-dashboard__status-pill--${(row.processStatus || "").toLowerCase()}`} style={{ fontSize: "12px" }}>
                                                {getCloudName(row.processStatus || "—")}
                                            </span>
                                            {(row.vendorName === "GOOGLE_WORKSPACE" && (row.processStatus || "").toUpperCase() === "COMPLETED") && (
                                                <ActionButton
                                                    buttonType="button"
                                                    buttonClickAction={() => handleDelta(null, row)}
                                                    customClass="data-sprawl-header__btn data-sprawl-header__btn--primary data-dashboard__row-delta-btn"
                                                    customStyles={{ padding: "5px 10px", fontSize: "11px", gap: "4px", marginLeft: "auto" }}
                                                    isDisabled={!!deltaLoadingId}
                                                    title="Run Delta"
                                                >
                                                    {deltaLoadingId === row.id ? (
                                                        <div className="cf_domainSpinner" style={{ width: "11px", height: "11px", border: "2px solid #fff", borderTopColor: "transparent" }} />
                                                    ) : null}
                                                    {deltaLoadingId === row.id ? "Running…" : "Run Delta"}
                                                </ActionButton>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            <div className="cf_new_tables_footer" style={{
                border: "0",
                borderTop: "1px solid #e0e0e0",
            }}>
                <span>Total: {pagination?.totalDocuments} </span>
                <span style={{ marginLeft: "auto" }}></span>
                <span style={{ opacity: "0.5" }}>
                    Showing {pagination?.pageNo} of{" "}
                    {pagination?.totalPages ? pagination?.totalPages : 1} Page
                </span>
                <span>
                    Showing :{" "}
                    <select
                        className="cf_message_pagination_select"
                        name="pageSize"
                        value={pagination?.pageSize}
                        onChange={handlePagination}
                    >
                        <option value="100">100</option>
                        <option value="200">200</option>
                        <option value="300">300</option>
                        <option value="400">400</option>
                        <option value="500">500</option>
                    </select>
                    &nbsp;Rows
                </span>
                <span>
                    Go to:{" "}
                    <select
                        className="cf_message_pagination_select"
                        name="pageNo"
                        value={pagination?.pageNo}
                        onChange={handlePagination}
                    >
                        {getRandomArray(
                            pagination?.totalPages ? pagination?.totalPages : 1
                        )?.map((data) => {
                            return (
                                <option value={data} key={`${data}_DDB`}>
                                    {data}
                                </option>
                            );
                        })}
                    </select>
                </span>
            </div>
        </div>
    );
};

export default DataDashboardBottom;
