import Popup from "../../../Resuables/Popup/Popup";
import CustomLineGraphs from "../../../Resuables/Charts/CustomLineGraphs";
import { Bot, Code, Terminal, Wrench } from "lucide-react";
import { getAIUsageInsights } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { useContext, useEffect, useState } from "react";
import {
  formatCurrencyShort,
  formatDateForGraph,
} from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const n = (v) => Number(v || 0);

const toolKeys = ["edit_tool", "write_tool", "multi_edit_tool", "notebook_edit_tool"];

const sumToolAccepted = (entry) => {
  const ta = entry?.tool_actions || {};
  return toolKeys.reduce((acc, k) => acc + n(ta[k]?.accepted), 0);
};

const sumToolRejected = (entry) => {
  const ta = entry?.tool_actions || {};
  return toolKeys.reduce((acc, k) => acc + n(ta[k]?.rejected), 0);
};

const modelTokenTotals = (rows) => {
  const byModel = {};
  rows.forEach((row) => {
    const breakdown = Array.isArray(row?.model_breakdown) ? row.model_breakdown : [];
    breakdown.forEach((m) => {
      const name = m?.model || "unknown";
      const t = m?.tokens || {};
      const sum =
        n(t.input) + n(t.output) + n(t.cache_read) + n(t.cache_creation);
      byModel[name] = (byModel[name] || 0) + sum;
    });
  });
  return byModel;
};

const mostUsedModelFromRows = (rows) => {
  const totals = modelTokenTotals(rows);
  const keys = Object.keys(totals);
  if (!keys.length) return "-";
  return keys.reduce((a, b) => (totals[a] >= totals[b] ? a : b));
};

const formatModelBreakdownCell = (entry) => {
  const breakdown = Array.isArray(entry?.model_breakdown) ? entry.model_breakdown : [];
  if (!breakdown.length) return "-";
  return breakdown
    .map((m) => {
      const t = m?.tokens || {};
      const sum = n(t.input) + n(t.output) + n(t.cache_read) + n(t.cache_creation);
      return `${m?.model || "?"} (${formatCurrencyShort(sum)} tok)`;
    })
    .join(", ");
};

const buildClaudeCodeGraphData = (rows) =>
  [...(rows || [])]
    .sort((a, b) => new Date(a?.date || 0) - new Date(b?.date || 0))
    .map((row) => ({
      name: formatDateForGraph(row?.date),
      "Lines Added": n(row?.core_metrics?.lines_of_code?.added),
      "Lines Removed": n(row?.core_metrics?.lines_of_code?.removed),
    }));

