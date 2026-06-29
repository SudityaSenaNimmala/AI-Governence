import { ChevronDown, ChevronRight } from "lucide-react";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { axiosRequest } from "../../helpers/apiRequest";
import { getMaxChar, notifyToast } from "../../helpers/utils";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { cloudImageMapper, getCloudName, getRandomArray } from "../../helpers/helpers";
import "../Dashboard/New/CSS/DashBoardNew.css";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { fetchGroupWithEmail } from "../Dashboard/DashboardActions/DashboardActions";
import SaaSManageGroups from "../Demos/SaaSManageGroups/SaaSManageGroups";

const ContentSprawl = () => {
    const [dataList, setDataList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [expandedRowKey, setExpandedRowKey] = useState(null);
    const [subsitesData, setSubsitesData] = useState({});
    const [loadingSubsitesKey, setLoadingSubsitesKey] = useState(null);
    const { globalContext } = useContext(GlobalContext);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [selectedLib, setSelectedLib] = useState(null);
    const [pagination, setPagination] = useState({
        pageSize: 100,
        totalPages: 1,
        currentPage: 1,
        totalDocuments: 0,
    });

    const fetchContentSprawl = async (
        pageNo = pagination?.currentPage,
        pageSize = pagination?.pageSize
    ) => {
        setDataList([]);
        setIsLoading(true);
        const res = await axiosRequest({
            method: "GET",
            path: `/common/contetnsprawl?pageNo=${pageNo}&pageSize=${pageSize}`,
        });
        if (res?.status === "OK") {
            setIsLoading(false);
            const list = res?.res?.data ?? [];
            const total = res?.res?.totalDocuments ?? 0;
            setDataList(list);
            setPagination((prev) => ({
                ...prev,
                ...(pageNo === 1 && {
                    totalDocuments: total,
                    totalPages: Math.ceil(total / pageSize) || 1,
                }),
                currentPage: pageNo,
                pageSize,
            }));
        } else {
            setIsLoading(false);
            notifyToast("error", res?.res ?? "Failed to load content sprawl");
        }
    };

    const fetchSubsites = useCallback(async (parentId, rowKey) => {
        if (!parentId) return;
        setLoadingSubsitesKey(rowKey);
        const res = await axiosRequest({
            method: "GET",
            path: `/common/contetnsprawl?parentId=${encodeURIComponent(parentId)}&pageNo=1&pageSize=100`,
        });
        setLoadingSubsitesKey(null);
        if (res?.status === "OK") {
            const list = res?.res?.data ?? [];
            setSubsitesData((prev) => ({ ...prev, [rowKey]: list }));
        } else {
            setSubsitesData((prev) => ({ ...prev, [rowKey]: [] }));
            notifyToast("error", res?.res ?? "Failed to load subsites");
        }
    }, []);

    const toggleExpanded = (rowKey, row) => {
        const nextExpanded = expandedRowKey === rowKey ? null : rowKey;
        setExpandedRowKey(nextExpanded);
        if (nextExpanded && !subsitesData[rowKey]) {
            const parentId = row?.filefolderId ?? row?.id;
            if (parentId) fetchSubsites(parentId, rowKey);
        }
    };

    useEffect(() => {
        fetchContentSprawl(1, pagination.pageSize);
    }, []);

    const handlePagination = (e) => {
        const { name, value } = e.target;
        const count = pagination?.totalDocuments;
        if (name === "pageSize") {
            fetchContentSprawl(1, +value);
            setPagination((prev) => ({
                ...prev,
                currentPage: 1,
                pageSize: +value,
                totalPages: Math.ceil(count / +value) || 1,
            }));
        } else {
            fetchContentSprawl(+value, pagination?.pageSize);
            setPagination((prev) => ({ ...prev, currentPage: +value }));
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return "—";
        try {
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
        } catch {
            return dateStr || "—";
        }
    };

    const getCloudIcon = useCallback((cloudId) => {
        if (!cloudId) return null;
        return globalContext?.cloudsList?.find((cloud) => cloud?.id === cloudId)?.providerName;
    }, []);

    const getUserInitials = useCallback((name) => {
        if (!name) return "—";
        if (name?.length >= 2) return `${name[0]}${name[1]}`.toUpperCase();
        return name?.charAt(0)?.toUpperCase() || "—";
    }, []);

    const getGroupWithEmail = useCallback(async (row) => {
        if (!row?.groupEmail) return;
        setIsPageLoading(true);
        setSelectedGroup(null);
        setSelectedLib({ ...row, vendorName: globalContext?.cloudsList?.find((cloud) => cloud?.id === row?.adminCloudId)?.providerName });
        const res = await fetchGroupWithEmail(row?.adminCloudId, row?.groupId);
        if (res?.status === "OK") {
            setSelectedGroup(res?.res);
            setIsPageLoading(false);
        } else {
            setIsPageLoading(false);
            notifyToast("error", res?.res ?? "Failed to load group");
        }
    }, []);

    return (
        <>
            <div className="cf_main_container">
                <SideNav activeTab="Dashboard" />
                <div className="cf_main_content_place">
                    <TopNav pageName="Content Sprawl" backLink="/Dashboard" />
                    <div
                        className="cf_main_content_place_main CF_d-flex"
                        style={{
                            padding: "10px 0 0 0",
                            flexDirection: "column",
                            height: "calc(100vh - 80px)",
                        }}
                    >
                        <div
                            className="cf_new_tables_div cf_users_license_table_card"
                            style={{ height: "calc(100% - 00px)" }}
                        >
                            <table className="cf_users_license_table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>Drive Type</th>
                                        <th>Path</th>
                                        <th>Collaborators</th>
                                        <th>Modified Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr>
                                            <td colSpan={5}>{getCFTextLoader()}</td>
                                        </tr>
                                    ) : (
                                        dataList?.map((row, index) => {
                                            const rowKey = row?.id ?? index;
                                            const isExpanded = expandedRowKey === rowKey;
                                            const subsites = subsitesData[rowKey] ?? [];
                                            const isLoadingSubs = loadingSubsitesKey === rowKey;
                                            const hasExpand = row?.filefolderId ?? row?.id;
                                            return (
                                                <React.Fragment key={rowKey}>
                                                    <tr
                                                        className={
                                                            index % 2 === 1 ? "cf_users_license_row_alt" : ""
                                                        }
                                                    >
                                                        <td style={{ width: "22%" }}>
                                                            <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                                                {hasExpand ? (
                                                                    <ActionButton
                                                                        buttonType="button"
                                                                        buttonClickAction={() => toggleExpanded(rowKey, row)}
                                                                        customClass="CF_Pointer CF_d-flex ai-center jc-center"
                                                                        customStyles={{
                                                                            border: "none",
                                                                            background: "none",
                                                                            color: "#6c757d",
                                                                            padding: 0,
                                                                        }}
                                                                        title={isExpanded ? "Collapse" : "Expand subsites"}
                                                                    >
                                                                        {isExpanded ? (
                                                                            <ChevronDown size={14} />
                                                                        ) : (
                                                                            <ChevronRight size={14} />
                                                                        )}
                                                                    </ActionButton>
                                                                ) : (
                                                                    <span style={{ width: 14, display: "inline-block" }} />
                                                                )}
                                                                <div className="cf_ManageClouds_table_image_container">
                                                                    <img src={cloudImageMapper(row?.type === "SITE" ? "SPO" : getCloudIcon(row?.adminCloudId))} alt="Cloud Icon" style={{ width: 20, height: 20 }} />
                                                                </div>
                                                                <span style={{ fontWeight: 500, color: "#212529" }} className={row?.groupEmail ? "cf_make_link" : ""} onClick={() => getGroupWithEmail(row)}>
                                                                    {row?.name ?? getMaxChar(row?.id ?? "—", 20)}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td style={{ width: "14%" }}>
                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                {getCloudName(row?.type ?? "—")}
                                                            </span>
                                                        </td>
                                                        <td style={{ width: "14%" }}>
                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                {getCloudName(row?.driveType ?? "—")}
                                                            </span>
                                                        </td>
                                                        <td style={{ width: "28%" }}>
                                                            <span
                                                                style={{ fontWeight: 500, color: "#212529" }}
                                                                title={row?.path ?? ""}
                                                            >
                                                                {getMaxChar(row?.path ?? "—", 36)}
                                                            </span>
                                                        </td>
                                                        <td style={{ width: "10%" }}>
                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                {row?.collabarationCount ? row?.collabarationCount : "0"}
                                                            </span>
                                                        </td>
                                                        <td style={{ width: "20%" }}>
                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                {formatDate(row?.modifiedDate)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr
                                                            className={
                                                                index % 2 === 1 ? "cf_users_license_row_alt" : ""
                                                            }
                                                        >
                                                            <td colSpan={5} style={{ padding: 0, verticalAlign: "top", borderTop: "none" }}>
                                                                <div
                                                                    style={{
                                                                        padding: "16px 16px 20px",
                                                                        background: "#f8fafc",
                                                                        borderBottom: "1px solid #e2e8f0",
                                                                    }}
                                                                >
                                                                    <div style={{ fontWeight: 600, marginBottom: 12, color: "#334155" }}>
                                                                        Sub sites
                                                                    </div>
                                                                    {isLoadingSubs ? (
                                                                        <div className="CF_d-flex ai-center jc-center" style={{ minHeight: 80 }}>
                                                                            {getCFTextLoader()}
                                                                        </div>
                                                                    ) : subsites.length === 0 ? (
                                                                        <span style={{ fontSize: 13, color: "#64748b" }}>No subsites</span>
                                                                    ) : (
                                                                        <table className="cf_users_license_table" style={{ margin: 0, background: "#fff" }}>
                                                                            <thead>
                                                                                <tr>
                                                                                    <th>Name</th>
                                                                                    <th>Type</th>
                                                                                    {/* <th>Drive Type</th> */}
                                                                                    <th>Path</th>
                                                                                    <th>Modified Date</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {subsites.map((sub, subIndex) => (
                                                                                    <tr key={sub?.id ?? subIndex}>
                                                                                        <td>
                                                                                            <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                                                                                <div
                                                                                                    className="cf_users_avatar"
                                                                                                    style={{
                                                                                                        width: 36,
                                                                                                        height: 36,
                                                                                                        borderRadius: "50%",
                                                                                                        background: "#e2e8f0",
                                                                                                        color: "#0062ff",
                                                                                                        fontSize: 12,
                                                                                                        fontWeight: 600,
                                                                                                        flexShrink: 0,
                                                                                                    }}
                                                                                                >
                                                                                                    <span className="CF_d-flex ai-center jc-center">
                                                                                                        {getUserInitials(sub?.name)}
                                                                                                    </span>
                                                                                                </div>
                                                                                                <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                                                    {sub?.name ?? getMaxChar(sub?.id ?? "—", 20)}
                                                                                                </span>
                                                                                            </div>
                                                                                        </td>
                                                                                        <td>
                                                                                            <span style={{ fontWeight: 500, color: "#212529" }}>{getCloudName(sub?.type ?? "—")}</span>
                                                                                        </td>
                                                                                        {/* <td>
                                                                                            <span style={{ fontWeight: 500, color: "#212529" }}>{getCloudName(sub?.driveType ?? "—")}</span>
                                                                                        </td> */}
                                                                                        <td title={sub?.path ?? ""}>
                                                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                                                {getMaxChar(sub?.path ?? "—", 30)}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td>
                                                                                            <span style={{ fontWeight: 500, color: "#212529" }}>
                                                                                                {formatDate(sub?.modifiedDate)}
                                                                                            </span>
                                                                                        </td>
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
                        </div>
                        <div className="cf_new_tables_footer">
                            <span>Total: {pagination?.totalDocuments}</span>
                            <span style={{ marginLeft: "auto" }}></span>
                            <span style={{ opacity: "0.5" }}>
                                Showing {pagination?.currentPage} of{" "}
                                {pagination?.totalPages || 1} Page
                            </span>
                            <span>
                                Showing :{" "}
                                <select
                                    className="cf_message_pagination_select"
                                    name="pageSize"
                                    value={pagination?.pageSize}
                                    onChange={handlePagination}
                                >
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                    <option value={300}>300</option>
                                    <option value={500}>500</option>
                                </select>
                                &nbsp;Rows
                            </span>
                            <span>
                                Go to:{" "}
                                <select
                                    className="cf_message_pagination_select"
                                    name="currentPage"
                                    value={pagination?.currentPage}
                                    onChange={handlePagination}
                                >
                                    {getRandomArray(pagination?.totalPages)?.map((pageNum) => (
                                        <option value={pageNum} key={`page_${pageNum}`}>
                                            {pageNum}
                                        </option>
                                    ))}
                                </select>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            {isPageLoading ? getCFLoader() : ""}
            {
                selectedGroup ?
                    <SaaSManageGroups
                        selectedTeam={selectedGroup}
                        setSelectedTeam={setSelectedGroup}
                        providerName={"MICROSOFT_OFFICE_365"}
                        currentGroupsList={[]}
                        setTeamsList={() => { }}
                        isPageLoading={isPageLoading}
                        setIsPageLoading={setIsPageLoading}
                    /> : ""
            }
        </>
    );
};

export default ContentSprawl;
