import { Clock, Copy, Globe, Mail, Pencil, Plus, Save, Trash2 } from "lucide-react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import Popup from "../../../Resuables/Popup/Popup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./DataPolicy.css";
import {
    ACTION,
    POLICY_TYPE,
    ACTION_OPTIONS,
    DATA_POLICY_APPLICATION_OPTIONS,
    RULES_BY_POLICY_TYPE,
    getActionLabel,
    getRuleLabel,
} from "./dataPolicyConstants";
import {
    deriveDocumentTypeFields,
    fetchContentSprawlPolicies,
    saveContentSprawlPolicyDocument,
} from "./DataPolicyActions";
import { notifyToast } from "../../../helpers/utils";
import { getCloudName } from "../../../helpers/helpers";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const defaultRuleForPolicyType = (policyType) => {
    const list = RULES_BY_POLICY_TYPE[policyType];
    return list?.[0] ?? null;
};

const createEmptyPolicyForm = (policyTypeForRuleDefaults) => ({
    applicationName: "",
    title: "",
    emailNotifyList: [],
    emailInput: "",
    allowedExternalDomains: [],
    domainInput: "",
    action: ACTION.EMAIL_NOTIFY,
    rule: defaultRuleForPolicyType(policyTypeForRuleDefaults),
});

const newClientKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** UI row = API POLICY + clientKey; API uses `active` (not enabled). */
const attachClientKeys = (docId, apiPolicies) =>
    (apiPolicies || []).map((p, i) => ({
        ...p,
        active: p.active !== false,
        clientKey: `${docId}-${i}`,
    }));

const formatApplicationLabel = (cloudKey) =>
    (cloudKey && (getCloudName(cloudKey) || cloudKey.replace(/_/g, " "))) || "";

