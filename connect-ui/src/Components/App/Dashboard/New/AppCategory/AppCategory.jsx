import { Users } from "lucide-react";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  RESET_SAAS_DATA,
  SET_SAAS_CLOUD,
} from "../../../../../GlobalContext/action.types";
import { getCloudName } from "../../../../helpers/helpers";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { useNavigate, useSearchParams } from "react-router-dom";
import { categorizedApps, getCategoryForCloud } from "../../../../helpers/utils";

const AppCategory = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const navigate = useNavigate();
  const [appsList, setAppsList] = useState([]);
  const [cloudTypes, setCloudTypes] = useState("");
  const [searchParams] = useSearchParams();
  const filterType = searchParams.get("type");

  const dedupedApps = useMemo(() => {
    const grouped = (appsList ?? [])
      .filter((res) => res?.providerName)
      .reduce((acc, data) => {
        const key = data.providerName;
        if (!acc[key]) acc[key] = { ...data, repeatCount: 0 };
        acc[key].repeatCount += 1;
        return acc;
      }, {});
    return Object.values(grouped).sort(
      (a, b) => b.repeatCount - a.repeatCount
    );
  }, [appsList]);

  useEffect(() => {
    if (globalContext?.cloudsList?.length > 0) {
      let newAppsList = [];
      let cptApsList = globalContext?.cloudsList?.filter((data) => {
        return data?.providerName;
      });

      if (categorizedApps[filterType]) {
        cptApsList?.map((data) => {
          return categorizedApps[filterType]?.includes(data?.providerName)
            ? newAppsList?.push(data)
            : "";
        });
        setAppsList(newAppsList);
      } else {
        setAppsList(globalContext?.cloudsList);
      }
    }
  }, [globalContext?.cloudsList, filterType]);

  useEffect(() => {
    if (filterType) {
      setCloudTypes(filterType);
    }
  }, [filterType]);

  const handleCardClick = (data) => {
    if (!data?.providerName) return;
    const cloudInfo = {
      ...data,
      billingInfo: {
        ...(data?.billingInfo ?? {}),
        category: getCategoryForCloud(data.providerName),
      },
    };
    dispatch({ type: SET_SAAS_CLOUD, payload: cloudInfo });
    dispatch({ type: RESET_SAAS_DATA, payload: "" });
    navigate("/Applications/Insights");
  };

  return (
    <>
      <div className="cf_main_container" style={{ overflow: "hidden" }}>
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav pageName="Apps Based On Category" backLink="/Dashboard" />

          <div
            className="cf_main_content_place_main"
            style={{
              padding: "10px 0",
              flexDirection: "column",
              gap: "15px",
              height: "calc(100vh - 135px)",
            }}
          >
            <div
              className="cf_saas_cloudPlacer cf_saas_cloudPlacer_Analytics_Insightes"
              style={{ marginTop: "0" }}
            >
              <>
                {appsList?.length > 0 ? (
                  <>
                    <div className="cf_saas_cloudPlacer_WithTag_Container">
                      <div className="cf_saas_cloudPlacer_WithTag_Header">
                        <div>
                          <p className="cf_saas_cloudPlacer_WithTag_Header_Title">
                            {getCloudName(cloudTypes)}
                          </p>
                          <p className="cf_saas_cloudPlacer_WithTag_Header_subTitle">
                            {/* {messageMigrationErrorMessages(cloudTypes)}  */}
                          </p>
                        </div>
                        <div
                          style={{ marginLeft: "auto" }}
                          className="cf_saas_consoladitionReport_Count_Info"
                        >
                          <div className="cf_saas_consoladitionReport_Count_Info_Item">
                            <Users size={14} />
                            <p style={{ fontSize: "12px", fontWeight: "600" }}>
                              {appsList.reduce(
                                (a, b) => a + b["Total Users"],
                                0
                              )}{" "}
                              Total Users
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="cf_saas_cloudPlacer_WithTag">
                        {dedupedApps.map((data, index) => {
                          const isOthers = data?.providerName === "OTHERS";
                          const bgKey = isOthers
                            ? getCloudName(data?.externalProviderName) ===
                              data?.externalProviderName
                              ? "OTHERS"
                              : data?.externalProviderName
                            : data?.providerName;
                          return (
                            <div
                              key={`${data?.providerName}_${index}`}
                              className="cf_new_dashboard_info_pannel"
                              onClick={() => handleCardClick(data)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "14px 16px",
                                cursor: "pointer",
                                animationDelay: `${index * 0.05}s`,
                              }}
                            >
                              <div
                                className={`cf_main_saas_selector_img_35 bg_35-${bgKey}`}
                                style={{ flexShrink: 0 }}
                              ></div>
                              <p
                                style={{
                                  flex: 1,
                                  margin: 0,
                                  fontSize: "14px",
                                  fontWeight: 500,
                                  color: "#1f2129",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {getCloudName(data?.providerName)}
                                {isOthers && (
                                  <span
                                    style={{
                                      marginLeft: "6px",
                                      fontSize: "10px",
                                      fontWeight: 500,
                                      color: "#64748b",
                                    }}
                                  >
                                    ({data?.externalProviderName})
                                  </span>
                                )}
                              </p>
                              {data.repeatCount > 1 && <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  color: "#001a6f",
                                  background: "#f2f3ff",
                                  borderRadius: "12px",
                                  padding: "2px 10px",
                                }}
                              >
                                x{data.repeatCount}
                              </span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  ""
                )}
              </>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AppCategory;
