import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  SET_RESOURCE_APP_LIST,
  SET_RESOURCE_APP_SUMMARY,
} from "../../../../../GlobalContext/action.types";
import PiCharts from "../../../../Resuables/Charts/PiCharts";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import { getCFTextLoader } from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { getSaaSAppsData } from "../../SaaSActions/SaaSActions";
import "../../css/SaaSManagement.css";

const ResourceApps = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [saasAppsList, setSaasAppsList] = useState([]);
  const [nextToken, setNextToken] = useState(0);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { memberId, providerName } = { ...globalContext?.saasCloud };

  useEffect(() => {
    if (globalContext?.resourceAppsSummary?.count) {
      setNextToken(null);
      setSummary(globalContext?.resourceAppsSummary);
      setSaasAppsList(globalContext?.resourceAppsList);
      setIsLoading(false);
    } else {
      getSaasSummary();
    }
  }, []);

  const getSaasSummary = async () => {
    let res = await getSaaSAppsData(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      let summary = { ...res?.res[0] };
      summary.withScopes = 0;
      summary.withOutScopes = 0;
      summary.verified = 0;
      setSummary(summary);
      getSaaSAppaList();
    }
  };

  const getSaaSAppaList = async () => {
    let copyList = [];
    let res = await getSaaSAppsData(
      memberId,
      providerName,
      false,
      nextToken ? nextToken : null
    );
    if (res?.status === "OK" && res?.res) {
      setNextToken(res?.res[0]?.nextPageToken);
      copyList = [...saasAppsList, ...res?.res];
      if (
        res?.res[0]?.nextPageToken === null ||
        res?.res[0]?.nextPageToken === ""
      ) {
        dispatch({
          type: SET_RESOURCE_APP_LIST,
          payload: copyList,
        });
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
    setSaasAppsList(copyList);
  };

  useEffect(() => {
    if (nextToken !== 0 && nextToken && nextToken !== "") {
      getSaaSAppaList();
    }
    if (nextToken === null || nextToken === "") {
      dispatch({
        type: SET_RESOURCE_APP_SUMMARY,
        payload: summary,
      });
      setIsLoading(false);
    }
  }, [nextToken, summary]);

  useEffect(() => {
    if (nextToken === null || nextToken === "") {
      let verified = 0,
        withScopes = 0,
        withOutScopes = 0;
      saasAppsList?.map((data) => {
        if (data?.verified) {
          verified++;
        }
        if (data?.scopes?.length > 0) {
          withScopes++;
        } else {
          withOutScopes++;
        }
      });
      setSummary({
        ...summary,
        verified: verified,
        withScopes: withScopes,
        withOutScopes: withOutScopes,
      });
    }
  }, [saasAppsList]);

  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav pageName="Resource Apps" />
        <div className="cf_saas_options">
          <Link to="/SaaSManagement">
            <ButtonComponent
              isDisabled={false}
              inputWidth="auto"
              customstyles={{
                height: "35px",
                padding: "0 10px",
                background: "#f2f2f2",
                color: "#454545",
                border: "1px solid #f2f2f2",
              }}
              buttonName="Back"
              buttonClickAction={() => console.log()}
            ></ButtonComponent>
          </Link>
          <span style={{ marginLeft: "auto" }}>
            <Link to="/SaaS/ResourceApps/List">
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
          className="cf_main_content_place_main cf_saas_options_contatiner"
          style={{ padding: "0 0 20px 0" }}
        >
          <div className="cf_saas_summary_container">
            <div className="cf_saas_summary_cards">
              <div className="cf_saas_summary_cards_title">
                <p>Total Apps</p>
                {/* <FaArrowRight /> */}
              </div>
              <div className="cf_saas_summary_cards_body">
                <p>{summary?.count ?? 0}</p>
              </div>
            </div>
            <div className="cf_saas_summary_cards">
              <div className="cf_saas_summary_cards_title">
                <p>Apps With Scopes</p>
                {/* <FaArrowRight /> */}
              </div>
              <div className="cf_saas_summary_cards_body">
                <p>{summary?.withScopes}</p>
              </div>
            </div>
            <div className="cf_saas_summary_cards">
              <div className="cf_saas_summary_cards_title">
                <p>Apps Without Scopes</p>
                {/* <FaArrowRight /> */}
              </div>
              <div className="cf_saas_summary_cards_body">
                <p>{summary?.withOutScopes}</p>
              </div>
            </div>
            <div className="cf_saas_summary_cards">
              <div className="cf_saas_summary_cards_title">
                <p>Verified Apps</p>
                {/* <FaArrowRight /> */}
              </div>
              <div className="cf_saas_summary_cards_body">
                <p>{summary?.verified}</p>
              </div>
            </div>
          </div>
          <div className="cf_resource_apps_graph_container">
            {isLoading ? (
              getCFTextLoader()
            ) : (
              <>
                <PiCharts
                  title="Integrated App's Summary"
                  graphData={[
                    {
                      name: "Apps With Scopes",
                      y: summary?.withScopes ?? 0,
                      color: "#0062ff",
                    },
                    {
                      name: "Apps Without Scopes",
                      y: summary?.withOutScopes ?? 0,
                      color: "#AFDBF5",
                    },
                  ]}
                />
                <PiCharts
                  title="Verified App's Summary"
                  graphData={[
                    {
                      name: "Verified Apps",
                      y: summary?.verified ?? 0,
                      color: "#0062ff",
                    },
                    {
                      name: "Un Verified Apps",
                      y: summary?.count - summary?.verified,
                      color: "#AFDBF5",
                    },
                  ]}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResourceApps;
