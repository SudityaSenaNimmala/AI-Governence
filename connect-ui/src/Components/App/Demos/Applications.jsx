import { CircleCheckBig, DollarSign, MoveRight, Users } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  RESET_SAAS_DATA,
  SET_BILLING_SUMMARY,
  SET_SAAS_CLOUD,
} from "../../../GlobalContext/action.types";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import {
  getCategoryForCloud,
  makeDataForCalender,
  notifyToast,
} from "../../helpers/utils";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getSaaSCostingWithAppList } from "../Dashboard/DashboardActions/DashboardActions";
import "./css/NewSaaS.css";
import "./Demos.css";
import ShadowITInfo from "../ShadowIT/ShadowITInfo";

const Applications = () => {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [totalBilling, setTotalBilling] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [activeGraph, setActiveGraph] = useState("APPROVED_APPLICATIONS");
  const { cloudsList } = globalContext;

  useEffect(() => {
    fetchSaaSCosting();
  }, []);

  const fetchSaaSCosting = async () => {
    setIsLoading(true);
    if (globalContext?.billingSummary?.userFinancialMetrics?.length > 0) {
      setIsLoading(false);
      setTotalBilling(globalContext?.billingSummary?.userFinancialMetrics);
    }
    let res = await getSaaSCostingWithAppList();
    if (res?.status === "OK") {
      setIsLoading(false);
      if (res?.res?.userFinancialMetrics[0]?.vendorName) {
        let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
        setTotalBilling(res?.res?.userFinancialMetrics);
        dispatch({
          type: SET_BILLING_SUMMARY,
          payload: { ...res?.res, calenderData: calData },
        });
      } else {
        notifyToast("error", "No Data Found");
        setTotalBilling([]);
      }
    } else {
      setIsLoading(false);
    }
  };

  const getCloudInfo = (vendorName, data, index) => {
    let cloudInfo = cloudsList?.filter(
      (cloud) => cloud?.providerName === vendorName
    );
    let findData = cloudInfo?.find((cld) => cld?.memberId === data?.memberId);
    if (findData?.memberId) {
      findData.billingInfo = {
        ...data,
        category: getCategoryForCloud(vendorName),
      };
      dispatch({ type: SET_SAAS_CLOUD, payload: findData });
    } else {
      cloudInfo[0].billingInfo = {
        ...data,
        category: getCategoryForCloud(vendorName),
      };
      dispatch({ type: SET_SAAS_CLOUD, payload: cloudInfo[0] });
    }
    dispatch({
      type: RESET_SAAS_DATA,
      payload: "",
    });
    navigate("/Applications/Insights");
  };

  const getCloudUsersCount = (vendorName, memberId) => {
    let findData = cloudsList?.find((cld) =>
      cld?.providerName === "OTHERS"
        ? cld?.externalProviderName === vendorName
        : cld?.memberId === memberId && cld?.providerName === vendorName
    );
    return findData?.usersCount;
  };

  const calculateCostPerUser = (data) => {
    if (data?.totalCost > 0) {
      if (data?.totalLicense) {
        return "$" + Math.round(data?.totalCost / data?.totalLicense);
      }
      if (data?.totalUserCount) {
        return "$" + Math.round(data?.totalCost / data?.totalUserCount);
      }
    } else {
      return "$0";
    }
  }

  const getCloudImageName = (adminCloudId, providerName, externalProviderName) => {
    if (externalProviderName) {
      let cloud = globalContext?.cloudsList?.find(data => data?.id === adminCloudId);
      if (cloud) {
        return cloud?.phoneNumber ? `https://cloudfuzehost.com/globalasserts/${cloud?.phoneNumber}` : cloudImageMapper(cloud?.providerName, cloud?.externalProviderName);
      }
    } else {
      return cloudImageMapper(providerName, externalProviderName);
    }
  }

  useEffect(() => {
    if (activeGraph) {
      setSearchInput("");
    }
  }, [activeGraph]);

  const groupApplicationsByProvideName = (data) => {
    const groupMap = new Map();
    data?.forEach((item) => {
      const providerName =
        item?.vendorName === "OTHERS" ? item?.externalProviderName : item?.vendorName;
      const vendorName = item?.vendorName;
      if (!groupMap.has(providerName)) {
        groupMap.set(providerName, {
          providerName,
          vendorName,
          applications: [],
        });
      }
      const group = groupMap.get(providerName);
      const usersCount =
        item?.vendorName === "OTHERS"
          ? getCloudUsersCount(item?.externalProviderName, item?.memberId)
          : getCloudUsersCount(item?.vendorName, item?.memberId);
      group.applications.push({
        ...item,
        usersCount: usersCount ?? item?.totalUserCount,
      });
    });
    return Array.from(groupMap.values()).map((group) => {
      const apps = group.applications;
      const totalCost = apps.reduce((sum, a) => sum + (Number(a?.totalCost) || 0), 0);
      const totalUsers = apps.reduce(
        (sum, a) => sum + ((Number(a?.usersCount) ?? Number(a?.totalUserCount)) || 0),
        0
      );
      const costPerUser =
        totalUsers > 0 && totalCost > 0
          ? "$" + Math.round(totalCost / totalUsers)
          : "$0";
      return {
        ...group,
        displayItem: apps[0],
        totalCost,
        totalUsers,
        costPerUser,
      };
    });
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Applications" />
      <div className="cf_main_content_place">
        <TopNav pageName={`Applications`} />
        <div
          className="cf_saas_options"
          style={{ marginTop: "10px", height: "40px" }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: "0" }}>
            <div className="cf_graph_toggler" style={{ backgroundColor: "#f2f3ff" }}>
              <div className={`cf_graph_toggler_item blueActive ${activeGraph === "APPROVED_APPLICATIONS" ? "cf_graph_toggler_item_active cf_active_blue" : ""}`} onClick={() => setActiveGraph("APPROVED_APPLICATIONS")} style={{ gap: "6px" }}>
                <CircleCheckBig size={14} color="#454545" />
                <p style={{ fontSize: "12px" }}>Approved Applications</p>
              </div>
              <div className={`cf_graph_toggler_item blueActive ${activeGraph === "SHADOW_APPLICATIONS" ? "cf_graph_toggler_item_active cf_active_blue" : ""}`} onClick={() => setActiveGraph("SHADOW_APPLICATIONS")} style={{ gap: "6px" }}>
                {/* <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cable-icon lucide-cable"><path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z" /><path d="M17 21v-2" /><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10" /><path d="M21 21v-2" /><path d="M3 5V3" /><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z" /><path d="M7 5V3" /></svg> */}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-hat-glasses-icon lucide-hat-glasses"><path d="M14 18a2 2 0 0 0-4 0" /><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11" /><path d="M2 11h20" /><circle cx="17" cy="18" r="3" /><circle cx="7" cy="18" r="3" /></svg>
                <p style={{ fontSize: "12px" }}>Shadow IT</p>
              </div>
            </div>
          </div>
          <span style={{ marginLeft: "auto" }}></span>
          <SearchComponent
            autoOpen={true}
            boxShadows={true}
            inputName="searchInput"
            defaultVal={searchInput}
            customStyles={{ width: "350px", height: "40px" }}
            customButtonStyles={{
              background: "transparent",
              color: "rgb(255, 255, 255)",
              fontWeight: "bolder",
              height: "35px",
            }}
            canResetDefaultVal={true}
            inputPlaceHolder={`Search By Application Name`}
            onInputSearch={(e) => setSearchInput(e.searchInput)}
          />
        </div>
        {activeGraph === "APPROVED_APPLICATIONS" ? <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: "10px 0 0 0",
            flexDirection: "column",
            height: "calc(100vh - 135px)",
          }}
        >
          <div
            className="cf_new_tables_div"
            style={{ height: "calc(100% - 10px)" }}
          >
            <table>
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Category</th>
                  <th>Users</th>
                  <th>Cost</th>
                  <th>Estimated Cost Per User</th>
                  {/* <th></th> */}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filteredBySearch = totalBilling?.filter((data) =>
                    searchInput === ""
                      ? data
                      : getCloudName(
                        data?.vendorName === "OTHERS"
                          ? data?.externalProviderName
                          : data?.vendorName
                      )
                        ?.toLowerCase()
                        ?.includes(searchInput?.toLowerCase())
                  );
                  const tableData = groupApplicationsByProvideName(filteredBySearch) ?? [];
                  return tableData.map((group, index) => {
                    const data = group.displayItem;
                    const displayName =
                      group.providerName ?? (data?.vendorName === "OTHERS" ? data?.externalProviderName : data?.vendorName);
                    return (
                      <tr
                        key={`${group.providerName}-${index}`}
                        onClick={() =>
                          getCloudInfo(group.vendorName, data, index)
                        }
                        className="CF_Pointer"
                      >
                        <td style={{ width: "300px" }}>
                          <div
                            className="cf_image_light cf_ManageClouds_table_image_container"
                            style={{ gap: "10px" }}
                          >
                            <img
                              src={data?.externalProviderName ? getCloudImageName(data?.adminCloudId, data?.vendorName, data?.externalProviderName) : cloudImageMapper(
                                data?.vendorName,
                                data?.externalProviderName
                              )}
                              alt={displayName}
                            />
                            <p style={{ whiteSpace: "nowrap" }}>
                              {getCloudName(displayName)}
                            </p>
                          </div>
                        </td>
                        <td style={{ width: "350px" }}>
                          <div className="cf_image_light">
                            <p className="cf_ManageClouds_table_domain_name">
                              {getCategoryForCloud(displayName) ?? "Others"}
                            </p>
                          </div>
                        </td>
                        <td style={{ width: "150px" }}>
                          <div className="cf_image_light">
                            <Users size={14} color="#001a6f" />
                            <p className="cf_ManageClouds_table_domain_name">
                              {group.totalUsers ?? "—"}
                            </p>
                          </div>
                        </td>
                        <td style={{ width: "150px" }}>
                          <div className="cf_image_light">
                            <DollarSign size={14} color="#16a34a" />
                            <p className="cf_ManageClouds_table_domain_name">
                              ${Math.round(group.totalCost)}
                            </p>
                          </div>
                        </td>
                        <td style={{ width: "150px" }}>
                          <div className="cf_image_light">
                            <DollarSign size={14} color="#16a34a" />
                            <p className="cf_ManageClouds_table_domain_name">
                              {group.costPerUser}
                            </p>
                          </div>
                        </td>
                        <td>
                          {/* <div
                          className="cf_dashboard_analytics_edit CF_Pointer cf_move_inside_details"
                          style={{ marginLeft: "auto" }}
                          onClick={() =>
                            getCloudInfo(data?.vendorName, data, index)
                          }
                        >
                          <p>View Details</p>
                          <MoveRight size={14} />
                        </div> */}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
            {isLoading ? getCFTextLoader() : ""}
          </div>
        </div> : <ShadowITInfo from="Applications" searchData={searchInput} />}
      </div>
    </div >
  );
};

export default Applications;
