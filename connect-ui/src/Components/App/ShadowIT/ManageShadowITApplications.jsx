import { useEffect, useState } from "react";
import { getCloudName } from "../../helpers/helpers";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import SvgName from "../../Testing/SvgName";
import { getShadowITUsersList } from "../SaaSManagement/SaaSActions/SaaSActions";

const ManageShadowITApplications = ({
  application = null,
  setSelectedApplication = null,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [listEmails, setListEmails] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [currentApplication, setCurrentApplication] = useState(application);
  useEffect(() => {
    if (application && application?.vendor === "GOOGLE_WORKSPACE") {
      setSearchInput("");
      getUsersList();
      setCurrentApplication(application);
      setIsVisible(true);
    } else if (application) {
      setSearchInput("");
      setIsLoading(false);
      setListEmails(application?.listOfEmails);
      setCurrentApplication(application);
      setIsVisible(true);
    }
  }, [application]);

  const getUsersList = async () => {
    setIsLoading(true);
    let res = await getShadowITUsersList(
      currentApplication?.adminCloudId,
      currentApplication?.appId
    );
    if (res?.status === "OK" && res?.res) {
      let emails = res?.res?.reduce((acc, item) => {
        if (item) {
          acc.push(item);
        }
        return acc;
      }, []);
      setIsLoading(false);
      setListEmails(emails);
    } else {
      setIsLoading(false);
    }
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: ``,
        popupWidth: "60%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setSelectedApplication}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div className="cf_manage_groups_header">
          <SvgName
            type="square"
            name={
              currentApplication?.appName || currentApplication?.displayName
            }
          />
          <div className="cf_manage_groups_header_title">
            <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
              <p
                title={
                  currentApplication?.appName || currentApplication?.displayName
                }
                dangerouslySetInnerHTML={{
                  __html:
                    currentApplication?.appName ||
                    currentApplication?.displayName,
                }}
              ></p>

              {/* {currentApplication?.isVerified ? (
                <BadgeCheck
                  size={22}
                  strokeWidth={2}
                  color="#fff"
                  fill="#166534"
                />
              ) : (
                <BadgeAlert
                  size={22}
                  strokeWidth={2}
                  color="#fff"
                  fill="#ff4c4c"
                />
              )} */}
            </div>
            {/* <p
              style={{
                fontSize: "12px",
                color: "#64748b",
                fontWeight: "400",
                visibility: "hidden",
              }}
            >
              {currentApplication?.vendor}
            </p> */}
            <div className="CF_d-flex ai-center" style={{ gap: "15px" }}>
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                {getCloudName(currentApplication?.vendor)}
              </p>
              <span style={{ marginLeft: "auto" }}></span>
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                Users Count: {listEmails?.length || 0}
              </p>
            </div>
          </div>
        </div>
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: "10px 0 0 0",
            flexDirection: "column",
            height: "fit-content",
            overflowY: "auto",
          }}
        >
          <div
            className="CF_d-flex ai-center"
            style={{ marginBottom: "10px", gap: "10px" }}
          >
            <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              inputPlaceHolder={`Search By Email`}
              onInputSearch={(e) => setSearchInput(e?.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
            {/* <ActionButton
              customClass={`changeButtonColorOnHoverToRed`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                padding: "8px 12px",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() => {
                console.log("remove");
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <span style={{ fontSize: "12px" }}>Revoke Access</span>
              </div>
            </ActionButton> */}
          </div>
          <div className="cf_new_tables_div" style={{ height: "fit-content" }}>
            <table>
              <thead>
                <tr>
                  {/* <th style={{ width: "1%", textAlign: "center" }}></th> */}
                  <th style={{ width: "35%", textAlign: "left" }}>Email</th>
                </tr>
              </thead>
              <tbody>
                {listEmails
                  ?.filter((item) =>
                    item?.toLowerCase().includes(searchInput?.toLowerCase())
                  )
                  ?.map((item, index) => (
                    <tr key={index}>
                      {/* <td><input type="checkbox" /></td> */}
                      <td className="cf_new_table_hide_text">
                        <p>{item}</p>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {isLoading ? getCFTextLoader() : null}
          </div>
        </div>
      </div>
    </Popup>
  );
};

export default ManageShadowITApplications;
