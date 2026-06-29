import React, { useEffect, useState } from "react";
import Popup from "../../../Resuables/Popup/Popup";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { getUsersApplicationsByEmail } from "../../UserManagement/UserManagementActions/UserManagementActions";
import { Check } from "lucide-react";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";

const DepartmentUsersApplications = ({ userEmail = "", isVisible = false, setIsVisible = () => { } }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [usersApplications, setUsersApplications] = useState([]);

    useEffect(() => {
        if (userEmail) {
            fetchUsersApplications(userEmail);
        }
    }, [userEmail]);

    const fetchUsersApplications = async () => {
        setIsLoading(true);
        let res = await getUsersApplicationsByEmail(userEmail);
        if (res?.status === "OK") {
            setUsersApplications(res?.res);
            setIsLoading(false);
        }
    }

    return (
        <Popup
            options={{
                isOpen: isVisible,
                title: `${userEmail} Applications`,
                popupWidth: "50%",
                type: "side",
                popupHeight: "calc(100% - 0px)",
                popupTop: "0px",
                maxHeight: "100%",
                overflowY: "auto",
                parentStyles: {
                    justifyContent: "flex-end",
                },
            }}
            toggleOpen={setIsVisible}
        >
            <div
                className="cf_popup_container_body"
                style={{
                    padding: "0 15px 15px 15px",
                    height: "100%",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    flexDirection: "column",
                    // gap: "10px",
                }}
            >
                <div
                    className="cf_licenses_container_table"
                    style={{ height: "calc(100% - 25px)", overflow: "auto" }}
                >
                    <table className="cf_licenses_table">
                        <thead>
                            <tr>
                                <th style={{ width: "15%", textAlign: "left" }}>Applications</th>
                                <th style={{ width: "15%", textAlign: "left" }}>
                                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                                        <span>Type</span>
                                    </div>
                                </th>
                                <th style={{ width: "15%", textAlign: "left" }}>
                                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                                        <span>Status</span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {usersApplications
                                ?.sort((a, b) => b?.deleted - a?.deleted)
                                ?.sort((a, b) => b?.isActive - a?.isActive)
                                ?.map((res, index) => (
                                    <tr key={index}>
                                        <td
                                            className="cf_new_table_hide_text"
                                            style={{ width: "200px" }}
                                        >
                                            <div className="cf_ManageClouds_table_image_container">
                                                <img
                                                    src={res?.logoUrl ?? cloudImageMapper(res?.vendor)}
                                                    alt="SLACK"
                                                />
                                                <p
                                                    title={res?.vendor}
                                                >
                                                    {getCloudName(res?.vendor)}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="cf_new_table_hide_text">
                                            <p style={{ position: "relative" }}>
                                                {res?.vendor === "HUBSPOT" && res?.saasUserRole
                                                    ? res?.saasUserRole
                                                    : res?.admin
                                                        ? "Admin"
                                                        : res?.guest
                                                            ? "Guest"
                                                            : "User"}
                                                {res?.saasUserRole?.indexOf("INVITED") > -1 ||
                                                    res?.memberId?.includes(res?.email) ? (
                                                    <span
                                                        style={{
                                                            color: "#0062ff",
                                                            fontSize: "8px",
                                                            position: "absolute",
                                                            top: "-1px",
                                                            fontWeight: "600",
                                                        }}
                                                    >
                                                        &nbsp; Invited
                                                    </span>
                                                ) : (
                                                    ""
                                                )}
                                                {res?.userType === "CONTRACTOR" ? (
                                                    <span
                                                        style={{
                                                            color: "#0062ff",
                                                            fontSize: "8px",
                                                            position: "absolute",
                                                            top: "-1px",
                                                            fontWeight: "600",
                                                        }}
                                                    >
                                                        &nbsp; Contractor
                                                    </span>
                                                ) : (
                                                    ""
                                                )}
                                            </p>
                                        </td>
                                        <td
                                            className="cf_new_table_hide_text"
                                            style={{ width: "15%" }}
                                        >
                                            {res?.isActive && !res?.idelUser ? (
                                                <div className="cf_new_verified_div">
                                                    <Check size={16} strokeWidth={3} color="#166534" />
                                                    <p>Active</p>
                                                </div>
                                            ) : (
                                                <div className="cf_new_unverified_div">
                                                    <p>
                                                        {res?.vendor === "GOOGLE_WORKSPACE_" ||
                                                            res?.vendor === "GOOGLE_CHAT_" ||
                                                            res?.vendor === "G_SUITE_" ||
                                                            res?.vendor === "GOOGLE_SHARED_DRIVE_"
                                                            ? "Suspended"
                                                            : res?.idelUser
                                                                ? "Idle"
                                                                : !res?.isActive
                                                                    ? "InActive"
                                                                    : res?.deleted
                                                                        ? "Deleted"
                                                                        : "Inactive"}
                                                    </p>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                    {isLoading ? getCFTextLoader() : ""}
                </div>
            </div>
        </Popup>
    );
};

export default DepartmentUsersApplications;
