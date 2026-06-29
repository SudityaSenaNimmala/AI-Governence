import { useEffect, useState } from "react";
import Popup from "../../../Resuables/Popup/Popup";
import SvgName from "../../../Testing/SvgName";
import { getBambooHRUserApps } from "../DemoActions/DemoActions";
import { cloudImageMapper } from "../../../helpers/helpers";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { Check } from "lucide-react";

const InfoTile = ({ label, value }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "3px",
      padding: "10px 14px",
      borderRadius: "8px",
      background: "#f8f9ff",
      border: "1px solid #eef0fb",
      flex: "1 1 calc(50% - 6px)",
      minWidth: "0",
    }}
  >
    <span style={{ fontSize: "11px", color: "#8b8fa8", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.4px" }}>
      {label}
    </span>
    <span style={{ fontSize: "13px", fontWeight: "600", color: "#1e1e2d", wordBreak: "break-word" }}>
      {value || <span style={{ color: "#b0b3c6", fontWeight: "400" }}>—</span>}
    </span>
  </div>
);

const BambooHRUserInsights = ({ selectedUser, setSelectedUser }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [appsList, setAppsList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (selectedUser) {
      setIsVisible(true);
      fetchUserApps(selectedUser.email);
    } else {
      setIsVisible(false);
      setAppsList([]);
    }
  }, [selectedUser]);

  const fetchUserApps = async (email) => {
    if (!email) return;
    setIsLoading(true);
    let res = await getBambooHRUserApps(email);
    if (res?.status === "OK") {
      const combined = [
        ...(res?.res?.userApplications || []),
        ...(res?.res?.aliasApplications || []),
      ];
      const seen = new Set();
      const unique = combined.filter((app) => {
        if (seen.has(app.id)) return false;
        seen.add(app.id);
        return true;
      });
      setAppsList(unique);
    }
    setIsLoading(false);
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: "",
        popupWidth: "55%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "0px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: { justifyContent: "flex-end" },
      }}
      toggleOpen={() => setSelectedUser(null)}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 20px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Header */}
        <div className="cf_manage_groups_header">
          <SvgName type="square" name={selectedUser?.firstName || selectedUser?.email} />
          <div className="cf_manage_groups_header_title">
            <p style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
              {selectedUser?.firstName
                ? `${selectedUser.firstName}${selectedUser.lastName ? " " + selectedUser.lastName : ""}`
                : "—"}
            </p>
            <p style={{ fontSize: "12px", color: "#64748b", fontWeight: "400", margin: "4px 0 0 0" }}>
              {selectedUser?.email}
            </p>
          </div>
        </div>

        {/* User Info Grid */}
        <div
          style={{
            border: "1px solid #e7e7ee",
            borderRadius: "10px",
            padding: "14px",
            width: "100%",
          }}
        >
          <p style={{ fontWeight: "600", fontSize: "13px", margin: "0 0 12px 0", color: "#1e1e2d" }}>
            User Information
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <InfoTile label="Email" value={selectedUser?.email} />
            <InfoTile label="Department" value={selectedUser?.departmentName} />
            <InfoTile label="Division" value={selectedUser?.division} />
            <InfoTile label="Location" value={selectedUser?.location} />
            <InfoTile label="Job Title" value={selectedUser?.jobTitle} />
          </div>
        </div>

        {/* Applications */}
        <div
          style={{
            border: "1px solid #e7e7ee",
            borderRadius: "10px",
            width: "100%",
          }}
        >
          <div
            className="CF_d-flex ai-center"
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid #e7e7ee",
              gap: "8px",
            }}
          >
            <p style={{ fontWeight: "600", fontSize: "13px", margin: 0, color: "#1e1e2d" }}>
              Applications
            </p>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "600",
                color: "#6f2dff",
                background: "#f3eeff",
                borderRadius: "999px",
                padding: "1px 8px",
              }}
            >
              {isLoading ? "..." : appsList.length}
            </span>
          </div>
          <div className="cf_new_tables_div" style={{ height: "fit-content", overflow: "visible" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "240px", textAlign: "left" }}>Application</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ width: "90px", textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={3}>{getCFTextLoader()}</td>
                  </tr>
                ) : appsList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{ textAlign: "center", color: "#8b8fa8", fontSize: "13px", padding: "24px" }}
                    >
                      No applications found
                    </td>
                  </tr>
                ) : (
                  appsList.map((app, index) => (
                    <tr key={index}>
                      <td className="cf_new_table_hide_text">
                        <div className="cf_ManageClouds_table_image_container">
                          <img src={cloudImageMapper(app?.vendor)} alt={app?.vendor} />
                          <p title={app?.vendor} style={{ fontWeight: "500" }}>
                            {app?.vendor?.replaceAll("_", " ")}
                          </p>
                        </div>
                      </td>
                      <td className="cf_new_table_hide_text">
                        <p title={app?.email} style={{ color: "#475569" }}>{app?.email || "—"}</p>
                      </td>
                      <td className="cf_new_table_hide_text">
                        {app?.isActive ? (
                          <div className="cf_new_verified_div">
                            <Check size={12} strokeWidth={3} color="#166534" />
                            <p>Active</p>
                          </div>
                        ) : (
                          <div className="cf_new_unverified_div">
                            <p>Inactive</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Popup >
  );
};

export default BambooHRUserInsights;
