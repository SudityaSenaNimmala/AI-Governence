import React, { useMemo, useState } from "react";
import { Eye, Link2, Pencil, Shield, User, UserX } from "lucide-react";
import Popup from "../../../Resuables/Popup/Popup";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import SvgName from "../../../Testing/SvgName";
import "./CollaboratorsPopup.css";
import { getMaxChar } from "../../../helpers/utils";

const ACCESS_FILTER_OPTIONS = [
    { value: "all", label: "All" },
    { value: "OWNER", label: "Owner" },
    { value: "EDITOR", label: "Editor" },
    { value: "VISITOR", label: "Visitor" },
];

const getDisplayName = (c) => {
    if (c.type === "LINK") return "Link";
    if (c.email) return c.email.split("@")[0] || c.email;
    return "";
};

const getInitialsName = (c) => {
    if (c.type === "LINK") return "Link";
    return c.email || "?";
};

const sortWithOwnerFirst = (list) => {
    if (!list || !list.length) return list;
    return [...list].sort((a, b) => {
        const aOwner = (a.access || "").toUpperCase() === "OWNER" ? 1 : 0;
        const bOwner = (b.access || "").toUpperCase() === "OWNER" ? 1 : 0;
        return bOwner - aOwner;
    });
};

const TypeIcon = ({ type }) => {
    if (type === "LINK") return <Link2 size={16} className="collab-popup__icon" title="Link" color="red" />;
    return "";
    // return <User size={16} className="collab-popup__icon" title="User" />;
};

const AccessIcon = ({ access }) => {
    const a = (access || "").toUpperCase();
    if (a === "OWNER") return <Shield size={16} className="collab-popup__icon" title="Owner" />;
    if (a === "EDITOR") return <Pencil size={16} className="collab-popup__icon" title="Editor" />;
    if (a === "VISITOR") return <Eye size={16} className="collab-popup__icon" title="Visitor" />;
    return null;
};

const StatusIcons = ({ external, anonymous }) => {
    if (!external && !anonymous) return null;
    return (
        <span className="collab-popup__status-icons">
            {external && <span className="collab-popup__tag collab-popup__tag--external">External</span>}
            {anonymous && <Link2 size={16} className="collab-popup__icon collab-popup__icon--anon" title="Anonymous link" color="red" />}
        </span>
    );
};

const CollaboratorsPopup = ({
    isOpen,
    onClose,
    collaborators = [],
    itemName = "",
    isLoading = false,
    onRevokeAccess,
    currentUserEmail,
}) => {
    const [searchInput, setSearchInput] = useState("");
    const [accessFilter, setAccessFilter] = useState("all");

    const sortedCollaborators = useMemo(() => sortWithOwnerFirst(collaborators), [collaborators]);

    const filteredCollaborators = useMemo(() => {
        let list = sortedCollaborators;
        const q = (searchInput || "").trim().toLowerCase();
        if (q) {
            list = list.filter((c) => {
                const name = getDisplayName(c).toLowerCase();
                const email = (c.email || "").toLowerCase();
                const type = (c.type || "").toLowerCase();
                return name.includes(q) || email.includes(q) || (type === "link" && ("link".includes(q) || "shared".includes(q)));
            });
        }
        if (accessFilter !== "all") {
            list = list.filter((c) => (c.access || "").toUpperCase() === accessFilter);
        }
        return list;
    }, [sortedCollaborators, searchInput, accessFilter]);

    return (
        <Popup
            toggleOpen={() => onClose?.()}
            options={{
                isOpen: !!isOpen,
                title: itemName ? `Collaborators – ${getMaxChar(itemName, 60)}` : "Collaborators",
                oTitle: itemName ? `Collaborators – ${itemName}` : "Collaborators",
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
            <div className="collab-popup__body">
                {!isLoading && collaborators.length > 0 && (
                    <div className="collab-popup__toolbar">
                        <SearchComponent
                            autoOpen
                            defaultVal={searchInput}
                            canResetDefaultVal
                            inputPlaceHolder="Search collaborators..."
                            onInputSearch={({ searchInput: val }) => setSearchInput(val ?? "")}
                            customStyles={{ minWidth: "200px" }}
                        />
                        <span style={{ marginLeft: "auto" }}></span>
                        <select
                            className="collab-popup__access-filter"
                            value={accessFilter}
                            onChange={(e) => setAccessFilter(e.target.value)}
                            aria-label="Filter by access"
                        >
                            {ACCESS_FILTER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {isLoading ? (
                    <div className="collab-popup__loading">{getCFTextLoader()}</div>
                ) : collaborators.length === 0 ? (
                    <div className="collab-popup__empty">No collaborators for this item.</div>
                ) : filteredCollaborators.length === 0 ? (
                    <div className="collab-popup__empty">No collaborators match your search or filter.</div>
                ) : (
                    <ul className="collab-popup__list" role="list">
                        {filteredCollaborators.map((c, i) => {
                            const isCurrentUser = currentUserEmail && c.email && c.email.toLowerCase() === currentUserEmail.toLowerCase();
                            const isOwner = (c.access || "").toUpperCase() === "OWNER";
                            const canRevoke = onRevokeAccess && !isOwner;
                            return (
                                <li key={c.collabartionId || i} className="collab-popup__item">
                                    <div className="collab-popup__item-avatar">
                                        <SvgName name={getInitialsName(c)} type="circle" />
                                    </div>
                                    <div className="collab-popup__item-main">
                                        <div className="collab-popup__item-name">
                                            {getDisplayName(c)} <span className="collab-popup__meta-cell" title={c.externalCollabarator ? "External" : c.containAnnonimousLink ? "Anonymous link" : "Internal"}>
                                                <StatusIcons external={c.externalCollabarator} anonymous={c.containAnnonimousLink} />
                                            </span>
                                            {isCurrentUser && <span className="collab-popup__you"> (you)</span>}
                                        </div>
                                        <div className="collab-popup__item-email" title={c.email || (c.type === "LINK" ? "Link" : undefined)}>
                                            {c.type === "LINK" ? "Shared link" : (c.email || "")}
                                        </div>
                                    </div>
                                    <div className="collab-popup__item-meta">
                                        <span className="collab-popup__meta-cell" title={c.type}>
                                            <TypeIcon type={c.type} />
                                        </span>
                                        <span className="collab-popup__meta-cell" title={c.access}>
                                            <AccessIcon access={c.access} />
                                        </span>
                                    </div>
                                    {canRevoke && (
                                        <button
                                            type="button"
                                            className="collab-popup__revoke"
                                            onClick={() => onRevokeAccess(c)}
                                            title="Revoke access"
                                        >
                                            {/* <UserX size={16} /> */}
                                            <span>Revoke</span>
                                        </button>
                                    )}
                                    {isOwner && (
                                        <span className="collab-popup__owner-label" title="Owner cannot be revoked">
                                            Owner
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </Popup>
    );
};

export default CollaboratorsPopup;