const ClaudeAIUserInsights = ({
  selectedUser,
  setSelectedUser,
  isPageLoading,
  setIsPageLoading,
  customPage = false,
}) => {
  const [aiUsageInfo, setAIUsageInfo] = useState(null);
  const [isVisible, setIsVisible] = useState(true);
  const [graphData, setGraphData] = useState(null);
  const { globalContext } = useContext(GlobalContext);
  const { id } = {
    ...globalContext?.saasCloud,
  };
  const [topHeaders, setTopHeaders] = useState([
    {
      id: "linesAdded",
      title: "Lines Added (Claude Code)",
      icon: <Code size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "",
      color: "#3b82f6",
      value: 0,
      subValue: null,
    },
    {
      id: "sessions",
      title: "Claude Code Sessions",
      icon: <Terminal size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "",
      color: "#001a6f",
      value: 0,
      subValue: null,
    },
    {
      id: "mostUsedModels",
      title: "Most Used Model",
      icon: <Bot size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "",
      color: "#f59e0b",
      value: "-",
      subValue: null,
    },
    {
      id: "toolActions",
      title: "Tool Actions",
      icon: <Wrench size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "",
      color: "#22c55e",
      value: 0,
      subValue: null,
    },
  ]);

  useEffect(() => {
    if (selectedUser?.id || selectedUser?.groupName) {
      getAIUsageInfo();
    } else {
      setIsVisible(false);
    }
  }, [selectedUser]);

  useEffect(() => {
    if (!isVisible) {
      if (!customPage) {
        setSelectedUser(null);
      }
    }
  }, [isVisible]);

  const getAIUsageInfo = async () => {
    setIsPageLoading(true);
    const res = await getAIUsageInsights(
      selectedUser?.adminCloudId || id,
      selectedUser?.email || selectedUser?.groupEmail
    );
    if (res?.status === "OK") {
      const rows = Array.isArray(res?.res) ? res.res : [];
      setAIUsageInfo(rows);
      setGraphData(buildClaudeCodeGraphData(rows));

      const linesAdded = rows.reduce(
        (acc, curr) => acc + n(curr?.core_metrics?.lines_of_code?.added),
        0
      );
      const linesRemoved = rows.reduce(
        (acc, curr) => acc + n(curr?.core_metrics?.lines_of_code?.removed),
        0
      );
      const sessions = rows.reduce((acc, curr) => acc + n(curr?.core_metrics?.num_sessions), 0);
      const commits = rows.reduce(
        (acc, curr) => acc + n(curr?.core_metrics?.commits_by_claude_code),
        0
      );
      const prs = rows.reduce(
        (acc, curr) => acc + n(curr?.core_metrics?.pull_requests_by_claude_code),
        0
      );
      const toolAccepted = rows.reduce((acc, curr) => acc + sumToolAccepted(curr), 0);
      const toolRejected = rows.reduce((acc, curr) => acc + sumToolRejected(curr), 0);
      const mostModel = mostUsedModelFromRows(rows);

      setTopHeaders([
        {
          id: "linesAdded",
          title: "Lines Added (Claude Code)",
          icon: <Code size={16} strokeWidth={2} color="#64748b" />,
          subtitle: "",
          color: "#3b82f6",
          value: linesAdded,
          subValue:
            linesRemoved > 0 ? (
              <span
                style={{
                  color: "rgb(235, 14, 73)",
                  fontSize: "10px",
                  fontWeight: "500",
                  marginLeft: "10px",
                }}
              >
                {formatCurrencyShort(linesRemoved)} removed
              </span>
            ) : null,
        },
        {
          id: "sessions",
          title: "Claude Code Sessions",
          icon: <Terminal size={16} strokeWidth={2} color="#64748b" />,
          subtitle:
            commits > 0 || prs > 0
              ? `Commits: ${commits} · PRs: ${prs}`
              : "",
          color: "#001a6f",
          value: sessions,
          subValue: null,
        },
        {
          id: "mostUsedModels",
          title: "Most Used Model",
          icon: <Bot size={16} strokeWidth={2} color="#64748b" />,
          subtitle: "",
          color: "#f59e0b",
          value: mostModel,
          subValue: null,
        },
        {
          id: "toolActions",
          title: "Tool Actions",
          icon: <Wrench size={16} strokeWidth={2} color="#64748b" />,
          subtitle: "",
          color: "#22c55e",
          value: toolAccepted,
          subValue:
            toolRejected > 0 ? (
              <span
                style={{
                  color: "rgb(235, 14, 73)",
                  fontSize: "10px",
                  fontWeight: "500",
                  marginLeft: "10px",
                }}
              >
                {formatCurrencyShort(toolRejected)} rejected
              </span>
            ) : null,
        },
      ]);

      setIsPageLoading(false);
      setIsVisible(true);
    } else {
      setIsPageLoading(false);
      setIsVisible(false);
    }
  };

  const tableRows = [...(aiUsageInfo || [])].sort(
    (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0)
  );

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${selectedUser?.firstName ||
          selectedUser?.email ||
          selectedUser?.groupName
          } Usage Insights`,
        popupWidth: "80%",
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
        titleDivStyles: {
          borderBottom: "1px solid #e2e8f0",
        },
      }}
      toggleOpen={setIsVisible}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: "0 5px",
            flexDirection: "column",
            height: "fit-content",
            position: "sticky",
            top: "0",
            zIndex: "99999999",
            backgroundColor: "#fff",
          }}
        >
          <div className="cf_new_dashboard_resourceApps_container">
            {topHeaders.map((header, index) => (
              <div className="cf_new_dashboard_info_pannel" key={header.id || index}>
                <div
                  className="cf_new_dashboard_info_pannel_title"
                  style={{ gap: "8px" }}
                >
                  <p>{header.title}</p>
                  <span style={{ marginLeft: "auto" }}></span>
                  {header?.icon}
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                  <p
                    className="cf_new_dashboard_Data"
                    style={{ color: header.color }}
                  >
                    {typeof header.value === "number"
                      ? formatCurrencyShort(header.value)
                      : header.value}
                    {header?.subValue}
                  </p>
                  <p className="cf_new_dashboard_pannel_info">
                    {header?.subtitle}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="cf_border cf_border_radius cf_overflow_hidden"
            style={{
              backgroundColor: "rgb(255, 255, 255)",
              marginTop: "30px",
            }}
          >
            <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
              <p>Claude Code — Lines Over Time</p>
              <p className="cf_new_dashboard_pannel_info">
                Lines added vs removed by day
              </p>
            </div>
            <CustomLineGraphs
              graphData={graphData}
              line1="Lines Added"
              line2="Lines Removed"
              providerName=""
            />
          </div>

          <div
            className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
            style={{
              paddingLeft: "0",
            }}
          >
            <p>Day Wise Usage</p>
          </div>
          <div
            className="cf_new_tables_div"
            style={{
              height: "fit-content",
              overflow: "visible",
              overflowX: "auto",
            }}
          >
            <table>
              <thead>
                <tr>
                  <th style={{ width: "140px" }}>Date</th>
                  <th style={{ width: "120px", textAlign: "center" }}>Terminal</th>
                  <th style={{ width: "120px", textAlign: "center" }}>Lines +</th>
                  <th style={{ width: "120px", textAlign: "center" }}>Lines −</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Sessions</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Commits</th>
                  <th style={{ width: "100px", textAlign: "center" }}>PRs</th>
                  <th style={{ width: "120px", textAlign: "center" }}>Tools Accepted</th>
                  <th style={{ width: "120px", textAlign: "center" }}>Tools Rejected</th>
                  <th style={{ minWidth: "220px", textAlign: "center" }}>Models</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((data, index) => (
                  <tr key={`${data?.date || index}_usg`}>
                    <td className="cf_new_table_hide_text">
                      <p>{formatDateForGraph(data?.date)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.terminal_type || "-"}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{n(data?.core_metrics?.lines_of_code?.added)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{n(data?.core_metrics?.lines_of_code?.removed)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{n(data?.core_metrics?.num_sessions)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{n(data?.core_metrics?.commits_by_claude_code)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{n(data?.core_metrics?.pull_requests_by_claude_code)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{sumToolAccepted(data)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{sumToolRejected(data)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{formatModelBreakdownCell(data)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Popup>
  );
};

export default ClaudeAIUserInsights;
