import {
  CircleDollarSign,
  DollarSign,
  MoveRight,
  Puzzle,
  Users,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { collaboratorsCloudsList } from "../../../helpers/helpers";
import { getSaaSCostingWithAppList } from "../DashboardActions/DashboardActions";
import { SET_BILLING_SUMMARY } from "../../../../GlobalContext/action.types";
import {
  formatCurrencyShort,
  getPotentialCostSaving,
  makeDataForCalender,
} from "../../../helpers/utils";

const DTopInfo = (props) => {
  const navigation = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [infoData, setInfoData] = useState({
    totalClouds: 0,
    totalBilling: 0,
    totalActiveUsers: 0,
  });
  const [totalBilling, setTotalBilling] = useState({});
  const [duplicateCloudsCount, setDuplicateCloudsCount] = useState({
    messageCloudsCount: 0,
  });

  useEffect(() => {
    if (globalContext?.cloudsList?.length > 0) {
      fetchSaaSCosting();
      let totalCount = 0;
      globalContext?.cloudsList?.map((data) => {
        return data?.providerName
          ? (totalCount = totalCount + data["Active Users"])
            ? data["Active Users"]
            : 0
          : 0;
      });

      let totalClouds = 0;
      globalContext?.cloudsList?.map((data) => {
        return data?.providerName ? totalClouds++ : 0;
      });

      setInfoData({
        ...infoData,
        totalClouds: totalClouds,
        totalActiveUsers: totalCount,
      });
    }

    let messageCloudsCount = 0;
    globalContext?.cloudsList?.map((data) => {
      return collaboratorsCloudsList.includes(data?.providerName)
        ? messageCloudsCount++
        : "";
    });
    if (messageCloudsCount > 1) {
      setDuplicateCloudsCount({
        ...duplicateCloudsCount,
        messageCloudsCount: messageCloudsCount,
      });
    }
  }, [globalContext?.cloudsList]);

  const fetchSaaSCosting = async () => {
    if (globalContext?.billingSummary?.userFinancialMetrics?.length > 0) {
      setTotalBilling(globalContext?.billingSummary);
      props.setBillingData(globalContext?.billingSummary);
    } else {
      let res = await getSaaSCostingWithAppList();
      if (res?.status === "OK") {
        setTotalBilling(res?.res);
        let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
        dispatch({
          type: SET_BILLING_SUMMARY,
          payload: { ...res?.res, calenderData: calData },
        });
        props.setBillingData(res?.res);
      }
    }
  };

  const calculatePotentialCostSaving = (data) => {
    let count = 0;
    data?.userFinancialMetrics?.map((curr) => {
      return isNaN(getPotentialCostSaving(curr))
        ? (count = count + 0)
        : (count = count + getPotentialCostSaving(curr));
    });
    return count?.toFixed(2);
  };

  return (
    <div className="cf_new_dashboard_resourceApps_container">
      <div className="cf_new_dashboard_info_pannel CF_Pointer"
        onClick={() => navigation("/Integrations/Manage")}
      >
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Total Apps</p>
          {/* <MoveRight
            className="cf_newDashboard_OpenLink"
            size={16}
            color="#0062ff"
            strokeWidth={2.5}
          /> */}
          <span style={{ marginLeft: "auto" }}></span>
          <Puzzle size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data">{infoData?.totalClouds}</p>
          <p className="cf_new_dashboard_pannel_info">Integrated Apps</p>
        </div>
      </div>
      {/* <div className="cf_new_dashboard_info_pannel">
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Overlapping Apps</p>
          <MoveRight
            className="cf_newDashboard_OpenLink"
            size={16}
            color="#0062ff"
            strokeWidth={2.5}
            onClick={() => navigation("/AppConsolidationReport")}
          />
          <span style={{ marginLeft: "auto" }}></span>
          <Copy size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data">
            {duplicateCloudsCount?.messageCloudsCount}
          </p>
          <p className="cf_new_dashboard_pannel_info">
            Apps with similar Functionality
          </p>
        </div>
      </div> */}
      <div className="cf_new_dashboard_info_pannel CF_Pointer"
        onClick={() => navigation("/UsersList")}
      >
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Total Active Users</p>
          {/* <MoveRight
            className="cf_newDashboard_OpenLink"
            size={16}
            color="#0062ff"
            strokeWidth={2.5}
          /> */}
          <span style={{ marginLeft: "auto" }}></span>
          <Users size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data">
            {/* {infoData?.totalActiveUsers ? infoData?.totalActiveUsers : 0} */}
            {totalBilling?.totalUniqueUserCount || 0}
          </p>
          <p className="cf_new_dashboard_pannel_info">
            Across all applications
          </p>
        </div>
      </div>
      <div className="cf_new_dashboard_info_pannel CF_Pointer"
        onClick={() => navigation("/SpentAnalytics")}
      >
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Total Spent</p>
          {/* <MoveRight
            className="cf_newDashboard_OpenLink"
            size={16}
            color="#0062ff"
            strokeWidth={2.5}
          /> */}
          <span style={{ marginLeft: "auto" }}></span>
          <DollarSign size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          {/* <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}> */}
          <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}>
            ${formatCurrencyShort(totalBilling?.totalSpent?.toFixed(2)) ?? 0 ?? 0}
          </p>
          <p className="cf_new_dashboard_pannel_info">
            Annual SaaS subscription costs
          </p>
        </div>
      </div>
      <div className="cf_new_dashboard_info_pannel CF_Pointer"
      onClick={() => navigation("/Analytics")}
      >
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Potential Savings</p>
          {/* <MoveRight
            className="cf_newDashboard_OpenLink"
            size={16}
            color="#0062ff"
            strokeWidth={2.5}
          /> */}
          <span style={{ marginLeft: "auto" }}></span>
          <CircleDollarSign size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data" style={{ color: "#16a34a" }}>
            ${calculatePotentialCostSaving(totalBilling)}
          </p>
          <p className="cf_new_dashboard_pannel_info">From unused licenses</p>
        </div>
      </div>
    </div>
  );
};

export default DTopInfo;
