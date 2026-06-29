import type { Step } from './types';
import { getCloudName } from '../../../../helpers/helpers';

/**
 * Workflow builder search filters by getCloudName(providerName) (display string), not the raw
 * PROVIDER_KEY. Typing the display label avoids empty result lists when the agent says "iSpring Learn"
 * but the row is keyed as ISPRING_LEARN.
 */
function workflowPanelSearchValue(canonicalOrLabel: string): string {
  const s = String(canonicalOrLabel).trim();
  if (!s) return s;
  if (/^[A-Z][A-Z0-9_]*$/.test(s)) {
    const display = getCloudName(s);
    return typeof display === 'string' && display.length ? display : s;
  }
  return s;
}

export function getSteps(operation: string, params: Record<string, any>): Step[] {
  switch (operation) {
    case 'offboard_user':     return offboardUser(params);
    case 'add_license':       return addLicense(params);
    case 'add_group_member':  return addGroupMember(params);
    case 'remove_group_member': return removeGroupMember(params);
    case 'revoke_shadow_app': return revokeShadowApp(params);
    case 'delete_vendor':     return deleteVendor(params);
    case 'save_api_key':      return saveApiKey(params);
    case 'onboard_user':      return onboardUser(params);
    case 'connect_vendor':    return connectVendor(params);
    default:                  return [];
  }
}

function offboardUser(params: Record<string, any>): Step[] {
  const { email = '', vendors = [], permanent_delete = false } = params;
  const steps: Step[] = [
    { type: 'navigate', route: '/Workflow/OffBoard', label: 'Opening Offboard Users page' },
    { type: 'wait', ms: 2000, label: 'Waiting for user list to load' },
    { type: 'type', placeholder: 'Search By User Email', value: email, label: `Searching for ${email}`, clear: true },
    { type: 'wait', ms: 1500, label: 'Waiting for search results' },
    // Click the "Off Board" button in the user's row — opens the vendor-select popup
    { type: 'click', text: 'Off Board', label: 'Opening offboard dialog for user' },
    { type: 'wait', ms: 1000, label: 'Waiting for offboard dialog to open' },
  ];

  // Each vendor name is shown as a <p> tag in the popup alongside a checkbox.
  // The click handler in useMouseAgent will redirect <p> clicks to the nearest checkbox.
  for (const vendor of (vendors as string[])) {
    steps.push({ type: 'click', text: vendor, label: `Selecting vendor: ${vendor}` });
  }

  if (permanent_delete) {
    // "Delete User Permanently :" is a <p> adjacent to a <label class="switch"> toggle.
    // The click handler redirects to the .switch input automatically.
    steps.push({ type: 'click', text: 'Delete User Permanently', label: 'Enabling permanent delete option' });
  }

  steps.push(
    { type: 'click', text: 'Start Offboard', label: 'Starting offboard process' },
    { type: 'wait', ms: 2000, label: 'Processing offboard' },
  );

  return steps;
}

function addLicense(params: Record<string, any>): Step[] {
  const {
    vendor_name = '',
    plan_name = '',
    total_seats = '',
    cost = '',
    expiry_date = '',
    recurring = true,
  } = params;

  return [
    { type: 'navigate', route: '/Dashboard', label: `Navigating to dashboard for ${vendor_name}` },
    { type: 'wait', ms: 1000, label: 'Waiting for page to load' },
    { type: 'click', text: 'Add License', label: 'Opening Add License dialog' },
    { type: 'wait', ms: 500, label: 'Waiting for dialog to open' },
    { type: 'type', placeholder: 'Plan Name', value: String(plan_name), label: 'Entering plan name', clear: true },
    { type: 'type', placeholder: 'Total Seats', value: String(total_seats), label: 'Entering seat count', clear: true },
    { type: 'type', placeholder: 'Purchased Amount', value: String(cost), label: 'Entering license cost', clear: true },
    { type: 'type', placeholder: 'Expiry Date', value: String(expiry_date), label: 'Entering expiry date', clear: true },
    ...(recurring ? [{ type: 'click' as const, text: 'Recurring', label: 'Enabling recurring billing' }] : []),
    { type: 'click', text: 'Save', label: 'Saving license details' },
  ];
}

