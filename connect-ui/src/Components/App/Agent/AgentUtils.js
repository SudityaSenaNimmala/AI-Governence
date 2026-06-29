
export const placeHolderTexts = [
    "How can I identify unused SaaS subscriptions?",
    "Are there any redundant SaaS tools in my organization?",
    "Which users have inactive licenses in the past 90 days?",
    "Can I downgrade any premium subscriptions to a lower tier?",
    "How can I optimize my Slack licenses?",
    "What are the cost-saving opportunities in our SaaS stack?",
    "Are there any duplicate user accounts across different platforms?",
    "Can I consolidate multiple tools that serve the same purpose?",
    "Which departments are overspending on SaaS subscriptions?",
    "How can I negotiate better pricing with vendors?",
    "Which employees have access to SaaS tools they don’t need?",
    "Are there any orphaned accounts from former employees?",
    "How can I automate user provisioning and deprovisioning?",
    "Who are the top users of each SaaS application?",
    "Which users have excessive permissions that should be reviewed?",
    "Are all SaaS applications compliant with our security policies?",
    "Do any apps pose a security risk due to lack of MFA?",
    "Are there any unauthorized SaaS applications being used?",
    "How can I track and enforce compliance for all SaaS tools?",
    "Are there any expired software licenses that need renewal?",
    "How can I measure SaaS adoption across my company?",
    "Which SaaS tools have the lowest engagement rates?",
    "What are the peak usage times for our most critical SaaS apps?",
    "Can I identify which SaaS tools contribute most to productivity?",
    "Are there any performance issues with our critical SaaS tools?",
];

export const inputSuggestions = [
    // "List all SaaS Users",
    // "List all admin users across all SaaS applications",
    "List all connected apps in Google Workspace",
    "List all users in Google Workspace",
    "List all admin users in Google Workspace",
];

// "How can I identify unused SaaS subscriptions?",
// "Show me the number of active users in Google Workspace this month",
// "Get me the inactive users count in Google Workspace",
// "List all users in Google Workspace",
// "Download users in Google Workspace",
// "How do I manage storage limits for Google Workspace users?",
// "Export all user data from Google Workspace for compliance"

export const getAIHeaders = (value) => {
    let mapper = {
        SaaSUser: { firstName: "Name", email: "Email", role: "Type", isActive: "Status" },
        "com.cloudfuze.common.model.CFConnectApp": { displayName: "Name", verified: "Status" },
        PlatformUser: { name: "Name", email: "Email", domain: "Domain", plan: "Plan" },
        "com.cloudfuze.common.model.UserLicenseCache": { licenseId: "License ID" },
        Licenses: { skuName: "SKU Name", skuId: "SKU ID", amount: "Cost" },
        SaaSVendor: { adminEmail: "Email", usersCount: "Users Count", activeUsers: "Active Users", totalAmount: "Total Amount", },
    }
    return mapper[value] || {};
}


