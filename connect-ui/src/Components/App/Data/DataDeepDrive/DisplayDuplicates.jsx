import { ArrowLeft, Copy, FileDown, RotateCw } from "lucide-react";
import { useState } from "react";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { copyToClipboard, downloadGlobalCSV, getMaxChar, getSizeFormatted, notifyToast } from "../../../helpers/utils";
import "./DisplayDuplicates.css";
import { getDuplicatesForAFilefolderByChecksum } from "../DataDashboardActions";
import { getDownloadSaaSReport } from "../../SaaSManagement/SaaSActions/SaaSActions";

const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { dateStyle: "short" });
    } catch {
        return dateStr || "—";
    }
};

const DisplayDuplicates = ({ isOpen, onClose, duplicatesData = { data: [], totalDocuments: 0 }, getRelativeImage, isLoading, user, type = "non" }) => {
    const { data = [], totalDocuments = 0 } = duplicatesData;
    const [duplicatesDataByChecksum, setDuplicatesDataByChecksum] = useState([]);
    const [duplicatesDataByChecksumLoading, setDuplicatesDataByChecksumLoading] = useState(false);
    const [showDuplicateCheckSum, setShowDuplicateCheckSum] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadStatus, setDownloadStatus] = useState(null);

    const handleDownload = async () => {
        const contentSprawlId = data[0]?.contentSprawlId;
        if (!contentSprawlId) {
            notifyToast("Export not available for this user", "error");
            return;
        }
        setIsDownloading(true);
        const res = await getDownloadSaaSReport(contentSprawlId, "CONTENT_SPRAWL_USERS_DUPLICATES");
        setIsDownloading(false);
        if (res?.status === "OK") {
            if (res?.headers?.["content-type"] === "text/csv") {
                downloadGlobalCSV(res?.res, `${user}_Duplicates`);
                setDownloadStatus(null);
            } else {
                setDownloadStatus("IN_PROGRESS");
            }
        } else {
            notifyToast("error", res?.res?.message ?? "Failed to download report");
        }
    };

    const onOpenDuplicates = async (body) => {
        setShowDuplicateCheckSum(true);
        setDuplicatesDataByChecksum([]);
        setDuplicatesDataByChecksumLoading(true);
        const res = await getDuplicatesForAFilefolderByChecksum(body);
        if (res?.status === "OK") {
            setDuplicatesDataByChecksum(res?.res?.data);
            setDuplicatesDataByChecksumLoading(false);
        } else {
            setDuplicatesDataByChecksumLoading(false);
            notifyToast(res?.res?.message ?? "Something went wrong", "error");
            setDuplicatesDataByChecksum([]);
        }
    };
    return (
        <Popup
            toggleOpen={() => onClose?.()}
            options={{
                isOpen: !!isOpen,
                title: type === "sensitive" ? `${user} files` : `${user} Duplicate`,
                oTitle: "Duplicate files",
                popupWidth: type === "sensitive" ? "30%" : "55%",
                type: "side",
                popupHeight: "calc(100% - 0px)",
                popupTop: "00px",
                maxHeight: "100%",
                overflowY: "auto",
                parentStyles: {
                    justifyContent: "flex-end",
                },
            }}
        >
            {
                showDuplicateCheckSum ?
                    <div
                        className="cf_popup_container_body"
                        style={{
                            padding: "20px 10px",
                            flexDirection: "column",
                            overflowY: "auto",
                            height: "calc(100% - 0px)",
                            width: "100%",
                            alignItems: "flex-start",
                            justifyContent: "flex-start",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setShowDuplicateCheckSum(false)}
                            className="display-duplicates__back-btn"
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                marginBottom: "12px",
                                padding: "6px 12px",
                                fontSize: "13px",
                                fontWeight: 500,
                                color: "#475569",
                                background: "#f1f5f9",
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                                cursor: "pointer",
                            }}
                        >
                            <ArrowLeft size={16} />
                            Back
                        </button>

                        {duplicatesDataByChecksumLoading && getCFTextLoader()}
                        {!duplicatesDataByChecksumLoading && <div className="display-duplicates__body">
                            {duplicatesDataByChecksum?.length === 0 ? (
                                <div className="display-duplicates__empty">No duplicate files found.</div>
                            ) : (
                                <div className="display-duplicates__list-wrap">
                                    <table className="display-duplicates__table" role="table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                {type === "sensitive" ? "" : <>
                                                    <th>Size</th>
                                                    <th>Last Accessed</th>
                                                    <th>Created Date</th>
                                                </>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {duplicatesDataByChecksum?.map((item, i) => (
                                                <tr key={item.id || i}>
                                                    <td className="display-duplicates__cell-name" title={item.name}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                            {getRelativeImage(item?.type === "FILE" ? "file" : "folder", { ...item, displayName: item.name ?? "—" })}
                                                            <span style={{ fontWeight: "500", color: "#475569" }} >
                                                                {getMaxChar(item.name ?? "—", 50)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    {type === "sensitive" ? "" : <>
                                                        <td>{item.fileSize != null ? getSizeFormatted(item?.duplicateCount > 0 ? item.fileSize : item.fileSize) : "—"}</td>
                                                        <td title={item?.lastAcessByTime ? `Last accessed by ${item?.lastAcessEmail} at ${item?.lastAcessByTime}` : null}>
                                                            {item?.lastAcessByTime ? item?.lastAcessByTime : formatDate(item?.viewedByMeTime)}
                                                        </td>
                                                        <td>
                                                            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>

                                                                {formatDate(item.createdDate)}
                                                                <span style={{ marginLeft: "auto" }}></span>
                                                                <Copy size={12} onClick={() => copyToClipboard(item.path)} style={{ cursor: "pointer" }} title="Copy Path" />
                                                            </div>
                                                        </td>
                                                    </>}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>}
                    </div> :
                    <div
                        className="cf_popup_container_body"
                        style={{
                            padding: "20px 10px",
                            flexDirection: "column",
                            overflowY: "auto",
                            height: "calc(100% - 0px)",
                            width: "100%",
                        }}
                    >
                        {isLoading && getCFTextLoader()}
                        {!isLoading && <div className="display-duplicates__body">
                            {data.length === 0 ? (
                                <div className="display-duplicates__empty">No duplicate files found.</div>
                            ) : (
                                <div className="display-duplicates__list-wrap">
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                                        <ActionButton
                                            customClass="CF_d-flex ai-center"
                                            customStyles={{ backgroundColor: "#f2f2f2", height: "40px" }}
                                            buttonType="button"
                                            buttonClickAction={() => isDownloading ? null : handleDownload()}
                                        >
                                            {isDownloading ? getCFTextLoader(" ") : downloadStatus === "IN_PROGRESS" ? (
                                                <RotateCw size={18} strokeWidth={2} title="Check Status" />
                                            ) : (
                                                <FileDown size={18} strokeWidth={2} />
                                            )}
                                        </ActionButton>
                                    </div>
                                    <table className="display-duplicates__table" role="table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                {type === "sensitive" ? "" : <>
                                                    <th>Total Size</th>
                                                    <th>Last Accessed</th>
                                                    <th>Created Date</th>
                                                </>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.map((item, i) => (
                                                <tr key={item.id || i}>
                                                    <td className="display-duplicates__cell-name" title={item.name}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                            {getRelativeImage(item?.type === "FILE" ? "file" : "folder", { ...item, displayName: item.name ?? "—" })}
                                                            <span style={{ fontWeight: "500", color: "#475569" }} className={type === "non" ? "cf_make_link" : ""}
                                                                onClick={type === "non" ? () => onOpenDuplicates({
                                                                    "contetnSprawlId": item?.contentSprawlId,
                                                                    "adminCloudId": item?.adminCloudId,
                                                                    "parentId": null,
                                                                    "fileFolderType": null,
                                                                    "pageNo": 1,
                                                                    "pageSize": 100,
                                                                    "searchValue": null,
                                                                    "createdDate": null,
                                                                    "sortCollaborators": null,
                                                                    "fileSize": null,
                                                                    "sharing": null,
                                                                    "riskLevel": null,
                                                                    "staleType": null,
                                                                    "versionId": null,
                                                                    "duplicate": false,
                                                                    "checksum": item?.checksum
                                                                }) : () => { }}
                                                            >
                                                                {getMaxChar(item.name ?? "—", 50)} {item?.duplicateCount ? <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "500" }}>({item?.duplicateCount} Duplicates)</span> : 0}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    {type === "sensitive" ? "" : <>
                                                        <td>{item.fileSize != null ? getSizeFormatted(item?.duplicateCount > 0 ? item.fileSize * item?.duplicateCount : item.fileSize) : "—"}</td>
                                                        <td title={item?.lastAcessByTime ? `Last accessed by ${item?.lastAcessEmail} at ${item?.lastAcessByTime}` : null}>
                                                            {formatDate(item.viewedByMeTime)}
                                                        </td>
                                                        <td>
                                                            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>

                                                                {formatDate(item.createdDate)}
                                                                <span style={{ marginLeft: "auto" }}></span>
                                                                <Copy size={12} onClick={() => copyToClipboard(item.path)} style={{ cursor: "pointer" }} title="Copy Path" />
                                                            </div>
                                                        </td>
                                                    </>}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>}
                    </div>
            }
        </Popup >
    );
};

export default DisplayDuplicates;
