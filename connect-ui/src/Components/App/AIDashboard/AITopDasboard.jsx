import {
  Bot,
  CircleDollarSign,
  Code,
  DollarSign,
  MoveRight,
  Puzzle,
  Users,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { formatCurrencyShort, listOfAIApplications } from "../../helpers/utils";
import { getAIUsageInfoForDashboard } from "../SaaSManagement/SaaSActions/SaaSActions";
import AIBottomDashboard from "./AIBottomDashboard";

const AITopDasboard = (props) => {
  const navigation = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [totalBilling, setTotalBilling] = useState({});
  const [mostUsedModelMap, setMostUsedModelMap] = useState({});
  const { cloudsList } = globalContext;

  const [aiUsageInfo, setAiUsageInfo] = useState([]);

  useEffect(() => {
    getAIInfo();
  }, []);

  const getAIInfo = async () => {
    let res = await getAIUsageInfoForDashboard();
    if (res?.status === "OK") {
      setAiUsageInfo(res?.res);
    }
  };

  useEffect(() => {
    if (aiUsageInfo?.length > 0) {
      setMostUsedModelMap(
        aiUsageInfo?.reduce((acc, curr) => {
          if (curr?.mostUsedModel) {
            acc[curr?.mostUsedModel] = (acc[curr?.mostUsedModel] || 0) + 1;
          }
          return acc;
        }, {})
      );
    }
  }, [aiUsageInfo]);

  console.log(mostUsedModelMap);

  return (
    <>
      <div className="cf_new_dashboard_resourceApps_container">
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Total AI Applications</p>
            <MoveRight
              className="cf_newDashboard_OpenLink"
              size={16}
              color="#0062ff"
              strokeWidth={2.5}
              onClick={() => navigation("/Integrations/Manage")}
            />
            <span style={{ marginLeft: "auto" }}></span>
            <Puzzle size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p className="cf_new_dashboard_Data">
              {cloudsList?.reduce((acc, curr) => {
                return (
                  acc +
                  (listOfAIApplications.includes(curr?.providerName) ? 1 : 0)
                );
              }, 0)}
            </p>
            <p className="cf_new_dashboard_pannel_info">Integrated Apps</p>
          </div>
        </div>

        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Total Users</p>
            <MoveRight
              className="cf_newDashboard_OpenLink"
              size={16}
              color="#0062ff"
              strokeWidth={2.5}
              onClick={() => navigation("/UsersList")}
            />
            <span style={{ marginLeft: "auto" }}></span>
            <Users size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p className="cf_new_dashboard_Data">
              {cloudsList?.reduce((acc, curr) => {
                return (
                  acc +
                  (listOfAIApplications.includes(curr?.providerName)
                    ? curr?.usersCount
                    : 0)
                );
              }, 0)}
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Across all AI applications
            </p>
          </div>
        </div>
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Total Lines of Code Added</p>
            <span style={{ marginLeft: "auto" }}></span>
            <Code size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}>
              {formatCurrencyShort(
                aiUsageInfo?.reduce((acc, curr) => {
                  return acc + curr?.totalLinesAdded;
                }, 0)
              )}
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Across all AI applications
            </p>
          </div>
        </div>
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Most Used AI Model</p>
            <span style={{ marginLeft: "auto" }}></span>
            <Bot size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p className="cf_new_dashboard_Data" style={{ color: "#16a34a" }}>
              {Object.keys(mostUsedModelMap)?.length > 0
                ? Object.keys(mostUsedModelMap)?.reduce((a, b) =>
                    mostUsedModelMap[a] > mostUsedModelMap[b] ? a : b
                  )
                : "-"}
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Across all AI applications
            </p>
          </div>
        </div>
      </div>
      <AIBottomDashboard aiInsightsList={aiUsageInfo} />
    </>
  );
};

export default AITopDasboard;
