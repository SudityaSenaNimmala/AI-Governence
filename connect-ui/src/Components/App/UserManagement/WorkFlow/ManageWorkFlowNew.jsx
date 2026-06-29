import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  CircleCheckBig,
  CircleX,
  Clock8,
  ClipboardList,
  Code,
  Copy,
  Edit2,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileText,
  History,
  MoveRight,
  Pause,
  Play,
  Plus,
  Trash2,
  TrendingUp,
  TriangleAlert,
  UserMinus2,
  UserPlus,
  Workflow,
  Zap
} from "lucide-react";
import moment from "moment";
import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { copyToClipboard, getStatusColor, notifyToast } from "../../../helpers/utils";
import { getCronDescription } from "../../../Resuables/CronExpressionBuilder/cronUtils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import Popup from "../../../Resuables/Popup/Popup";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import {
  deleteWorkFlow,
  getOffBoardWorkFlowHistory,
  getTemplatesList,
  getWorkFlowHistory,
  getWorkFlows,
  saveNewWorkFlow
} from "../UserManagementActions/UserManagementActions";
import ManualTriggerComponent from "./ManualTriggerComponent";
import ExposedWorkflowApiPopup from "./ExposedWorkflowApiPopup";
import "../css/UserManagement.css";

// Component for displaying user history details
const UserHistoryItem = ({ usrData }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  // Combine groupIds and successGroupIds, removing duplicates
  const allGroups = [
    ...(usrData?.groupIds || []),
    ...(usrData?.sucessGroupIds || [])
  ].reduce((acc, group) => {
    const existing = acc.find(g => g.groupId === group.groupId);
    if (!existing) {
      acc.push(group);
    } else {
      // If exists, prefer the one with userAdded: true
      if (group.userAdded && !existing.userAdded) {
        const index = acc.indexOf(existing);
        acc[index] = group;
      }
    }
    return acc;
  }, []);

  // Combine unsubscriptionIds and successSkuIds, removing duplicates
  const allSkus = [
    ...(usrData?.unsubscriptionIds || []),
    ...(usrData?.successSkuIds || [])
  ].reduce((acc, sku) => {
    const skuId = sku?.skuId ?? sku?.subscriptionId ?? sku?.id;
    const existing = acc.find(s => (s?.skuId ?? s?.subscriptionId ?? s?.id) === skuId);
    if (!existing) {
      acc.push(sku);
    } else {
      // If exists, prefer the one that indicates success (e.g. from successSkuIds)
      const existingId = existing?.skuId ?? existing?.subscriptionId ?? existing?.id;
      if (skuId && (sku?.userAdded || sku?.processed) && !(existing?.userAdded || existing?.processed)) {
        const index = acc.indexOf(existing);
        acc[index] = sku;
      }
    }
    return acc;
  }, []);

  const handleCopyPassword = () => {
    if (usrData?.passWord) {
      copyToClipboard(usrData.passWord, "Password");
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
      }}
    >
      {/* Vendor Header */}
      <div
        className="CF_d-flex ai-center"
        style={{
          gap: "8px",
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: "1px solid #f3f4f6",
        }}
      >
        <img
          src={cloudImageMapper(usrData?.vendor || usrData?.applicationName)}
          title={getCloudName(usrData?.vendor || usrData?.applicationName)}
          alt={usrData?.vendor || usrData?.applicationName}
          style={{
            width: "20px",
            height: "20px",
            objectFit: "contain",
          }}
        />
        <p
          style={{
            fontSize: "14px",
            fontWeight: "600",
            color: "#1f2937",
            margin: 0,
          }}
        >
          {getCloudName(usrData?.vendor || usrData?.applicationName)}
        </p>
        <span style={{ marginLeft: "auto" }}></span>
        {usrData?.userExist === true && (
          <span
            style={{
              // marginLeft: "auto",
              fontSize: "10px",
              fontWeight: "600",
              color: "#0062ff",
              backgroundColor: "#f2f3ff",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            User Already Exist
          </span>
        )}
        {usrData?.onboardUserStatus && (
          <span
            style={{
              // marginLeft: "auto",
              fontSize: "10px",
              fontWeight: "600",
              color: getStatusColor(usrData?.onboardUserStatus),
              backgroundColor: getStatusColor(usrData?.onboardUserStatus, true),
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            {(usrData?.onboardUserStatus === "GROUP_PROCESSED" ? "PROCESSED" : usrData?.onboardUserStatus)?.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Password Section */}
      {usrData?.passWord && (
        <div
          style={{
            marginBottom: "16px",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              fontWeight: "500",
              color: "#6b7280",
              marginBottom: "6px",
            }}
          >
            Password
          </p>
          <div
            className="CF_d-flex ai-center"
            style={{
              gap: "8px",
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              padding: "8px 12px",
            }}
          >
            <input
              type={showPassword ? "text" : "password"}
              value={usrData.passWord}
              readOnly
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                backgroundColor: "transparent",
                fontSize: "13px",
                fontFamily: "monospace",
                color: "#1f2937",
              }}
            />
            <div
              className="CF_d-flex"
              style={{ gap: "4px" }}
            >
              <ActionButton
                buttonType="button"
                customClass=""
                customStyles={{
                  width: "28px",
                  height: "28px",
                  padding: "0",
                  minWidth: "28px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                buttonClickAction={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={16} color="#6b7280" />
                ) : (
                  <Eye size={16} color="#6b7280" />
                )}
              </ActionButton>
              <ActionButton
                buttonType="button"
                customClass=""
                customStyles={{
                  width: "28px",
                  height: "28px",
                  padding: "0",
                  minWidth: "28px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                buttonClickAction={handleCopyPassword}
              >
                {copiedPassword ? (
                  <Check size={16} color="#00c64f" />
                ) : (
                  <Copy size={16} color="#6b7280" />
                )}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Groups Section */}
      {allGroups?.length > 0 && (
        <div>
          <p
            style={{
              fontSize: "12px",
              fontWeight: "500",
              color: "#6b7280",
              marginBottom: "8px",
            }}
          >
            Groups ({allGroups.length})
          </p>
          <div
            className="CF_d-flex"
            style={{
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {allGroups.map((group, groupIndex) => {
              const status = group.userAdded ? "ACTIVE" : "INACTIVE";
              const isSuccessGroup = usrData?.sucessGroupIds?.some(
                g => g.groupId === group.groupId
              );

              return (
                <div
                  key={groupIndex}
                  className="CF_d-flex ai-center"
                  style={{
                    gap: "8px",
                    padding: "8px 10px",
                    backgroundColor: getStatusColor("", true),
                    border: `1px solid ${getStatusColor("")}`,
                    borderRadius: "6px",
                  }}
                >
                  <img src={cloudImageMapper(usrData?.vendor || usrData?.applicationName)} style={{ width: "15px", height: "15px", objectFit: "contain" }} />
                  <p
                    style={{
                      flex: 1,
                      fontSize: "12px",
                      fontWeight: "500",
                      color: "#1f2937",
                      margin: 0,
                    }}
                  >
                    {group.groupName || group.groupId}
                  </p>

                  {isSuccessGroup && (
                    <CircleCheckBig size={14} color={getStatusColor("PROCESSED")} />
                  )}
                  {
                    (!isSuccessGroup && (usrData?.onboardUserStatus === "GROUP_PROCESSED" || usrData?.onboardUserStatus === "CONFLICT")) ?
                      <CircleX size={14} color={getStatusColor("CONFLICT")} />
                      :
                      !isSuccessGroup && (
                        <Clock8 size={14} color={getStatusColor("IN_PROGRESS")} />
                      )
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Subscriptions / SKUs Section */}
      {allSkus?.length > 0 && (
        <div style={{ marginTop: "15px" }}>
          <p
            style={{
              fontSize: "12px",
              fontWeight: "500",
              color: "#6b7280",
              marginBottom: "8px",
            }}
          >
            Subscriptions / SKUs ({allSkus.length})
          </p>
          <div
            className="CF_d-flex"
            style={{
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {allSkus.map((sku, skuIndex) => {
              const skuId = sku?.skuId ?? sku?.subscriptionId ?? sku?.id;
              const skuName = sku?.skuName ?? sku?.subscriptionName ?? sku?.name ?? skuId;
              const isSuccessSku = usrData?.successSkuIds?.some(
                s => (s?.skuId ?? s?.subscriptionId ?? s?.id) === skuId
              );

              return (
                <div
                  key={skuIndex}
                  className="CF_d-flex ai-center"
                  style={{
                    gap: "8px",
                    padding: "8px 10px",
                    backgroundColor: getStatusColor("", true),
                    border: `1px solid ${getStatusColor("")}`,
                    borderRadius: "6px",
                  }}
                >
                  <img src={cloudImageMapper(usrData?.vendor || usrData?.applicationName)} style={{ width: "15px", height: "15px", objectFit: "contain" }} />
                  <p
                    style={{
                      flex: 1,
                      fontSize: "12px",
                      fontWeight: "500",
                      color: "#1f2937",
                      margin: 0,
                    }}
                  >
                    {skuName?.replace(/_/g, " ")}
                  </p>

                  {isSuccessSku && (
                    <CircleCheckBig size={14} color={getStatusColor("PROCESSED")} />
                  )}
                  {
                    (!isSuccessSku && (usrData?.onboardUserStatus === "GROUP_PROCESSED" || usrData?.onboardUserStatus === "CONFLICT")) ?
                      <CircleX size={14} color={getStatusColor("CONFLICT")} />
                      :
                      !isSuccessSku && (
                        <Clock8 size={14} color={getStatusColor("IN_PROGRESS")} />
                      )
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ManageWorkFlowNew = () => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isWorkFlowVisible, setIsWorkFlowVisible] = useState(false);
  const [workFlowsList, setWorkFlowsList] = useState([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [offBoardWorkFlowList, setOffBoardWorkFlowList] = useState([]);
  const [deleteWorkFlowId, setDeleteWorkFlowId] = useState(null);
  const [workFlowHistory, setWorkFlowHistory] = useState(null);
  const navigate = useNavigate();
  const selectDownOptionsRef = useRef(null);
  const [dropDownOpen, setDropDownOpen] = useState(false);
  const [currentWorkFlowId, setCurrentWorkFlowId] = useState(null);
  const [currentTab, setCurrentTab] = useState("WORKFLOWS");
  const [templatesList, setTemplatesList] = useState([]);
  const [isManualTriggerOpen, setIsManualTriggerOpen] = useState(false);
  const [manualTriggerWorkFlow, setManualTriggerWorkFlow] = useState(null);
  const [exposeAPI, setExposeAPI] = useState(null);
  const [completeWorkFlowList, setCompleteWorkFlowList] = useState(null)
  const [selectedOffBoardHistory, setSelectedOffBoardHistory] = useState({
    wfId: null,
    history: [],
  });
  const [tabMenu] = useState([
    {
      id: "WORKFLOWS",
      name: "My Workflows",
    },
    {
      id: "TEMPLATES",
      name: "Templates",
    },
  ]);

  const safeNum = (v) => {
    const n = Number(v);
    return (typeof n === "number" && !Number.isNaN(n)) ? n : 0;
  };

  const safeDisplayNum = (v, fallback = 0) => {
    const n = Number(v);
    if (typeof n !== "number" || Number.isNaN(n)) return fallback;
    return n;
  };

  // Calculate statistics from workflow counts (user-based + application-based)
  const calculateStatistics = () => {
    const allWorkflows = [...(workFlowsList || []), ...(offBoardWorkFlowList || [])];
    const totalWorkflows = allWorkflows.length;
    const activeWorkflows = (workFlowsList || []).filter(wf => wf?.active === true).length + offBoardWorkFlowList?.length;

    // Application-based: totalCount across all workflows
    const totalExecutions = allWorkflows.reduce((sum, wf) => sum + safeNum(wf?.totalCount), 0);

    // Average success rate from application-based: successCount / totalCount per workflow
    let totalSuccess = 0;
    let totalForRate = 0;
    allWorkflows.forEach(wf => {
      const total = safeNum(wf?.totalCount);
      if (total > 0) {
        totalForRate += total;
        totalSuccess += safeNum(wf?.successCount);
      }
    });
    const rate = totalForRate > 0 ? (totalSuccess / totalForRate) * 100 : 0;
    const avgSuccessRate = (typeof rate === "number" && !Number.isNaN(rate)) ? rate.toFixed(1) : "0";

    return {
      totalWorkflows: safeDisplayNum(totalWorkflows, 0),
      activeWorkflows: safeDisplayNum(activeWorkflows, 0),
      totalExecutions: safeDisplayNum(totalExecutions, 0),
      avgSuccessRate: avgSuccessRate === "NaN" ? "0" : avgSuccessRate
    };
  };

  const statistics = calculateStatistics();

  const primaryCloudFromList = cloudsList?.find((cloud) => cloud?.primaryApp === true);

  // Helper function to get workflow description
  const getWorkflowDescription = (workflow) => {
    if (workflow?.description) return workflow.description;
    if (workflow?.workFlowName === "GROUP_SHEDULING") {
      return "Schedule onboarding for specific groups at scheduled times";
    }
    if (workflow?.manual) {
      return workflow?.workFlowName === "ONBOARD" ? "Manually trigger onboarding for specific users" : "Manually trigger offboarding for specific users";
    }
    const apps = workflow?.mandatoryApplications || [];
    if (apps.length > 0) {
      const appNames = apps.slice(0, 3).map(app =>
        getCloudName(app?.applicationName || app?.providerName)
      ).filter(Boolean);
      return `Provision ${appNames.join(", ")}${apps.length > 3 ? " and more" : ""}`;
    }
    return "Automated onboarding workflow";
  };

  const countWorkflowRules = (workflow) => {
    let count = 0;
    if (workflow?.mandatoryApplications?.length > 0) count += workflow.mandatoryApplications.length;
    if (workflow?.departMentWorkFlows?.length > 0) count += workflow.departMentWorkFlows.length;
    if (workflow?.divisionDetails?.length > 0) {
      workflow.divisionDetails.forEach(division => {
        if (division?.conditionalWorkFlows?.length > 0) {
          count += division.conditionalWorkFlows.length;
        }
      });
    }
    return count;
  };

  const getLastRunInfo = (workflow) => {
    const totalCount = safeNum(workflow?.totalCount);
    const successCount = safeNum(workflow?.successCount);
    const failedCount = safeNum(workflow?.failedCount);
    const totalUsersRan = safeNum(workflow?.totalUsersRan);
    const totalSuccessUsers = safeNum(workflow?.totalSuccessUsers);
    const totalConflictUsers = safeNum(workflow?.totalConflictUsers);

    const executions = totalCount > 0 ? totalCount : totalUsersRan;
    let successRate = "0";
    if (totalCount > 0) {
      const rate = (successCount / totalCount) * 100;
      successRate = (typeof rate === "number" && !Number.isNaN(rate)) ? rate.toFixed(1) : "0";
    } else if (totalUsersRan > 0) {
      const rate = (totalSuccessUsers / totalUsersRan) * 100;
      successRate = (typeof rate === "number" && !Number.isNaN(rate)) ? rate.toFixed(1) : "0";
    }

    return {
      time: workflow?.lastRunTime ? moment(workflow.lastRunTime).fromNow() : "—",
      executions: safeDisplayNum(executions, 0),
      successRate: successRate === "NaN" ? "0" : successRate,
      totalUsersRan,
      totalSuccessUsers,
      totalConflictUsers,
      successCount,
      failedCount,
      totalCount
    };
  };

  useEffect(() => {
    if (window.location.hash === "#Templates") {
      setCurrentTab("TEMPLATES");
    }
  }, [window.location.hash]);

  const TEMPLATES_CONDITION_VALUES_KEY = "workflowTemplatesConditionValues";

  const fetchTemplates = async () => {
    setIsPageLoading(true);
    const res = await getTemplatesList();
    if (res?.status === "OK") {
      setTemplatesList(res?.res || []);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  // Store template conditionValues in an array and persist to localStorage
  useEffect(() => {
    const conditionValues = (templatesList || [])
      .map((template) => template?.conditionValue)
      .filter((val) => val != null && val !== "");
    localStorage.setItem(TEMPLATES_CONDITION_VALUES_KEY, JSON.stringify(conditionValues));
  }, [templatesList]);

  const handleClickOutside = (event) => {
    if (
      selectDownOptionsRef?.current &&
      !selectDownOptionsRef?.current.contains(event.target)
    ) {
      setDropDownOpen(false);
      setCurrentWorkFlowId(null);
    }
  };

  useEffect(() => {
    if (dropDownOpen) {
      document.addEventListener("click", handleClickOutside);
    } else {
      document.removeEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [dropDownOpen]);

  // Two-step New Workflow dialog (PRD: Step 1 = workflow type, Step 2 = trigger type)
  const [newWorkflowStep, setNewWorkflowStep] = useState(1);
  const [selectedWorkflowType, setSelectedWorkflowType] = useState(null); // "onboarding" | "offboarding"

  const handleCloseNewWorkflowPopup = () => {
    setNewWorkflowStep(1);
    setSelectedWorkflowType(null);
    setIsWorkFlowVisible(false);
  };

  const handleSelectTrigger = (link) => {
    navigate(link);
    handleCloseNewWorkflowPopup();
  };

  const newWorkflowPopupTitle =
    newWorkflowStep === 1
      ? "New Workflow"
      : selectedWorkflowType === "onboarding"
        ? "New Onboarding Workflow"
        : "New Offboarding Workflow";

  useEffect(() => {
    fetchWorkFlows();
  }, []);

  useEffect(() => {
    if (cloudsList && cloudsList.length > 0 && (workFlowsList.length > 0 || offBoardWorkFlowList.length > 0)) {
      const processedOnBoardList = processWorkflowData([...workFlowsList]);
      const processedOffBoardList = processWorkflowData([...offBoardWorkFlowList]);
      setWorkFlowsList(processedOnBoardList);
      setOffBoardWorkFlowList(processedOffBoardList);
    }
  }, [cloudsList]);

  const findDeletedApplications = (workflowData) => {
    if (!cloudsList || cloudsList.length === 0) {
      return undefined;
    }

    const deletedAppsSet = new Set();
    const currentAppIds = new Set(
      cloudsList.map((cloud) => cloud?.id).filter(Boolean)
    );
    const currentAppNames = new Set(
      cloudsList.map((cloud) => cloud?.providerName).filter(Boolean)
    );

    const isAppDeleted = (app) => {
      if (app?.deleted === true) {
        const appId = app?.adminCloudId || app?.id;
        const appName = app?.applicationName || app?.providerName;
        return { id: appId, name: appName };
      }

      const appId = app?.adminCloudId || app?.id;
      const appName = app?.applicationName || app?.providerName;

      if (appId && !currentAppIds.has(appId)) {
        return { id: appId, name: appName };
      }
      if (appName && !currentAppNames.has(appName)) {
        return { id: appId, name: appName };
      }
      return null;
    };

    if (workflowData?.adminCloudId) {
      if (!currentAppIds.has(workflowData.adminCloudId)) {
        const appName = workflowData?.providerName || "Primary Application";
        deletedAppsSet.add(JSON.stringify({
          id: workflowData.adminCloudId,
          name: getCloudName(appName),
          isPrimary: true
        }));
      }
    }

    if (workflowData?.workFlowApplications?.length > 0) {
      workflowData.workFlowApplications.forEach((app) => {
        const deleted = isAppDeleted(app);
        if (deleted) {
          deletedAppsSet.add(JSON.stringify(deleted));
        }
      });
    }

    if (workflowData?.mandatoryApplications?.length > 0) {
      workflowData.mandatoryApplications.forEach((app) => {
        const deleted = isAppDeleted(app);
        if (deleted) {
          deletedAppsSet.add(JSON.stringify(deleted));
        }
      });
    }

    const departmentWorkFlows = workflowData?.departMentWorkFlows || workflowData?.departmentWorkFlows || [];
    if (departmentWorkFlows.length > 0) {
      departmentWorkFlows.forEach((deptWorkflow) => {
        if (deptWorkflow?.workFlowApplications?.length > 0) {
          deptWorkflow.workFlowApplications.forEach((app) => {
            const deleted = isAppDeleted(app);
            if (deleted) {
              deletedAppsSet.add(JSON.stringify(deleted));
            }
          });
        }
      });
    }

    if (workflowData?.divisionDetails?.length > 0) {
      workflowData.divisionDetails.forEach((division) => {
        if (division?.conditionalWorkFlows?.length > 0) {
          division.conditionalWorkFlows.forEach((conditionalWorkflow) => {
            if (conditionalWorkflow?.workFlowApplications?.length > 0) {
              conditionalWorkflow.workFlowApplications.forEach((app) => {
                const deleted = isAppDeleted(app);
                if (deleted) {
                  deletedAppsSet.add(JSON.stringify(deleted));
                }
              });
            }
          });
        }
      });
    }

    const deletedApps = Array.from(deletedAppsSet).map((str) =>
      JSON.parse(str)
    );

    return deletedApps.length > 0 ? deletedApps : undefined;
  };

  const processWorkflowData = (workflowList) => {
    if (!cloudsList || cloudsList.length === 0) {
      return workflowList;
    }

    return workflowList.map((workflow) => {
      const deletedApps = findDeletedApplications(workflow);
      if (deletedApps && deletedApps.length > 0) {
        return {
          ...workflow,
          deletedApplications: deletedApps,
        };
      }
      return workflow;
    });
  };

  const fetchWorkFlows = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows();
    if (res?.status === "OK") {
      // let completeList = [...res?.res?.onBoardWorkFlowList, ...res?.res?.offBoardWorkFlowList];
      setCompleteWorkFlowList(res?.res)
      let completeList = [...res?.res?.onBoardWorkFlowList];
      let offBoardList = completeList.filter((item) => item?.workFlowName === "OFFBOARD");
      let onBoardList = completeList.filter((item) => item?.workFlowName !== "OFFBOARD");
      const processedOnBoardList = processWorkflowData(
        onBoardList || []
      );
      const processedOffBoardList = processWorkflowData(
        [...offBoardList, ...res?.res?.offBoardWorkFlowList] || []
      );
      setWorkFlowsList(processedOnBoardList);
      setOffBoardWorkFlowList(processedOffBoardList);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const handleDeleteWorkFlow = async () => {
    setIsPageLoading(true);
    setDeleteWorkFlowId(null);
    let workFlowId = deleteWorkFlowId;
    if (deleteWorkFlowId?.includes("_OFFBOARD")) {
      workFlowId = deleteWorkFlowId?.split("_OFFBOARD")[0];
    }
    const isOnboard = completeWorkFlowList?.onBoardWorkFlowList.some((res) => res?.id === workFlowId);
    let res = await deleteWorkFlow(workFlowId, !isOnboard);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (deleteWorkFlowId?.includes("_TEMPLATE")) {
        notifyToast("success", "Template Deleted Successfully");
      } else {
        notifyToast("success", "Workflow Deleted Successfully");
      }
      handleSoftDelete(deleteWorkFlowId);
      setDeleteWorkFlowId(null);
    } else {
      setIsPageLoading(false);
      if (deleteWorkFlowId?.includes("_TEMPLATE")) {
        notifyToast("success", "Template Deleted Successfully");
      } else {
        notifyToast("success", "Workflow Deleted Successfully");
      }
      handleSoftDelete(deleteWorkFlowId);
      setDeleteWorkFlowId(null);
    }
  };

  const handleSoftDelete = (id) => {
    if (id?.includes("_TEMPLATE")) {
      let copyTemplatesList = [...templatesList];
      copyTemplatesList = copyTemplatesList.filter(
        (template) => template?.id !== id?.split("_TEMPLATE")[0]
      );
      setTemplatesList(copyTemplatesList);
    } else if (id?.includes("_OFFBOARD")) {
      let copyOffBoardWorkFlowList = [...offBoardWorkFlowList];
      copyOffBoardWorkFlowList = copyOffBoardWorkFlowList.filter(
        (workFlow) => workFlow?.id !== id?.split("_OFFBOARD")[0]
      );
      setOffBoardWorkFlowList(copyOffBoardWorkFlowList);
    } else {
      let copyWorkFlowsList = [...workFlowsList];
      copyWorkFlowsList = copyWorkFlowsList.filter(
        (workFlow) => workFlow?.id !== id
      );
      setWorkFlowsList(copyWorkFlowsList);
    }
  };

  const fetchWorkFlowHistory = async (workFlowId, type = "ONBOARD") => {
    if (workFlowHistory && workFlowId === workFlowHistory[0]?.workFlowId) {
      setWorkFlowHistory(null);
      return;
    }
    setIsPageLoading(true);
    let res = await getWorkFlowHistory(workFlowId, type);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setWorkFlowHistory(res?.res);
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Something went wrong while fetching workflow history");
    }
  };

  useEffect(() => {
    if (currentTab === "TEMPLATES") {
      fetchTemplates();
      window.location.hash = "#Templates";
    } else {
      window.location.hash = "#WorkFlows";
    }
  }, [currentTab]);


  useEffect(() => {
    if (!isManualTriggerOpen) {
      setManualTriggerWorkFlow(null);
    }
  }, [isManualTriggerOpen]);


  const fetchOffBoardWorkFlowHistory = async (workFlowId, type = "NORMAL") => {
    setIsPageLoading(true);
    let res = await getOffBoardWorkFlowHistory(workFlowId, type);
    if (res?.status === "OK") {
      setSelectedOffBoardHistory({ wfId: workFlowId, history: res?.res });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  const handlePause = async (data, action = "PAUSE") => {
    setIsPageLoading(true);
    data.active = action === "RESUME" ? true : false;
    // data.enable = action === "RESUME" ? true : false;
    let res = await saveNewWorkFlow(data);
    if (res?.status === "OK") {
      let copyWorkFlowsList = [...workFlowsList];
      copyWorkFlowsList = copyWorkFlowsList.map((workFlow) => {
        if (workFlow?.id === data?.id) {
          return { ...workFlow, active: action === "RESUME" ? true : false };
        }
        return workFlow;
      });
      setWorkFlowsList(copyWorkFlowsList);
      if (action === "RESUME") {
        notifyToast("success", "Workflow Resumed Successfully");
      } else {
        notifyToast("success", "Workflow Paused Successfully");
      }
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  }

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="WorkFlows" />
        <div className="cf_main_content_place">
          <TopNav pageName="Manage Workflows" />
          <div
            className="cf_main_content_place_main"
            style={{ padding: "20px", gap: "20px" }}
          >
            {/* Header Section */}
            <div className="cf_add_cloud_filter_div" style={{ marginBottom: "20px" }}>
              <TabSwitcher
                tabMenu={tabMenu}
                returnCurrentTab={(e) => setCurrentTab(e)}
                currentTab={currentTab}
              />
            </div>
            {
              currentTab !== "TEMPLATES" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: "20px",
                  }}
                >
                  <div>
                    <h1
                      style={{
                        fontSize: "28px",
                        fontWeight: "700",
                        color: "#1f2937",
                        margin: "0 0 8px 0",
                      }}
                    >
                      Workflows
                    </h1>
                    <p
                      style={{
                        fontSize: "14px",
                        color: "#6b7280",
                        margin: 0,
                      }}
                    >
                      Automate your business processes with rule-based workflows
                    </p>
                  </div>
                  <ActionButton
                    customClass={`changeButtonColorOnHover`}
                    customStyles={{
                      backgroundColor: "#0062ff",
                      color: "#fff",
                      height: "40px",
                      width: "180px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                    }}
                    isDisabled={false}
                    buttonType="button"
                    buttonClickAction={() => {
                      setIsWorkFlowVisible(true);
                    }}
                  >
                    <Plus size={18} color="#fff" />
                    <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#fff" }}>
                      Create Workflow
                    </p>
                  </ActionButton>
                </div>)
            }

            {/* Summary Statistics Cards */}
            {currentTab === "WORKFLOWS" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        backgroundColor: "#e0e7ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Workflow size={20} color="#0062ff" />
                    </div>
                    <div>
                      <p style={{ fontSize: "24px", fontWeight: "700", color: "#1f2937", margin: 0 }}>
                        {Number.isNaN(statistics.totalWorkflows) ? 0 : statistics.totalWorkflows}
                      </p>
                      <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
                        Total Workflows
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        backgroundColor: getStatusColor("ACTIVE", true),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Play size={20} color={getStatusColor("ACTIVE")} />
                    </div>
                    <div>
                      <p style={{ fontSize: "24px", fontWeight: "700", color: "#1f2937", margin: 0 }}>
                        {Number.isNaN(statistics.activeWorkflows) ? 0 : statistics.activeWorkflows}
                      </p>
                      <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
                        Active
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        backgroundColor: "#e0e7ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Zap size={20} color="#0062ff" />
                    </div>
                    <div>
                      <p style={{ fontSize: "24px", fontWeight: "700", color: "#1f2937", margin: 0 }}>
                        {Number.isNaN(statistics.totalExecutions) ? 0 : statistics.totalExecutions}
                      </p>
                      <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
                        Total Executions
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        backgroundColor: "#fff4e6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <TrendingUp size={20} color="#f59e0b" />
                    </div>
                    <div>
                      <p style={{ fontSize: "24px", fontWeight: "700", color: "#1f2937", margin: 0 }}>
                        {statistics.avgSuccessRate}%
                      </p>
                      <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
                        Avg Success Rate
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentTab === "WORKFLOWS" ? (
              <div className="cf_saas_cloudPlacer cf_saas_cloudPlacer_usersList">
                {workFlowsList?.length === 0 && offBoardWorkFlowList?.length === 0 ? (
                  <div
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "12px",
                      padding: "40px",
                      textAlign: "center",
                    }}
                  >
                    <Workflow size={48} color="#9ca3af" style={{ marginBottom: "16px" }} />
                    <p style={{ fontSize: "16px", fontWeight: "600", color: "#1f2937", margin: "0 0 8px 0" }}>
                      No Workflows Yet
                    </p>
                    <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 24px 0" }}>
                      Create your first workflow to automate onboarding or offboarding processes
                    </p>
                    <ActionButton
                      customClass={`changeButtonColorOnHover`}
                      customStyles={{
                        backgroundColor: "#0062ff",
                        color: "#fff",
                        height: "40px",
                        width: "180px",
                      }}
                      isDisabled={false}
                      buttonType="button"
                      buttonClickAction={() => {
                        setIsWorkFlowVisible(true);
                      }}
                    >
                      <div
                        className="CF_d-flex ai-center"
                        style={{
                          gap: "8px",
                          width: "100%",
                          justifyContent: "center",
                        }}
                      >
                        <Plus size={18} color="#fff" />
                        <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#fff" }}>
                          Create Workflow
                        </p>
                      </div>
                    </ActionButton>
                  </div>
                ) : (
                  workFlowsList?.map((data, index) => {
                    const lastRunInfo = getLastRunInfo(data);
                    const rulesCount = countWorkflowRules(data);
                    const workflowName = data?.name || (data?.manual ? data?.workFlowName === "ONBOARD" ? "Manual Trigger Onboarding" : "Manual Trigger Offboarding" : data?.workFlowName === "ONBOARD" ? "Automated Onboarding Workflow" : "Automated Offboarding Workflow");
                    const description = getWorkflowDescription(data);
                    const isActive = data?.active !== false;

                    return (
                      <div
                        key={data?.id || index}
                        className="cf_box_shadow"
                        style={{
                          backgroundColor: "#fff",
                          border: data?.deletedApplications && data?.deletedApplications?.length > 0
                            ? "2px solid #ffc107"
                            : "1px solid #e5e7eb",
                          borderRadius: "12px",
                          padding: "20px",
                          marginBottom: "16px",
                          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                        }}
                      >
                        {/* Header with Icon, Title, and Status */}
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "12px", marginBottom: "12px" }}
                        >
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "8px",
                              backgroundColor: getStatusColor("ACTIVE", true),
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {data?.workFlowName === "GROUP_SHEDULING" ? (
                              <Clock8 size={20} color={getStatusColor("ACTIVE")} />
                            ) : (
                              <UserPlus size={20} color={getStatusColor("ACTIVE")} />
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                              <p style={{ fontSize: "16px", fontWeight: "600", color: "#1f2937", margin: 0 }}>
                                {workflowName}
                              </p>
                              {isActive && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    color: getStatusColor("ACTIVE"),
                                    backgroundColor: getStatusColor("ACTIVE", true),
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <Play size={12} color={getStatusColor("ACTIVE")} />
                                  Active
                                </span>
                              )}
                              {
                                (!data?.active) && (
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      color: "#f59e0b",
                                      backgroundColor: "#fff4e6",
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <Pause size={12} color="#f59e0b" />
                                    Paused
                                  </span>
                                )
                              }
                            </div>
                            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
                              {description}
                            </p>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {data?.workFlowName === "OFFBOARD" && data?.manual ? "" : <>
                              <ActionButton
                                buttonType="button"
                                customClass="changeButtonColorOnHover"
                                customStyles={{
                                  backgroundColor: "transparent",
                                  border: "1px solid #e5e7eb",
                                  height: "32px",
                                  width: "70px",
                                  padding: "0",
                                }}
                                buttonClickAction={() => {
                                  if (data?.deletedApplications && data?.deletedApplications?.length > 0) {
                                    localStorage.setItem(
                                      `deletedApplications_${data?.id}`,
                                      JSON.stringify(data.deletedApplications)
                                    );
                                  }
                                  navigate(
                                    data?.workFlowName === "GROUP_SHEDULING" ? `/ScheduledTrigger?workFlowId=${data?.id}` :
                                      data?.manual ?
                                        data?.workFlowName === "OFFBOARD" ? `/Workflow/OffBoarding/Manual?workFlowId=${data?.id}` :
                                          `/NewFlowV4?workFlowId=${data?.id}&formBased=${data?.formBasedWorkFlow}&manualTrigger=true` : data?.workFlowName === "ONBOARD" ? `/WorkFLowBuilder?action=workflow&workFlowId=${data?.id}` : `/NewFlowV4?workFlowId=${data?.id}`
                                  );
                                }}
                              >
                                <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Edit</p>
                              </ActionButton>
                              {(data?.active) && (
                                <ActionButton
                                  buttonType="button"
                                  customClass="changeButtonColorOnHover"
                                  customStyles={{
                                    backgroundColor: "transparent",
                                    border: "1px solid #e5e7eb",
                                    height: "32px",
                                    width: "70px",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    // Pause functionality
                                    handlePause(data);
                                  }}
                                >
                                  <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Pause</p>
                                </ActionButton>)
                              }
                              {(!data?.active) && (
                                <ActionButton
                                  buttonType="button"
                                  customClass="changeButtonColorOnHover"
                                  customStyles={{
                                    backgroundColor: "transparent",
                                    border: "1px solid #e5e7eb",
                                    height: "32px",
                                    width: "70px",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    // Pause functionality
                                    handlePause(data, "RESUME");
                                  }}
                                > <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Resume</p></ActionButton>)
                              }
                            </>}
                            <div
                              className="cf_dropdown_contatiner"
                              ref={selectDownOptionsRef}
                              style={{ cursor: "pointer" }}
                            >
                              <div
                                className="cf_three_dot_dropdown"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDropDownOpen(true);
                                  setCurrentWorkFlowId(data?.id);
                                }}
                              >
                                <EllipsisVertical size={18} />
                              </div>
                              {dropDownOpen && currentWorkFlowId === data?.id ? (
                                <div
                                  className="cf_dropdown_contatiner_content"
                                  style={{
                                    width: "140px",
                                    left: "-120px",
                                    height: data?.manual ? "150px" : data?.workFlowName === "OFFBOARD" && data?.manual ? "80px" : "140px",
                                    maxHeight: data?.manual ? "220px" : "113px",
                                  }}
                                >
                                  <ActionButton
                                    buttonType="button"
                                    customClass=""
                                    customStyles={{
                                      width: "100%",
                                      padding: "0",
                                    }}
                                    buttonClickAction={() => {
                                      fetchWorkFlowHistory(data?.id, data?.workFlowName);
                                      setDropDownOpen(false);
                                    }}
                                  >
                                    <div
                                      className="CF_d-flex ai-center"
                                      style={{ gap: "10px", width: "100%" }}
                                    >
                                      <History size={14} color="#000" />
                                      <p
                                        style={{
                                          fontSize: "12px",
                                          fontWeight: "500",
                                        }}
                                      >
                                        View History
                                      </p>
                                    </div>
                                  </ActionButton>
                                  {data?.workFlowName === "OFFBOARD" && data?.manual ? "" : <ActionButton
                                    buttonType="button"
                                    customClass=""
                                    customStyles={{
                                      width: "100%",
                                      padding: "0",
                                    }}
                                    buttonClickAction={() => {
                                      if (data?.deletedApplications && data?.deletedApplications?.length > 0) {
                                        localStorage.setItem(
                                          `deletedApplications_${data?.id}`,
                                          JSON.stringify(data.deletedApplications)
                                        );
                                      }
                                      navigate(
                                        data?.workFlowName === "GROUP_SHEDULING" ? `/ScheduledTrigger?workFlowId=${data?.id}` :
                                          data?.manual ? `/NewFlowV4?workFlowId=${data?.id}&manualTrigger=true&formBased=${data?.formBasedWorkFlow}` : data?.workFlowName === "ONBOARD" ? `/WorkFLowBuilder?action=workflow&workFlowId=${data?.id}` : `/NewFlowV4?workFlowId=${data?.id}`
                                      );
                                    }}
                                  >
                                    <div
                                      className="CF_d-flex ai-center"
                                      style={{ gap: "10px", width: "100%" }}
                                    >
                                      <Eye size={14} color="#000" />
                                      <p
                                        style={{
                                          fontSize: "12px",
                                          fontWeight: "500",
                                        }}
                                      >
                                        View WorkFlow
                                      </p>
                                    </div>
                                  </ActionButton>}
                                  <ActionButton
                                    buttonType="button"
                                    customClass=""
                                    customStyles={{
                                      width: "100%",
                                      padding: "0",
                                    }}
                                    buttonClickAction={() => {
                                      setDeleteWorkFlowId(data?.id);
                                      setDropDownOpen(false);
                                    }}
                                  >
                                    <div
                                      className="CF_d-flex ai-center"
                                      style={{ gap: "10px", width: "100%" }}
                                    >
                                      <Trash2 size={14} color="#000" />
                                      <p
                                        style={{
                                          fontSize: "12px",
                                          fontWeight: "500",
                                        }}
                                      >
                                        Delete
                                      </p>
                                    </div>
                                  </ActionButton>
                                  {
                                    data?.manual ?
                                      <ActionButton
                                        buttonType="button"
                                        customClass=""
                                        customStyles={{
                                          width: "100%",
                                          padding: "0",
                                        }}
                                        buttonClickAction={() => {
                                          setExposeAPI({
                                            workFlowId: data?.id,
                                            userId: data?.userId,
                                          });
                                        }}
                                      >
                                        <div
                                          className="CF_d-flex ai-center"
                                          style={{ gap: "10px", width: "100%" }}
                                        >
                                          <Code size={14} color="#000" />
                                          <p
                                            style={{
                                              fontSize: "12px",
                                              fontWeight: "500",
                                            }}
                                          >
                                            Expose API
                                          </p>
                                        </div>
                                      </ActionButton> : ""
                                  }
                                </div>
                              ) : (
                                ""
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Workflow Details Section */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "20px",
                            marginTop: "16px",
                            paddingTop: "16px",
                            borderTop: "1px solid #f3f4f6",
                            flexWrap: "wrap",
                          }}
                        >
                          {/* Trigger Info */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {data?.groupName ? <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}><span style={{ fontWeight: "600", color: "#000" }}>{data?.groupName}</span> Group</p> : ""}
                              <Zap size={14} color="#64748b" />
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                                {data?.workFlowName === "OFFBOARD" && data?.cronExpression ? "Scheduled Offboarding" : data?.workFlowName === "ONBOARD" && data?.manual ? "Manual Trigger Onboarding" : data?.manual ? "Manual Trigger" : data?.workFlowName === "GROUP_SHEDULING" ? <span style={{ fontWeight: "600", color: "#000" }}>{getCronDescription(data.cronExpression)}</span> : data?.providerName
                                  ? `${getCloudName(data?.providerName)} → User Created`
                                  : data?.workFlowName === "GROUP_SHEDULING"
                                    ? "Scheduled Trigger"
                                    : cloudsList?.find((cloud) => cloud?.id === data?.adminCloudId)
                                      ? `${getCloudName(cloudsList.find((cloud) => cloud?.id === data?.adminCloudId)?.providerName)} → User Created`
                                      : "Manual Trigger"}
                              </p>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {data?.manual && (
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                                {(data?.mandatoryApplications?.length ?? 0)} Application{(data?.mandatoryApplications?.length ?? 0) === 1 ? "" : "s"} In this workflow
                              </p>
                            )}
                          </div>

                          {/* Rules Count */}
                          {/* <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <LinkIcon size={14} color="#64748b" />
                            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              {rulesCount} {rulesCount === 1 ? "rule" : "rules"}
                            </p>
                          </div> */}

                          {/* Created Date */}
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <Calendar size={14} color="#64748b" />
                            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              Created {data?.createdOn ? moment(data.createdOn).format("YYYY-MM-DD") : "—"}
                            </p>
                          </div>

                          {/* Last Run Info */}
                          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                            {/* <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <CircleCheckBig size={14} color={getStatusColor("PROCESSED")} />
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                                Last run {lastRunInfo.time}
                              </p>
                            </div> */}
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                                <span style={{ fontWeight: "600", color: "#000" }}>{Number.isNaN(lastRunInfo.executions) ? 0 : lastRunInfo.executions}</span> executions
                              </p>
                              <span style={{ color: "#e5e7eb" }}>•</span>
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                                <span style={{ fontWeight: "600", color: "#000" }}>{Number.isNaN(Number(lastRunInfo.successRate)) ? "0" : lastRunInfo.successRate}%</span> success rate
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Manual Trigger Button */}
                        {data?.manual && data?.workFlowName !== "OFFBOARD" && (
                          <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                            <ActionButton
                              buttonType="button"
                              customClass="changeButtonColorOnHover"
                              customStyles={{
                                backgroundColor: "#0062ff",
                                color: "#fff",
                                height: "32px",
                                width: "100px",
                                padding: "0",
                              }}
                              buttonClickAction={() => {
                                setIsManualTriggerOpen(true);
                                setManualTriggerWorkFlow(data);
                              }}
                            >
                              <div className="CF_d-flex ai-center" style={{ gap: "6px", width: "100%", justifyContent: "center" }}>
                                <Play size={14} color="#fff" />
                                <p style={{ fontSize: "12px", fontWeight: "500", margin: 0, color: "#fff" }}>Run</p>
                              </div>
                            </ActionButton>
                          </div>
                        )}

                        {/* Deleted Applications Warning */}
                        {data?.deletedApplications && data?.deletedApplications?.length > 0 && (
                          <div
                            style={{
                              marginTop: "12px",
                              padding: "8px 12px",
                              backgroundColor: "#fff3cd",
                              border: "1px solid #ffc107",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <TriangleAlert size={16} color="#856404" />
                            <p style={{ fontSize: "12px", color: "#856404", margin: 0 }}>
                              Deleted Applications: {data.deletedApplications.map(app => getCloudName(app?.name || app?.providerName) || app?.id).join(", ")}
                            </p>
                          </div>
                        )}
                        {workFlowHistory?.length > 0 &&
                          data?.id === workFlowHistory[0]?.workFlowId ? (
                          <div
                            className="cf_box_shadow cf_view_created_flow"
                            style={{
                              marginTop: "15px",
                              borderRadius: "8px"
                            }}
                          >
                            <p style={{ fontSize: "14px", fontWeight: "500" }}>
                              Workflow History
                            </p>
                            {workFlowHistory?.map((flowHistoryData) => {
                              return (
                                <div className="cf_box_shadow cf_view_created_flow">
                                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                    <p
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: "500",
                                        color: "#000",
                                      }}
                                    >
                                      {flowHistoryData?.parentEmail || flowHistoryData?.userEmail}
                                    </p>
                                    <span style={{ marginLeft: "auto" }}></span>

                                    {(flowHistoryData?.userExist === true || flowHistoryData?.listOfApps?.some?.((app) => app?.userExist === true)) ? (
                                      <p
                                        style={{
                                          fontSize: "10px",
                                          fontWeight: "600",
                                          color: "#0062ff",
                                          backgroundColor: "#f2f3ff",
                                          padding: "5px 10px",
                                          borderRadius: "5px",
                                        }}
                                      >
                                        <span style={{ color: "#0062ff", fontWeight: "600" }}>User Already Exist</span>
                                      </p>
                                    ) : null}
                                    {
                                      flowHistoryData?.status ? (
                                        <p
                                          style={{
                                            fontSize: "10px",
                                            fontWeight: "600",
                                            color: getStatusColor(flowHistoryData?.status),
                                            backgroundColor: getStatusColor(flowHistoryData?.status, true),
                                            padding: "5px 10px",
                                            borderRadius: "5px",
                                          }}
                                        >
                                          <span style={{ color: getStatusColor(flowHistoryData?.status), fontWeight: "600" }}>{getCloudName(flowHistoryData?.status)}</span></p>
                                      ) : ""
                                    }

                                    <span></span>
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "500",
                                        color: "#64748b",
                                      }}
                                    >
                                      {moment(
                                        flowHistoryData?.createdTime
                                      ).fromNow()}
                                    </p>
                                    <ActionButton
                                      buttonType="button"
                                      customClass=""
                                      customStyles={{
                                        width: "20px",
                                        height: "20px",
                                        padding: "0",
                                      }}
                                      buttonClickAction={() => {
                                        if (selectedOffBoardHistory?.wfId === flowHistoryData?.id) {
                                          setSelectedOffBoardHistory({ wfId: null, history: [] });
                                        } else {
                                          fetchOffBoardWorkFlowHistory(flowHistoryData?.id, flowHistoryData?.workFlowName === "OFFBOARD" ? "OFFBOARD" : "NORMAL");
                                        }
                                      }}
                                    >
                                      <ChevronDown size={14} color="#000" style={{ transform: selectedOffBoardHistory?.wfId === flowHistoryData?.id ? "rotate(180deg)" : "rotate(0deg)" }} />
                                    </ActionButton>
                                  </div>
                                  <>
                                    {selectedOffBoardHistory?.wfId === flowHistoryData?.id &&
                                      (<>
                                        <div
                                          className="CF_d-flex"
                                          style={{
                                            gap: "12px",
                                            flexDirection: "column",
                                            paddingLeft: "10px",
                                            paddingTop: "10px",
                                          }}
                                        >
                                          {selectedOffBoardHistory?.history?.map(
                                            (usrData, index) => (
                                              <UserHistoryItem key={index} usrData={usrData} />
                                            )
                                          )}
                                        </div></>)}
                                  </>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          ""
                        )}
                      </div>
                    );
                  })
                )}
                {offBoardWorkFlowList?.map((data, index) => {
                  const lastRunInfo = getLastRunInfo(data);
                  const workflowName = data?.name || (data?.manual ? "Manual Workflow" : "Automated Offboarding Workflow");
                  const description = data?.cronExpression ? "Scheduled Offboarding" : data?.manual ? "Manual offboarding workflow" : "Automated offboarding workflow";
                  const isActive = data?.active !== false;
                  const hasPrimaryAppMismatch = !primaryCloudFromList || (data?.adminCloudId != null && data?.adminCloudId !== primaryCloudFromList?.id && data?.workFlowName !== "OFFBOARD");

                  return (
                    <div
                      key={data?.id || index}
                      className="cf_box_shadow"
                      style={{
                        backgroundColor: "#fff",
                        border: data?.deletedApplications && data?.deletedApplications?.length > 0
                          ? "2px solid #ffc107"
                          : hasPrimaryAppMismatch && data?.workFlowName !== "OFFBOARD"
                            ? "2px solid #ef4444"
                            : "1px solid #e5e7eb",
                        borderRadius: "12px",
                        padding: "20px",
                        marginBottom: "16px",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                      }}
                    >

                      {/* Header with Icon, Title, and Status */}
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "12px", marginBottom: "12px" }}
                      >
                        <div
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "8px",
                            backgroundColor: "#fee2e2",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <UserMinus2 size={20} color="#ef4444" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <p style={{ fontSize: "16px", fontWeight: "600", color: "#1f2937", margin: 0 }}>
                              {workflowName}
                            </p>
                            {isActive && (
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  color: getStatusColor("ACTIVE"),
                                  backgroundColor: getStatusColor("ACTIVE", true),
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <Play size={12} color={getStatusColor("ACTIVE")} />
                                Active
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
                            {description}
                          </p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <ActionButton
                            buttonType="button"
                            customClass="changeButtonColorOnHover"
                            customStyles={{
                              backgroundColor: "transparent",
                              border: "1px solid #e5e7eb",
                              height: "32px",
                              width: "70px",
                              padding: "0",
                            }}
                            buttonClickAction={() => {
                              if (data?.deletedApplications && data?.deletedApplications?.length > 0) {
                                localStorage.setItem(
                                  `deletedApplications_${data?.id}`,
                                  JSON.stringify(data.deletedApplications)
                                );
                              }
                              navigate(
                                data?.manual
                                  ? `/NewFlowV4?workFlowId=${data?.id}&manualTrigger=true&offboarding=true`
                                  : `/Workflow/OffBoarding?workFlowId=${data?.id}&manualTrigger=${data?.manual}`
                              );
                            }}
                          >
                            <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Edit</p>
                          </ActionButton>
                          {
                            (data?.active) && (
                              <ActionButton
                                buttonType="button"
                                customClass="changeButtonColorOnHover"
                                customStyles={{
                                  backgroundColor: "transparent",
                                  border: "1px solid #e5e7eb",
                                  height: "32px",
                                  width: "70px",
                                  padding: "0",
                                }}
                                buttonClickAction={() => {
                                  // Pause functionality
                                  handlePause(data);
                                }}
                              >
                                <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Pause</p>
                              </ActionButton>)
                          }
                          {
                            (!data?.active) && (
                              <ActionButton
                                buttonType="button"
                                customClass="changeButtonColorOnHover"
                                customStyles={{
                                  backgroundColor: "transparent",
                                  border: "1px solid #e5e7eb",
                                  height: "32px",
                                  width: "70px",
                                  padding: "0",
                                }}
                                buttonClickAction={() => {
                                  // Pause functionality
                                  handlePause(data, "RESUME");
                                }}
                              >
                                <p style={{ fontSize: "12px", fontWeight: "500", margin: 0 }}>Resume</p>
                              </ActionButton>)
                          }
                          <div
                            className="cf_dropdown_contatiner"
                            ref={selectDownOptionsRef}
                            style={{ cursor: "pointer" }}
                          >
                            <div
                              className="cf_three_dot_dropdown"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropDownOpen(true);
                                setCurrentWorkFlowId(data?.id);
                              }}
                            >
                              <EllipsisVertical size={18} />
                            </div>
                            {dropDownOpen && currentWorkFlowId === data?.id ? (
                              <div
                                className="cf_dropdown_contatiner_content"
                                style={{
                                  width: "140px",
                                  left: "-120px",
                                  height: data?.manual ? "80px" : "140px",
                                  maxHeight: "113px",
                                }}
                              >
                                <ActionButton
                                  buttonType="button"
                                  customClass=""
                                  customStyles={{
                                    width: "100%",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    if (workFlowHistory?.length > 0 && workFlowHistory[0]?.workFlowName === "OFFBOARD") {
                                      setWorkFlowHistory(null);
                                      return;
                                    }
                                    fetchWorkFlowHistory(data?.id, "OFFBOARD");
                                    setDropDownOpen(false);
                                  }}
                                >
                                  <div
                                    className="CF_d-flex ai-center"
                                    style={{ gap: "10px", width: "100%" }}
                                  >
                                    <History size={14} color="#000" />
                                    <p
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      View History
                                    </p>
                                  </div>
                                </ActionButton>
                                {
                                  data?.manual ? "" :
                                    <ActionButton
                                      buttonType="button"
                                      customClass=""
                                      customStyles={{
                                        width: "100%",
                                        padding: "0",
                                      }}
                                      buttonClickAction={() => {
                                        // Store deletedApplications in localStorage if they exist
                                        if (data?.deletedApplications && data?.deletedApplications?.length > 0) {
                                          localStorage.setItem(
                                            `deletedApplications_${data?.id}`,
                                            JSON.stringify(data.deletedApplications)
                                          );
                                        }
                                        navigate(
                                          `/Workflow/OffBoarding?workFlowId=${data?.id}&manualTrigger=${data?.manual}`
                                        );
                                      }}
                                    >
                                      <div
                                        className="CF_d-flex ai-center"
                                        style={{ gap: "10px", width: "100%" }}
                                      >
                                        <Eye size={14} color="#000" />
                                        <p
                                          style={{
                                            fontSize: "12px",
                                            fontWeight: "500",
                                          }}
                                        >
                                          View WorkFlow
                                        </p>
                                      </div>
                                    </ActionButton>
                                }
                                <ActionButton
                                  buttonType="button"
                                  customClass=""
                                  customStyles={{
                                    width: "100%",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    setDeleteWorkFlowId(data?.id + "_OFFBOARD");
                                    setDropDownOpen(false);
                                  }}
                                >
                                  <div
                                    className="CF_d-flex ai-center"
                                    style={{ gap: "10px", width: "100%" }}
                                  >
                                    <Trash2 size={14} color="#000" />
                                    <p
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      Delete
                                    </p>
                                  </div>
                                </ActionButton>
                              </div>
                            ) : (
                              ""
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Workflow Details Section */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "20px",
                          marginTop: "16px",
                          paddingTop: "16px",
                          borderTop: "1px solid #f3f4f6",
                          flexWrap: "wrap",
                        }}
                      >
                        {/* Trigger Info */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {data.cronExpression ? <span style={{ fontWeight: "600", color: "#000", fontSize: "12px" }}>{getCronDescription(data.cronExpression)}</span> : ""}
                            <Zap size={14} color="#64748b" />
                            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              {data?.cronExpression ? "Scheduled Offboarding" : data?.manual ? "Manual Trigger" : data?.providerName
                                ? `${getCloudName(data?.providerName)} → User Deprovisioned`
                                : cloudsList?.find((cloud) => cloud?.id === data?.adminCloudId)
                                  ? `${getCloudName(cloudsList.find((cloud) => cloud?.id === data?.adminCloudId)?.providerName)} → User Deprovisioned`
                                  : "Manual Trigger"}
                            </p>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {data?.manual && (
                            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              {(data?.mandatoryApplications?.length ?? 0)} Application{(data?.mandatoryApplications?.length ?? 0) === 1 ? "" : "s"} In this workflow
                            </p>
                          )}
                        </div>

                        {/* Last Run Info */}
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {/* <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              AAAAAAAAAs <span style={{ fontWeight: "600", color: "#000" }}>{Number.isNaN(lastRunInfo.executions) ? 0 : lastRunInfo.executions}</span> executions
                            </p>
                            <span style={{ color: "#e5e7eb" }}>•</span>
                            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                              <span style={{ fontWeight: "600", color: "#000" }}>{Number.isNaN(Number(lastRunInfo.successRate)) ? "0" : lastRunInfo.successRate}%</span> success rate
                            </p> */}
                          </div>
                        </div>
                      </div>

                      {data?.manual && (
                        <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                          <ActionButton
                            buttonType="button"
                            customClass="changeButtonColorOnHover"
                            customStyles={{
                              backgroundColor: "#0062ff",
                              color: "#fff",
                              height: "32px",
                              width: "100px",
                              padding: "0",
                            }}
                            buttonClickAction={() => {
                              setIsManualTriggerOpen(true);
                              setManualTriggerWorkFlow(data);
                            }}
                          >
                            <div className="CF_d-flex ai-center" style={{ gap: "6px", width: "100%", justifyContent: "center" }}>
                              <Play size={14} color="#fff" />
                              <p style={{ fontSize: "12px", fontWeight: "500", margin: 0, color: "#fff" }}>Run</p>
                            </div>
                          </ActionButton>
                        </div>
                      )}
                      {(primaryCloudFromList?.length === 0 || (data?.adminCloudId !== primaryCloudFromList?.id && data?.workFlowName !== "OFFBOARD")) && (
                        <div
                          style={{
                            marginTop: "12px",
                            padding: "8px 12px",
                            backgroundColor: "#fef2f2",
                            border: "1px solid #ef4444",
                            borderRadius: "6px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <TriangleAlert size={16} color="#ef4444" />
                          <p style={{ fontSize: "12px", color: "#b91c1c", margin: 0 }}>
                            {primaryCloudFromList?.length === 0
                              ? "The Primary Application is deleted or changed. So, Offboarding workflow will not be triggered."
                              : ""}
                            {
                              data?.adminCloudId !== primaryCloudFromList?.id && data?.workFlowName !== "OFFBOARD" ? "Please change the admin application to the primary application." : ""
                            }
                          </p>
                        </div>
                      )}
                      {(workFlowHistory?.length > 0 && workFlowHistory[0]?.workFlowName === "OFFBOARD" && workFlowHistory[0]?.workFlowId === data?.id) && (
                        <div className="cf_box_shadow cf_view_created_flow">
                          <p style={{ fontSize: "14px", fontWeight: "500" }}>
                            Workflow History
                          </p>
                          {workFlowHistory?.map((flowHistoryData) => {
                            return (
                              <div key={flowHistoryData?.id} className="cf_box_shadow cf_view_created_flow">
                                <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                  <p
                                    style={{
                                      fontSize: "12px",
                                      fontWeight: "500",
                                      color: "#000",
                                    }}
                                  >
                                    {flowHistoryData?.listOfApps?.[0]?.email}
                                  </p>
                                  <span style={{ marginLeft: "auto" }}></span>

                                  {flowHistoryData?.approveStatus === "APPROVED" && flowHistoryData?.status === "PROCESSED" ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        color: "#2d7f44",
                                        backgroundColor: "rgba(200, 247, 214, 0.52)",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      <span style={{ color: "#2d7f44", fontWeight: "600" }}>Processed</span>
                                    </p>
                                  ) : ""}
                                  {flowHistoryData?.approveStatus === "APPROVED" && flowHistoryData?.status === "NOT_PROCESSED" && data?.cronExpression ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        color: "#0062ff",
                                        backgroundColor: "#f2f3ff",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      <span style={{ color: "#0062ff", fontWeight: "600" }}>Scheduled</span>
                                    </p>
                                  ) : ""}
                                  {flowHistoryData?.approveStatus === "APPROVED" && flowHistoryData?.status === "IN_PROGRESS" ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        color: "#0062ff",
                                        backgroundColor: "#f2f3ff",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      <span style={{ color: "#0062ff", fontWeight: "600" }}>In Progress</span>
                                    </p>
                                  ) : ""}

                                  {flowHistoryData?.approveStatus === "APPROVED" && flowHistoryData?.status === "NOT_PROCESSED" && !data?.cronExpression ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        color: "#0062ff",
                                        backgroundColor: "#f2f3ff",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      <span style={{ color: "#0062ff", fontWeight: "600" }}>In Progress</span>
                                    </p>
                                  ) : ""}
                                  {flowHistoryData?.approveStatus === "REJECTED" ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "400",
                                        color: "#ef4343e6",
                                        backgroundColor: "#fef2f2",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      Approval Status: <span style={{ color: "#ef4343e6", fontWeight: "600" }}>Rejected</span>
                                    </p>
                                  ) : ""}
                                  {flowHistoryData?.approveStatus === "IN_QUEUE" ? (
                                    <p
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        color: "#ffa500",
                                        backgroundColor: "rgb(255 241 216 / 56%)",
                                        padding: "5px 10px",
                                        borderRadius: "5px",
                                      }}
                                    >
                                      Waiting for Approval
                                    </p>
                                  ) : ""}

                                  <span></span>
                                  <p
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: "500",
                                      color: "#64748b",
                                    }}
                                  >
                                    {moment(
                                      flowHistoryData?.createdTime
                                    ).fromNow()}
                                  </p>
                                  <ActionButton
                                    buttonType="button"
                                    customClass=""
                                    customStyles={{
                                      width: "20px",
                                      height: "20px",
                                      padding: "0",
                                    }}
                                    buttonClickAction={() => {
                                      if (selectedOffBoardHistory?.wfId === flowHistoryData?.id) {
                                        setSelectedOffBoardHistory({ wfId: null, history: [] });
                                      } else {
                                        fetchOffBoardWorkFlowHistory(flowHistoryData?.id, "OFFBOARD");
                                      }
                                    }}
                                  >
                                    <ChevronDown size={14} color="#000" style={{ transform: selectedOffBoardHistory?.wfId === flowHistoryData?.id ? "rotate(180deg)" : "rotate(0deg)" }} />
                                  </ActionButton>
                                </div>
                                <>
                                  {selectedOffBoardHistory?.wfId === flowHistoryData?.id &&
                                    (<>
                                      <div
                                        className="CF_d-flex"
                                        style={{
                                          gap: "12px",
                                          flexDirection: "column",
                                          paddingLeft: "10px",
                                          paddingTop: "10px",
                                        }}
                                      >
                                        {selectedOffBoardHistory?.history?.length > 0 ? (
                                          selectedOffBoardHistory?.history?.map((item, index) => (
                                            <div
                                              key={item?.id || index}
                                              className="CF_d-flex ai-center"
                                              style={{
                                                gap: "8px",
                                                padding: "8px 12px",
                                                borderRadius: "6px",
                                                backgroundColor: item?.offBoardStatus === "PROCESSED" ? "rgb(200 247 214 / 52%)" : item?.offBoardStatus === "CONFLICT" ? "rgb(255 164 164 / 24%)" : "#f2f3ff",
                                                border: "1px solid #e5e7eb",
                                              }}
                                            >
                                              <img
                                                src={cloudImageMapper(item?.applicationName)}
                                                title={getCloudName(item?.applicationName)}
                                                alt={item?.applicationName}
                                                style={{ width: "20px", height: "20px", objectFit: "contain" }}
                                              />
                                              <p style={{ fontSize: "12px", fontWeight: "500", color: "#1f2937", margin: 0, flex: 1 }}>
                                                {getCloudName(item?.applicationName)}
                                              </p>
                                              <span
                                                style={{
                                                  fontSize: "10px",
                                                  fontWeight: "600",
                                                  color: item?.offBoardStatus === "PROCESSED" ? "#2d7f44" : item?.offBoardStatus === "CONFLICT" ? "#ef4343e6" : "#0062ff",
                                                  backgroundColor: item?.offBoardStatus === "PROCESSED" ? "rgba(200, 247, 214, 0.52)" : item?.offBoardStatus === "CONFLICT" ? "#fef2f2" : "#f2f3ff",
                                                  padding: "4px 8px",
                                                  borderRadius: "4px",
                                                }}
                                              >
                                                {item?.offBoardStatus === "DATA_TRANSFER" ? "Data Transfer In Progress" : item?.offBoardStatus === "PROCESSED" ? "Processed" : item?.offBoardStatus === "CONFLICT" ? "Failed" : item?.offBoardStatus === "IN_PROGRESS" ? "In Progress" : data?.cronExpression ? "Scheduled" : "In Progress"}
                                              </span>
                                              {item?.createdTime && (
                                                <p style={{ fontSize: "10px", color: "#64748b", margin: 0 }}>
                                                  {moment(item.createdTime).fromNow()}
                                                </p>
                                              )}
                                            </div>
                                          ))
                                        ) : (
                                          <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>No details</p>
                                        )}
                                      </div></>)}
                                </>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="cf_saas_cloudPlacer cf_saas_cloudPlacer_usersList">
                <div
                  className="cf_add_cloud_filter_div"
                  style={{ marginTop: "10px" }}
                >
                  <span style={{ marginLeft: "auto" }}></span>
                  <ActionButton
                    customClass={`changeButtonColorOnHover`}
                    customStyles={{
                      backgroundColor: "#f2f2f2",
                      // padding: "8px 12px",
                      height: "40px",
                      width: "140px",
                    }}
                    isDisabled={false}
                    buttonType="button"
                    buttonClickAction={() => {
                      if (currentTab === "WORKFLOWS") {
                        navigate("/NewFlowV4");
                      } else {
                        navigate("/WorkFLowBuilder");
                      }
                    }}
                  >
                    <div
                      className="CF_d-flex ai-center"
                      style={{
                        gap: "5px",
                        width: "100%",
                        justifyContent: "center",
                      }}
                    >
                      <p style={{ fontSize: "12px", fontWeight: "500" }}>
                        Create{" "}
                        {currentTab === "WORKFLOWS" ? "Workflow" : "Template"}
                      </p>
                    </div>
                  </ActionButton>
                </div>
                {templatesList?.map((data, index) => {
                  return (
                    <div className="cf_box_shadow cf_view_created_flow">
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "10px" }}
                      >
                        <div className="cf_newFlow_trigger_pannel_header_icon">
                          <FileText size={20} color="#8b5cf6" />
                        </div>
                        <p style={{ fontSize: "14px", fontWeight: "500" }}>
                          {data?.templetName || data?.conditionValue}
                        </p>
                        <span style={{ marginLeft: "auto" }}></span>
                        <div>
                          <div
                            className="cf_dropdown_contatiner"
                            ref={selectDownOptionsRef}
                            style={{ cursor: "pointer" }}
                          >
                            <div
                              className="cf_three_dot_dropdown"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropDownOpen(true);
                                setCurrentWorkFlowId(data?.id);
                              }}
                            >
                              <EllipsisVertical size={18} />
                            </div>
                            {dropDownOpen && currentWorkFlowId === data?.id ? (
                              <div
                                className="cf_dropdown_contatiner_content"
                                style={{
                                  width: "140px",
                                  left: "-120px",
                                  height: "80px",
                                  maxHeight: "80px",
                                }}
                              >
                                <ActionButton
                                  buttonType="button"
                                  customClass=""
                                  customStyles={{
                                    width: "100%",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    localStorage.setItem(
                                      "editTemplate",
                                      JSON.stringify(data)
                                    );
                                    navigate(
                                      `/WorkFLowBuilder?templateId=${data?.id}`
                                    );
                                  }}
                                >
                                  <div
                                    className="CF_d-flex ai-center"
                                    style={{ gap: "10px", width: "100%" }}
                                  >
                                    <Edit2 size={14} color="#000" />
                                    <p
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      Edit Template
                                    </p>
                                  </div>
                                </ActionButton>
                                <ActionButton
                                  buttonType="button"
                                  customClass=""
                                  customStyles={{
                                    width: "100%",
                                    padding: "0",
                                  }}
                                  buttonClickAction={() => {
                                    setDeleteWorkFlowId(data?.id + "_TEMPLATE");
                                    setDropDownOpen(false);
                                  }}
                                >
                                  <div
                                    className="CF_d-flex ai-center"
                                    style={{ gap: "10px", width: "100%" }}
                                  >
                                    <Trash2 size={14} color="#000" />
                                    <p
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      Delete
                                    </p>
                                  </div>
                                </ActionButton>
                              </div>
                            ) : (
                              ""
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <Popup
        options={{
          isOpen: isWorkFlowVisible,
          title: newWorkflowPopupTitle,
          oTitle: newWorkflowPopupTitle,
          popupWidth: "31%",
          type: "side",
          popupHeight: "calc(100% - 0px)",
          popupTop: "00px",
          maxHeight: "100%",
          overflowY: "auto",
          parentStyles: {
            justifyContent: "flex-end",
          },
          titleCustomStyles: {
            fontSize: "16px",
            fontWeight: "600",
          },
        }}
        toggleOpen={handleCloseNewWorkflowPopup}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "0 15px 15px 15px",
            height: "100%",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            flexDirection: "column",
          }}
        >
          {newWorkflowStep === 2 && (
            <button
              type="button"
              onClick={() => {
                setNewWorkflowStep(1);
                setSelectedWorkflowType(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "16px",
                padding: "8px 0",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "14px",
                color: "#1e3a5f",
                fontWeight: "500",
              }}
              aria-label="Back to workflow type"
            >
              <ArrowLeft size={18} />
              Back
            </button>
          )}

          {newWorkflowStep === 1 && <div className="cf_workflow_action_panel_compact" style={{ gap: "20px", marginTop: "20px" }}>

            <div
              className="cf_workdflow_action_item"
              style={{ maxWidth: "100%", padding: "15px", width: "100%" }}
              onClick={() => {
                setSelectedWorkflowType("onboarding");
                setNewWorkflowStep(2);
              }}
            >
              <div className="cf_workdflow_action_item_icon">
                <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                  <UserPlus color="#fff" size={24} />
                </div>
              </div>
              <div className="cf_workdflow_action_item_content">
                <p
                  style={{
                    color: "#0f1729",
                    fontWeight: "500",
                    lineHeight: "1.25",
                    margin: 0,
                  }}
                >
                  Onboarding
                </p>
                <p
                  className="cf_sub_heading"
                  style={{ fontWeight: "400", margin: "2px 0 0 0" }}
                >
                  Create a workflow for onboarding users.
                </p>
              </div>
            </div>

            <div
              className="cf_workdflow_action_item"
              style={{ maxWidth: "100%", padding: "15px", width: "100%" }}
              onClick={() => {
                setSelectedWorkflowType("offboarding");
                setNewWorkflowStep(2);
              }}
            >
              <div className="cf_workdflow_action_item_icon">
                <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                  <UserMinus2 color="#fff" size={24} />
                </div>
              </div>
              <div className="cf_workdflow_action_item_content">
                <p
                  style={{
                    color: "#0f1729",
                    fontWeight: "500",
                    lineHeight: "1.25",
                    margin: 0,
                  }}
                >
                  Offboarding
                </p>
                <p
                  className="cf_sub_heading"
                  style={{ fontWeight: "400", margin: "2px 0 0 0" }}
                >
                  Create a workflow for offboarding users.
                </p>
              </div>
            </div>
          </div>}

          {newWorkflowStep === 10 && (
            <div className="cf_saas_cloudPlacer cf_saas_workflow_options_List cf_new_workflow_dialog_cards">
              <div
                role="button"
                tabIndex={0}
                className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                style={{
                  paddingLeft: "0",
                  paddingRight: "0",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setSelectedWorkflowType("onboarding");
                  setNewWorkflowStep(2);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedWorkflowType("onboarding");
                    setNewWorkflowStep(2);
                  }
                }}
              >
                <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                    <UserPlus color="#fff" size={24} />
                  </div>
                  <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                    <p className="cf_saas_menu_title_container_head">Onboarding</p>
                    <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                      Create a workflow to automate onboarding tasks for users.
                    </p>
                  </div>
                </div>
                <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    Select <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                  </span>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                style={{
                  paddingLeft: "0",
                  paddingRight: "0",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setSelectedWorkflowType("offboarding");
                  setNewWorkflowStep(2);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedWorkflowType("offboarding");
                    setNewWorkflowStep(2);
                  }
                }}
              >
                <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                    <UserMinus2 color="#fff" size={24} />
                  </div>
                  <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                    <p className="cf_saas_menu_title_container_head">Offboarding</p>
                    <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                      Create a workflow to automate offboarding tasks for users.
                    </p>
                  </div>
                </div>
                <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    Select <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                  </span>
                </div>
              </div>
            </div>
          )}

          {newWorkflowStep === 2 && (
            <div className="cf_saas_cloudPlacer cf_saas_workflow_options_List cf_new_workflow_dialog_cards cf_new_workflow_dialog_cards_step2">
              <div
                role="button"
                tabIndex={0}
                className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                style={{
                  paddingLeft: "0",
                  paddingRight: "0",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() =>
                  handleSelectTrigger(
                    selectedWorkflowType === "onboarding"
                      ? "/WorkFLowBuilder?action=workflow"
                      : "/Workflow/OffBoarding"
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTrigger(
                      selectedWorkflowType === "onboarding"
                        ? "/WorkFLowBuilder?action=workflow"
                        : "/Workflow/OffBoarding"
                    );
                  }
                }}
              >
                <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                    <Workflow color="#fff" size={24} />
                  </div>
                  <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                    <p className="cf_saas_menu_title_container_head">Automated Trigger</p>
                    <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                      Workflow fires automatically based on a platform event (e.g., {selectedWorkflowType === "onboarding" ? `user created` : `user offboarded`} in Google Workspace).
                    </p>
                  </div>
                </div>
                <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    Create Workflow <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                  </span>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                style={{
                  paddingLeft: "0",
                  paddingRight: "0",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() =>
                  handleSelectTrigger(
                    selectedWorkflowType === "onboarding"
                      ? `/NewFlowV4?manualTrigger=true`
                      : `/NewFlowV4?manualTrigger=true&offboarding=true`
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTrigger(
                      selectedWorkflowType === "onboarding"
                        ? "/NewFlowV4?manualTrigger=true"
                        : `/NewFlowV4?manualTrigger=true&offboarding=true`
                    );
                  }
                }}
              >
                <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                    <Play color="#fff" size={24} />
                  </div>
                  <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                    <p className="cf_saas_menu_title_container_head">Manual Trigger</p>
                    <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                      Admin manually triggers the workflow for a specific user.
                    </p>
                  </div>
                </div>
                <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    Create Workflow <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                  </span>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                style={{
                  paddingLeft: "0",
                  paddingRight: "0",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() =>
                  handleSelectTrigger(
                    selectedWorkflowType === "onboarding"
                      ? "/ScheduledTrigger"
                      : `/Workflow/OffBoarding/Scheduled`
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTrigger(
                      selectedWorkflowType === "onboarding"
                        ? "/ScheduledTrigger"
                        : `/Workflow/OffBoarding/Scheduled`
                    );
                  }
                }}
              >
                <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                    <Clock8 color="#fff" size={24} />
                  </div>
                  <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                    <p className="cf_saas_menu_title_container_head">{selectedWorkflowType === "onboarding" ? "Group Scheduling" : "Scheduled Trigger"}</p>
                    <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                      {selectedWorkflowType === "onboarding" ? `Create a workflow to schedule onboarding for a specific Group at a specific time of a day or date with recurring or one time basis.` : `Workflow runs at a scheduled date/time, on a recurring or one-time basis.`}
                    </p>
                  </div>
                </div>
                <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    Create Workflow <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                  </span>
                </div>
              </div>

              {selectedWorkflowType === "onboarding" && (
                <div
                  role="button"
                  tabIndex={0}
                  className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_saas_workflow_options_item"
                  style={{
                    paddingLeft: "0",
                    paddingRight: "0",
                    position: "relative",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    handleSelectTrigger("/NewFlowV4?formBased=true&manualTrigger=true")
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectTrigger("/NewFlowV4?formBased=true&manualTrigger=true");
                    }
                  }}
                >
                  <div style={{ padding: "0 1.5rem 0 1.5rem", display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                    <div style={{ background: "#001a6f", flexShrink: 0 }} className="cf_saas_menu_icon_div">
                      <ClipboardList color="#fff" size={24} />
                    </div>
                    <div className="cf_saas_menu_title_container" style={{ flex: 1, minWidth: 0 }}>
                      <p className="cf_saas_menu_title_container_head">Microsoft Form Based Onboarding</p>
                      <p className="cf_new_dashboard_pannel_info" style={{ marginTop: "2px" }}>
                        Trigger onboarding workflows based on Microsoft Form submissions.
                      </p>
                    </div>
                  </div>
                  <div className="cf_saas_menu_link_container cf_saas_workflow_options_item_link">
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      Create Workflow <MoveRight size={12} className="cf_newDashboard_OpenLink" />
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: deleteWorkFlowId,
          title: deleteWorkFlowId?.includes("_TEMPLATE")
            ? `Delete Template`
            : `Delete Workflow`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setDeleteWorkFlowId}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
            maxHeight: "500px",
          }}
        >
          <p style={{ fontWeight: "600" }}>
            Are you sure you want to delete the{" "}
            {deleteWorkFlowId?.includes("_TEMPLATE") ? "Template" : "Workflow"}{" "}
            ?{" "}
          </p>
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
              background: "#f2f2f2",
              color: "#000",
              border: "1px solid #ddd",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="No"
            buttonClickAction={() => {
              setDeleteWorkFlowId(null);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => handleDeleteWorkFlow()}
          />
        </div>
      </Popup>
      <ExposedWorkflowApiPopup
        exposeContext={exposeAPI}
        toggleOpen={(v) => {
          if (v === "" || v == null) setExposeAPI(null);
        }}
      />
      {
        isManualTriggerOpen ?
          <ManualTriggerComponent
            isManualTriggerOpen={isManualTriggerOpen}
            setIsManualTriggerOpen={setIsManualTriggerOpen}
            manualTriggerWorkFlow={manualTriggerWorkFlow}
            setManualTriggerWorkFlow={setManualTriggerWorkFlow}
            setIsPageLoading={setIsPageLoading}
          /> : ""
      }
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ManageWorkFlowNew;