function addGroupMember(params: Record<string, any>): Step[] {
  const { group_name = '', member_emails = [] } = params;
  const steps: Step[] = [
    { type: 'navigate', route: '/SaaS/TeamsGroups', label: 'Opening Teams & Groups page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    { type: 'click', text: String(group_name), label: `Opening group: ${group_name}` },
    { type: 'wait', ms: 800, label: 'Waiting for group panel to open' },
    { type: 'click', text: 'Members', label: 'Opening Members tab' },
    { type: 'wait', ms: 500, label: 'Waiting for members tab' },
    { type: 'click', text: 'Add Members', label: 'Opening Add Members panel', fallbackSelector: '[data-action="add-members"]' },
    { type: 'wait', ms: 800, label: 'Waiting for add members panel' },
  ];

  for (const email of (member_emails as string[])) {
    steps.push(
      { type: 'type', placeholder: 'Search For User', value: String(email), label: `Searching for ${email}`, clear: true },
      { type: 'wait', ms: 600, label: 'Waiting for user search results' },
      { type: 'click', text: String(email), label: `Selecting user: ${email}` },
    );
  }

  steps.push({ type: 'click', text: 'Add', label: 'Confirming member addition' });

  return steps;
}

function removeGroupMember(params: Record<string, any>): Step[] {
  const { group_name = '', member_emails = [] } = params;
  const steps: Step[] = [
    { type: 'navigate', route: '/SaaS/TeamsGroups', label: 'Opening Teams & Groups page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    { type: 'click', text: String(group_name), label: `Opening group: ${group_name}` },
    { type: 'wait', ms: 800, label: 'Waiting for group panel' },
    { type: 'click', text: 'Members', label: 'Opening Members tab' },
    { type: 'wait', ms: 500, label: 'Waiting for members tab' },
  ];

  for (const email of (member_emails as string[])) {
    steps.push({ type: 'click', text: String(email), label: `Selecting member: ${email}` });
  }

  steps.push(
    { type: 'click', text: 'Remove Members', label: 'Removing selected members' },
    { type: 'wait', ms: 500, label: 'Waiting for confirmation' },
  );

  return steps;
}

function revokeShadowApp(params: Record<string, any>): Step[] {
  const { app_name = '' } = params;
  return [
    { type: 'navigate', route: '/SaaS/ShadowIT', label: 'Opening Shadow IT page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    { type: 'click', text: String(app_name), label: `Selecting app: ${app_name}` },
    { type: 'wait', ms: 800, label: 'Waiting for app panel' },
    { type: 'click', text: 'Revoke Access', label: 'Clicking Revoke Access' },
    { type: 'wait', ms: 500, label: 'Waiting for confirmation dialog' },
    { type: 'click', text: 'Confirm', label: 'Confirming revoke action', fallbackSelector: '[data-action="confirm"]' },
  ];
}

function deleteVendor(params: Record<string, any>): Step[] {
  const { vendor_name = '' } = params;
  return [
    { type: 'navigate', route: '/Integrations/Manage', label: 'Opening Integrations page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    {
      type: 'click',
      text: String(vendor_name),
      label: `Locating vendor: ${vendor_name}`,
      fallbackSelector: `[data-vendor="${vendor_name}"] .delete-btn`,
    },
    { type: 'wait', ms: 500, label: 'Waiting for confirmation dialog' },
    { type: 'click', text: 'Yes', label: 'Confirming vendor deletion', fallbackSelector: '[data-action="confirm"]' },
  ];
}

function saveApiKey(params: Record<string, any>): Step[] {
  const { vendor_name = '' } = params;
  return [
    { type: 'navigate', route: '/Integrations/Manage', label: 'Opening Integrations page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    {
      type: 'click',
      text: String(vendor_name),
      label: `Locating ${vendor_name} integration`,
      fallbackSelector: `[data-vendor="${vendor_name}"] .auth-btn`,
    },
    { type: 'wait', ms: 800, label: 'Waiting for authentication modal' },
    {
      type: 'pause',
      reason: 'sensitive_input',
      message: 'Please type your API key in the highlighted field, then click "Done" in the chat',
      highlightLabel: 'API Key',
    },
    { type: 'click', text: 'Save', label: 'Saving API key' },
  ];
}

function connectVendor(params: Record<string, any>): Step[] {
  const { vendor_name = '' } = params;
  return [
    { type: 'navigate', route: '/Integrations/Add', label: 'Opening Add Integrations page' },
    { type: 'wait', ms: 1500, label: 'Waiting for page to load' },
    {
      type: 'click',
      text: String(vendor_name),
      label: `Clicking ${vendor_name} integration card`,
      fallbackSelector: `[data-vendor="${vendor_name}"] button, [data-vendor="${vendor_name}"] [role="button"], [data-integration-card][data-vendor="${vendor_name}"]`,
    },
    { type: 'wait', ms: 1200, label: 'Waiting for credentials panel to open' },
    {
      type: 'pause',
      reason: 'credentials',
      message: `Please enter your ${vendor_name} credentials in the panel that opened. Once complete, click "Done" in the chat to continue.`,
      highlightLabel: 'Credentials',
    },
  ];
}

/** Supports `app_names: string[]` or legacy `app_name` / comma-separated string. */
function normalizeOnboardAppNames(params: Record<string, any>): string[] {
  if (Array.isArray(params.app_names) && params.app_names.length > 0) {
    return params.app_names.map((x) => String(x).trim()).filter(Boolean);
  }
  const single = params.app_name;
  if (single == null || single === '') return [];
  const s = String(single).trim();
  const parts = s.split(/(?:,\s*|\s+and\s+|\s*&\s*)/i).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}

function onboardUser(params: Record<string, any>): Step[] {
  const { email = '' } = params;
  const apps = normalizeOnboardAppNames(params);
  const appLabel = apps.length ? apps.join(' + ') : 'onboarding';
  const firstApp = apps[0] ?? '';
  const seekVisibleName = firstApp ? workflowPanelSearchValue(firstApp) : '';

  // Steps shared by both paths: once the Run dialog is open, search + select user + trigger
  const runWorkflowSteps: Step[] = [
    // NOTE: "Run" is ambiguous if many rows have Run — resolver picks first visible match (brittle).
    { type: 'click', text: 'Run', label: 'Opening Run Workflow panel' },
    { type: 'wait', ms: 1500, label: 'Waiting for panel to open' },
    { type: 'type', placeholder: 'Search By Email', value: email, label: `Searching for ${email}`, clear: true },
    // ManualTriggerComponent debounces search 500ms + API — list must update before we target the row checkbox
    { type: 'wait', ms: 2800, label: 'Waiting for user search results' },
    // <p> with email → p-to-tr-checkbox redirect selects the row checkbox
    { type: 'click', text: email, label: `Selecting user: ${email}` },
    { type: 'wait', ms: 300, label: 'Confirming selection' },
    { type: 'click', text: 'Run Workflow', label: 'Triggering workflow for user' },
  ];

  /**
   * Manual `?manualTrigger=true`: `addAction("GLOBAL")` hits the branch that opens CustomTemplateActionPannel
   * (PRIMARY_APPLICATION_ADD) — not the tile menu. Rows carry `data-cf-dnd-payload`; apply via `cf:workflowDrop`.
   */
  const searchStepsForApp = (name: string): Step[] =>
    String(name).trim()
      ? [
          {
            type: 'type' as const,
            placeholder: 'Search By Application',
            value: workflowPanelSearchValue(String(name).trim()),
            label: `Filtering list for ${name}`,
            clear: true,
          },
          { type: 'wait', ms: 700, label: 'Waiting for search filter' },
        ]
      : [];

  const dropStepsForApp = (name: string): Step[] =>
    String(name).trim()
      ? [
          {
            type: 'workflow_drop' as const,
            matchText: String(name).trim(),
            label: `Adding ${name} to the workflow`,
          },
          { type: 'wait', ms: 2200, label: 'Waiting after app is added' },
        ]
      : [
          { type: 'workflow_drop' as const, label: 'Adding first onboard application to workflow' },
          { type: 'wait', ms: 2200, label: 'Waiting after app is added' },
        ];

  const additionalAppsSteps: Step[] = [];
  for (let i = 1; i < apps.length; i++) {
    const name = apps[i];
    additionalAppsSteps.push(
      { type: 'click_builder_add', label: `Adding another app: ${name} (+)` },
      { type: 'wait', ms: 1000, label: 'Waiting for application panel' },
      ...searchStepsForApp(name),
      ...dropStepsForApp(name),
    );
  }

  const createAndRunSteps: Step[] = [
    { type: 'click', text: 'Create Workflow', label: 'Opening Create Workflow dialog' },
    { type: 'wait', ms: 800, label: 'Waiting for dialog to open' },
    { type: 'click', text: 'Onboarding', label: 'Selecting Onboarding workflow type' },
    { type: 'wait', ms: 600, label: 'Waiting for trigger type options' },
    { type: 'click', text: 'Manual Trigger', label: 'Selecting Manual Trigger' },
    { type: 'wait', ms: 5000, label: 'Loading workflow builder (NewFlowV4)' },
    { type: 'click_builder_add', label: 'Opening onboard applications panel (+)' },
    { type: 'wait', ms: 1200, label: 'Waiting for application side panel' },
    ...searchStepsForApp(firstApp),
    ...dropStepsForApp(firstApp),
    ...additionalAppsSteps,
    { type: 'click_builder_save', label: 'Saving workflow' },
    { type: 'wait', ms: 2500, label: 'Waiting after save' },
    { type: 'navigate', route: '/Workflow/Template', label: 'Returning to Workflows list' },
    { type: 'wait', ms: 2500, label: 'Waiting for list to refresh' },
    ...runWorkflowSteps,
  ];

  return [
    { type: 'navigate', route: '/Workflow/Template', label: 'Opening Workflows page' },
    { type: 'wait', ms: 3500, label: 'Waiting for workflows to load' },
    {
      type: 'seek',
      // Look for the app name in workflow cards. Falls back to "Manual Trigger Onboarding"
      // (the auto-generated name for manual onboarding workflows) if no app-specific one exists.
      text: seekVisibleName || firstApp || 'Manual Trigger Onboarding',
      timeoutMs: 12000,
      label: `Checking for existing onboarding workflow (${appLabel})`,
      found: runWorkflowSteps,
      notFound: createAndRunSteps,
    },
  ];
}
