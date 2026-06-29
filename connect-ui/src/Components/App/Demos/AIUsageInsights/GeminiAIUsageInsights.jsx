import Popup from "../../../Resuables/Popup/Popup";
import { FileText, Mail, MessageSquare, Table, Video } from "lucide-react";
import { getAIUsageInsights } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { useContext, useEffect, useState } from "react";
import { formatCurrencyShort, formatDateForGraph } from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Org-level reference mix (screenshot); per-user daily counts scale from these weights. */
const GEMINI_APP_WEIGHTS = {
  gmail: 89,
  docs: 62,
  sheets: 41,
  meet: 18,
  chat: 33,
};
const WEIGHT_SUM = Object.values(GEMINI_APP_WEIGHTS).reduce((a, b) => a + b, 0);

const GEMINI_APP_META = [
  { key: "gmail", label: "Gmail", icon: Mail, color: "#ea4335", subtitle: "Gemini events in Gmail (10 days)" },
  { key: "docs", label: "Docs", icon: FileText, color: "#4285f4", subtitle: "Gemini events in Docs (10 days)" },
  { key: "sheets", label: "Sheets", icon: Table, color: "#34a853", subtitle: "Gemini events in Sheets (10 days)" },
  { key: "meet", label: "Meet", icon: Video, color: "#00acc1", subtitle: "Gemini events in Meet (10 days)" },
  { key: "chat", label: "Chat", icon: MessageSquare, color: "#f9ab00", subtitle: "Gemini events in Chat (10 days)" },
];

const LINE_COLORS = {
  Gmail: "#ea4335",
  Docs: "#4285f4",
  Sheets: "#34a853",
  Meet: "#00acc1",
  Chat: "#f9ab00",
};