const DataPolicy = () => {
    const [viewType, setViewType] = useState(POLICY_TYPE.EXTERNAL_SHARING);
    const [documentMeta, setDocumentMeta] = useState(null);
    const [policies, setPolicies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [policyPopupOpen, setPolicyPopupOpen] = useState(false);
    const [editingClientKey, setEditingClientKey] = useState(null);
    const [policyForm, setPolicyForm] = useState(() => createEmptyPolicyForm(POLICY_TYPE.EXTERNAL_SHARING));
    const [isPageLoading, setIsPageLoading] = useState(true);
    const documentMetaRef = useRef(documentMeta);
    const policiesRef = useRef(policies);
    useEffect(() => {
        documentMetaRef.current = documentMeta;
    }, [documentMeta]);
    useEffect(() => {
        policiesRef.current = policies;
    }, [policies]);

    const filteredPolicies = useMemo(
        () => policies.filter((p) => p.policyType === viewType),
        [policies, viewType]
    );

    const ruleOptionsForForm = useMemo(() => RULES_BY_POLICY_TYPE[viewType] || [], [viewType]);

    const applicationSelectOptions = useMemo(() => {
        const current = policyForm.applicationName;
        if (current && !DATA_POLICY_APPLICATION_OPTIONS.some((o) => o.value === current)) {
            return [
                { value: current, label: formatApplicationLabel(current) || current },
                ...DATA_POLICY_APPLICATION_OPTIONS,
            ];
        }
        return DATA_POLICY_APPLICATION_OPTIONS;
    }, [policyForm.applicationName]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setIsPageLoading(true);
            const res = await fetchContentSprawlPolicies();
            if (cancelled) return;
            setLoading(false);
            if (res.status !== "OK") {
                setIsPageLoading(false);
                notifyToast("error", "Failed to load data policies");
                return;
            } else {
                setIsPageLoading(false);
            }
            const list = Array.isArray(res.res) ? res.res : [];
            const doc = list[0];
            if (!doc) {
                documentMetaRef.current = null;
                setDocumentMeta(null);
                setPolicies([]);
                return;
            }
            const meta = {
                id: doc.id,
                userId: doc.userId,
                createdTime: doc.createdTime,
                updatedTime: doc.updatedTime,
                external: doc.external ?? null,
                stale: doc.stale ?? null,
            };
            documentMetaRef.current = meta;
            setDocumentMeta(meta);
            setPolicies(attachClientKeys(doc.id, doc.policies));
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const applyDocumentFromApi = useCallback((doc) => {
        const nextMeta = {
            id: doc.id,
            userId: doc.userId,
            createdTime: doc.createdTime,
            updatedTime: doc.updatedTime,
            external: doc.external ?? null,
            stale: doc.stale ?? null,
            duplicate: doc.duplicate ?? null,
        };
        documentMetaRef.current = nextMeta;
        setDocumentMeta(nextMeta);
        setPolicies(attachClientKeys(doc.id, doc.policies));
    }, []);

    const persistPolicies = useCallback(
        async (nextPolicies) => {
            setSaving(true);
            try {
                const meta = documentMetaRef.current;
                const apiPolicies = nextPolicies.map(({ clientKey, ...rest }) => rest);
                const { external, stale } = deriveDocumentTypeFields(apiPolicies);
                const body = {
                    ...(meta?.id ? { id: meta.id } : {}),
                    ...(meta?.userId ? { userId: meta.userId } : {}),
                    ...(meta?.createdTime != null ? { createdTime: meta.createdTime } : {}),
                    policies: apiPolicies,
                    external,
                    stale,
                };
                setIsPageLoading(true);
                const res = await saveContentSprawlPolicyDocument(body);
                if (res.status !== "OK") {
                    const msg =
                        (typeof res.res === "string" && res.res) ||
                        res.res?.message ||
                        "Failed to save policy";
                    notifyToast("error", msg);
                    return false;
                }
                const saved = res.res;
                if (saved && Array.isArray(saved.policies) && saved.id) {
                    applyDocumentFromApi(saved);
                    return true;
                }
                const refresh = await fetchContentSprawlPolicies();
                if (refresh.status !== "OK") {
                    notifyToast("error", "Saved but failed to reload policies");
                    return false;
                }
                const list = Array.isArray(refresh.res) ? refresh.res : [];
                const doc =
                    (saved?.id && list.find((d) => d.id === saved.id)) || list[0];
                if (doc) {
                    applyDocumentFromApi(doc);
                    return true;
                }
                notifyToast("error", "Saved but no policy document was returned");
                return false;
            } finally {
                setIsPageLoading(false);
                setSaving(false);
            }
        },
        [applyDocumentFromApi]
    );

    useEffect(() => {
        if (!policyPopupOpen) return;
        setPolicyForm((prev) => {
            const allowed = RULES_BY_POLICY_TYPE[viewType] || [];
            const needsRuleFix = !allowed.includes(prev.rule);
            const needsDomainClear =
                viewType !== POLICY_TYPE.EXTERNAL_SHARING &&
                (prev.allowedExternalDomains.length > 0 || prev.domainInput);
            if (!needsRuleFix && !needsDomainClear) return prev;
            return {
                ...prev,
                ...(needsRuleFix ? { rule: allowed[0] ?? null } : {}),
                ...(needsDomainClear ? { allowedExternalDomains: [], domainInput: "" } : {}),
            };
        });
    }, [viewType, policyPopupOpen]);

    const openAddPolicy = useCallback(() => {
        setEditingClientKey(null);
        setPolicyForm(createEmptyPolicyForm(viewType));
        setPolicyPopupOpen(true);
    }, [viewType]);

    const openEditPolicy = useCallback((clientKey) => {
        const policy = policiesRef.current.find((p) => p.clientKey === clientKey);
        if (!policy) return;
        setEditingClientKey(clientKey);
        setPolicyForm({
            applicationName: policy.applicationName || "",
            title: policy.title || "",
            emailNotifyList: [...(policy.emailNotifyList || [])],
            emailInput: "",
            allowedExternalDomains: [...(policy.allowedExternalDomains || [])],
            domainInput: "",
            action: policy.action || ACTION.EMAIL_NOTIFY,
            rule: policy.rule || defaultRuleForPolicyType(policy.policyType || POLICY_TYPE.EXTERNAL_SHARING),
        });
        setPolicyPopupOpen(true);
    }, []);

    const togglePolicyActive = useCallback(
        async (clientKey) => {
            const prev = policiesRef.current;
            const next = prev.map((p) => (p.clientKey === clientKey ? { ...p, active: !p.active } : p));
            await persistPolicies(next);
        },
        [persistPolicies]
    );

    const deletePolicy = useCallback(
        async (clientKey) => {
            const prev = policiesRef.current;
            const next = prev.filter((p) => p.clientKey !== clientKey);
            await persistPolicies(next);
        },
        [persistPolicies]
    );

    const addEmailToForm = useCallback(() => {
        const email = policyForm.emailInput?.trim();
        if (!email || policyForm.emailNotifyList.includes(email)) return;
        setPolicyForm((prev) => ({
            ...prev,
            emailNotifyList: [...prev.emailNotifyList, email],
            emailInput: "",
        }));
    }, [policyForm.emailInput, policyForm.emailNotifyList]);

    const removeEmailFromForm = useCallback((email) => {
        setPolicyForm((prev) => ({
            ...prev,
            emailNotifyList: prev.emailNotifyList.filter((e) => e !== email),
        }));
    }, []);

    const addDomainToForm = useCallback(() => {
        const domain = policyForm.domainInput?.trim().toLowerCase();
        if (!domain || policyForm.allowedExternalDomains.includes(domain)) return;
        setPolicyForm((prev) => ({
            ...prev,
            allowedExternalDomains: [...prev.allowedExternalDomains, domain],
            domainInput: "",
        }));
    }, [policyForm.domainInput, policyForm.allowedExternalDomains]);

    const removeDomainFromForm = useCallback((domain) => {
        setPolicyForm((prev) => ({
            ...prev,
            allowedExternalDomains: prev.allowedExternalDomains.filter((d) => d !== domain),
        }));
    }, []);

    const handleSavePolicy = useCallback(async () => {
        const { applicationName, title, emailNotifyList, allowedExternalDomains, action, rule } = policyForm;
        if (!title?.trim() || !applicationName?.trim()) return;

        const payload = {
            applicationName: applicationName.trim(),
            title: title.trim(),
            emailNotifyList: [...emailNotifyList],
            allowedExternalDomains:
                viewType === POLICY_TYPE.EXTERNAL_SHARING ? [...allowedExternalDomains] : [],
            policyType: viewType,
            action,
            rule,
        };

        const prev = policiesRef.current;
        let nextPolicies;
        if (editingClientKey) {
            nextPolicies = prev.map((p) => (p.clientKey === editingClientKey ? { ...p, ...payload } : p));
        } else {
            nextPolicies = [...prev, { ...payload, active: true, clientKey: newClientKey() }];
        }

        const ok = await persistPolicies(nextPolicies);
        if (ok) {
            setEditingClientKey(null);
            setPolicyPopupOpen(false);
        }
    }, [policyForm, editingClientKey, viewType, persistPolicies]);

    const menuList = [
        { icon: <Globe size={14} />, title: "External Sharing", value: POLICY_TYPE.EXTERNAL_SHARING },
        { icon: <Clock size={14} />, title: "Stale Content", value: POLICY_TYPE.STALE_CONTENT },
        { icon: <Copy size={14} />, title: "Duplicate Content", value: POLICY_TYPE.DUPLICATE_FILES },
    ];

    return (
        <>
            <div className="cf_main_container">
                <SideNav activeTab="Data" />
                <div className="cf_main_content_place">
                    <TopNav pageName="Data Policy" backLink="/Data" />
                    <div className="data-policy__wrap" style={{ marginTop: "20px" }}>
                        <div className="deep-drive__toolbar CF_d-flex">
                            <div
                                className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
                                style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "0",
                                    width: "fit-content",
                                }}
                            >
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

                        <section className="data-policy__section">
                            <div className="data-policy__section-header">
                                <div className="data-policy__section-head">
                                    <h2 className="data-policy__section-title">
                                        {viewType === POLICY_TYPE.EXTERNAL_SHARING
                                            ? "External Sharing Policies"
                                            : viewType === POLICY_TYPE.STALE_CONTENT
                                                ? "Stale Content Policies"
                                                : "Duplicate Content Policies"}
                                    </h2>
                                    <p className="data-policy__section-subtitle">
                                        {viewType === POLICY_TYPE.EXTERNAL_SHARING
                                            ? "Configure external sharing rules, domains, and notifications"
                                            : viewType === POLICY_TYPE.STALE_CONTENT
                                                ? "Configure stale content thresholds and actions"
                                                : "Configure duplicate file detection and actions"}
                                    </p>
                                </div>
                                <ActionButton
                                    buttonType="button"
                                    buttonClickAction={openAddPolicy}
                                    customClass="data-policy__add-btn"
                                    title="Add Policy"
                                    isDisabled={loading || saving}
                                >
                                    <Plus size={18} />
                                    Add Policy
                                </ActionButton>
                            </div>
                            <div className="data-policy__card">
                                {loading ? (
                                    <p className="data-policy__empty-hint" style={{ padding: "1rem", color: "#64748b" }}>
                                        Loading policies…
                                    </p>
                                ) : filteredPolicies.length === 0 ? (
                                    <p className="data-policy__empty-hint" style={{ padding: "1rem", color: "#64748b" }}>
                                        No policies yet. Add a policy to get started.
                                    </p>
                                ) : (
                                    filteredPolicies.map((policy) => (
                                        <div key={policy.clientKey} className="data-policy__row">
                                            <ActionButton
                                                buttonType="button"
                                                buttonClickAction={() => togglePolicyActive(policy.clientKey)}
                                                customClass={`data-policy__toggle ${policy.active ? "data-policy__toggle--on" : ""}`}
                                                title={policy.active ? "Turn off" : "Turn on"}
                                                isDisabled={saving}
                                            >
                                                <span className="data-policy__toggle-thumb" />
                                            </ActionButton>
                                            <div className="data-policy__row-external-main">
                                                <span className="data-policy__row-name">{policy.title}</span>
                                                <div className="data-policy__row-external-meta">
                                                    <span className="data-policy__scope-badge">
                                                        {formatApplicationLabel(policy.applicationName) ||
                                                            policy.applicationName}
                                                    </span>
                                                    <span className="data-policy__action-badge">{getActionLabel(policy.action)}</span>
                                                    <span className="data-policy__tag">{getRuleLabel(policy.rule)}</span>
                                                    {policy.action === ACTION.EMAIL_NOTIFY && policy.emailNotifyList?.length > 0 && (
                                                        <span className="data-policy__notification-badge">
                                                            <Mail size={14} />
                                                            {policy.emailNotifyList.length} recipient(s)
                                                        </span>
                                                    )}
                                                    {policy.policyType === POLICY_TYPE.EXTERNAL_SHARING && (
                                                        <div className="data-policy__tags">
                                                            {(policy.allowedExternalDomains || []).map((domain) => (
                                                                <span
                                                                    key={domain}
                                                                    className="data-policy__tag data-policy__tag--domain"
                                                                >
                                                                    {domain}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="data-policy__actions">
                                                <ActionButton
                                                    buttonType="button"
                                                    buttonClickAction={() => openEditPolicy(policy.clientKey)}
                                                    customClass="data-policy__action-btn"
                                                    title="Edit"
                                                    isDisabled={saving}
                                                >
                                                    <Pencil size={16} />
                                                </ActionButton>
                                                <ActionButton
                                                    buttonType="button"
                                                    buttonClickAction={() => deletePolicy(policy.clientKey)}
                                                    customClass="data-policy__action-btn data-policy__action-btn--danger"
                                                    title="Delete"
                                                    isDisabled={saving}
                                                >
                                                    <Trash2 size={16} />
                                                </ActionButton>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </div>
                </div>

                <Popup
                    toggleOpen={setPolicyPopupOpen}
                    options={{
                        isOpen: policyPopupOpen,
                        title: editingClientKey ? "Edit Policy" : "Add Policy",
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
                >
                    <div className="data-policy__popup-body">
                        <div className="data-policy__field">
                            <label className="data-policy__label">Application name</label>
                            <select
                                className="data-policy__select"
                                value={policyForm.applicationName}
                                onChange={(e) =>
                                    setPolicyForm((prev) => ({ ...prev, applicationName: e.target.value }))
                                }
                            >
                                <option value="">Select application</option>
                                {applicationSelectOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {getCloudName(opt.label)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="data-policy__field">
                            <label className="data-policy__label">Title</label>
                            <input
                                type="text"
                                className="data-policy__input"
                                placeholder="Policy title"
                                value={policyForm.title}
                                onChange={(e) => setPolicyForm((prev) => ({ ...prev, title: e.target.value }))}
                            />
                        </div>
                        <div className="data-policy__field">
                            <label className="data-policy__label">Rule</label>
                            <select
                                className="data-policy__select"
                                value={policyForm.rule || ""}
                                onChange={(e) => setPolicyForm((prev) => ({ ...prev, rule: e.target.value }))}
                            >
                                {ruleOptionsForForm.map((r) => (
                                    <option key={r} value={r}>
                                        {getRuleLabel(r)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="data-policy__field">
                            <label className="data-policy__label">Action</label>
                            <select
                                className="data-policy__select"
                                value={policyForm.action}
                                onChange={(e) => setPolicyForm((prev) => ({ ...prev, action: e.target.value }))}
                            >
                                {ACTION_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="data-policy__field">
                            <label className="data-policy__label">Email notify list</label>
                            <div className="data-policy__domain-row">
                                <input
                                    type="email"
                                    className="data-policy__input"
                                    placeholder="user@company.com"
                                    value={policyForm.emailInput}
                                    onChange={(e) =>
                                        setPolicyForm((prev) => ({ ...prev, emailInput: e.target.value }))
                                    }
                                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmailToForm())}
                                />
                                <ActionButton
                                    buttonType="button"
                                    buttonClickAction={addEmailToForm}
                                    customClass="data-policy__add-domain-btn CF_d-flex ai-center"
                                    title="Add email"
                                >
                                    <span>Add</span>
                                </ActionButton>
                            </div>
                            {policyForm.emailNotifyList.length > 0 && (
                                <div className="data-policy__domain-pills">
                                    {policyForm.emailNotifyList.map((email) => (
                                        <span key={email} className="data-policy__tag data-policy__tag--domain">
                                            {email}
                                            <button
                                                type="button"
                                                className="data-policy__domain-pill-remove"
                                                onClick={() => removeEmailFromForm(email)}
                                                aria-label={`Remove ${email}`}
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        {viewType === POLICY_TYPE.EXTERNAL_SHARING && (
                            <div className="data-policy__field">
                                <label className="data-policy__label">Allowed external domains</label>
                                <div className="data-policy__domain-row">
                                    <input
                                        type="text"
                                        className="data-policy__input"
                                        placeholder="domain.com"
                                        value={policyForm.domainInput}
                                        onChange={(e) =>
                                            setPolicyForm((prev) => ({ ...prev, domainInput: e.target.value }))
                                        }
                                        onKeyDown={(e) =>
                                            e.key === "Enter" && (e.preventDefault(), addDomainToForm())
                                        }
                                    />
                                    <ActionButton
                                        buttonType="button"
                                        buttonClickAction={addDomainToForm}
                                        customClass="data-policy__add-domain-btn CF_d-flex ai-center"
                                        title="Add domain"
                                    >
                                        <span>Add</span>
                                    </ActionButton>
                                </div>
                                {policyForm.allowedExternalDomains.length > 0 && (
                                    <div className="data-policy__domain-pills">
                                        {policyForm.allowedExternalDomains.map((domain) => (
                                            <span key={domain} className="data-policy__tag data-policy__tag--domain">
                                                {domain}
                                                <button
                                                    type="button"
                                                    className="data-policy__domain-pill-remove"
                                                    onClick={() => removeDomainFromForm(domain)}
                                                    aria-label={`Remove ${domain}`}
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="data-policy__popup-footer">
                            <ActionButton
                                buttonType="button"
                                buttonClickAction={handleSavePolicy}
                                customClass="data-policy__save-btn"
                                title="Save Policy"
                                isDisabled={saving}
                            >
                                <Save size={18} />
                                {saving ? "Saving…" : "Save Policy"}
                            </ActionButton>
                        </div>
                    </div>
                </Popup>
            </div>
            {isPageLoading && getCFLoader()}
        </>
    );
};

export default DataPolicy;
