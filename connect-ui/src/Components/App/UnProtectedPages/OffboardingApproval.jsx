import { ChevronDown, CircleCheckBig, CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import CF_LOGO from "../../../assets/images/CF_LOGO_WHITE.png";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import { getWorkFlowByWorkflowId, updateWorkFlowApproval } from "../SaaSManagement/SaaSActions/SaaSActions";
import "./css/UnProtecedPages.css";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import APP_SVG from "../../../assets/images/cloudIcons/APP_SVG.svg";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
const OffboardingApproval = () => {
  const [queryParams] = useSearchParams();
  const workflowId = queryParams.get("workflowId");
  const approveStatus = queryParams.get("approveStatus");
  const [workFlow, setWorkFlow] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAppsListOpen, setIsAppsListOpen] = useState(false);
  const [isButtonLoading, setIsButtonLoading] = useState(false);
  useEffect(() => {
    fetchWorkFlowByWorkflowId();
  }, [workflowId]);

  const fetchWorkFlowByWorkflowId = async () => {
    setIsLoading(true);
    let res = await getWorkFlowByWorkflowId(workflowId);
    if (res?.status === "OK") {
      setIsLoading(false);
      setWorkFlow(res?.res);
    }else{
      setIsLoading(false);
    }
  };

  const updateWorkFlowApprovalAction = async (approvalStatus) => {
    setIsButtonLoading(approvalStatus);
    let res = await updateWorkFlowApproval(workflowId, approvalStatus);
    if (res?.status === "OK") {
      setIsButtonLoading(false);
      fetchWorkFlowByWorkflowId();
    }else{
      setIsButtonLoading(false);
      fetchWorkFlowByWorkflowId();
      notifyToast("error", "Failed to update approval status");
    }
  };

  const makeListOfApps = () =>{
    return <div className="cf_approve_content_apps_list">
      <div className="cf_approve_content_apps_list_header" onClick={() => setIsAppsListOpen(!isAppsListOpen)}>
        <img src={APP_SVG} alt="App SVG" />
        <p>Applications ({workFlow?.listOfApps?.length})</p>
        <span style={{marginLeft: "auto"}}></span>
        <div className="cf_approve_content_apps_list_header_icon">
        <ChevronDown size={18} style={{transform: isAppsListOpen ? "rotate(180deg)" : "rotate(0deg)"}} />
        </div>
      </div>
      {isAppsListOpen && <div className="cf_approve_content_apps_list_body"> 
        {
          workFlow?.listOfApps?.map((app) => {
            return <div key={app?.adminCloudId} className="cf_approve_content_apps_list_body_item">
                <div className="cf_approve_content_apps_list_body_item_image">
                <img src={cloudImageMapper(app?.vendor)} alt="App Logo" />
                </div>
                <p className="cf_approve_content_apps_list_body_item_name">{getCloudName(app?.vendor)}</p>
              </div>;
          })
        }
      </div>}
    </div>;
  }

  const approveButtonAction = () => {
    return  <ButtonComponent
    inputWidth="100%"
    isLoading={isButtonLoading === "APPROVED"}
    isDisabled={isButtonLoading}
    buttonName=""
    buttonClickAction={() => updateWorkFlowApprovalAction("APPROVED")}
  >
    <div className="cf_approve_content_buttons_icon">
      <CircleCheckBig size={14} />
      <p>Confirm Approval</p>
    </div>
  </ButtonComponent>
  }

  const rejectButtonAction = () => {
    return  <ButtonComponent
    inputWidth="100%"
    isLoading={isButtonLoading === "REJECTED"}
    isDisabled={isButtonLoading}
    buttonName=""
    buttonClickAction={() => updateWorkFlowApprovalAction("REJECTED")}
    customstyles={{
      background: "#ef4343e6",
      color: "#000",
      border: "1px solid #ef4343e6",
    }}
  >
    <div className="cf_approve_content_buttons_icon">
      <CircleX size={14} color="#fff" />
      <p>Reject Request</p>
    </div>
  </ButtonComponent>
  }

  return (
    <div className="cf_login_bg">
      <div className="cf_login_bg_part_1">
        <div className="cf_approve_container">
          <div className="cf_approve_container_header">
            <img src={CF_LOGO} alt="CF Logo" />
          </div>
          {
            isLoading ? 
              getCFTextLoader()
            :""
          }
          {
            workFlow?.approveStatus !== "IN_QUEUE" && !isLoading ? (
              <>
                <div className="cf_approve_sub_heading" style={{padding:"1rem",
                background: workFlow?.approveStatus === "APPROVED" ? "rgba(181, 249, 206, 0.24)" : "#fef2f2",
                borderLeft: workFlow?.approveStatus === "APPROVED" ? "4px solid #16a34a" : "4px solid #ef4343e6",
                }}>
                  <p>Offboarding Request for <span className="cf_approve_content_email" style={{fontWeight: "600", color:"#000", paddingLeft:"4px"}}>{workFlow?.listOfApps?.length > 0 ? workFlow?.listOfApps?.[0]?.email : ""}</span></p>
                </div>
                  <div className="CF_d-flex ai-center" style={{padding:"1rem", gap:"10px", justifyContent: "center", alignItems: "center", width:"100%", flexDirection: "column"}}>
                    {
                      workFlow?.approveStatus === "APPROVED" ? 
                      <CircleCheckBig size={56} color="#16a34a" />
                      :<CircleX size={56} color="#ef4343e6" />
                    }
                    <p style={{fontSize:"18px", fontWeight:"500", color: workFlow?.approveStatus === "APPROVED" ? "#16a34a" : "#ef4343e6"}}>{workFlow?.approveStatus === "APPROVED" ? "Approved" : "Rejected"}</p>
                  </div>
              </>
            ):""
          }
          {workFlow?.approveStatus === "IN_QUEUE" && approveStatus === "APPROVED" && !isLoading ? (
            <>
              <div className="cf_approve_sub_heading">
                <p>⚠️ Confirm Offboarding Approval</p>
                <span>This action cannot be undone</span>
              </div>
              <div className="cf_approve_content">
                <p style={{ padding: "1rem 0" }}>
                  You are about to approve the offboarding request for
                  <span className="cf_approve_content_email">
                    {workFlow?.listOfApps?.length > 0 ? workFlow?.listOfApps?.[0]?.email : ""}
                  </span>
                  . This will permanently revoke their access to all connected
                  applications.
                </p>

                {makeListOfApps()}

                <div className="cf_approve_content_buttons">
                 {approveButtonAction()}
                </div>
              </div>
            </>
          ) : (""
          )}
          {
            (workFlow?.approveStatus === "IN_QUEUE" && approveStatus === "REJECTED" && !isLoading) ? <>
            <div
              className="cf_approve_sub_heading"
              style={{
                background: "#fef2f2",
                borderLeft: "4px solid #ef4343e6",
              }}
            >
              <p>⚠️ Reject Offboarding Request</p>
              <span>This action cannot be undone</span>
            </div>
            <div className="cf_approve_content">
              <p style={{ padding: "1rem 0" }}>
                You are about to reject the offboarding request for
                <span className="cf_approve_content_email">
                  {workFlow?.listOfApps?.length > 0 ? workFlow?.listOfApps?.[0]?.email : ""}
                </span>
                . The user's access will remain unchanged.
              </p>
              
              {makeListOfApps()}

              <div className="cf_approve_content_buttons">
               {rejectButtonAction()}
              </div>
            </div>
          </>:""
          }
          {
            (workFlow?.approveStatus === "IN_QUEUE" && approveStatus === "VIEWDETAILS" && !isLoading) ? <>
            <div className="cf_approve_sub_heading">
                <p>Offboarding Request</p>
                <span style={{padding:"0"}}>This action cannot be undone</span>
              </div>
            <div className="cf_approve_content">
              <p style={{ padding: "1rem 0" }}>
                Review the offboarding request for
                <span className="cf_approve_content_email">
                  {workFlow?.listOfApps?.length > 0 ? workFlow?.listOfApps?.[0]?.email : ""}
                </span>
                . The user's access will remain unchanged.
              </p>
              
              {makeListOfApps()}

              <div className="cf_approve_content_buttons">
              {approveButtonAction()}
              {rejectButtonAction()}
                
              </div>
            </div>
          </>:""
          }
        </div>
      </div>
    </div>
  );
};

export default OffboardingApproval;
