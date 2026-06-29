export type Step =
  | { type: 'navigate'; route: string; label: string }
  | { type: 'click'; text: string; label: string; fallbackSelector?: string }
  /** Canvas “+” / add-step controls are usually icon-only — use dedicated finder, not text "+" */
  | { type: 'click_builder_add'; label: string }
  /** Prefer Save in workflow editor toolbar/header */
  | { type: 'click_builder_save'; label: string }
  /** Simulate drag-drop onto NewFlowV4 canvas using `data-cf-dnd-payload` on panel rows */
  | { type: 'workflow_drop'; label: string; matchText?: string }
  | { type: 'type'; placeholder?: string; labelText?: string; value: string; label: string; clear?: boolean }
  | { type: 'pause'; reason: string; message: string; highlightLabel?: string }
  | { type: 'wait'; ms: number; label: string }
  | { type: 'confirm'; message: string }
  | { type: 'seek'; text: string; timeoutMs?: number; label: string; found: Step[]; notFound: Step[] };

export interface ActionPlan {
  operation: string;
  params: Record<string, any>;
  label: string;
  steps_preview: string[];
}

export type AgentStatus = 'idle' | 'confirming' | 'executing' | 'paused' | 'done' | 'aborted' | 'error';
