import {
  Building,
  CalendarClock,
  DollarSign,
  Puzzle,
  Users,
} from "lucide-react";
import { useContext, useEffect } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import RenewalCalendar from "../../Resuables/Nav/RenewalCalendar";
import { formatCurrencyShort, getCategoryForCloud } from "../../helpers/utils";

const DemoTopInfo = ({ orgData, totalCost, claudeMetrics }) => {
  const { globalContext } = useContext(GlobalContext);
  const { saasCloud } = globalContext;
  const { providerName, ssoAppId } = saasCloud;

  const getRenewalDate = () => {
    let data = [];
    data = Object.values(saasCloud?.billingInfo?.expiryDateMap ?? {});
    data = data.reduce((acc, curr) => {
      let date = new Date(curr).toISOString().split("T")[0].split("-");
      let timestamp = new Date(date[0], date[1] - 1, date[2]).getTime();
      acc.push(timestamp);
      return acc;
    }, []);
    data = data.sort((a, b) => a - b);
    return data[0] ? data[0] : "-";
  };

  useEffect(() => {
    getRenewalDate();
  }, [saasCloud]);

  return (
    <div className="cf_new_dashboard_resourceApps_container">
      {(providerName === "GITHUB" && !ssoAppId) ||
        providerName === "ATLASSIAN" ||
        providerName === "PANDADOC" ||
        providerName === "TERRAFORM" ? (
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Organizations</p>
            <span style={{ marginLeft: "auto" }}></span>
            <Building size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p
              className="cf_new_dashboard_Data"
              style={{
                textWrap: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {
                // providerName === "ATLASSIAN" || providerName === "TERRAFORM"
                // ? orgData?.data?.length - 1 || 0
                // :
                orgData?.data?.filter(
                  (item) => item?.organization !== "ALL" && item?.organization
                ).length
              }
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Organizations in the application
            </p>
          </div>
        </div>
      ) : providerName === "CLAUDE" ? <div className="cf_new_dashboard_info_pannel">
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Token Used</p>
          <span style={{ marginLeft: "auto" }}></span>
          {/* <Puzzle size={16} strokeWidth={2} color="#64748b" /> */}
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p
            className="cf_new_dashboard_Data"
            title={claudeMetrics?.totalTokens}
            style={{
              textWrap: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {formatCurrencyShort(claudeMetrics?.totalTokens)}
          </p>
          <p className="cf_new_dashboard_pannel_info">
            Cached Tokens: {formatCurrencyShort(claudeMetrics?.cachedTokens)}
          </p>
        </div>
      </div> : providerName === "CURSOR_AI" ? (
        ""
      ) : (
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>Category</p>
            <span style={{ marginLeft: "auto" }}></span>
            <Puzzle size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p
              className="cf_new_dashboard_Data"
              title={saasCloud?.billingInfo?.category}
              style={{
                textWrap: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {providerName === "OTHERS"
                ? "Others"
                : saasCloud?.billingInfo?.category ??
                getCategoryForCloud(providerName)}
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Categories of Applications
            </p>
          </div>
        </div>
      )}
      <div className="cf_new_dashboard_info_pannel">
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Users</p>

          <span style={{ marginLeft: "auto" }}></span>
          <Users size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data">
            {/* {infoData?.totalActiveUsers ? infoData?.totalActiveUsers : 0} */}
            {providerName === "GITHUB__" || providerName === "ATLASSIAN__" || providerName === "CANNY"
              ? orgData?.uniqueUsersCount || 0
              : saasCloud?.usersCount || 0}
            {/* {saasCloud?.usersCount || 0} */}
          </p>
          <p className="cf_new_dashboard_pannel_info">
            {providerName === "GITHUB__" || providerName === "ATLASSIAN__"
              ? "Unique Users in the application"
              : "Users in the application"}
          </p>
        </div>
      </div>
      <div className="cf_new_dashboard_info_pannel">
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Cost</p>
          <span style={{ marginLeft: "auto" }}></span>
          <DollarSign size={16} strokeWidth={2} color="#64748b" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}>
            $
            {providerName === "CLAUDE" ? formatCurrencyShort(claudeMetrics?.totalCost?.toFixed(2)) : (providerName === "GITHUB"
              ? totalCost === 0
                ? saasCloud?.billingInfo?.totalCost
                : totalCost || 0
              : saasCloud?.billingInfo?.totalCost || 0
            ).toFixed(2)}
          </p>
          <p className="cf_new_dashboard_pannel_info">Subscription costs</p>
        </div>
      </div>
      {providerName === "CURSOR_AI" ? (
        <div className="cf_new_dashboard_info_pannel">
          <div
            className="cf_new_dashboard_info_pannel_title"
            style={{ gap: "8px" }}
          >
            <p>On-Demand Usage</p>
            <span style={{ marginLeft: "auto" }}></span>
            <DollarSign size={16} strokeWidth={2} color="#64748b" />
          </div>
          <div className="cf_new_dashboard_info_pannel_body">
            <p className="cf_new_dashboard_Data" style={{ color: "#FB923C" }}>
              $
              {(saasCloud?.totalSpendCents
                ? saasCloud?.totalSpendCents / 100
                : 0
              ).toFixed(2)}
              {/* <span
                style={{
                  color: "rgb(235, 14, 73)",
                  fontSize: "10px",
                  fontWeight: "500",
                  marginLeft: "10px",
                }}
              >
                1.6K Deleted
              </span> */}
            </p>
            <p className="cf_new_dashboard_pannel_info">
              Beyond Your Plan Usage
            </p>
          </div>
        </div>
      ) : (
        ""
      )}
      <div className="cf_new_dashboard_info_pannel">
        <div
          className="cf_new_dashboard_info_pannel_title"
          style={{ gap: "8px" }}
        >
          <p>Renewal Date</p>

          <span style={{ marginLeft: "auto" }}></span>
          <RenewalCalendar action="APPINSIGHTS" />
        </div>
        <div className="cf_new_dashboard_info_pannel_body">
          <p className="cf_new_dashboard_Data" style={{ color: "#16a34a" }}>
            {getRenewalDate() !== "-"
              ? new Date(getRenewalDate())
                .toDateString()
                ?.split(" ")
                ?.splice(1, 4)
                ?.join(" ")
              : "-"}
          </p>
          <p className="cf_new_dashboard_pannel_info">Next Renewal Date</p>
        </div>
      </div>
    </div>
  );
};

export default DemoTopInfo;
