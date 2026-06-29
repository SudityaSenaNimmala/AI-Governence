import React, { useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper } from "../../../helpers/helpers";

const Toggle = ({ checked, onChange }) => (
  <label style={{ position: "relative", display: "inline-block", width: "36px", height: "20px", flexShrink: 0 }}>
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ opacity: 0, width: 0, height: 0 }}
    />
    <span style={{
      position: "absolute", cursor: "pointer", inset: 0,
      backgroundColor: checked ? "#0062ff" : "#ccc",
      borderRadius: "20px",
      transition: "0.3s",
    }}>
      <span style={{
        position: "absolute",
        content: "",
        height: "14px", width: "14px",
        left: checked ? "18px" : "3px",
        bottom: "3px",
        backgroundColor: "#fff",
        borderRadius: "50%",
        transition: "0.3s",
      }} />
    </span>
  </label>
);

const OptionRow = ({ label, children }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 16px", borderBottom: "1px solid #f0f0f4", minHeight: "44px",
  }}>
    <span style={{ fontSize: "12px", fontWeight: 500, color: "#374151" }}>{label}</span>
    {children}
  </div>
);

const Card = ({ title, children, style }) => (
  <div style={{
    background: "#fff", borderRadius: "8px",
    border: "1px solid #e5e7eb", overflow: "hidden", ...style,
  }}>
    <div style={{
      padding: "10px 16px", background: "#f2f3ff",
      borderBottom: "1px solid #e5e7eb",
    }}>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#1f2937" }}>{title}</span>
    </div>
    {children}
  </div>
);

const EmailOptions = () => {
  const { globalContext } = useContext(GlobalContext);
  const location = useLocation();
  const preSelectedUsers = location.state?.preSelectedUsers ?? [];

  const [jobType, setJobType] = useState("Onetime");
  const [migrateFrom, setMigrateFrom] = useState("");
  const [migrateTo, setMigrateTo] = useState("");
  const [inPlaceArchive, setInPlaceArchive] = useState(false);

  const [migrateLabel, setMigrateLabel] = useState("Folders");
  const [migrateRules, setMigrateRules] = useState(false);
  const [excludeGroups, setExcludeGroups] = useState(false);
  const [archiveMailbox, setArchiveMailbox] = useState(false);

  const previewPairs = globalContext?.mappedPairs?.length > 0
    ? globalContext.mappedPairs
    : preSelectedUsers.map((u) => ({
        fromMailId: u.email,
        toMailId: u.email?.replace(/@.+/, "@gmail.com") ?? u.email,
        fromVendor: u.vendorName ?? "OUTLOOK",
        toVendor: "GMAIL",
      }));

  const dateInputStyle = {
    border: "1px solid #e5e7eb", borderRadius: "6px", padding: "4px 8px",
    fontSize: "11px", color: "#374151", height: "28px", outline: "none",
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: "16px", padding: "4px 0" }}>
      {/* Left: Job Options + Migration Options */}
      <div style={{ width: "49%", height: "100%", display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto" }}>
        <Card title="Job Options">
          <OptionRow label="Job Type :">
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              style={{ ...dateInputStyle, width: "140px" }}
            >
              <option value="Onetime">One-Time</option>
              <option value="Delta">Delta</option>
            </select>
          </OptionRow>
          <OptionRow label="Migrate :">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#6b7280" }}>From:</span>
              <input
                type="date"
                value={migrateFrom}
                onChange={(e) => setMigrateFrom(e.target.value)}
                style={dateInputStyle}
              />
              <span style={{ fontSize: "11px", color: "#6b7280" }}>To:</span>
              <input
                type="date"
                value={migrateTo}
                onChange={(e) => setMigrateTo(e.target.value)}
                style={dateInputStyle}
              />
            </div>
          </OptionRow>
          <OptionRow label="Migrate As In-Place Archive :">
            <Toggle checked={inPlaceArchive} onChange={(e) => setInPlaceArchive(e.target.checked)} />
          </OptionRow>
        </Card>

        <Card title="Migration Options">
          <OptionRow label="Migrate Label As :">
            <div style={{ display: "flex", gap: "16px" }}>
              {["Folders", "Categories"].map((opt) => (
                <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 500, color: "#374151" }}>
                  <input
                    type="radio"
                    name="migrateLabel"
                    value={opt}
                    checked={migrateLabel === opt}
                    onChange={() => setMigrateLabel(opt)}
                    style={{ accentColor: "#0062ff" }}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </OptionRow>
          <OptionRow label="Migrate Rules :">
            <Toggle checked={migrateRules} onChange={(e) => setMigrateRules(e.target.checked)} />
          </OptionRow>
          <OptionRow label="Exclude Groups :">
            <Toggle checked={excludeGroups} onChange={(e) => setExcludeGroups(e.target.checked)} />
          </OptionRow>
          <OptionRow label="Archive Mailbox :">
            <Toggle checked={archiveMailbox} onChange={(e) => setArchiveMailbox(e.target.checked)} />
          </OptionRow>
        </Card>
      </div>

      {/* Right: Preview Mappings */}
      <div style={{ width: "49%", height: "100%" }}>
        <Card title="Preview Mappings" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            padding: "8px 16px", background: "#f9fafb",
            borderBottom: "1px solid #e5e7eb",
          }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280" }}>From</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280" }}>To</span>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {previewPairs.length > 0 ? previewPairs.map((pair, idx) => (
              <div
                key={pair.fromMailId ?? idx}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr",
                  padding: "10px 16px", borderBottom: "1px solid #f0f0f4",
                  background: idx % 2 === 0 ? "#fff" : "#f9fafb",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "50%",
                    border: "1px solid #e5e7eb", display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, background: "#fff",
                  }}>
                    <img src={cloudImageMapper(pair.fromVendor ?? "OUTLOOK")} alt="" style={{ width: "14px", height: "14px", objectFit: "contain" }} />
                  </div>
                  <span style={{ fontSize: "12px", color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pair.fromMailId}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "50%",
                    border: "1px solid #e5e7eb", display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, background: "#fff",
                  }}>
                    <img src={cloudImageMapper(pair.toVendor ?? "GMAIL")} alt="" style={{ width: "14px", height: "14px", objectFit: "contain" }} />
                  </div>
                  <span style={{ fontSize: "12px", color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pair.toMailId}
                  </span>
                </div>
              </div>
            )) : (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
                No mappings to preview
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default EmailOptions;
