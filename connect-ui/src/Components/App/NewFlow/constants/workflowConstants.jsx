import { Building, FileText, GitBranch, UserPlus, Zap } from "lucide-react";

export const ACTION_TYPES = {
  TRIGGER: "TRIGGER",
  ONBOARD_TO_APPLICATIONS: "ONBOARD_TO_APPLICATIONS",
  IF_ELSE: "IF_ELSE",
  DEPARTMENT_BASED_ACTION: "DEPARTMENT_BASED_ACTION",
  PRIMARY_APPLICATION: "PRIMARY_APPLICATION",
  SELECT_DEPARTMENT: "SELECT_DEPARTMENT",
  SELECT_DIVISION: "SELECT_DIVISION",
  ASSIGN_TEMPLATE: "ASSIGN_TEMPLATE",
  DIVISION_BASED_ACTION: "DIVISION_BASED_ACTION",
  SELECT_GROUP: "SELECT_GROUP",
};

export const ACTION_TYPE_CONFIG = [
  {
    id: ACTION_TYPES.TRIGGER,
    name: "Trigger Action",
    icon: <Zap size={20} color="#64748b" />,
    description: "Trigger an action based on a specific event",
  },
  {
    id: ACTION_TYPES.ONBOARD_TO_APPLICATIONS,
    name: "Onboard To Applications",
    icon: <UserPlus size={20} color="#64748b" />,
    description: "Add users to selected applications",
  },
  {
    id: ACTION_TYPES.IF_ELSE,
    name: "If Else",
    icon: <GitBranch size={20} color="#64748b" />,
    description: "Add conditional branching logic",
  },
  {
    id: ACTION_TYPES.DEPARTMENT_BASED_ACTION,
    name: "Department Based Action",
    icon: <Building size={20} color="#64748b" />,
    description: "Add actions based on department",
  },
  {
    id: ACTION_TYPES.ASSIGN_TEMPLATE,
    name: "Assign Templates",
    icon: <FileText size={20} color="#64748b" />,
    description: "Assign a template to the action",
  },
  {
    id: ACTION_TYPES.DIVISION_BASED_ACTION,
    name: "Division Based Action",
    icon: <Building size={20} color="#64748b" />,
    description: "Add actions based on division",
  },
];

export const TRIGGER_EVENTS = [
  {
    id: "USER_CREATED",
    name: "User Created",
  },
];

export const DEPARTMENT_LIST = [
  { id: "1", name: "Sales" },
  { id: "2", name: "Marketing" },
  { id: "3", name: "IT" },
  { id: "4", name: "HR" },
  { id: "5", name: "Finance" },
  { id: "6", name: "Operations" },
  { id: "7", name: "Customer Support" },
  { id: "8", name: "Engineering" },
];

export const WAITING_STATES = {
  GLOBAL: "GLOBAL",
  SELECT_DEPARTMENT: "SELECT_DEPARTMENT",
  SELECT_DIVISION: "SELECT_DIVISION",
};

export const DIVISION_LIST = [
  { id: "1", name: "Asia" },
  { id: "2", name: "South America" },
  { id: "3", name: "North America" },
  { id: "4", name: "Europe" },
  { id: "5", name: "Africa" },
  { id: "6", name: "Oceania" },
  { id: "7", name: "Middle East" },
];
