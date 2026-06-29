import { useContext, useEffect, useState } from "react";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { getSaaSCostingWithAppList } from "../../DashboardActions/DashboardActions";
import { cloudImageMapper, getCloudName } from "../../../../helpers/helpers";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  RESET_SAAS_DATA,
  SET_BILLING_SUMMARY,
  SET_SAAS_CLOUD,
} from "../../../../../GlobalContext/action.types";
import { useNavigate } from "react-router-dom";
import { getCFTextLoader } from "../../../../Resuables/Loaders/Loaders";
import { Users } from "lucide-react";
import {
  getCategoryForCloud,
  getPotentialCostSaving,
  makeDataForCalender,
} from "../../../../helpers/utils";

const SpentAnalytics = () => {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [totalBilling, setTotalBilling] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { cloudsList } = globalContext;

  useEffect(() => {
    fetchSaaSCosting();
  }, []);

  const fetchSaaSCosting = async () => {
    setIsLoading(true);
    let res = await getSaaSCostingWithAppList();
    if (res?.status === "OK") {
      setIsLoading(false);
      if (res?.res?.userFinancialMetrics[0]?.vendorName) {
        let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
        setTotalBilling({
          ...res?.res,
          calenderData: calData,
        });
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

  const moveToInsightes = (memberId, vendorName, data, action, type) => {
    let cloudInfo = cloudsList?.filter(
      (cloud) =>
        cloud?.providerName === vendorName && cloud?.memberId === memberId
    );
    if (cloudInfo?.length > 0) {
      cloudInfo[0].billingInfo = {
        ...data,
        category: getCategoryForCloud(vendorName),
      };
    }
    dispatch({ type: SET_SAAS_CLOUD, payload: cloudInfo[0] });
    dispatch({
      type: RESET_SAAS_DATA,
      payload: "",
    });
    if (type === "LICENCE") {
      navigate(`/Applications/Insights#LICENSE_MANAGEMENT?Status=${action}`);
    } else {
      navigate(`/Applications/Insights#USER_MANAGEMENT?Status=${action}`);
    }
  };

  const getCloudUsersCount = (vendorName, memberId) => {
    let findData = cloudsList?.find(
      (cld) => cld?.id === memberId && cld?.providerName === vendorName
    );
    return findData?.usersCount;
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Dashboard" />
      <div className="cf_main_content_place">
        <TopNav pageName={`Spent Analytics`} backLink="/Dashboard" />
        <div
          className="cf_saas_options"
          style={{ marginTop: "10px", height: "40px" }}
        >
          <span style={{ marginLeft: "auto" }}></span>
          <SearchComponent
            autoOpen={true}
            boxShadows={true}
            inputName="searchInput"
            customStyles={{ width: "350px", height: "40px" }}
            customButtonStyles={{
              background: "transparent",
              color: "rgb(255, 255, 255)",
              fontWeight: "bolder",
              height: "35px",
            }}
            inputPlaceHolder={`Search By Cloud Name`}
            onInputSearch={(e) => setSearchInput(e.searchInput)}
          />
        </div>
        <div
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
                  <th style={{ width: "200px" }}>Cloud Name</th>
                  <th style={{ width: "50px" }}>Total Users</th>
                  <th style={{ width: "50px" }}>Active Users</th>
                  <th style={{ width: "50px" }}>Idle Users</th>
                  <th style={{ width: "50px" }}>Inactive Users</th>
                  <th style={{ width: "50px" }}>Billable Users</th>
                  <th style={{ width: "50px" }}>Total Cost</th>
                  <th style={{ width: "50px" }}>Potential Savings</th>
                </tr>
              </thead>
              <tbody>
                {totalBilling?.userFinancialMetrics
                  ?.filter((data) =>
                    searchInput === ""
                      ? data
                      : getCloudName(data?.vendorName)
                        ?.toLowerCase()
                        ?.includes(searchInput?.toLowerCase())
                  )
                  ?.map((data, index) => (
                    <tr key={index}>
                      <td>
                        <div className="cf_ManageClouds_table_image_container">
                          <img
                            src={cloudImageMapper(
                              data?.vendorName,
                              data?.externalProviderName
                            )}
                            alt={data?.vendorName}
                          />
                          <p style={{ whiteSpace: "nowrap" }}>
                            {data?.vendorName === "OTHERS"
                              ? data?.externalProviderName
                              : getCloudName(data?.vendorName)}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div
                          className={`cf_image_light ${data?.memberId && data?.totalUserCount !== 0
                            ? "cf_make_link"
                            : ""
                            }`}
                          onClick={() =>
                            data?.memberId
                              ? moveToInsightes(
                                data?.memberId,
                                data?.vendorName,
                                data,
                                "ALL"
                              )
                              : ""
                          }
                        >
                          <Users size={14} color="#0006fc" />
                          <p className={`cf_ManageClouds_table_domain_name `}>
                            {/* {data?.totalUserCount} */}
                            {getCloudUsersCount(
                              data?.vendorName,
                              data?.adminCloudId
                            ) || 0}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div
                          className={`cf_image_light ${data?.memberId && data?.activeUserCount !== 0
                            ? "cf_make_link"
                            : ""
                            }`}
                          onClick={() =>
                            data?.memberId
                              ? moveToInsightes(
                                data?.memberId,
                                data?.vendorName,
                                data,
                                "ACTIVE"
                              )
                              : ""
                          }
                        >
                          <Users size={14} color="#0006ff96" />
                          <p className={`cf_ManageClouds_table_domain_name`}>
                            {data?.activeUserCount}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div
                          className={`cf_image_light ${data?.memberId && data?.idleUserCount !== 0
                            ? "cf_make_link"
                            : ""
                            }`}
                          onClick={() =>
                            data?.memberId
                              ? moveToInsightes(
                                data?.memberId,
                                data?.vendorName,
                                data,
                                "IDLE"
                              )
                              : ""
                          }
                        >
                          <Users size={14} color="#FFC107" />
                          <p className={`cf_ManageClouds_table_domain_name`}>
                            {data?.idleUserCount}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div
                          className={`cf_image_light ${data?.memberId && data?.inactiveUserCount !== 0
                            ? "cf_make_link"
                            : ""
                            }`}
                          onClick={() => {
                            data?.memberId
                              ? moveToInsightes(
                                data?.memberId,
                                data?.vendorName,
                                data,
                                "IN_ACTIVE"
                              )
                              : "";
                          }}
                        >
                          <Users size={14} color="#FF4C4C" />
                          <p className={`cf_ManageClouds_table_domain_name`}>
                            {data?.inactiveUserCount}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div className={`cf_image_light`}>
                          <Users size={14} color="#454545" />
                          <p className="cf_ManageClouds_table_domain_name">
                            {data?.billableUserCount}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div
                          className={`cf_image_light ${data?.memberId ? `cf_make_link` : ""
                            }`}
                          onClick={() =>
                            data?.memberId
                              ? moveToInsightes(
                                data?.memberId,
                                data?.vendorName,
                                data,
                                "ALL",
                                "LICENCE"
                              )
                              : ""
                          }
                        >
                          <p className="cf_ManageClouds_table_domain_name">
                            ${data?.totalCost?.toFixed(2)}
                          </p>
                        </div>
                      </td>
                      <td>
                        <div className="cf_image_light">
                          <p className="cf_ManageClouds_table_domain_name">
                            $
                            {isNaN(getPotentialCostSaving(data))
                              ? 0
                              : getPotentialCostSaving(data)?.toFixed(2)}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {isLoading ? getCFTextLoader() : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpentAnalytics;
