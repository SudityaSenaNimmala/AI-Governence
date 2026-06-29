import { Plus } from "lucide-react";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import "./css/NewFlow.css";
import { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import SelectDropDown from "../../Resuables/SelectDropDown/SelectDropDown";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { getLicensesList } from "../SaaSManagement/SaaSActions/SaaSActions";

const NewFlow = () => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [flowItems, setFlowItems] = useState([]);
  const [flowEditApp, setFlowEditApp] = useState({});

  const [licenseMap, setLicenseMap] = useState({});

  useEffect(() => {
    if (flowEditApp?.action?.value === "ONBOARD_USER") {
      fetchLicenses();
    }
  }, [flowEditApp]);

  const fetchLicenses = async () => {
    let res = await getLicensesList(
      "",
      flowEditApp?.currentApplication?.providerName,
      flowEditApp?.currentApplication?.id
    );

    if (res?.status === "OK") {
      setLicenseMap({
        ...licenseMap,
        [flowEditApp?.currentApplication?.providerName]: res?.res,
      });
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Settings" />
      <div className="cf_main_content_place">
        <TopNav pageName="New Flow" />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
        >
          <div className="cf_newFlow_canvas">
            <div className="cf_newFlow_canvas_action">
              <div className="cf_newFlow_canvas_header">
                <div className="cf_newFlow_canvas_header_name cf_tableEdit_Option">
                  <p>Flow Name</p>
                </div>
                <span style={{ fontSize: "12px", fontWeight: "500" }}></span>
              </div>
              <div className="cf_newFlow_canvas_action_placer_items">
                <div className="cf_newFlow_canvas_dottedLines"></div>
                {flowItems.map((item, index) => (
                  <>
                    <div
                      key={index}
                      className="cf_newFlow_canvas_header cf_sub_header"
                    >
                      <p className="cf_sub_header_p">Select Application</p>
                      <SelectDropDown
                        customDivStyles={{ width: "300px" }}
                        placeHolder={""}
                        defaultSelected={
                          flowEditApp?.currentApplication?.providerName
                            ? flowEditApp?.currentApplication
                            : {
                                name: "Select Application",
                                value: "",
                                displayName: "Select Application",
                              }
                        }
                        dropDownContent={[
                          {
                            name: "Select Application",
                            value: "",
                            displayName: "Select Application",
                          },
                          ...cloudsList?.reduce((acc, curr) => {
                            if (
                              curr?.providerName !== "OTHERS" &&
                              curr?.providerName
                            ) {
                              acc.push({
                                ...curr,
                                displayName: getCloudName(curr?.providerName),
                                imageSrc: cloudImageMapper(curr?.providerName),
                              });
                            }
                            return acc;
                          }, []),
                        ]}
                        onSelect={(e) => {
                          let currentFlowItems = { ...item };
                          currentFlowItems.currentApplication = e;
                          setFlowEditApp({ ...currentFlowItems });
                          let dummFlow = [...flowItems];
                          dummFlow[index] = currentFlowItems;
                          setFlowItems(dummFlow);
                        }}
                      />
                      {flowEditApp?.currentApplication?.providerName ? (
                        <>
                          <p className="cf_sub_header_p">Then</p>
                          <SelectDropDown
                            customDivStyles={{ width: "250px" }}
                            placeHolder={""}
                            defaultSelected={
                              flowEditApp?.action
                                ? flowEditApp?.action
                                : {
                                    name: "Select Action",
                                    value: "",
                                    displayName: "Select Action",
                                  }
                            }
                            dropDownContent={[
                              {
                                name: "Select Action",
                                value: "",
                                displayName: "Select Action",
                              },
                              {
                                name: "OnBoard User",
                                value: "ONBOARD_USER",
                              },
                              {
                                name: "Add User to Group or Team",
                                value: "ADD_USER_TO_GROUP",
                              },
                            ]}
                            onSelect={(e) => {
                              let currentFlowItems = { ...item };
                              currentFlowItems.action = e;
                              setFlowEditApp({ ...currentFlowItems });
                              let dummFlow = [...flowItems];
                              dummFlow[index] = currentFlowItems;
                              setFlowItems(dummFlow);
                            }}
                          />
                          {flowEditApp?.action?.value === "ONBOARD_USER" ? (
                            <>
                              <p className="cf_sub_header_p">Select License</p>
                            </>
                          ) : (
                            ""
                          )}
                        </>
                      ) : (
                        ""
                      )}
                    </div>
                    <div
                      className="cf_newFlow_canvas_action_placer_items"
                      style={{ marginTop: "-20px" }}
                    >
                      <div className="cf_newFlow_canvas_dottedLines"></div>
                      {item?.subItems?.map((subItem, subIndex) => (
                        <div
                          key={index}
                          className="cf_newFlow_canvas_header cf_sub_header"
                        >
                          <p className="cf_sub_header_p">Select Action</p>
                          <SelectDropDown
                            customDivStyles={{ width: "250px" }}
                            placeHolder={""}
                            defaultSelected={
                              subItem?.action
                                ? subItem?.action
                                : {
                                    name: "Select Action",
                                    value: "",
                                    displayName: "Select Action",
                                  }
                            }
                            dropDownContent={[
                              {
                                name: "Select Action",
                                value: "",
                                displayName: "Select Action",
                              },
                              {
                                name: "Add User to Group or Team",
                                value: "ADD_USER_TO_GROUP",
                              },
                            ]}
                            onSelect={(e) => {
                              let currentFlowItems = { ...subItem };
                              currentFlowItems.action = e;
                              let dumSubItems = [...item?.subItems];
                              dumSubItems[subIndex] = currentFlowItems;
                              let mainFlowItems = { ...item };
                              mainFlowItems.subItems = dumSubItems;
                              setFlowEditApp({ ...mainFlowItems });
                              let dummFlow = [...flowItems];
                              dummFlow[index] = mainFlowItems;
                              setFlowItems(dummFlow);
                            }}
                          />
                          {subItem?.action?.value === "ADD_USER_TO_GROUP" ? (
                            <>
                              <p className="cf_sub_header_p">
                                Select Group/Team
                              </p>
                              {/* <SelectDropDown
                                customDivStyles={{ width: "250px" }}
                                placeHolder={""}
                              /> */}
                            </>
                          ) : (
                            ""
                          )}
                        </div>
                      ))}
                      <div className="cf_newFlow_canvas_action_placer">
                        <ActionButton
                          customClass={`${
                            flowEditApp?.currentApplication?.providerName &&
                            flowEditApp?.action
                              ? "changeButtonColorOnHover"
                              : "cf_custom_cursor_not_allowed"
                          }`}
                          customStyles={{
                            backgroundColor: "#fff",
                            height: "35px",
                            width: "35px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          buttonType="button"
                          isDisabled={
                            flowEditApp?.currentApplication?.providerName &&
                            flowEditApp?.action
                              ? false
                              : true
                          }
                          buttonClickAction={() => {
                            let currentFlowItems = { ...item };
                            currentFlowItems?.subItems?.push({
                              action: null,
                              currentApplication: null,
                            });
                            let dummFlow = [...flowItems];
                            dummFlow[index] = currentFlowItems;
                            setFlowItems(dummFlow);
                          }}
                        >
                          <Plus size={16} />
                        </ActionButton>
                      </div>
                    </div>
                  </>
                ))}
                <div className="cf_newFlow_canvas_action_placer">
                  <ActionButton
                    customClass={`changeButtonColorOnHover`}
                    customStyles={{
                      backgroundColor: "#fff",
                      height: "35px",
                      width: "35px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    buttonType="button"
                    buttonClickAction={() => {
                      setFlowItems([
                        ...flowItems,
                        {
                          id: flowItems.length + 1,
                          action: null,
                          currentApplication: {},
                          subItems: [],
                        },
                      ]);
                    }}
                  >
                    <Plus size={16} />
                  </ActionButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewFlow;