const hashUserSeed = (user) => {
  const s = String(user?.email || user?.id || user?.firstName || "demo");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

/**
 * 10 calendar days ending `anchorDate`, per-user variation (10 user “profiles” from hash).
 * Counts follow Gmail/Docs/Sheets/Meet/Chat mix from reference row.
 */
export const buildGeminiDemoUsageRows = (selectedUser, anchorDate) => {
  const seed = hashUserSeed(selectedUser);
  const profile = seed % 10;
  const rows = [];
  const end = anchorDate ? new Date(anchorDate) : new Date();
  end.setHours(12, 0, 0, 0);

  for (let i = 0; i < 10; i++) {
    const dt = new Date(end);
    dt.setDate(dt.getDate() - (9 - i));
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getDay();
    const weekend = dow === 0 || dow === 6 ? 0.62 : 1;
    const ramp = 0.82 + i * 0.02;
    const userScale = 0.75 + profile * 0.035;
    const noise = 1 + ((seed >> (i % 5)) & 3) * 0.08;
    const dailyTotal = Math.max(
      6,
      Math.round((12 + (profile + i) % 9) * weekend * ramp * userScale * noise)
    );

    const pick = (w) =>
      Math.max(0, Math.round((w / WEIGHT_SUM) * dailyTotal + ((seed + i * 7 + w) % 5) - 2));

    let gmail = pick(GEMINI_APP_WEIGHTS.gmail);
    let docs = pick(GEMINI_APP_WEIGHTS.docs);
    let sheets = pick(GEMINI_APP_WEIGHTS.sheets);
    let meet = pick(GEMINI_APP_WEIGHTS.meet);
    let chat = pick(GEMINI_APP_WEIGHTS.chat);
    let sum = gmail + docs + sheets + meet + chat;
    if (sum === 0) {
      gmail = 2;
      docs = 1;
      sum = 3;
    }
    const scaleT = dailyTotal / sum;
    gmail = Math.max(0, Math.round(gmail * scaleT));
    docs = Math.max(0, Math.round(docs * scaleT));
    sheets = Math.max(0, Math.round(sheets * scaleT));
    meet = Math.max(0, Math.round(meet * scaleT));
    chat = Math.max(0, dailyTotal - gmail - docs - sheets - meet);

    rows.push({
      usageOn: iso,
      gmail,
      docs,
      sheets,
      meet,
      chat,
    });
  }
  return rows;
};

const formatGeminiRowsForLineChart = (rows) =>
  (rows || []).map((r) => ({
    name: formatDateForGraph(r.usageOn),
    Gmail: r.gmail,
    Docs: r.docs,
    Sheets: r.sheets,
    Meet: r.meet,
    Chat: r.chat,
  }));

const isGeminiWorkspaceRow = (row) =>
  row &&
  typeof row.gmail === "number" &&
  typeof row.docs === "number" &&
  typeof row.sheets === "number";

const buildTopCardsFromRows = (rows) => {
  const totals = { gmail: 0, docs: 0, sheets: 0, meet: 0, chat: 0 };
  (rows || []).forEach((r) => {
    totals.gmail += Number(r.gmail) || 0;
    totals.docs += Number(r.docs) || 0;
    totals.sheets += Number(r.sheets) || 0;
    totals.meet += Number(r.meet) || 0;
    totals.chat += Number(r.chat) || 0;
  });
  return GEMINI_APP_META.map((m) => ({
    id: m.key,
    title: m.label,
    icon: <m.icon size={18} strokeWidth={2} color="#64748b" />,
    subtitle: m.subtitle,
    color: m.color,
    value: totals[m.key],
  }));
};

const GeminiWorkspaceLineChart = ({ graphData, height = 360 }) => {
  if (!graphData?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={graphData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            fontSize: "12px",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        {["Gmail", "Docs", "Sheets", "Meet", "Chat"].map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={LINE_COLORS[key]}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

const GeminiAIUsageInsights = ({
  selectedUser,
  setSelectedUser,
  isPageLoading,
  setIsPageLoading,
  customPage = false,
}) => {
  const [aiUsageInfo, setAIUsageInfo] = useState(null);
  const [isVisible, setIsVisible] = useState(true);
  const [graphData, setGraphData] = useState(null);
  const [topCards, setTopCards] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const { id } = {
    ...globalContext?.saasCloud,
  };

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
    let rows = null;
    try {
      const res = await getAIUsageInsights(
        selectedUser?.adminCloudId || id,
        selectedUser?.email || selectedUser?.groupEmail
      );
      if (res?.status === "OK" && Array.isArray(res?.res) && res.res.length > 0 && isGeminiWorkspaceRow(res.res[0])) {
        rows = res.res.map((r) => ({
          usageOn: r.usageOn ?? r.date,
          gmail: Number(r.gmail) || 0,
          docs: Number(r.docs) || 0,
          sheets: Number(r.sheets) || 0,
          meet: Number(r.meet) || 0,
          chat: Number(r.chat) || 0,
        }));
      }
    } catch {
      rows = null;
    }

    if (!rows?.length) {
      rows = buildGeminiDemoUsageRows(selectedUser);
    }

    setAIUsageInfo(rows);
    setGraphData(formatGeminiRowsForLineChart(rows));
    setTopCards(buildTopCardsFromRows(rows));
    setIsPageLoading(false);
    setIsVisible(true);
  };

  const tableRows = aiUsageInfo ? [...aiUsageInfo].reverse() : [];

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${selectedUser?.firstName || selectedUser?.email || selectedUser?.groupName} — Gemini usage`,
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
          <div
            className="cf_new_dashboard_resourceApps_container"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "12px",
              width: "100%",
            }}
          >
            {topCards.map((card) => (
              <div
                key={card.id}
                className="cf_border cf_border_radius"
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>{card.title}</span>
                  {card.icon}
                </div>
                <p className="cf_new_dashboard_Data" style={{ color: card.color, margin: 0, fontSize: "26px", fontWeight: 700 }}>
                  {formatCurrencyShort(card.value)}
                </p>
                <p className="cf_new_dashboard_pannel_info" style={{ margin: 0, whiteSpace: "pre" }}>
                  {card.subtitle}
                </p>
              </div>
            ))}
          </div>

          <div
            className="cf_border cf_border_radius cf_overflow_hidden"
            style={{
              backgroundColor: "#fff",
              marginTop: "24px",
              border: "1px solid #e2e8f0",
            }}
          >
            <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
              <p>Gemini usage by app</p>
              <p className="cf_new_dashboard_pannel_info">Last 10 days (Gmail, Docs, Sheets, Meet, Chat)</p>
            </div>
            <div style={{ padding: "8px 12px 20px" }}>
              <GeminiWorkspaceLineChart graphData={graphData} height={380} />
            </div>
          </div>

          <div
            className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
            style={{
              paddingLeft: "0",
              marginTop: "20px",
            }}
          >
            <p>Day-wise usage</p>
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
                  <th style={{ width: "140px" }}>Last active</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Gmail</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Docs</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Sheets</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Meet</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Chat</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((data, index) => (
                  <tr key={`${data.usageOn}_${index}`}>
                    <td className="cf_new_table_hide_text">
                      <p>{formatDateForGraph(data.usageOn)}</p>
                    </td>
                    <td className="cf_new_table_hide_text" style={{ textAlign: "center" }}>
                      <p>{data.gmail}</p>
                    </td>
                    <td className="cf_new_table_hide_text" style={{ textAlign: "center" }}>
                      <p>{data.docs}</p>
                    </td>
                    <td className="cf_new_table_hide_text" style={{ textAlign: "center" }}>
                      <p>{data.sheets}</p>
                    </td>
                    <td className="cf_new_table_hide_text" style={{ textAlign: "center" }}>
                      <p>{data.meet}</p>
                    </td>
                    <td className="cf_new_table_hide_text" style={{ textAlign: "center" }}>
                      <p>{data.chat}</p>
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

export default GeminiAIUsageInsights;
