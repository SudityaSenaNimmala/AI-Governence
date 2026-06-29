import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import EmailBreadCrumb from "./EmailBreadCrumb";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import "./css/Content.css";
import ContentMapping from "./EmailMapping/ContentMapping";
import EmailPerMissionMapping from "./EmailPerMissionMapping";
import EmailOptions from "./EmailOptions";
import Selection from "../Content/Selection";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";

const Email = () => {
  const location = useLocation();
  const preSelectedUsers = location.state?.preSelectedUsers ?? [];
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [contentState, setContentState] = useState(
    preSelectedUsers.length > 0
      ? { atPosition: 2, previousPosition: 1, nextPosition: 3 }
      : { atPosition: 1, previousPosition: 0, nextPosition: 2 }
  );

  const showBanner = preSelectedUsers.length > 0 && !bannerDismissed && contentState.atPosition === 1;

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Migrate" subMenuActive="Email Migration" />
      <div className="cf_main_content_place">
        <TopNav pageName="Email Migration" />
        <div className="cf_main_content_place_main">
          <EmailBreadCrumb contentState={(e) => setContentState(e)} />

          {/* Pre-selected users banner from Email Sprawl */}
          {showBanner && (
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              background: "rgba(0,98,255,0.06)",
              border: "1px solid rgba(0,98,255,0.2)",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "16px",
              flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600, color: "#0062ff" }}>
                  {preSelectedUsers.length} account{preSelectedUsers.length > 1 ? "s" : ""} selected from Email Sprawl
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {preSelectedUsers.map((u) => (
                    <span key={u.id} style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "20px",
                      padding: "4px 10px",
                      fontSize: "12px",
                      color: "#1f2937",
                    }}>
                      <img
                        src={cloudImageMapper(u.vendorName)}
                        alt={u.vendorName}
                        style={{ width: "14px", height: "14px", objectFit: "contain" }}
                      />
                      {u.email ?? getCloudName(u.vendorName)}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "#6b7280", flexShrink: 0 }}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div
            className={
              contentState?.atPosition === 1
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <Selection type="EMAIL" />
          </div>
          <div
            className={
              contentState?.atPosition === 2
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <ContentMapping
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
          <div
            className={
              contentState?.atPosition === 3
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <EmailPerMissionMapping
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
          <div
            className={
              contentState?.atPosition === 4
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <EmailOptions
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Email;
