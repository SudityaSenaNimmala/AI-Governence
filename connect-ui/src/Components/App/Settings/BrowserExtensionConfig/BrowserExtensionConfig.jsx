import { useEffect, useState } from "react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import Popup from "../../../Resuables/Popup/Popup";
import { BriefcaseBusiness, Building, Globe, Pencil, Plus, Trash2, User } from "lucide-react";
import { getOrgLevelBrowserExtensionConfig as fetchOrgLevelConfig, saveBrowserExtensionConfig } from "./BrowserExtensionActions";
import { notifyToast } from "../../../helpers/utils";
import "../../Data/DataPolicy/DataPolicy.css";
import { getCFLoader, getCFTextLoader } from "../../../Resuables/Loaders/Loaders";

const BrowserExtensionConfig = () => {
    const [viewType, setViewType] = useState("ORG_LEVEL");

    const [orgLevelBrowserExtensionConfig, setOrgLevelBrowserExtensionConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [addDomainPopupOpen, setAddDomainPopupOpen] = useState(false);
    const [addDomainMode, setAddDomainMode] = useState("normal"); // "normal" | "buildList"
    const [addDomainForm, setAddDomainForm] = useState({ domain: "", alternateDomain: "", domainList: "" });
    const [editDomainPopupOpen, setEditDomainPopupOpen] = useState(false);
    const [editingDomainIndex, setEditingDomainIndex] = useState(null);
    const [editAlternateDomain, setEditAlternateDomain] = useState("");
    const [isPageLoading, setIsPageLoading] = useState(false);
    const menuList = [
        { icon: <Globe size={14} />, title: "Org Level", value: "ORG_LEVEL" },
        { icon: <Building size={14} />, title: "Department Level", value: "DEPARTMENT_LEVEL" },
        { icon: <BriefcaseBusiness size={14} />, title: "Role Level", value: "ROLE_LEVEL" },
        { icon: <User size={14} />, title: "User Level", value: "USER_LEVEL" },
    ];

    const blockedDomains = Array.isArray(orgLevelBrowserExtensionConfig?.blockedDomains)
        ? orgLevelBrowserExtensionConfig.blockedDomains
        : [];

    const loadConfig = async () => {
        setLoading(true);
        const res = await fetchOrgLevelConfig();
        if (res?.status === "OK") {
            const raw = res?.res ?? res?.data;
            const config = raw?.data ?? raw;
            setOrgLevelBrowserExtensionConfig(config ?? null);
        } else {
            setOrgLevelBrowserExtensionConfig(null);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (viewType === "ORG_LEVEL") loadConfig();
    }, [viewType]);

    const handleAddDomain = () => {
        setAddDomainForm({ domain: "", alternateDomain: "", domainList: "" });
        setAddDomainMode("normal");
        setAddDomainPopupOpen(true);
    };

    const handleSaveNewDomain = async () => {
        setIsPageLoading(true);
        setAddDomainPopupOpen(false);
        const existing = blockedDomains.map((d) => ({
            domain: d.domain ?? "",
            alternateDomain: d.alternateDomain ?? "",
        }));

        if (addDomainMode === "buildList") {
            const listStr = (addDomainForm.domainList || "").trim();
            if (!listStr) {
                notifyToast("error", "Enter at least one domain.");
                return;
            }
            const domains = listStr
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (domains.length === 0) {
                notifyToast("error", "Enter at least one domain.");
                return;
            }
            const newEntries = domains.map((domain) => ({ domain, alternateDomain: null }));
            const newList = [...existing, ...newEntries];
            const payload = { ...orgLevelBrowserExtensionConfig, blockedDomains: newList };
            const res = await saveBrowserExtensionConfig(payload);
            if (res?.status === "OK") {
                setOrgLevelBrowserExtensionConfig((prev) => (prev ? { ...prev, blockedDomains: newList } : { blockedDomains: newList }));
                setIsPageLoading(false);
                notifyToast("success", `${domains.length} domain(s) added.`);
            } else {
                notifyToast("error", res?.res ?? "Failed to add domains.");
                setIsPageLoading(false);
            }
            return;
        }

        const { domain, alternateDomain } = addDomainForm;
        const trimmedDomain = (domain || "").trim();
        if (!trimmedDomain) {
            notifyToast("error", "Domain is required.");
            return;
        }
        const newList = [
            ...existing,
            { domain: trimmedDomain, alternateDomain: (alternateDomain || "").trim() || null },
        ];
        const payload = { ...orgLevelBrowserExtensionConfig, blockedDomains: newList };
        const res = await saveBrowserExtensionConfig(payload);
        if (res?.status === "OK") {
            setIsPageLoading(false);
            setOrgLevelBrowserExtensionConfig((prev) => (prev ? { ...prev, blockedDomains: newList } : { blockedDomains: newList }));
            setAddDomainPopupOpen(false);
            notifyToast("success", "Domain added.");
        } else {
            setIsPageLoading(false);
            notifyToast("error", res?.res ?? "Failed to add domain.");
        }
    };

    const handleEditAlternateDomain = (index) => {
        const item = blockedDomains[index];
        if (!item) return;
        setEditingDomainIndex(index);
        setEditAlternateDomain(item.alternateDomain ?? "");
        setEditDomainPopupOpen(true);
    };

    const handleSaveEditAlternateDomain = async () => {
        setIsPageLoading(true);
        setEditDomainPopupOpen(false);
        if (editingDomainIndex == null) return;
        const newList = blockedDomains.map((d, i) => ({
            domain: d.domain ?? "",
            alternateDomain: i === editingDomainIndex ? (editAlternateDomain || "").trim() || null : (d.alternateDomain ?? ""),
        }));
        const payload = { ...orgLevelBrowserExtensionConfig, blockedDomains: newList };
        const res = await saveBrowserExtensionConfig(payload);
        if (res?.status === "OK") {
            setIsPageLoading(false);
            setOrgLevelBrowserExtensionConfig((prev) => (prev ? { ...prev, blockedDomains: newList } : { blockedDomains: newList }));
            setEditingDomainIndex(null);
            notifyToast("success", "Alternate domain updated.");
        } else {
            setIsPageLoading(false);
            notifyToast("error", res?.res ?? "Failed to update.");
        }
    };

    const handleRemoveDomain = async (index) => {
        setIsPageLoading(true);
        const newList = blockedDomains.filter((_, i) => i !== index).map((d) => ({ domain: d.domain ?? "", alternateDomain: d.alternateDomain ?? "" }));
        const payload = { ...orgLevelBrowserExtensionConfig, blockedDomains: newList };
        const res = await saveBrowserExtensionConfig(payload);
        if (res?.status === "OK") {
            setIsPageLoading(false);
            setOrgLevelBrowserExtensionConfig((prev) => (prev ? { ...prev, blockedDomains: newList } : { blockedDomains: newList }));
            notifyToast("success", "Domain removed.");
        } else {
            setIsPageLoading(false);
            notifyToast("error", res?.res ?? "Failed to remove domain.");
        }
    };

    return (
        <div className="cf_main_container">
            <SideNav activeTab="User Management" />
            <div className="cf_main_content_place">
                <TopNav
                    pageName="Browser Extension Config"
                    backLink="/UserManagement"
                />
                <div
                    className="cf_main_content_place_main"
                    style={{ padding: "10px 0", gap: "15px" }}
                >
                    <div className="deep-drive__toolbar CF_d-flex">
                        <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: "0", width: "fit-content" }}>
                            <div className="cf_graph_toggler" style={{ backgroundColor: "#f2f3ff" }}>
                                {menuList.map((item) => (
                                    <div
                                        key={item.value}
                                        className={`cf_graph_toggler_item blueActive ${viewType === item.value ? "cf_graph_toggler_item_active cf_active_blue" : ""}`}
                                        onClick={() => setViewType(item.value)}
                                        style={{ gap: "6px" }}
                                    >
                                        {item.icon}
                                        <span style={{ fontSize: "12px" }}>{item.title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {viewType === "ORG_LEVEL" && (
                        <div style={{ marginTop: "16px" }}>
                            <div className="CF_d-flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Blocked Domains</h3>
                                <ActionButton
                                    customClass="changeButtonColorOnHover"
                                    buttonType="button"
                                    buttonClickAction={handleAddDomain}
                                    customStyles={{ backgroundColor: "#f2f2f2" }}
                                >
                                    <div className="CF_d-flex ai-center" style={{ gap: "6px" }}>
                                        <Plus size={16} />
                                        <span style={{ fontSize: "14px" }}>Add domain</span>
                                    </div>
                                </ActionButton>
                            </div>
                            {loading ? (
                                <p style={{ color: "#666" }}>{getCFTextLoader()}</p>
                            ) : blockedDomains.length === 0 ? (
                                <p style={{ color: "#666" }}>No blocked domains configured.</p>
                            ) : (
                                <div style={{ border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ backgroundColor: "#f5f5f5" }}>
                                                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "12px", fontWeight: 600 }}>Domain</th>
                                                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "12px", fontWeight: 600 }}>Alternate domain</th>
                                                <th style={{ padding: "10px 12px", width: "100px" }} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {blockedDomains.map((item, index) => (
                                                <tr key={index} style={{ borderTop: "1px solid #eee" }}>
                                                    <td style={{ padding: "10px 12px" }}>{item.domain ?? "—"}</td>
                                                    <td style={{ padding: "10px 12px" }}>{item.alternateDomain || "—"}</td>
                                                    <td style={{ padding: "10px 12px", display: "flex", gap: "8px", alignItems: "center" }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditAlternateDomain(index)}
                                                            title="Edit alternate domain"
                                                            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#0062ff" }}
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveDomain(index)}
                                                            title="Remove"
                                                            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#c62828" }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <Popup
                options={{
                    isOpen: addDomainPopupOpen,
                    title: `Add Blocked Domain`,
                    popupWidth: "400px",
                    popupHeight: "fit-content",
                    popupTop: "150px",
                    maxHeight: "100%",
                    overflowY: "auto",
                    parentStyles: {},
                }}
                toggleOpen={setAddDomainPopupOpen}
            >
                <div
                    className="cf_popup_container_body"
                    style={{ padding: "20px 10px", flexDirection: "column", gap: "20px" }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px", width: "100%" }}>
                        <span>Bulk:</span>
                        <ActionButton
                            buttonType="button"
                            buttonClickAction={() => setAddDomainMode((prev) => (prev === "normal" ? "buildList" : "normal"))}
                            customClass={`data-policy__toggle ${addDomainMode === "buildList" ? "data-policy__toggle--on" : ""}`}
                            title={addDomainMode === "buildList" ? "Switch to Normal" : "Switch to Build list"}
                        >
                            <span className="data-policy__toggle-thumb" />
                        </ActionButton>
                    </div>

                    {addDomainMode === "normal" ? (
                        <>
                            <TextInput
                                type="text"
                                inputName="domain"
                                placeHolder="Domain To Block *"
                                defaultValue={addDomainForm.domain}
                                getInputText={(val, name) => setAddDomainForm((prev) => ({ ...prev, [name]: val }))}
                                inputWidth="100%"
                            />
                            <TextInput
                                type="text"
                                inputName="alternateDomain"
                                placeHolder="Alternate domain"
                                defaultValue={addDomainForm.alternateDomain}
                                getInputText={(val, name) => setAddDomainForm((prev) => ({ ...prev, [name]: val }))}
                                inputWidth="100%"
                            />
                        </>
                    ) : (
                        <div style={{ width: "100%" }}>
                            <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 500 }}>Domains to block (comma-separated) *</label>
                            <textarea
                                name="domainList"
                                value={addDomainForm.domainList}
                                onChange={(e) => setAddDomainForm((prev) => ({ ...prev, domainList: e.target.value }))}
                                placeholder="e.g. example.com, foo.org, bar.net"
                                rows={3}
                                style={{
                                    width: "100%",
                                    padding: "8px 10px",
                                    border: "1px solid #ccc",
                                    borderRadius: "6px",
                                    fontSize: "14px",
                                    resize: "vertical",
                                    boxSizing: "border-box",
                                }}
                            />
                            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#666" }}>
                                Enter multiple domains separated by commas. Alternate domain is not used.
                            </p>
                        </div>
                    )}
                </div>
                <div className="cf_popup_container_footer" style={{ gap: "20px", justifyContent: "flex-end" }}>
                    <ActionButton
                        customClass="changeButtonColorOnHover"
                        buttonType="button"
                        buttonClickAction={() => setAddDomainPopupOpen(false)}
                        customStyles={{ backgroundColor: "#f2f2f2" }}
                    >
                        Cancel
                    </ActionButton>
                    <ActionButton
                        customClass="changeButtonColorOnHover"
                        buttonType="button"
                        buttonClickAction={handleSaveNewDomain}
                        customStyles={{ backgroundColor: "#0062ff", color: "#fff" }}
                    >
                        Save
                    </ActionButton>
                </div>
            </Popup>

            <Popup
                options={{
                    isOpen: editDomainPopupOpen,
                    title: "Edit alternate domain",
                    popupWidth: "400px",
                    popupHeight: "fit-content",
                    popupTop: "150px",
                    maxHeight: "100%",
                    overflowY: "auto",
                    parentStyles: {},
                }}
                toggleOpen={() => { setEditDomainPopupOpen(false); setEditingDomainIndex(null); }}
            >
                <div className="cf_popup_container_body" style={{ padding: "20px 10px", flexDirection: "column", gap: "20px" }}>
                    {editingDomainIndex != null && blockedDomains[editingDomainIndex] && (
                        <>
                            <TextInput
                                key={"tet"}
                                type="text"
                                inputName="alternateDomain"
                                placeHolder="Blocked Domain"
                                defaultValue={blockedDomains[editingDomainIndex].domain ?? ""}
                                getInputText={(val) => setEditAlternateDomain(val)}
                                inputWidth="100%"
                                readOnly={true}
                            />

                            <TextInput
                                key={editingDomainIndex}
                                type="text"
                                inputName="alternateDomain"
                                placeHolder="Alternate domain"
                                defaultValue={editAlternateDomain}
                                getInputText={(val) => setEditAlternateDomain(val)}
                                inputWidth="100%"
                                autoFocus={true}
                            />
                        </>
                    )}
                </div>
                <div className="cf_popup_container_footer" style={{ gap: "20px", justifyContent: "flex-end" }}>
                    <ActionButton
                        customClass="changeButtonColorOnHover"
                        buttonType="button"
                        buttonClickAction={() => { setEditDomainPopupOpen(false); setEditingDomainIndex(null); }}
                        customStyles={{ backgroundColor: "#f2f2f2" }}
                    >
                        Cancel
                    </ActionButton>
                    <ActionButton
                        customClass="changeButtonColorOnHover"
                        buttonType="button"
                        buttonClickAction={handleSaveEditAlternateDomain}
                        customStyles={{ backgroundColor: "#0062ff", color: "#fff" }}
                    >
                        Save
                    </ActionButton>
                </div>
            </Popup>
            {isPageLoading && getCFLoader()}
        </div>
    )
}

export default BrowserExtensionConfig;