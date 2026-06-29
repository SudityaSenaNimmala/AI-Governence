import React, { useContext, useState } from "react";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import { IoMdClose } from "react-icons/io";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { downloadSaaSAppsReports } from "../../SaaSActions/SaaSActions";
import { downloadGlobalCSV, notifyToast } from "../../../../helpers/utils";

const SaaSDownload = (props) => {
  const { globalContext } = useContext(GlobalContext);
  const [action, setAction] = useState("TEAMS");
  const [frequency, setFrequency] = useState(7);
  const { memberId, providerName } = { ...globalContext?.saasCloud };
  const getReports = async () => {
    notifyToast("success", "Started Generating Your Report");
    props?.navigateTo("");
    let res = await downloadSaaSAppsReports(
      memberId,
      providerName,
      frequency,
      action
    );
    if (res?.status === "OK") {
      props?.navigateTo("");
      if(res?.res)
      downloadGlobalCSV(res?.res, action);
    } else {
      props?.navigateTo("");
      notifyToast("error", "Failed To Generate Report");
    }
  };

  return (
    <div className="cf_saasReports_download">
      <div className="cf_saasReports_download_Container">
        <div className="cf_saasReports_download_Container_title">
          <span>Download Report</span>
          <span
            className="cf_saasReports_download_Container_title_close"
            onClick={() => props?.navigateTo("")}
          >
            <IoMdClose />
          </span>
        </div>
        <div className="cf_saasReports_download_Container_body">
          <div>
            <div>Generate Reports For :</div>
            <div className="cf_saasReports_OptionsList">
              <div>
                <input
                  type="radio"
                  name="reportfor"
                  id="saasTeams"
                  onChange={() => setAction("TEAMS")}
                  checked={action === "TEAMS"}
                />
                <label htmlFor="saasTeams">Teams</label>
              </div>
              <div>
                <input
                  type="radio"
                  name="reportfor"
                  id="saasGroups"
                  onChange={() => setAction("GROUPS")}
                  checked={action === "GROUPS"}
                />
                <label htmlFor="saasGroups">Groups</label>
              </div>
              <div>
                <input
                  type="radio"
                  name="reportfor"
                  id="saasUsers"
                  onChange={() => setAction("USERS")}
                  checked={action === "USERS"}
                />
                <label htmlFor="saasUsers">Users</label>
              </div>
            </div>
          </div>
          <div>
            <div>Select Duration :</div>
            <div className="cf_saasReports_OptionsList">
              <div>
                <input
                  type="radio"
                  name="reportFrequency"
                  id="saas7"
                  onChange={() => setFrequency(7)}
                  checked={frequency === 7}
                />
                <label htmlFor="saas7">7 Days</label>
              </div>
              <div>
                <input
                  type="radio"
                  name="reportFrequency"
                  id="saas30"
                  onChange={() => setFrequency(30)}
                  checked={frequency === 30}
                />
                <label htmlFor="saas30">30 Days</label>
              </div>
              <div>
                <input
                  type="radio"
                  name="reportFrequency"
                  id="saas180"
                  onChange={() => setFrequency(180)}
                  checked={frequency === 180}
                />
                <label htmlFor="saas180">180 Days</label>
              </div>
            </div>
          </div>
        </div>
        <div className="cf_saasReports_download_Container_footer">
          <span style={{ marginLeft: "auto" }}></span>
          <ButtonComponent
            inputWidth="auto"
            customstyles={{ padding: "0 10px", height: "35px" }}
            buttonName="Download Report"
            buttonClickAction={() => getReports()}
          />
        </div>
      </div>
    </div>
  );
};

export default SaaSDownload;
