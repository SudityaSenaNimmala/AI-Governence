/**
 * Proactive agent templates.
 * Questions are limited to what the agent's 15 tools can actually answer:
 * get_org_stats, get_discovered_apps, get_app_usage, get_licenses,
 * get_unused_licenses, get_user_apps, get_spend_summary, get_spend_anomalies,
 * get_renewal_forecast, get_shadow_it, get_duplicate_tools,
 * get_contract_details, search_apps, get_groups, get_compliance_summary
 */

/** Maps URL path prefixes → event type keys */
export const ROUTE_EVENT_MAP = {
  '/Dashboard':                'route_dashboard',
  '/SaaSManagement':           'route_saas_management',
  '/SpentAnalytics':           'route_spend',
  '/ShadowIT':                 'route_shadow_it',
  '/SaaS/ShadowIT':            'route_shadow_it',
  '/SaaS/TeamsGroups':         'route_groups',
  '/SaaS/License':             'route_licenses',
  '/UsersList':                'route_users',
  '/Analytics':                'route_analytics',
  '/AuditLogs':                'route_audit_logs',
  '/Workflow':                 'route_workflow',
  '/Integrations':             'route_integrations',
  '/SaaS/ResourceApps':        'route_resource_apps',
  '/AppCategory':              'route_app_category',
  '/Applications/Insights':    'route_app_insights',
  '/Reports':                  'route_reports',
  '/Admin':                    'route_admin',
  '/SaaS/Assessments':         'route_assessments',
  '/OrgChart':                 'route_org_chart',
  '/Applications':             'route_applications',
  '/BrowserActivity':          'route_browser_activity',
};

