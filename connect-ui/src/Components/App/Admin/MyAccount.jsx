import React, { useContext } from "react";
import TopNav from "../../Resuables/Nav/TopNav";
import SideNav from "../../Resuables/Nav/SideNav";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const MyAccount = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);

  return (
    <div className="cf_main_container">
      <SideNav activeTab="" />
      <div className="cf_main_content_place">
        <TopNav pageName="My Account" />
        <div
          className="cf_main_content_place_main CF_d-flex CF_flex-d-column"
          style={{ gap: "30px" }}
        >
          {globalContext?.user?.roles ? (
            <div
              className="cf_content_migration_preview"
              style={{ width: "60%" }}
            >
              <div
                className="cf_content_migration_preview_jobOptions"
                style={{ height: "300px" }}
              >
                <div className="cf_content_mapping_title">
                  <h4>My Account</h4>
                </div>
                <div
                  className="cf_content_premissionMapping_body"
                  style={{ height: "calc(100% - 30px)" }}
                >
                  <div
                    className="cf_jobOptions_Options_Div"
                    style={{ height: "60px" }}
                  >
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ width: "25%" }}
                    >
                      <span>Name </span>
                      <span style={{ marginLeft: "auto" }}>:</span>
                    </div>
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ fontWeight: "400" }}
                    >
                      {globalContext?.user?.name}
                    </div>
                  </div>
                  <div
                    className="cf_jobOptions_Options_Div"
                    style={{ height: "60px" }}
                  >
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ width: "25%" }}
                    >
                      <span>Email </span>
                      <span style={{ marginLeft: "auto" }}>:</span>
                    </div>
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ fontWeight: "400" }}
                    >
                      {globalContext?.user?.email}
                    </div>
                  </div>
                  <div
                    className="cf_jobOptions_Options_Div"
                    style={{ height: "60px" }}
                  >
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ width: "25%" }}
                    >
                      <span>User Type </span>
                      <span style={{ marginLeft: "auto" }}>:</span>
                    </div>
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ fontWeight: "400" }}
                    >
                      {globalContext?.user?.roles[0]?.name}
                    </div>
                  </div>
                  {/* <div
                    className="cf_jobOptions_Options_Div"
                    style={{ height: "60px" }}
                  >
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ width: "25%" }}
                    >
                      <span>Plan Details </span>
                      <span style={{ marginLeft: "auto" }}>:</span>
                    </div>
                    <div
                      className="cf_jobOptions_Options_Div_Key"
                      style={{ fontWeight: "400" }}
                    >
                      {globalContext?.user?.plan}
                    </div>
                  </div> */}
                </div>
              </div>
            </div>
          ) : (
            ""
          )}
        </div>
      </div>
    </div>
  );
};

export default MyAccount;
