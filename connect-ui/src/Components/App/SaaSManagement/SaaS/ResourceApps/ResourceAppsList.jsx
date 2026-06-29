import React, { useContext, useState } from "react";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { Link, useNavigate } from "react-router-dom";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { AiOutlineAppstore } from "react-icons/ai";
import moment from "moment";
import { MdVerified } from "react-icons/md";

const ResourceAppsList = () => {
  const navigate = useNavigate();
  const [slectedApp, setSlectedApp] = useState("");
  const { globalContext, dispatch } = useContext(GlobalContext);
  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav pageName="Resource Apps List" />
        <div className="cf_saas_options">
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
            buttonClickAction={() => navigate(-1)}
          ></ButtonComponent>
          <span style={{ marginLeft: "auto" }}>
            {/* <Link to="/SaaS/ResourceApps/List">
              <ButtonComponent
                isDisabled={false}
                inputWidth="95px"
                customstyles={{ height: "35px" }}
                buttonName="View Apps"
                buttonClickAction={() => console.log()}
              />
            </Link> */}
          </span>
        </div>
        <div
          className="cf_main_content_place_main cf_saas_apps_list"
          style={{
            gap: "0px 20px",
            overflow: "auto",
            padding: "0 10px",
            height: "calc(100% - 80px)",
          }}
        >
          {globalContext?.resourceAppsList?.map((data) => {
            return (
              <div
                className={`cf_resource_apps_body ${
                  slectedApp === data?.appId
                    ? "cf_resource_apps_body_active"
                    : ""
                }`}
                onClick={() =>
                  setSlectedApp(data?.appId === slectedApp ? "" : data?.appId)
                }
                key={data?.appId}
              >
                {data?.verified ? (
                  <div className="cf_app_verification_div">
                    <MdVerified className="cf_verifIcon" />
                  </div>
                ) : (
                  ""
                )}
                <div className="cf_resource_apps_body_resize">
                  <div className="cf_resource_apps_body_icon">
                    {data?.logoUrl ? (
                      <div className="cf_saas_logo_container">
                        <img src={data?.logoUrl} alt="" />
                      </div>
                    ) : (
                      <div className="cf_saas_logo_container">
                        <AiOutlineAppstore />
                      </div>
                    )}
                  </div>
                  <div className="cf_resource_apps_header">
                    <p
                      className="cf_mapping_email"
                      title={data?.appName}
                      style={{
                        fontSize: "14px",
                        fontWeight: "400",
                        marginTop: "5px",
                      }}
                    >
                      {data?.appName}
                    </p>
                    <p
                      className="cf_mapping_email"
                      style={{
                        fontSize: "12px",
                        color: "#acacac",
                        fontWeight: "400",
                        marginTop: "-10px",
                        alignItems: "flex-start",
                      }}
                    >
                      {data?.signIn}
                    </p>
                  </div>
                </div>
                {data?.appId === slectedApp ? (
                  <div className="cf_resource_apps_body_description">
                    <div className="cf_resource_apps_body_description_body">
                      <div className="CF_d-flex cf_gap-5">
                        <p
                          className="cf_mapping_email"
                          style={{
                            width: "auto",
                            color: "#acacac",
                            fontWeight: "400",
                          }}
                        >
                          Desctiption:
                        </p>
                        <p
                          className="cf_mapping_email"
                          style={{ width: "auto" }}
                        >
                          {data?.description}
                        </p>
                      </div>
                      <div className="CF_d-flex cf_gap-5">
                        <p
                          className="cf_mapping_email"
                          style={{
                            width: "auto",
                            color: "#acacac",
                            fontWeight: "400",
                          }}
                        >
                          Publisher Domain:
                        </p>
                        <p
                          className="cf_mapping_email"
                          style={{ width: "auto" }}
                        >
                          {data?.publisherDomain}
                        </p>
                      </div>
                      <div className="CF_d-flex cf_gap-5">
                        <p
                          className="cf_mapping_email"
                          style={{
                            width: "auto",
                            color: "#acacac",
                            fontWeight: "400",
                          }}
                        >
                          Created At:
                        </p>
                        <p
                          className="cf_mapping_email"
                          style={{ width: "auto" }}
                        >
                          {data?.createdTime
                            ? moment(data?.createdTime).format("Do MMM YYYY")
                            : "-"}
                        </p>
                      </div>
                      <div className="CF_d-flex cf_gap-5">
                        <p
                          className="cf_mapping_email"
                          style={{
                            width: "auto",
                            color: "#acacac",
                            fontWeight: "400",
                          }}
                        >
                          App Type:
                        </p>
                        <p
                          className="cf_mapping_email"
                          style={{ width: "auto" }}
                        >
                          {data?.oauth2 ? "OAUTH2" : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  ""
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ResourceAppsList;