const TEMPLATES = {
  apps_card: {
    fact: (d) => `You have ${d.count} apps connected to CloudFuze.`,
    questions: [
      "Which categories have the most redundant tools?",
      "Are there any apps with no active users?",
      "Which app has the highest number of inactive users?",
      "Which apps have the most duplicate functionality?",
      "Show me all unauthorized shadow IT apps",
      "Which app is costing the most?",
      "Show me all connected apps sorted by active users",
      "Which apps have the lowest usage?",
    ],
  },

  users_card: {
    fact: (d) => `You have ${d.count} total users in your organization.`,
    questions: [
      "How many users are inactive across all apps?",
      "Which department has the most app access?",
      "Show me users with access to the most apps",
      "Which users have unused licenses assigned?",
      "Show me users who haven't been active recently",
      "Which apps have the most inactive users?",
      "Show me user distribution by department",
      "Which users are candidates for offboarding?",
    ],
  },

  spend_card: {
    fact: (d) => `Your total SaaS spend is $${d.amount}.`,
    questions: [
      "Which app is costing the most?",
      "Show me apps with the highest cost per active user",
      "Are there any spend anomalies this month?",
      "Which apps have high spend but low usage?",
      "Show me spend breakdown by app",
      "Which licenses are unused and wasting budget?",
      "Which contracts are coming up for renewal?",
      "Show me the top 5 most expensive apps",
    ],
  },

  savings_card: {
    fact: (d) => `You have a potential saving of $${d.amount} from unused licenses.`,
    questions: [
      "Which apps have the most unused seats?",
      "Show me all licenses with low utilization",
      "Which app has the worst license utilization?",
      "Show me idle users per application",
      "Which contracts should I downsize at renewal?",
      "How many licenses can I reclaim right now?",
      "Which subscriptions have the most wasted seats?",
      "Show me upcoming renewals I should downgrade",
    ],
  },

  spend_page: {
    fact: () => "Here is an overview of your SaaS spending.",
    questions: [
      "Which app costs the most per active user?",
      "Are there any spend anomalies?",
      "Which apps have high spend but low usage?",
      "Show me total spend broken down by app",
      "Which licenses are draining budget with low usage?",
      "Show me the top 5 most expensive apps",
      "Which contracts are up for renewal soon?",
      "Which apps have unused seats I can reclaim?",
    ],
  },

  app_detail: {
    fact: (d) => `${d.name} has ${d.users} users in your organization.`,
    questions: [
      "How many users are inactive in this app?",
      "What is the license utilization for this app?",
      "When does this app contract renew?",
      "Are there other tools that overlap with this app?",
      "How much are we spending on this app?",
      "Show me all groups in this app",
      "Which users should be removed from this app?",
      "Show me usage stats for this app",
    ],
  },

  shadow_it_page: {
    fact: (d) => d.count > 0 ? `You have ${d.count} unauthorized apps detected.` : "Shadow IT monitoring is active for your org.",
    questions: [
      "Which shadow IT apps have the highest risk level?",
      "Show me all unauthorized apps sorted by risk",
      "Which shadow apps have the most users?",
      "Are there shadow IT apps that overlap with approved tools?",
      "Show me all high-risk unauthorized apps",
      "Which shadow apps are most recently discovered?",
      "Show me shadow IT apps by category",
      "Which unauthorized apps have the most user access?",
    ],
  },

  groups_page: {
    fact: (d) => `You have ${d.total} groups across your organization.`,
    questions: [
      "Which groups have the most members?",
      "Show me private versus public group breakdown",
      "Which apps have the most groups?",
      "Show me groups with the fewest members",
      "Which app has the largest groups?",
      "Show me all groups sorted by member count",
      "How many groups are there per app?",
      "Which groups have only one member?",
    ],
  },

  licenses_page: {
    fact: (d) => `You have ${d.count} license subscriptions being tracked.`,
    questions: [
      "Which licenses are expiring soon?",
      "Show me licenses with unused seats",
      "Which annual licenses renew this quarter?",
      "What is the total cost of all active licenses?",
      "Which licenses have the worst utilization?",
      "Are there any auto-renewing contracts?",
      "Show me licenses sorted by cost",
      "Which subscriptions can I downgrade to save money?",
    ],
  },

  /** Shown once after successful login (ChatPanel + session flag). Personalized in getProactiveMessage via data.firstName */
  login_renewals: {
    fact: (d) => {
      const n = (d && d.firstName && String(d.firstName).trim()) || '';
      const safe = n && n.toLowerCase() !== 'there' ? n : '';
      if (safe) {
        return `${safe}, renewals coming up?\nLet me show your upcoming contract renewals.`;
      }
      return `Renewals coming up?\nLet me show your upcoming contract renewals.`;
    },
    questions: [
      'What are my upcoming contract renewals?',
      'Show me renewals in the next 90 days as a timeline',
      'Which contracts are set to auto-renew?',
    ],
  },

  // ── Route-based templates ──────────────────────────────────────────────────

  route_dashboard: {
    fact: () => "You are on the main dashboard.",
    questions: [
      "Give me a full overview of my SaaS portfolio",
      "Which apps have the most inactive users?",
      "What is my total SaaS spend?",
      "Show me upcoming contract renewals",
      "Are there any shadow IT apps detected?",
      "Which categories have the most redundant tools?",
      "What are my top 5 most expensive apps?",
      "How many licenses are going to waste?",
    ],
  },

  route_saas_management: {
    fact: () => "You are viewing your connected SaaS applications.",
    questions: [
      "Which app has the most inactive users?",
      "Which apps are underutilized?",
      "Show me apps with the highest spend",
      "Are there any duplicate tools in my stack?",
      "Which apps have the most unused seats?",
      "Show me apps sorted by active users",
      "Which apps have the most users?",
      "Are there any apps with zero active users?",
    ],
  },

  route_spend: {
    fact: () => "You are viewing your SaaS spend analytics.",
    questions: [
      "Which app is costing the most?",
      "Show me cost per active user for each app",
      "Are there any spend anomalies?",
      "Which apps have high spend but low usage?",
      "Show me spend breakdown by app",
      "Which licenses are wasting the most budget?",
      "Which contracts are coming up for renewal?",
      "Show me the top 5 most expensive apps",
    ],
  },

  route_shadow_it: {
    fact: () => "You are viewing shadow IT and unauthorized apps.",
    questions: [
      "Which unauthorized apps have the highest risk?",
      "Show me shadow IT apps sorted by risk level",
      "Which shadow apps have the most users?",
      "Are any shadow apps duplicating approved tools?",
      "Show me all high-risk unauthorized apps",
      "Which shadow apps were most recently discovered?",
      "Show me shadow IT apps by category",
      "Which unauthorized apps have the most user access?",
    ],
  },

  route_groups: {
    fact: () => "You are viewing teams and groups across your apps.",
    questions: [
      "Which groups have the most members?",
      "Show me private versus public group breakdown",
      "Which apps have the most groups?",
      "Show me all groups sorted by member count",
      "Which app has the largest groups?",
      "How many groups are there per app?",
      "Show me groups with only one member",
      "Which apps have the most teams?",
    ],
  },

  route_licenses: {
    fact: () => "You are viewing your license subscriptions.",
    questions: [
      "Which licenses are expiring soon?",
      "Show me licenses with unused seats",
      "Which annual contracts renew this quarter?",
      "What is the total cost of all active licenses?",
      "Which licenses have the worst utilization?",
      "Are there auto-renewing contracts to review?",
      "Show me licenses sorted by cost",
      "Which subscriptions can I downgrade?",
    ],
  },

  route_users: {
    fact: () => "You are viewing your user management dashboard.",
    questions: [
      "How many users are inactive across all apps?",
      "Which department has the most app access?",
      "Show me users with access to the most apps",
      "Which users have unused licenses assigned?",
      "Show me users who haven't been active recently",
      "Which apps have the most inactive users?",
      "Show me user distribution by department",
      "Which users are candidates for offboarding?",
    ],
  },

  route_analytics: {
    fact: () => "You are viewing analytics and potential savings.",
    questions: [
      "Which apps have the most unused seats?",
      "Show me all licenses with low utilization",
      "Which app has the worst license utilization?",
      "Show me idle users per application",
      "Which contracts should I downsize at renewal?",
      "How many licenses can I reclaim right now?",
      "Which subscriptions have the most wasted seats?",
      "Show me upcoming renewals I should downgrade",
    ],
  },

  route_audit_logs: {
    fact: () => "You are viewing audit logs and activity history.",
    questions: [
      "Which apps have the most active users?",
      "Show me apps with the most inactive users",
      "Which users have access to the most apps?",
      "Show me my full SaaS portfolio overview",
      "Which apps have unused licenses?",
      "Show me spend across all apps",
      "Which shadow IT apps are detected?",
      "Show me duplicate tools in my stack",
    ],
  },

  route_workflow: {
    fact: () => "You are viewing workflows and automation.",
    questions: [
      "Which users are inactive across all apps?",
      "Show me users with unused licenses",
      "Which apps have the most inactive users?",
      "Show me users who haven't logged in recently",
      "Which licenses can be reclaimed from inactive users?",
      "Show me apps sorted by inactive user count",
      "Which users have access to the most apps?",
      "What is my total potential savings from unused licenses?",
    ],
  },

  route_integrations: {
    fact: () => "You are viewing your app integrations.",
    questions: [
      "Which connected apps have the most inactive users?",
      "Show me apps with the highest spend",
      "Which apps have unused license seats?",
      "Are there duplicate tools among my connected apps?",
      "Which apps have the most users?",
      "Show me connected apps sorted by active users",
      "Which apps are the most expensive?",
      "Show me all connected apps and their usage",
    ],
  },

  route_resource_apps: {
    fact: () => "You are viewing resource apps and verified applications.",
    questions: [
      "Which apps have the most active users?",
      "Show me apps with the lowest usage",
      "Which apps have the most unused seats?",
      "Are there apps with duplicate functionality?",
      "Show me apps sorted by spend",
      "Which apps have zero active users?",
      "Show me apps by category",
      "Which apps are the most expensive?",
    ],
  },

  route_app_category: {
    fact: () => "You are viewing app categories.",
    questions: [
      "Which category has the most apps?",
      "Are there redundant tools in any category?",
      "Show me spend broken down by app",
      "Which apps have the highest cost?",
      "Which categories have duplicate tools?",
      "Show me all apps sorted by category",
      "Which apps overlap in functionality?",
      "Which category should I consolidate first?",
    ],
  },

  route_app_insights: {
    fact: () => "You are viewing detailed app insights.",
    questions: [
      "Show me usage stats for this app",
      "How many inactive users does this app have?",
      "What is the license utilization for this app?",
      "When does this app contract renew?",
      "How much is this app costing?",
      "Are there duplicate tools that overlap with this app?",
      "Show me all groups in this app",
      "Which users should be removed from this app?",
    ],
  },

  route_reports: {
    fact: () => "You are viewing reports.",
    questions: [
      "Show me total SaaS spend broken down by app",
      "Which licenses have the worst utilization?",
      "Show me all inactive users across apps",
      "Which apps have the most unused seats?",
      "Show me all shadow IT apps by risk level",
      "Which apps have duplicate functionality?",
      "Show me upcoming license renewals",
      "What is my total potential savings from unused licenses?",
    ],
  },

  route_admin: {
    fact: () => "You are in the admin settings.",
    questions: [
      "Give me a full overview of my SaaS portfolio",
      "Which apps have the most inactive users?",
      "What is my total SaaS spend?",
      "Which licenses have the worst utilization?",
      "Show me all shadow IT apps detected",
      "Which apps have duplicate functionality?",
      "Show me upcoming license renewals",
      "Which apps have the most unused seats?",
    ],
  },

  route_assessments: {
    fact: () => "You are viewing SaaS security assessments.",
    questions: [
      "Which shadow IT apps have the highest risk level?",
      "Show me all unauthorized apps sorted by risk",
      "Which shadow apps have the most users?",
      "Are there shadow IT apps that overlap with approved tools?",
      "Show me all high-risk unauthorized apps",
      "Which unauthorized apps have the most user access?",
      "Show me shadow IT apps by category",
      "Which shadow apps were most recently discovered?",
    ],
  },

  route_org_chart: {
    fact: () => "You are viewing the organization chart.",
    questions: [
      "Which department has the most app access?",
      "Show me user distribution by department",
      "Which apps have the most users?",
      "Show me spend broken down by app",
      "Which departments have users with unused licenses?",
      "Show me inactive users by app",
      "Which apps have the most inactive users?",
      "Show me all users sorted by number of apps they use",
    ],
  },

  route_applications: {
    fact: () => "You are viewing your connected applications.",
    questions: [
      "Which apps have the most active users?",
      "Show me apps with low usage",
      "Which apps are the most expensive?",
      "Are there any apps with zero active users?",
      "Which apps have duplicate functionality?",
      "Show me apps sorted by active users",
      "Which apps have the most unused seats?",
      "Show me all apps and their spend",
    ],
  },

  route_browser_activity: {
    fact: () => "You are viewing browser activity and extension data.",
    questions: [
      "Show me all detected shadow IT apps",
      "Which unauthorized apps have the highest risk?",
      "Show me shadow IT apps sorted by risk level",
      "Which shadow apps have the most users?",
      "Are there shadow apps that overlap with approved tools?",
      "Show me all high-risk unauthorized apps",
      "Which shadow IT apps were most recently discovered?",
      "Show me unauthorized apps by category",
    ],
  },
};

/**
 * Returns { fact, question } for the given event type + data.
 * Returns null if the type is not found.
 */
export function getProactiveMessage(type, data = {}) {
  const tpl = TEMPLATES[type];
  if (!tpl) return null;
  const fact = tpl.fact(data);
  const pool = tpl.questions;
  const question = pool[Math.floor(Math.random() * pool.length)];
  return { fact, question };
}
