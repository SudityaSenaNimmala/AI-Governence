import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import Popup from "../../Resuables/Popup/Popup";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import { csvFileToJson, downloadGlobalCSV, getSizeFormatted, notifyToast } from "../../helpers/utils";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import { getContentSprawlInfo, runScanContentSprawl } from "./DataDashboardActions";
import { FileDown, FileUp, RotateCw, Trash2 } from "lucide-react";
import { getDownloadSaaSReport, getDownloadStatus } from "../SaaSManagement/SaaSActions/SaaSActions";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const StorageBar = ({ used, total }) => {
    if (!total || total <= 0) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
    const pct = Math.min(100, (used / total) * 100);
    const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#3b82f6";
    return (
        <div style={{ minWidth: 110 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4, color: "#454545" }}>
                <span>{getSizeFormatted(used)}</span>
                <span style={{ color: "#9ca3af" }}>{getSizeFormatted(total)}</span>
            </div>
            <div style={{ width: "100%", height: 5, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.3s ease" }} />
            </div>
        </div>
    );
};

/** Aligns with DataDeepDrive list paging default */
const DEFAULT_PAGE_SIZE = 100;

const RunScanContentSprawlPopup = ({
    isOpen,
    setIsOpen,
    pageSize: initialPageSize = DEFAULT_PAGE_SIZE,
    onScanSuccess,
    dataSprawl = "CONTENT",
}) => {
    const { globalContext, dispatch } = useContext(GlobalContext);
    const { id } = globalContext?.user;
    const [isScanning, setIsScanning] = useState(false);
    const [platformData, setPlatformData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedUsersEmail, setSelectedUsersEmail] = useState([]);
    const [selectedUserObj, setSelectedUserObj] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const [downloadStatus, setDownloadStatus] = useState(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isCSVUploaded, setIsCSVUploaded] = useState(false);
    const [pagination, setPagination] = useState({
        pageNo: 1,
        pageSize: initialPageSize,
        totalDocuments: 0,
        totalPages: 1,
    });

    const emailFilterRef = useRef(null);
    const paginationRef = useRef({ pageNo: 1, pageSize: initialPageSize });
    const searchDebounceRef = useRef(null);

    useEffect(() => {
        paginationRef.current = {
            pageNo: pagination.pageNo,
            pageSize: pagination.pageSize,
        };
    }, [pagination.pageNo, pagination.pageSize]);

    const emailForApi = () => {
        const raw = emailFilterRef.current;
        return raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
    };

    const fetchInactivePage = useCallback(async (pageNo, pageSize) => {
        setIsLoading(true);
        const res = await getContentSprawlInfo(false, pageNo, pageSize, emailForApi(), dataSprawl);
        if (res?.status === "OK") {
            const payload = res?.res ?? {};
            const rows = payload?.data ?? [];
            setPlatformData(rows);
            if (pageNo === 1) {
                setPagination({
                    pageNo,
                    pageSize,
                    totalDocuments: payload?.totalDocuments ?? 0,
                    totalPages: Math.ceil((payload?.totalDocuments ?? 0) / pageSize) || 1,
                });
            } else {
                setPagination((prev) => ({
                    ...prev,
                    pageNo,
                    pageSize,
                }));
            }
        } else {
            notifyToast("error", res?.message || "Failed to load content sprawl list");
            setPlatformData([]);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        // setSelectedUsersEmail([]);
        setSelectedUserObj([]);
        setSearchInput("");
        setIsCSVUploaded(false);
        emailFilterRef.current = null;
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = null;
        }
        const size = Number(initialPageSize) > 0 ? Number(initialPageSize) : DEFAULT_PAGE_SIZE;
        setPagination((p) => ({ ...p, pageSize: size }));
        paginationRef.current = { pageNo: 1, pageSize: size };
        fetchInactivePage(1, size);
    }, [isOpen, initialPageSize, fetchInactivePage]);

    const handleClose = () => setIsOpen(false);

    const searchWithThrottle = (searchValue) => {
        const v = searchValue ?? "";
        setSearchInput(v);
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
        }
        searchDebounceRef.current = setTimeout(() => {
            const trimmed = v.trim();
            emailFilterRef.current = trimmed === "" ? null : trimmed;
            // setSelectedUsersEmail([]);
            fetchInactivePage(1, paginationRef.current.pageSize);
        }, 500);
    };

    const handlePagination = (e) => {
        const { name, value } = e.target;
        if (name === "pageSize") {
            const nextSize = +value;
            // setSelectedUsersEmail([]);
            fetchInactivePage(1, nextSize);
        } else if (name === "pageNo") {
            fetchInactivePage(+value, pagination.pageSize);
        }
    };

    const runScan = async () => {
        if (selectedUsersEmail.length === 0) {
            notifyToast("warn", "Select at least one row to run scan");
            return;
        }
        setIsScanning(true);
        const res = await runScanContentSprawl(
            selectedUserObj,
            dataSprawl
        );
        setIsScanning(false);
        handleClose();
        if (typeof onScanSuccess === "function") {
            onScanSuccess();
        }
    };

    const downloadSaaSReport = async (action) => {
        setIsDownloading(true);
        let res = await getDownloadSaaSReport(id, action);
        if (res?.status === "OK") {
            setIsDownloading(false);
            if (res?.headers["content-type"] === "text/csv") {
                downloadGlobalCSV(res?.res, `ContentSprawlUsers_`);
                setDownloadStatus({
                    ...downloadStatus,
                    status: "Downloaded",
                });
            } else {
                setDownloadStatus({
                    ...downloadStatus,
                    status: "IN_PROGRESS",
                });
            }
        } else {
            setIsDownloading(false);
            notifyToast("error", "Failed Downloading CSV");
        }
    };

    const getCSVStatus = async () => {
        setIsDownloading(true);
        let res = await getDownloadStatus(id, "CONTENT_SPRAWL_USERS");
        if (res?.status === "OK") {
            setIsDownloading(true);
            if (res?.res) {
                setDownloadStatus({ ...res?.res });
                if (res?.res?.status === "PROCESSED") {
                    downloadSaaSReport("CONTENT_SPRAWL_USERS");
                }
            }
        } else {
            setIsDownloading(true);
        }
    };

    const extractCSV = (cls) => {
        csvFileToJson(cls, { Id: "id", Email: "email", Type: "type", Application: "vendorName" }).then((json) => {
            setSelectedUserObj([])
            // setSelectedUsersEmail([])
            setPlatformData(json)
            setIsCSVUploaded(true);
        }).catch((err) => {
            setIsCSVUploaded(false);
            console.log(err);
        });
    }

    return (
        <Popup
            options={{
                isOpen,
                title: "Run content sprawl scan",
                popupWidth: "40%",
                type: "side",
                popupHeight: "calc(100% - 0px)",
                popupTop: "00px",
                maxHeight: "100%",
                overflowY: "auto",
                parentStyles: {
                    justifyContent: "flex-end",
                },
            }}
            toggleOpen={(v) => setIsOpen(v === true)}
        >
            <div
                className="cf_popup_container_footer CF_d-flex ai-center"
                style={{ gap: "12px", flexWrap: "wrap", padding: "10px 15px", height: "60px", overflow: "hidden" }}
            >
                <div
                    className="CF_d-flex ai-center"
                    style={{ flex: "1 1 200px", minWidth: "160px", marginRight: "auto" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <SearchComponent
                        key={isOpen ? "open" : "closed"}
                        defaultVal={searchInput}
                        autoOpen
                        boxShadows
                        inputName="searchInput"
                        inputPlaceHolder="Search by email"
                        onInputSearch={(e) => searchWithThrottle(e?.searchInput)}
                    />
                </div>
                <span style={{ marginLeft: "auto" }}></span>
                <ActionButton
                    customClass="CF_d-flex ai-center"
                    customStyles={{
                        backgroundColor: "#f2f2f2",
                        height: "40px",
                    }}
                    buttonType="button"
                    buttonClickAction={() =>
                        isDownloading ? null :
                            downloadStatus?.status === "IN_PROGRESS"
                                ? getCSVStatus()
                                : downloadSaaSReport("CONTENT_SPRAWL_USERS")
                    }
                >
                    {isDownloading ? getCFTextLoader(" ") : downloadStatus?.status === "IN_PROGRESS" ? (
                        <RotateCw size={18} strokeWidth={2} title="Check Status" />
                    ) : (
                        <FileDown size={18} strokeWidth={2} />
                    )}
                </ActionButton>
                <ActionButton
                    buttonType="button"
                    customClass={`changeButtonColorOnHover ${selectedUsersEmail.length === 0 ? "cf_button_disabled" : ""}`}
                    customStyles={{
                        padding: "0 10px",
                        height: "40px",
                        borderRadius: "5px",
                        backgroundColor: "rgb(242, 242, 242)",
                    }}
                    buttonClickAction={runScan}
                    isDisabled={isScanning || selectedUsersEmail.length === 0}
                >
                    <p style={{ fontSize: "12px", fontWeight: "500" }}>
                        {isScanning ? "Running…" : "Run scan"}
                    </p>
                </ActionButton>
            </div>
            <div
                className="cf_popup_container_body"
                style={{
                    padding: "0 15px 15px 15px",
                    height: "calc(100% - 80px)",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    flexDirection: "column",
                    gap: "10px",
                }}
            >

                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{
                        padding: "10px 0 0 0",
                        flexDirection: "column",
                        height: "100%",
                        overflowY: "auto",
                        width: "100%",
                    }}
                >
                    <div className="cf_new_tables_div" style={{ height: "100%", width: "100%" }}>
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: "1%", textAlign: "center" }} />
                                    <th style={{ textAlign: "left" }}>
                                        <div className="CF_d-flex ai-center" style={{ width: "70%", gap: "10px" }}>

                                            <span>Email</span>
                                            <span style={{ marginLeft: "auto" }}></span>
                                        </div>
                                    </th>
                                    <th style={{ textAlign: "center", width: "60px" }}> <div className="CF_d-flex ai-center" style={{ width: "100%", gap: "10px" }}>

                                        {dataSprawl ? <span>Storage</span> : ""}
                                        <span style={{ marginLeft: "auto" }}></span>
                                        <ActionButton
                                            customClass="CF_d-flex ai-center"
                                            customStyles={{
                                                backgroundColor: "#f2f2f2",
                                                height: "35px",
                                            }}
                                            fileType=".csv"
                                            buttonType="file"
                                            getFileStream={(file) => {
                                                extractCSV(file);
                                            }}
                                        >
                                            <FileUp size={16} strokeWidth={2} />
                                        </ActionButton>
                                        {isCSVUploaded && (
                                            <ActionButton
                                                buttonType="button"
                                                customClass="CF_d-flex ai-center"
                                                customStyles={{
                                                    backgroundColor: "#f2f2f2",
                                                    height: "35px",
                                                }}
                                                buttonClickAction={() => {
                                                    setSelectedUserObj([]);
                                                    setSelectedUsersEmail([]);
                                                    setPlatformData([]);
                                                    setIsCSVUploaded(false);
                                                    setIsLoading(true);
                                                    fetchInactivePage(1, paginationRef.current.pageSize);
                                                }}
                                            >
                                                <Trash2 size={16} strokeWidth={2} />
                                            </ActionButton>
                                        )}
                                    </div></th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* {!isLoading && platformData?.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} style={{ padding: "12px", color: "#5f6368" }}>
                                            No rows for this page.
                                        </td>
                                    </tr>
                                ) : null} */}
                                {!isLoading &&
                                    selectedUserObj?.map((row, idx) => {
                                        const email = row?.email ?? "";
                                        const key = row?.id != null ? String(row.id) : `row-${idx}`;
                                        return (
                                            <tr key={key}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={true}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedUserObj((prev) => [...prev, { ...row }]);
                                                                setSelectedUsersEmail((prev) => [...prev, key]);
                                                            } else {
                                                                setSelectedUserObj((prev) =>
                                                                    prev.filter((x) => x.id !== row?.id)
                                                                );
                                                                setSelectedUsersEmail((prev) =>
                                                                    prev.filter((x) => x !== key)
                                                                );
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: "500", textAlign: "left" }}>
                                                    <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                                        <img
                                                            src={cloudImageMapper(row.vendorName === "GOOGLE_WORKSPACE" ? row.type === "SHARED_DRIVE" ? "GOOGLE_SHARED_DRIVES" : row.type === "DRIVE" ? "G_SUITE" : row.vendorName : row.vendorName)}
                                                            alt=""
                                                            className="data-dashboard__platform-icon"
                                                        />
                                                        <p style={{ position: "relative", margin: 0 }}>
                                                            <span style={{ fontWeight: "500" }}>{email || "—"}</span>
                                                        </p>
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: "center" }}>
                                                    {dataSprawl ? <StorageBar used={row.usageQuota ?? 0} total={row.totalQuota ?? 0} /> : ""}
                                                </td>
                                            </tr>
                                        );
                                    })
                                }
                                {console.log(selectedUsersEmail)}
                                {!isLoading &&
                                    platformData?.map((row, idx) => {
                                        const email = row?.email ?? "";
                                        const key = row?.id != null ? String(row.id) : `row-${idx}`;
                                        return (
                                            !selectedUsersEmail.includes(key) &&
                                            <tr key={key}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedUsersEmail.includes(key)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedUserObj((prev) => [...prev, { ...row }]);
                                                                setSelectedUsersEmail((prev) => [...prev, key]);
                                                            } else {
                                                                setSelectedUserObj((prev) =>
                                                                    prev.filter((x) => x.id !== row?.id)
                                                                );
                                                                setSelectedUsersEmail((prev) =>
                                                                    prev.filter((x) => x !== key)
                                                                );
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: "500", textAlign: "left" }}>
                                                    <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                                        <img
                                                            src={cloudImageMapper(row.type === "SHARED_DRIVE" ? "GOOGLE_SHARED_DRIVES" : row.type === "DRIVE" ? "G_SUITE" : row.vendorName)}
                                                            alt=""
                                                            className="data-dashboard__platform-icon"
                                                        />
                                                        <p style={{ position: "relative", margin: 0 }}>
                                                            <span style={{ fontWeight: "500" }}>{email || "—"}</span>
                                                        </p>
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: "center" }}>
                                                    <StorageBar used={row.usageQuota ?? 0} total={row.totalQuota ?? 0} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                        {isLoading ? getCFTextLoader() : ""}
                    </div>
                    {!isCSVUploaded && <div
                        className="cf_new_tables_footer"
                        style={{
                            border: "0",
                            marginTop: "8px",
                            flexWrap: "wrap",
                            gap: "8px",
                        }}
                    >
                        <span>Total: {pagination.totalDocuments}</span>
                        <span style={{ marginLeft: "auto" }} />
                        <span style={{ opacity: 0.5 }}>
                            Showing {pagination.pageNo} of {pagination.totalPages || 1} Page
                        </span>
                        <span>
                            Showing:{" "}
                            <select
                                className="cf_message_pagination_select"
                                name="pageSize"
                                value={pagination.pageSize}
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
                                value={pagination.pageNo}
                                onChange={handlePagination}
                            >
                                {getRandomArray(pagination.totalPages || 1)?.map((n) => (
                                    <option value={n} key={`${n}_runscan`}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </span>
                    </div>}
                </div>
            </div>
        </Popup>
    );
};

export default RunScanContentSprawlPopup;
