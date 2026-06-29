import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import {
  deleteWorkFlow,
  getWorkFlows,
} from "../UserManagementActions/UserManagementActions";
import CreateWorkFlow from "./CreateWorkFlow";
import { dullBackgroundColors, notifyToast } from "../../../helpers/utils";
import Popup from "../../../Resuables/Popup/Popup";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { useNavigate } from "react-router-dom";

const ManageWorkFlow = () => {
  const navigate = useNavigate();
  const [isWorkFlowVisible, setIsWorkFlowVisible] = useState(false);
  const [workFlowsList, setWorkFlowsList] = useState([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [editWorkFlowId, setEditWorkFlowId] = useState(null);
  const [editWorkFlowObject, setEditWorkFlowObject] = useState(null);
  const [deleteWorkFlowId, setDeleteWorkFlowId] = useState(null);
  useEffect(() => {
    fetchWorkFlows();
  }, []);

  const fetchWorkFlows = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows();
    if (res?.status === "OK") {
      setWorkFlowsList(res?.res);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (editWorkFlowId) {
      getEditWorkFlowForEdit();
    }
  }, [editWorkFlowId]);

  const getEditWorkFlowForEdit = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows(true, editWorkFlowId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setEditWorkFlowObject(res?.res);
      setIsWorkFlowVisible(true);
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  useEffect(() => {
    if (!isWorkFlowVisible) {
      setEditWorkFlowObject(null);
      setEditWorkFlowId(null);
    }
  }, [isWorkFlowVisible]);

  const handleDeleteWorkFlow = async () => {
    setIsPageLoading(true);
    setDeleteWorkFlowId(null);
    let res = await deleteWorkFlow(deleteWorkFlowId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Workflow Deleted Successfully");
      let copyWorkFlowsList = [...workFlowsList];
      copyWorkFlowsList = copyWorkFlowsList.filter(
        (workFlow) => workFlow?.id !== deleteWorkFlowId
      );
      setWorkFlowsList(copyWorkFlowsList);
    } else {
      setIsPageLoading(false);
      notifyToast("success", "Workflow Deleted Successfully");
      let copyWorkFlowsList = [...workFlowsList];
      copyWorkFlowsList = copyWorkFlowsList.filter(
        (workFlow) => workFlow?.id !== deleteWorkFlowId
      );
      setWorkFlowsList(copyWorkFlowsList);
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="WorkFlows" />
        <div className="cf_main_content_place">
          <TopNav pageName="Create Templates" backLink="/Workflow" />
          <div
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div className="cf_add_cloud_filter_div">
              <span style={{ marginLeft: "auto" }}></span>
              <ActionButton
                customClass={`changeButtonColorOnHover`}
                customStyles={{
                  backgroundColor: "#f2f2f2",
                  // padding: "8px 12px",
                  height: "40px",
                  width: "140px",
                }}
                isDisabled={false}
                buttonType="button"
                buttonClickAction={() => {
                  navigate("/NewFlow");
                }}
              >
                <div
                  className="CF_d-flex ai-center"
                  style={{
                    gap: "5px",
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  <p style={{ fontSize: "12px", fontWeight: "500" }}>
                    Create Template
                  </p>
                </div>
              </ActionButton>
            </div>
            <div className="cf_saas_cloudPlacer cf_saas_cloudPlacer_usersList">
              {workFlowsList?.map((data, index) => {
                return (
                  <div
                    key={data?.id}
                    className="cf_new_dashboard_info_pannel cf_main_saas_selector cf_main_saas_selector_onboard_users"
                    style={{
                      animationDelay: `${index * 0.1}s`,
                      padding: "1rem",
                      paddingBottom: "1rem !important",
                      backgroundColor: "#f0f4f8",
                      border: "1px solid #c0c5ca",
                    }}
                  >
                    <div
                      className="cf_main_saas_selector_img_container ai-center"
                      style={{ height: "100%" }}
                    >
                      <div style={{ width: "200px" }}>
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_name"
                          title={data?.workFlowName}
                        >
                          {data?.workFlowName}
                        </p>
                      </div>
                      <div style={{ marginLeft: "auto", width: "200px" }}>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "8px" }}
                        >
                          <p>
                            Total Applications: {data?.workFlowLists?.length}
                          </p>
                        </div>
                      </div>
                      <div
                        style={{ width: "150px", alignItems: "flex-start" }}
                        className="CF_d-flex"
                      >
                        {/* <div
                          style={{ marginLeft: "auto" }}
                          className="cf_onboard_timer"
                        >
                          <p
                            className="cf_new_dashboard_info_graph_container_details_app_name"
                            style={{ fontSize: "12px" }}
                          >
                            {moment(data.createdOn).fromNow()}
                          </p>
                        </div> */}
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          padding: "0",
                          width: "auto",
                          height: "30px",
                          justifyContent: "center",
                        }}
                        className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                      ></div>
                      <div
                        className="CF_d-flex ai-center cf_newDashboard_OpenLink_tr"
                        style={{ gap: "20px" }}
                      >
                        {/* <div
                          style={{
                            marginLeft: "auto",
                            padding: "0",
                            width: "30px",
                            height: "30px",
                            justifyContent: "center",
                          }}
                          className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                          onClick={() => {
                            console.log();
                          }}
                        >
                          <View size={14} />
                        </div> */}
                        <div
                          style={{
                            marginLeft: "auto",
                            padding: "0",
                            width: "30px",
                            height: "30px",
                            justifyContent: "center",
                          }}
                          className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                          onClick={() => {
                            navigate("/NewFlow?editWorkFlowId=" + data?.id);
                          }}
                        >
                          <Pencil size={14} />
                        </div>
                        <div
                          style={{
                            marginLeft: "auto",
                            padding: "0",
                            width: "30px",
                            height: "30px",
                            justifyContent: "center",
                          }}
                          className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                          onClick={() => {
                            setDeleteWorkFlowId(data?.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <CreateWorkFlow
        isWorkFlowVisible={isWorkFlowVisible}
        setIsWorkFlowVisible={setIsWorkFlowVisible}
        setIsPageLoading={setIsPageLoading}
        setWorkFlowsList={setWorkFlowsList}
        editWorkFlowObject={editWorkFlowObject}
        setEditWorkFlowObject={setEditWorkFlowObject}
        workFlowsList={workFlowsList}
      />
      <Popup
        options={{
          isOpen: deleteWorkFlowId,
          title: `Delete Template`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setDeleteWorkFlowId}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
            maxHeight: "500px",
          }}
        >
          <p style={{ fontWeight: "600" }}>
            Are you sure you want to delete the Template ?{" "}
          </p>
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
              background: "#f2f2f2",
              color: "#000",
              border: "1px solid #ddd",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="No"
            buttonClickAction={() => {
              setDeleteWorkFlowId(null);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => handleDeleteWorkFlow()}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ManageWorkFlow;
