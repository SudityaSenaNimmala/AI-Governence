import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleCheckBig, CircleX } from "lucide-react";
import "./css/AssignGroups.css";
import "../UnProtectedPages/css/UnProtecedPages.css";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import CF_LOGO from "../../../assets/images/CF_LOGO_WHITE.png";
import { notifyToast } from "../../helpers/utils";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import {
    verifyOnboardUser,
    getOnboardUserGroups,
    assignGroupsToUser,
} from "./ClientActions/ClientActions";

const AssignGroups = () => {
    const [searchParams] = useSearchParams();
    const onBoardUserInfoId = searchParams.get("onBoardUserInfoId");
    const adminCloudId = searchParams.get("adminCloudId");
    let userJobInfo = searchParams.get("userInfo");
    userJobInfo = atob(userJobInfo);
    const [userInfo, setUserInfo] = useState(null);
    const [groupsAlreadyAssigned, setGroupsAlreadyAssigned] = useState(false);
    const [availableGroups, setAvailableGroups] = useState([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [assigning, setAssigning] = useState(false);

    const searchDebounce = useRef(null);

    useEffect(() => {
        if (!onBoardUserInfoId || !adminCloudId) {
            notifyToast("error", "Invalid request parameters");
            return;
        }
        verifyUser();
    }, []);

    const verifyUser = async () => {
        try {
            setLoading(true);
            const response = await verifyOnboardUser(onBoardUserInfoId, adminCloudId);

            if (response?.status !== "OK") {
                notifyToast("error", "Failed to verify user");
                return;
            }

            const data = response?.res;
            setUserInfo(data);

            if (data?.manualGroupsAdded) {
                setGroupsAlreadyAssigned(true);
            } else {
                fetchGroups();
            }
        } catch (error) {
            notifyToast("error", "Error verifying user");
            console.error("Verification error:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchGroups = async (search = "null") => {
        try {
            setGroupsLoading(true);
            const response = await getOnboardUserGroups(
                onBoardUserInfoId,
                adminCloudId,
                search
            );

            if (response?.status !== "OK") {
                notifyToast("error", "Failed to fetch groups");
                return;
            }

            setAvailableGroups(response?.res ?? []);
        } catch (error) {
            notifyToast("error", "Error fetching groups");
            console.error("Fetch groups error:", error);
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleSearchInput = (e) => {
        const value = e?.searchInput ?? "";

        if (searchDebounce.current) {
            clearTimeout(searchDebounce.current);
        }

        searchDebounce.current = setTimeout(() => {
            if (value?.length > 0) {
                fetchGroups(value);
            } else {
                fetchGroups();
            }
        }, 500);
    };

    const handleSelectGroup = (e, group) => {
        const newSet = new Set(selectedGroupIds);
        if (e?.target?.checked) {
            newSet.add(group.groupId);
        } else {
            newSet.delete(group.groupId);
        }
        setSelectedGroupIds(newSet);
    };

    const getSelectedGroupObjects = () => {
        return availableGroups.filter((g) => selectedGroupIds.has(g.groupId));
    };

    const handleAssignGroups = async () => {
        const selected = getSelectedGroupObjects();
        if (selected.length === 0) {
            notifyToast("warn", "Please select at least one group");
            return;
        }

        try {
            setAssigning(true);

            const response = await assignGroupsToUser(
                onBoardUserInfoId,
                adminCloudId,
                selected
            );

            if (response?.status !== "OK") {
                notifyToast(
                    "error",
                    response?.res?.message || "Failed to assign groups"
                );
                return;
            }

            notifyToast("success", "Groups assigned successfully");
            setGroupsAlreadyAssigned(true);
        } catch (error) {
            notifyToast("error", "Error assigning groups");
            console.error("Assign groups error:", error);
        } finally {
            setAssigning(false);
        }
    };

    const handleSkipGroups = async () => {
        try {
            setAssigning(true);
            const response = await assignGroupsToUser(
                onBoardUserInfoId,
                adminCloudId,
                []
            );

            if (response?.status !== "OK") {
                notifyToast("error", response?.res?.message || "Failed to skip");
                return;
            }

            notifyToast("success", "Continued without adding groups");
            setGroupsAlreadyAssigned(true);
        } catch (error) {
            notifyToast("error", "Error processing request");
            console.error("Skip groups error:", error);
        } finally {
            setAssigning(false);
        }
    };

    return (
        <div className="cf_login_bg">
            <div className="cf_login_bg_part_1">
                <div className="cf_approve_container" style={{ maxHeight: "100vh" }}>
                    <div className="cf_approve_container_header">
                        <img src={CF_LOGO} alt="CF Logo" />
                    </div>

                    {loading ? getCFTextLoader() : ""}

                    {/* Already assigned state */}
                    {groupsAlreadyAssigned && !loading ? (
                        <>
                            <div
                                className="cf_approve_sub_heading"
                                style={{
                                    padding: "1rem",
                                    background: "rgba(181, 249, 206, 0.24)",
                                    borderLeft: "4px solid #16a34a",
                                }}
                            >
                                <p style={{ fontWeight: "500", fontSize: "12px" }}>Groups Successfully Assigned to <span className="cf_approve_content_email" style={{ background: "transparent", paddingLeft: "3px", color: "#0062ff", fontWeight: "600" }}>{userInfo?.email}</span></p>
                                <p style={{ fontSize: "11px", fontWeight: "500", color: "#64748b" }}>
                                    {userJobInfo && userJobInfo?.split(":")[0] && userJobInfo?.split(":")[0] !== "N/A" ? (
                                        <>
                                            Department: <span style={{ paddingLeft: "3px", fontWeight: "500", color: "#0062ff" }}>{userJobInfo?.split(":")[0]}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                                        </>
                                    ) : ""}
                                    {userJobInfo && userJobInfo?.split(":")[1] && userJobInfo?.split(":")[1] !== "N/A" ? <>Title:<span style={{ paddingLeft: "3px", fontWeight: "500", color: "#0062ff" }}>{userJobInfo?.split(":")[1]}</span></> : ""}
                                </p>
                            </div>
                            <div className="cf_approve_content">
                                <div
                                    className="CF_d-flex ai-center"
                                    style={{
                                        padding: "1rem",
                                        gap: "10px",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        width: "100%",
                                        flexDirection: "column",
                                    }}
                                >
                                    <CheckCircle2 size={56} color="#16a34a" />
                                    <p
                                        style={{
                                            fontSize: "18px",
                                            fontWeight: "500",
                                            color: "#16a34a",
                                        }}
                                    >
                                        Assigned
                                    </p>
                                </div>

                            </div>
                        </>
                    ) : (
                        ""
                    )}

                    {/* Assignment form state */}
                    {!groupsAlreadyAssigned && !loading ? (
                        <>
                            <div className="cf_approve_sub_heading">
                                <p style={{ fontSize: "12px", fontWeight: "500", color: "#000", marginBottom: "3px" }}>
                                    Assign Microsoft 365 groups to &nbsp;
                                    <span className="cf_approve_content_email" style={{ color: "#0062ff", fontWeight: "600", paddingLeft: "0" }}>
                                        {userInfo?.email}
                                    </span>
                                </p>
                                <p style={{ fontSize: "11px", fontWeight: "500", color: "#64748b" }}>
                                    {userJobInfo && userJobInfo?.split(":")[0] && userJobInfo?.split(":")[0] !== "N/A" ? (
                                        <>
                                            Department: <span style={{ paddingLeft: "3px", fontWeight: "500", color: "#0062ff" }}>{userJobInfo?.split(":")[0]}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                                        </>
                                    ) : ""}
                                    {userJobInfo && userJobInfo?.split(":")[1] && userJobInfo?.split(":")[1] !== "N/A" ? <>Title:<span style={{ paddingLeft: "3px", fontWeight: "500", color: "#0062ff" }}>{userJobInfo?.split(":")[1]}</span></> : ""}
                                </p>
                            </div>
                            <div className="cf_approve_content">
                                {/* Selected groups display */}
                                {selectedGroupIds.size > 0 && (
                                    <div className="cf_selected_groups_bar">
                                        <p style={{ fontSize: "11px", fontWeight: "500", color: "#64748b", marginBottom: "6px" }}>
                                            Selected Groups ({selectedGroupIds.size})
                                        </p>
                                        <div className="cf_selected_groups_list">
                                            {availableGroups
                                                ?.filter((g) => selectedGroupIds.has(g.groupId))
                                                ?.map((group) => (
                                                    <div key={group.groupId} className="cf_group_tag">
                                                        <span>{group.groupName}</span>
                                                        <button
                                                            className="cf_remove_group_btn"
                                                            type="button"
                                                            onClick={() => {
                                                                const newSet = new Set(selectedGroupIds);
                                                                newSet.delete(group.groupId);
                                                                setSelectedGroupIds(newSet);
                                                            }}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}

                                <div className="cf_groups_section">
                                    <div
                                        className="CF_d-flex ai-center"
                                        style={{ marginBottom: "10px" }}
                                    >
                                        <SearchComponent
                                            autoOpen={true}
                                            inputName="searchInput"
                                            inputPlaceHolder="Search groups..."
                                            onInputSearch={handleSearchInput}
                                            autoFocus={false}
                                            customStyles={{ width: "100%", maxWidth: "100%" }}
                                        />
                                    </div>

                                    <div
                                        className="cf_new_tables_div"
                                        style={{ height: "fit-content", maxHeight: "250px", overflowY: "auto" }}
                                    >
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th style={{ width: "5%", textAlign: "center" }}></th>
                                                    <th style={{ width: "45%", textAlign: "left" }}>
                                                        Group Name
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {groupsLoading ? (
                                                    <tr>
                                                        <td colSpan={2}>{getCFTextLoader()}</td>
                                                    </tr>
                                                ) : (
                                                    ""
                                                )}
                                                {!groupsLoading && availableGroups?.length === 0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={2}
                                                            style={{
                                                                textAlign: "center",
                                                                padding: "1rem",
                                                                color: "#64748b",
                                                            }}
                                                        >
                                                            No groups found
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    ""
                                                )}
                                                {!groupsLoading &&
                                                    availableGroups?.map((group) => (
                                                        <tr key={group.groupId}>
                                                            <td style={{ textAlign: "center" }}>
                                                                <input
                                                                    type="checkbox"
                                                                    onChange={(e) =>
                                                                        handleSelectGroup(e, group)
                                                                    }
                                                                    checked={selectedGroupIds.has(
                                                                        group.groupId
                                                                    )}
                                                                />
                                                            </td>
                                                            <td style={{ fontWeight: "500", textAlign: "left" }}>
                                                                {group?.groupName ?? "-"}
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="cf_approve_content_buttons">
                                    <ButtonComponent
                                        inputWidth="100%"
                                        isLoading={assigning && selectedGroupIds.size > 0}
                                        isDisabled={assigning || selectedGroupIds.size === 0}
                                        buttonName=""
                                        buttonClickAction={handleAssignGroups}
                                    >
                                        <div className="cf_approve_content_buttons_icon">
                                            <CircleCheckBig size={14} />
                                            <p>Assign Selected Groups</p>
                                        </div>
                                    </ButtonComponent>
                                    <ButtonComponent
                                        inputWidth="100%"
                                        isLoading={assigning && selectedGroupIds.size === 0}
                                        isDisabled={assigning}
                                        buttonName=""
                                        buttonClickAction={handleSkipGroups}
                                        customstyles={{
                                            background: "#fff",
                                            color: "#64748b",
                                            border: "1px solid #cbd5e1",
                                        }}
                                    >
                                        <div className="cf_approve_content_buttons_icon">
                                            <CircleX size={14} color="#64748b" />
                                            <p style={{ color: "#64748b" }}>Continue Without Adding Groups</p>
                                        </div>
                                    </ButtonComponent>
                                </div>
                            </div>
                        </>
                    ) : (
                        ""
                    )}
                </div>
            </div>
        </div>
    );
};

export default AssignGroups;
