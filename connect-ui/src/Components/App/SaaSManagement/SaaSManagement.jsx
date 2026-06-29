import { Users } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import {
  RESET_SAAS_DATA,
  SET_SAAS_CLOUD,
  SET_UPDATE_JOB_PARAMS,
} from "../../../GlobalContext/action.types";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getCloudName } from "../../helpers/helpers";
import SaaSDownload from "./SaaS/SaaSDownload/SaaSDownload";
import "./css/SaaSManagement.css";

const SaaSManagement = () => {
  const navigate = useNavigate();
  const [navigateTo, setNavigateTo] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { cloudsList } = globalContext;

  useEffect(() => {
    if (navigateTo === "Resource Apps") {
      navigate("/SaaS/ResourceApps");
    } else if (navigateTo === "License Management") {
      navigate("/SaaS/License");
    } else if (navigateTo === "Domains") {
      navigate("/SaaS/Domains");
    } else if (navigateTo === "Group Management") {
      navigate("/SaaS/TeamsGroups");
    } else if (navigateTo === "User Management") {
      navigate("/SaaS/UserManagement");
    }
  }, [navigateTo]);

  const selectSaaSVendor = useCallback(
    (e) => {
      dispatch({ type: SET_SAAS_CLOUD, payload: e });
      dispatch({
        type: RESET_SAAS_DATA,
        payload: "",
      });
      navigate("/SaaSManagement/Menu");
    },
    [dispatch, navigate]
  );

  useEffect(() => {
    dispatch({
      type: SET_UPDATE_JOB_PARAMS,
      payload: "",
    });
  }, []);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName="SaaS Management" />

          <div
            // className="cf_main_content_place_main  cf_saas_cloudPlacer"
            // style={{ gap: "20px 50px" }}
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div className="cf_add_cloud_filter_div">
              <span style={{ marginLeft: "auto" }}></span>
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                inputPlaceHolder={`Search By Cloud Name`}
                onInputSearch={(e) => setSearchVal(e?.searchInput)}
              />
            </div>
            <div className="cf_saas_cloudPlacer">
              {cloudsList
                ?.filter((data) =>
                  searchVal === ""
                    ? data
                    : getCloudName(data?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchVal?.toLowerCase())
                )
                ?.map((data, index) => {
                  return data?.providerName ? (
                    <div
                      key={data?.id}
                      className="cf_new_dashboard_info_pannel cf_main_saas_selector"
                      // style={{ animationDelay: `${index * 0.1}s` }}
                      style={{
                        animationDelay: `${index * 0.1}s`,
                        backgroundColor: "#f0f4f8",
                        borderRadius: "8px",
                        transition: "border 0.3s",
                        border: "2px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.border = "2px solid #3b82f6";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.border = "2px solid transparent";
                      }}
                    >
                      <div className="cf_main_saas_selector_img_container">
                        {/* <img src={cloudImageMapper(data?.providerName)} /> */}
                        <div
                          className={`cf_main_saas_selector_img bg-${data?.providerName}`}
                        ></div>
                        <div>
                          <p
                            className="cf_new_dashboard_info_graph_container_details_app_name"
                            title={data?.adminEmail}
                          >
                            {getCloudName(data?.providerName)}
                          </p>
                          <p
                            title={data?.adminEmail}
                            className="cf_new_dashboard_info_graph_container_details_app_licensesInfo"
                          >
                            {data?.adminEmail}
                          </p>
                        </div>
                      </div>
                      <div className="cf_main_saas_selector_body_container">
                        <Users size={14} strokeWidth={2} color="#64748b" />
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_licensesInfo"
                          style={{ fontWeight: "500" }}
                        >
                          {data?.usersCount} Users
                        </p>
                        <button
                          className="cf_saas_manage_button"
                          style={{ marginLeft: "auto" }}
                          onClick={() => selectSaaSVendor(data)}
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  ) : (
                    ""
                  );
                })}
            </div>
            {/* {saasOptions?.map((data) => {
              return (
                <div
                  className="cf_saas_options_pannels"
                  key={data?.title}
                  onClick={() => setNavigateTo(data?.title)}
                >
                  <div className="cf_saas_options_pannels_icon_container">
                    <div className="cf_saas_options_pannels_icon_div">
                      {data?.icon}
                    </div>
                  </div>
                  <div className="cf_saas_options_pannels_title_container">
                    <h3>{data?.title}</h3>
                  </div>
                </div>
              );
            })} */}
          </div>
        </div>
      </div>
      {navigateTo === "Download Reports" ? (
        <SaaSDownload navigateTo={setNavigateTo} />
      ) : (
        ""
      )}
    </>
  );
};

export default SaaSManagement;
