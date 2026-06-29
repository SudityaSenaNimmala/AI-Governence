import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SET_RESOURCE_APP_SUMMARY } from "../../../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../../../GlobalContext/GlobalContext";
import PiCharts from "../../../../../Resuables/Charts/PiCharts";
import ButtonComponent from "../../../../../Resuables/InputsComponents/ButtonComponent";
import SideNav from "../../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../../Resuables/Nav/TopNav";
import { getResourceAppsPagination } from "../../../SaaSActions/SaaSActions";

const ResourceAppsNew = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { memberId, providerName } = { ...globalContext?.saasCloud };

  useEffect(() => {
    if (globalContext?.resourceAppsSummary?.totalApps) {
      setSummary({ ...globalContext?.resourceAppsSummary });
    } else {
      getSaasSummary();
    }
  }, [globalContext?.saasCloud]);

  const getSaasSummary = async () => {
    let res = await getResourceAppsPagination(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      setSummary(res?.res);
      dispatch({
        type: SET_RESOURCE_APP_SUMMARY,
        payload: res?.res,
      });
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav pageName="Connected Apps" backLink="/SaaSManagement/Menu" />
        <div className="cf_saas_options" style={{ marginTop: "10px" }}>
          <span style={{ marginLeft: "auto" }}>
            <Link to="/SaaS/ConnectedApps/List/New">
              <ButtonComponent
                isDisabled={false}
                inputWidth="95px"
                customstyles={{ height: "35px" }}
                buttonName="View Apps"
                buttonClickAction={() => console.log()}
              />
            </Link>
          </span>
        </div>
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: 0,
            flexDirection: "column",
            gap: "15px",
          }}
        >
          <div className="cf_new_dashboard_resourceApps_container_3row">
            <div className="cf_new_dashboard_info_pannel">
              <div className="cf_new_dashboard_info_pannel_title">
                <p>Total Apps</p>
              </div>
              <div className="cf_new_dashboard_info_pannel_body">
                <p className="cf_new_dashboard_Data">
                  {summary?.totalApps ?? 0}
                </p>
                {/* <p className="cf_new_dashboard_pannel_info">Integrated Apps</p> */}
              </div>
            </div>
            <div className="cf_new_dashboard_info_pannel">
              <div className="cf_new_dashboard_info_pannel_title">
                <p>Apps With Scopes</p>
              </div>
              <div className="cf_new_dashboard_info_pannel_body">
                <p className="cf_new_dashboard_Data">
                  {summary?.appsWithScopes}
                </p>
                {/* <p className="cf_new_dashboard_pannel_info">
                  Apps Without Scopes
                </p> */}
              </div>
            </div>
            <div className="cf_new_dashboard_info_pannel">
              <div className="cf_new_dashboard_info_pannel_title">
                <p>Apps Without Scopes</p>
              </div>
              <div className="cf_new_dashboard_info_pannel_body">
                {/* <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}> */}
                <p
                  className="cf_new_dashboard_Data"
                  style={{ color: "#001a6f" }}
                >
                  {summary?.appsWithoutScopes}
                </p>
                {/* <p className="cf_new_dashboard_pannel_info">
                  Annual SaaS subscription costs
                </p> */}
              </div>
            </div>
            {/* <div className="cf_new_dashboard_info_pannel">
              <div className="cf_new_dashboard_info_pannel_title">
                <p>Verified Apps</p>
              </div>
              <div className="cf_new_dashboard_info_pannel_body">
                <p
                  className="cf_new_dashboard_Data"
                  style={{ color: "#16a34a" }}
                >
                  {summary?.verifiedApps}
                </p>
                <p className="cf_new_dashboard_pannel_info">
                  From unused licenses
                </p>
              </div>
            </div> */}
          </div>
          <div className="cf_resource_new_graphs_div">
            <div className="cf_resource_new_graphs_container">
              <div>
                <p
                  className="cf_new_dashboard_info_graph_container_details_app_name"
                  style={{ fontSize: "16px" }}
                >
                  Integrated App's Summary
                </p>
              </div>
              <div>
                <PiCharts
                  title=" "
                  graphData={[
                    {
                      name: "Apps With Scopes",
                      y: summary?.appsWithScopes ?? 0,
                      color: "#0062ff",
                    },
                    {
                      name: "Apps Without Scopes",
                      y: summary?.appsWithoutScopes ?? 0,
                      color: "#AFDBF5",
                    },
                  ]}
                />
              </div>
            </div>
            {/* <div className="cf_resource_new_graphs_container">
              <div>
                <p
                  className="cf_new_dashboard_info_graph_container_details_app_name"
                  style={{ fontSize: "16px" }}
                >
                  Verified App's Summary
                </p>
              </div>
              <div>
                <PiCharts
                  title=" "
                  graphData={[
                    {
                      name: "Verified Apps",
                      y: summary?.verifiedApps ?? 0,
                      color: "#28a745",
                    },
                    {
                      name: "Un Verified Apps",
                      y: summary?.unverifiedApps,
                      color: "#8fbc8f",
                    },
                  ]}
                />
              </div>
            </div> */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResourceAppsNew;
