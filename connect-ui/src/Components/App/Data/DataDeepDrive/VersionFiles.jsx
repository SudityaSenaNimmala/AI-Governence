import React from "react";
import Popup from "../../../Resuables/Popup/Popup";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { getMaxChar, getSizeFormatted } from "../../../helpers/utils";
import "./DataDeepDrive.css";

const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { dateStyle: "short", timeStyle: "short" });
    } catch {
        return dateStr || "—";
    }
};

const VersionFiles = ({
    isOpen,
    onClose,
    itemName,
    versions,
    isLoading,
    getRelativeImage,
}) => {
    const list = Array.isArray(versions) ? versions : [];

    return (
        <Popup
            toggleOpen={() => onClose?.()}
            options={{
                isOpen: !!isOpen,
                title: `Versions – ${getMaxChar(itemName ?? "File", 60)}`,
                oTitle: `Versions – ${itemName ?? "File"}`,
                popupWidth: "50%",
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
            <div className="cf_popup_container_body" style={{ padding: "16px", flexDirection: "column", gap: "16px", width: "100%", height: "100%" }}>
                {isLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "32px" }}>
                        {getCFTextLoader()}
                    </div>
                ) : list.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", color: "#5f6368" }}>
                        No versions found.
                    </div>
                ) : (
                    <div style={{ overflowX: "auto", width: "100%", height: "100%" }}>
                        <table className="deep-drive__table" style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e8eaed", fontWeight: 600 }}>Name</th>
                                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e8eaed", fontWeight: 600 }}>Size</th>
                                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e8eaed", fontWeight: 600 }}>Modified</th>
                                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e8eaed", fontWeight: 600 }}>Modified by</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((v) => (
                                    <tr key={v.id ?? v.versionId ?? v.filefolderId ?? Math.random()} style={{ borderBottom: "1px solid #f1f3f4" }}>
                                        <td style={{ padding: "10px 12px" }} title={v.name ?? v.path}>
                                            <span className="deep-drive__name-cell">
                                                {getRelativeImage("file", { ...v, displayName: v.name ?? v.path ?? "—" })}
                                                {getMaxChar(v.name ?? v.path ?? "—", 40)}
                                            </span>
                                        </td>
                                        <td style={{ padding: "10px 12px" }}>
                                            {v.fileSize != null ? getSizeFormatted(v.fileSize) : "—"}
                                        </td>
                                        <td style={{ padding: "10px 12px" }} title={v.modifiedBy}>
                                            {getMaxChar(v.modifiedBy ?? "—", 24)}
                                        </td>
                                        <td style={{ padding: "10px 12px" }}>
                                            {new Date(v.modifiedDate).toLocaleString()}
                                        </td>

                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Popup>
    );
};

export default VersionFiles;
