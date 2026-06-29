/** Mirrors backend enums for Data Policy API */

export const POLICY_TYPE = {
    SENSITIVE_CONTENT: "SENSITIVE_CONTENT",
    EXTERNAL_SHARING: "EXTERNAL_SHARING",
    STALE_CONTENT: "STALE_CONTENT",
    DUPLICATE_FILES: "DUPLICATE_FILES",
};

export const ACTION = {
    EMAIL_NOTIFY: "EMAIL_NOTIFY",
    REVOKE: "REVOKE",
};

export const RULE = {
    ANONYMOUS_LINK: "ANONYMOUS_LINK",
    EXTERNAL_COLLABORATOR: "EXTERNAL_COLLABORATOR",
    DAYS_90: "DAYS_90",
    DAYS_180: "DAYS_180",
    DAYS_360: "DAYS_360",
};

export const POLICY_TYPE_OPTIONS = [
    { value: POLICY_TYPE.SENSITIVE_CONTENT, label: "Sensitive content" },
    { value: POLICY_TYPE.EXTERNAL_SHARING, label: "External sharing" },
    { value: POLICY_TYPE.STALE_CONTENT, label: "Stale content" },
    { value: POLICY_TYPE.DUPLICATE_FILES, label: "Duplicate content" },
];

export const ACTION_OPTIONS = [
    { value: ACTION.EMAIL_NOTIFY, label: "Email notify" },
    { value: ACTION.REVOKE, label: "Revoke" },
];

export const RULE_LABELS = {
    [RULE.ANONYMOUS_LINK]: "Anonymous link",
    [RULE.EXTERNAL_COLLABORATOR]: "External collaborator",
    [RULE.DAYS_90]: "90 days",
    [RULE.DAYS_180]: "180 days",
    [RULE.DAYS_360]: "360 days",
};

export const RULES_BY_POLICY_TYPE = {
    [POLICY_TYPE.SENSITIVE_CONTENT]: [RULE.DAYS_90],
    [POLICY_TYPE.EXTERNAL_SHARING]: [RULE.ANONYMOUS_LINK, RULE.EXTERNAL_COLLABORATOR],
    [POLICY_TYPE.STALE_CONTENT]: [RULE.DAYS_90, RULE.DAYS_180, RULE.DAYS_360],
    [POLICY_TYPE.DUPLICATE_FILES]: [RULE.DAYS_90, RULE.DAYS_180, RULE.DAYS_360],
};

export const getRuleLabel = (rule) => RULE_LABELS[rule] || rule || "";

export const getActionLabel = (action) =>
    ACTION_OPTIONS.find((o) => o.value === action)?.label || action || "";

export const getPolicyTypeLabel = (policyType) =>
    POLICY_TYPE_OPTIONS.find((o) => o.value === policyType)?.label || policyType || "";

/** applicationName values (API / backend enums) */
export const DATA_POLICY_APPLICATION_OPTIONS = [
    { label: "MICROSOFT_OFFICE_365", value: "MICROSOFT_OFFICE_365" },
    { label: "SHAREPOINT_ONLINE_BUSINESS", value: "SHAREPOINT_ONLINE_BUSINESS" },
    { label: "GOOGLE_WORKSPACE", value: "GOOGLE_WORKSPACE" },
];
