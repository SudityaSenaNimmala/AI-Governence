import type { ActionPlan } from "./types";

type ActionItem = { label: string; action: string; payload?: Record<string, unknown> };

/**
 * Maps chat `action_buttons` items (backend-oriented names) to mouse-agent ActionPlans.
 * No server-side CloudFuze API — the cursor performs UI steps in the Manage app.
 */
export function actionButtonItemToActionPlan(item: ActionItem): ActionPlan | null {
  const p = item.payload ?? {};
  const a = item.action?.trim();

  switch (a) {
    case "create_onboard_workflow":
    case "run_onboard_workflow": {
      const email = String(p.email ?? "").trim();
      const rawNames = p.app_names;
      const fromArray = Array.isArray(rawNames)
        ? rawNames.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const vendor = String(p.vendor ?? p.app_name ?? "").trim();
      const app_names = fromArray.length > 0 ? fromArray : vendor ? [vendor] : [];
      if (app_names.length === 0) return null;
      const labelApps = app_names.join(" + ");
      return {
        operation: "onboard_user",
        params: { app_names, email },
        label: item.label || `Onboard to ${labelApps}`,
        steps_preview: [
          "Open Workflows",
          "Find or create a Manual Trigger onboarding workflow with those apps",
          "Run the workflow for the user",
        ],
      };
    }

    case "run_offboard_workflow": {
      const email = String(p.email ?? "").trim();
      const vendor = String(p.vendor ?? "").trim();
      const vendorsRaw = p.vendors;
      const vendors = Array.isArray(vendorsRaw)
        ? vendorsRaw.map((x) => String(x).trim()).filter(Boolean)
        : vendor
          ? [vendor]
          : [];
      if (!email || vendors.length === 0) return null;
      return {
        operation: "offboard_user",
        params: {
          email,
          vendors,
          permanent_delete: Boolean(p.perm_delete ?? p.permanent_delete),
        },
        label: item.label || `Offboard ${email}`,
        steps_preview: [
          "Open Offboard Users",
          "Select user and apps",
          "Start offboarding",
        ],
      };
    }

    case "create_offboard_workflow": {
      const users = p.users;
      const apps = p.apps;
      const emails = Array.isArray(users)
        ? users.map((u: unknown) => (typeof u === "string" ? u : (u as { email?: string })?.email ?? "")).filter(Boolean)
        : [];
      const vendorList = Array.isArray(apps)
        ? apps.map((x: unknown) =>
            typeof x === "string" ? x : (x as { vendor?: string })?.vendor ?? "",
          ).filter(Boolean)
        : [];
      const email = emails[0] ? String(emails[0]) : String(p.email ?? "").trim();
      if (!email || vendorList.length === 0) return null;
      return {
        operation: "offboard_user",
        params: { email, vendors: vendorList, permanent_delete: false },
        label: item.label || `Offboard ${email}`,
        steps_preview: [
          "Open Offboard Users",
          "Select user and apps",
          "Start offboarding",
        ],
      };
    }

    default:
      return null;
  }
}

export function mouseUnsupportedActionMessage(action: string): string {
  return `“${action.replace(/_/g, " ")}” isn’t wired to UI automation yet. Ask the agent in your own words (e.g. onboard or offboard) so it can drive the app step by step.`;
}
