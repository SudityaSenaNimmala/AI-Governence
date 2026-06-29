import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import Popup from "../../../Resuables/Popup/Popup";
import { downloadGlobalCSV, notifyToast } from "../../../helpers/utils";
import { uploadUsersCSVFile } from "../../SaaSManagement/SaaSActions/SaaSActions";

const ManageUsersUsingCSV = ({
  adminCloudId,
  userlevel = true,
  totalUsers,
  fetchSaaSUsersList = () => {},
  isPopUpOpen = false,
  setIsPopUpOpen = () => {},
  setIsPageLoading = () => {},
}) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // setIsPageLoading(true);
    setIsOpen(isPopUpOpen);
  }, [isPopUpOpen]);

  const downloadSampleCSV = () => {
    let headers = ["Email", "UserType", "Status"];
    downloadGlobalCSV(headers, `SampleUserCSV`);
  };

  const uploadFile = async (fileStream) => {
    setIsPageLoading(true);
    let res = await uploadUsersCSVFile(
      fileStream,
      adminCloudId,
      totalUsers > 0
    );
    if (res?.status === "OK") {
      console.log(res?.res);
      if (res?.res === "success") {
        notifyToast("success", "Users Added Successfully");
      }
      setIsOpen(false);
      fetchSaaSUsersList();
      setIsPopUpOpen(false);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      setIsPopUpOpen(false);
      setIsOpen(false);
      notifyToast("error", "Failed To Upload CSV");
    }
  };

  return (
    <Popup
      options={{
        isOpen: isOpen,
        title: `Manage Users Using CSV`,
        popupWidth: "600px",
        type: "side",
        popupHeight: "fit-content",
        popupTop: "80px",
        maxHeight: "100%",
        overflowY: "auto",
        customStyles: {
          borderRadius: "10px",
        },
      }}
      toggleOpen={setIsOpen}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "10px",
          height: "calc(100% - 50px)",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
        }}
      >
        <p
          style={{
            fontSize: "12px",
            color: "#71717A",
            fontWeight: "500",
            marginLeft: "auto",
            paddingBottom: "10px",
            userSelect: "none",
          }}
        >
          Click to Download{" "}
          <span className="cf_make_link" onClick={downloadSampleCSV}>
            Sample CSV
          </span>
        </p>
        <ActionButton
          customClass="cf_upload_invoice_container"
          fileType=".csv"
          getFileStream={(file) => {
            uploadFile(file);
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              position: "relative",
              gap: "10px",
            }}
          >
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <FileText size={20} color="#acacac" />
              <p>Browse to Upload CSV Supports only .csv files</p>
            </div>
          </div>
        </ActionButton>
      </div>
    </Popup>
  );
};

export default ManageUsersUsingCSV;
