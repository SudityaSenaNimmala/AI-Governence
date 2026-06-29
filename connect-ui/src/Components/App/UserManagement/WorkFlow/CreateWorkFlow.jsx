import { Grip, SaveAll, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  getCloudName,
  onBoardCloudsList,
} from "../../../helpers/helpers";
import {
  dullBackgroundColors,
  notifyToast,
  onBoardWithOutLicense,
} from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getLicensesList } from "../../SaaSManagement/SaaSActions/SaaSActions";
import {
  createWorkFlow,
  updateWorkFlow,
} from "../UserManagementActions/UserManagementActions";

const CreateWorkFlow = ({
  isWorkFlowVisible,
  setIsWorkFlowVisible,
  setIsPageLoading,
  setWorkFlowsList,
  editWorkFlowObject,
  workFlowsList,
  setEditWorkFlowObject,
}) => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [draggedCloudId, setDraggedCloudId] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [newWorkFlowObject, setNewWorkFlowObject] = useState({
    workFlowName: "",
    workFlowLists: [],
  });

  const [workflowCanvasList, setWorkflowCanvasList] = useState([]);

  const [licenseMap, setLicenseMap] = useState({});

  const [onBoardLicenseMap, setOnBoardLicenseMap] = useState({});

  const [editWorkFlowObjectNew, setEditWorkFlowObjectNew] = useState(null);

  const handleDragStart = (e) => {
    e.target.style.opacity = 1;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", null);
  };

  useEffect(() => {
    resetState();
    if (editWorkFlowObject) {
      setEditWorkFlowObjectNew(editWorkFlowObject[0]);
    } else {
      setEditWorkFlowObjectNew(null);
    }
  }, [editWorkFlowObject]);

  useEffect(() => {
    if (editWorkFlowObjectNew) {
      makeUIForEditWorkFlow();
    }
  }, [editWorkFlowObjectNew]);

  const resetState = () => {
    setLicenseMap({});
    setSearchInput("");
    setDraggedCloudId(null);
    setOnBoardLicenseMap({});
    setWorkflowCanvasList([]);
    setNewWorkFlowObject({
      workFlowName: "",
      workFlowLists: [],
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setWorkflowCanvasList((prev) => [...prev, draggedCloudId?.adminCloudId]);
    setNewWorkFlowObject((prev) => ({
      ...prev,
      workFlowLists: [...prev?.workFlowLists, draggedCloudId],
    }));
    e.dataTransfer.dropEffect = "move";
    getLicenses();
  };

  const getLicenses = async (cldId = draggedCloudId?.adminCloudId) => {
    let cloud = cloudsList.find((cloud) => cloud?.id === cldId);
    let view = document.getElementById(`view_${cloud?.providerName}`);
    if (view) {
      view.scrollIntoView({ behavior: "smooth" });
    }
    setLicenseMap((prev) => ({
      ...prev,
      [`${cloud?.providerName}|${cloud?.id}`]: {
        isLoaded: false,
        licenses: [],
      },
    }));

    if (onBoardWithOutLicense?.includes(cloud?.providerName)) {
      setLicenseMap((prev) => ({
        ...prev,
        [`${cloud?.providerName}|${cloud?.id}`]: {
          isLoaded: true,
          licenses: [],
        },
      }));
      return;
    }

    let res = await getLicensesList(
      cloud?.adminEmail,
      cloud?.providerName,
      cloud?.id
    );
    if (res?.status === "OK") {
      setLicenseMap((prev) => ({
        ...prev,
        [`${cloud?.providerName}|${cloud?.id}`]: {
          isLoaded: true,
          licenses: res?.res,
        },
      }));
    } else {
      setLicenseMap((prev) => ({
        ...prev,
        [`${cloud?.providerName}|${cloud?.id}`]: {
          isLoaded: true,
          licenses: [],
        },
      }));
    }
  };

  const removeCloudFromWorkflow = (id, providerName) => {
    setWorkflowCanvasList((prev) => prev.filter((cloud) => cloud !== id));
    let licMap = { ...licenseMap };
    delete licMap[`${providerName}|${id}`];
    setLicenseMap(licMap);

    let onBoardLicMap = { ...onBoardLicenseMap };
    delete onBoardLicMap[`${providerName}|${id}`];
    setOnBoardLicenseMap(onBoardLicMap);

    let copyworkFlowLists = [...newWorkFlowObject?.workFlowLists];
    copyworkFlowLists = copyworkFlowLists.filter(
      (cloud) => cloud?.adminCloudId !== id
    );
    setNewWorkFlowObject((prev) => ({
      ...prev,
      workFlowLists: copyworkFlowLists,
    }));
  };

  const handleLicenseSelection = (e, data, providerName) => {
    let selectedLicenses = [...(onBoardLicenseMap[`${providerName}`] || [])];
    if (e === "INPUT_TEXT") {
      setOnBoardLicenseMap((prev) => ({
        ...prev,
        [`${providerName}`]: data,
      }));
    } else {
      if (e.target.checked) {
        selectedLicenses.push(data);
      } else {
        selectedLicenses = selectedLicenses.filter(
          (license) => license?.id !== data?.id
        );
      }
      setOnBoardLicenseMap((prev) => ({
        ...prev,
        [`${providerName}`]: selectedLicenses,
      }));
    }
  };

  const isCreateButtonDisabled = () => {
    let returnValue = false;
    if (
      !newWorkFlowObject.workFlowName?.trim() &&
      workflowCanvasList.length < 3
    ) {
      returnValue = true;
    } else {
      returnValue = false;
    }

    if (Object.keys(onBoardLicenseMap).length === 0) {
      returnValue = true;
    } else {
      returnValue = false;
    }

    return returnValue;
  };

  const handleCreateWorkflow = async () => {
    let finalList = [];

    console.log("newWorkFlowObject", newWorkFlowObject);

    newWorkFlowObject?.workFlowLists?.map((cloud) => {
      if (cloud?.providerName === "THINKIFIC") {
        finalList.push({
          ...cloud,
          domainName:
            onBoardLicenseMap[`${cloud?.providerName}|${cloud?.adminCloudId}`],
          skus: [],
        });
      } else if (onBoardWithOutLicense?.includes(cloud?.providerName)) {
        finalList.push({
          ...cloud,
          skus: [],
        });
      } else {
        finalList.push({
          ...cloud,
          skus: onBoardLicenseMap[
            `${cloud?.providerName}|${cloud?.adminCloudId}`
          ],
        });
      }
    });

    let fnlBody = { ...newWorkFlowObject, workFlowLists: finalList };

    setIsPageLoading(true);
    // setIsWorkFlowVisible(false);

    let res = "";

    if (editWorkFlowObjectNew?.id) {
      fnlBody.id = editWorkFlowObjectNew?.id;
      fnlBody.createdOn = editWorkFlowObjectNew?.createdOn;
      fnlBody.updatedOn = editWorkFlowObjectNew?.updatedOn;
      fnlBody.updatedOn = editWorkFlowObjectNew?.updatedOn;
      fnlBody.userId = editWorkFlowObjectNew?.userId;
      res = await updateWorkFlow(fnlBody);
    } else {
      res = await createWorkFlow(fnlBody);
    }
    if (res?.status === "OK") {
      setIsWorkFlowVisible(false);
      setIsPageLoading(false);
      resetState();
      if (editWorkFlowObjectNew?.id) {
        notifyToast("success", "Template Updated Successfully");
        let copyWorkFlowsList = [...workFlowsList];
        copyWorkFlowsList = copyWorkFlowsList.map((workFlow) => {
          if (workFlow?.id === editWorkFlowObjectNew?.id) {
            return res?.res;
          }
          return workFlow;
        });
        setWorkFlowsList(copyWorkFlowsList);
      } else {
        notifyToast("success", "Template Created Successfully");
        setWorkFlowsList((prev) => [...prev, res?.res]);
      }
    } else {
      if (res?.res === "Workflow with the same name already exists.") {
        notifyToast("error", res?.res);
        setIsPageLoading(false);
      } else {
        resetState();
        setIsPageLoading(false);
        setIsWorkFlowVisible(false);
        notifyToast("error", res?.res);
      }
    }
  };

  const makeUIForEditWorkFlow = () => {
    let onBoardLicenseMapCpy = {};
    let workflowCanvasListCpy = editWorkFlowObjectNew?.workFlowLists?.reduce(
      (acc, cloud) => {
        return acc.includes(cloud?.adminCloudId)
          ? acc
          : [...acc, cloud?.adminCloudId];
      },
      []
    );

    setNewWorkFlowObject({
      workFlowName: editWorkFlowObjectNew?.workFlowName,
      workFlowLists: editWorkFlowObjectNew?.workFlowLists,
    });

    editWorkFlowObjectNew?.workFlowLists?.forEach((cloud) => {
      if (cloud?.providerName === "THINKIFIC") {
        onBoardLicenseMapCpy[`${cloud?.providerName}|${cloud?.adminCloudId}`] =
          cloud?.domainName;
      } else if (onBoardWithOutLicense?.includes(cloud?.providerName)) {
        onBoardLicenseMapCpy[`${cloud?.providerName}|${cloud?.adminCloudId}`] =
          [];
      } else {
        onBoardLicenseMapCpy[`${cloud?.providerName}|${cloud?.adminCloudId}`] =
          cloud?.skus;
      }
    });

    workflowCanvasListCpy.forEach((cldId) => {
      getLicenses(cldId);
    });

    console.log(onBoardLicenseMapCpy);

    setWorkflowCanvasList(workflowCanvasListCpy);
    setOnBoardLicenseMap(onBoardLicenseMapCpy);
  };

  console.log("onBoardLicenseMapCpy", onBoardLicenseMap);

  return (
    <Popup
      options={{
        isOpen: isWorkFlowVisible,
        title: `Create Template For Onboarding`,
        popupWidth: "100%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        titleCustomStyles: {
          fontSize: "16px",
          fontWeight: "600",
        },
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setIsWorkFlowVisible}
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
        <div className="cf_workflow_canvas_container">
          <div className="CF_d-flex" style={{ gap: "10px" }}>
            <TextInput
              type="text"
              autoFocus={true}
              inputWidth="calc(100% - 100px)"
              defaultValue={newWorkFlowObject.workFlowName}
              inputName="workFlowName"
              placeHolder="Template Name"
              getInputText={(val) =>
                setNewWorkFlowObject({
                  ...newWorkFlowObject,
                  workFlowName: val,
                })
              }
            />
            <ActionButton
              customClass={`changeButtonColorOnHover ${
                isCreateButtonDisabled() ? "cf_button_disabled" : ""
              }`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                // padding: "8px 12px",
                height: "40px",
                width: "100px",
              }}
              isDisabled={isCreateButtonDisabled()}
              buttonType="button"
              buttonClickAction={() => {
                handleCreateWorkflow();
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
                <SaveAll size={16} />
                <p style={{ fontSize: "12px" }}>
                  {editWorkFlowObjectNew?.id ? `Update` : `Create`}
                </p>
              </div>
            </ActionButton>
          </div>
          <div className="cf_workflow_canvas_container_body">
            <div className="cf_workflow_canvas_container_body_left">
              <div className="cf_workflow_canvas_container_body_left_header">
                <h3>Select Clouds</h3>
                <p>Drag to canvas to add cloud to Template</p>
                <SearchComponent
                  autoOpen={true}
                  boxShadows={true}
                  inputName="searchInput"
                  customStyles={{
                    width: "100%",
                    height: "40px",
                    marginTop: "5px",
                  }}
                  inputPlaceHolder={`Search By Cloud Name`}
                  onInputSearch={(e) => setSearchInput(e?.searchInput)}
                />
              </div>
              <div className="cf_workflow_canvas_container_body_left_body">
                {cloudsList
                  ?.filter((cld) =>
                    searchInput === ""
                      ? cld
                      : getCloudName(cld?.providerName)
                          ?.toLowerCase()
                          ?.includes(searchInput?.toLowerCase())
                  )
                  ?.map((cloud, index) =>
                    onBoardCloudsList?.includes(cloud?.providerName) &&
                    !workflowCanvasList?.includes(cloud?.id) ? (
                      <div
                        key={cloud?.id}
                        data-id={cloud?.id}
                        className="cf_workflow_canvas_container_body_left_body_item"
                        style={{
                          backgroundColor: dullBackgroundColors[index],
                        }}
                        onDragStart={(e) => {
                          setDraggedCloudId({
                            providerName: cloud?.providerName,
                            adminCloudId: cloud?.id,
                            adminEmail: cloud?.adminEmail,
                            domainName: "",
                          });
                          handleDragStart(e);
                        }}
                        draggable={true}
                      >
                        <div className="cf_workflow_canvas_container_body_left_body_item_grip">
                          <Grip size={16} />
                        </div>
                        <div
                          className="cf_workflow_canvas_container_body_left_body_item_content"
                          style={{ flexDirection: "column" }}
                        >
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            <img
                              src={cloudImageMapper(cloud?.providerName)}
                              alt={cloud?.name}
                              style={{
                                width: "20px",
                                height: "20px",
                              }}
                            />
                            <p>{getCloudName(cloud?.providerName)}</p>
                          </div>
                          {cloud?.adminEmail ? (
                            <div className="cf_workflow_canvas_container_body_left_body_item_content_email">
                              {cloud?.adminEmail}
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      </div>
                    ) : (
                      ""
                    )
                  )}
              </div>
            </div>
            <div className="cf_workflow_canvas_drag_drop_container">
              <div className="cf_workflow_canvas_drag_drop_container_header">
                <h3>Template Canvas</h3>
                <p>
                  Drop cloud providers here, then select licenses within each
                  cloud
                </p>
              </div>
              <div
                className="cf_workflow_canvas_drag_drop_container_body"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                {cloudsList.map((cloud, index) =>
                  workflowCanvasList?.reverse()?.includes(cloud?.id) ? (
                    <div
                      style={
                        {
                          // backgroundColor:
                          //   dullBackgroundColors.reverse()[index],
                        }
                      }
                      id={`view_${cloud?.providerName}`}
                      key={`drop_${cloud?.id}`}
                      className="cf_workflow_canvas_Cloud_Item"
                    >
                      <div
                        className="cf_workflow_canvas_Cloud_Item_close"
                        onClick={() => {
                          removeCloudFromWorkflow(
                            cloud?.id,
                            cloud?.providerName
                          );
                        }}
                      >
                        <X size={12} strokeWidth={4} />
                      </div>
                      <div className="cf_workflow_canvas_Cloud_Item_header">
                        <div className="cf_workflow_canvas_Cloud_Item_header_block">
                          <img
                            src={cloudImageMapper(cloud?.providerName)}
                            alt={cloud?.name}
                          />
                          <p>{getCloudName(cloud?.providerName)}</p>
                        </div>
                        <div className="cf_workflow_canvas_Cloud_Item_header_block">
                          <p
                            className="cf_workflow_canvas_container_body_left_body_item_content_email"
                            style={{
                              fontWeight: "400",
                            }}
                          >
                            {getCloudName(cloud?.adminEmail)}
                          </p>
                        </div>
                      </div>
                      <div
                        className="cf_workflow_canvas_Cloud_Item_body"
                        style={{
                          paddingBottom: onBoardWithOutLicense?.includes(
                            cloud?.providerName
                          )
                            ? "0px"
                            : "10px",
                          height:
                            onBoardLicenseMap[
                              `${cloud?.providerName}|${cloud?.id}`
                            ]?.length > 0
                              ? "calc(100% - 100px)"
                              : "calc(100% - 60px)",
                        }}
                      >
                        {onBoardWithOutLicense?.includes(
                          cloud?.providerName
                        ) ? (
                          cloud?.providerName === "THINKIFIC" ? (
                            <div
                              style={{
                                width: "100%",
                                gap: "10px",
                                padding: "15px 0px",
                                flexDirection: "column",
                              }}
                              className="CF_d-flex"
                            >
                              <TextInput
                                type="email"
                                placeHolder="Admin Email *"
                                inputName="email"
                                autoFocus={true}
                                inputWidth="100%"
                                textInputWidth="100%"
                                defaultValue={
                                  onBoardLicenseMap[
                                    `${cloud?.providerName}|${cloud?.id}`
                                  ]
                                }
                                errorData={""}
                                getInputText={(val, name) => {
                                  handleLicenseSelection(
                                    "INPUT_TEXT",
                                    val,
                                    `${cloud?.providerName}|${cloud?.id}`
                                  );
                                }}
                              />
                            </div>
                          ) : (
                            ""
                          )
                        ) : !licenseMap[`${cloud?.providerName}|${cloud?.id}`]
                            ?.isLoaded ? (
                          getCFTextLoader()
                        ) : licenseMap[`${cloud?.providerName}|${cloud?.id}`]
                            ?.isLoaded &&
                          licenseMap[`${cloud?.providerName}|${cloud?.id}`]
                            ?.licenses?.length === 0 ? (
                          <div
                            className="cf_workdflow_cloud_license_item"
                            style={{
                              justifyContent: "center",
                              padding: "35px",
                            }}
                          >
                            <p style={{ color: "#64748b" }}>
                              No licenses found
                            </p>
                          </div>
                        ) : (
                          licenseMap[
                            `${cloud?.providerName}|${cloud?.id}`
                          ]?.licenses?.map((res) => (
                            <div className="cf_workdflow_cloud_license_item">
                              <input
                                type="checkbox"
                                onChange={(e) =>
                                  handleLicenseSelection(
                                    e,
                                    res,
                                    `${cloud?.providerName}|${cloud?.id}`
                                  )
                                }
                                checked={onBoardLicenseMap[
                                  `${cloud?.providerName}|${cloud?.id}`
                                ]?.find(
                                  (license) =>
                                    license?.id === res?.id &&
                                    license?.adminCloudId === res?.adminCloudId
                                )}
                              />
                              <p>
                                {res?.planName?.replaceAll("_", " ")}{" "}
                                {res?.organization ? (
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: "500",
                                    }}
                                  >
                                    ({res?.organization})
                                  </span>
                                ) : (
                                  ""
                                )}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                      {console.log(
                        onBoardLicenseMap[`${cloud?.providerName}|${cloud?.id}`]
                      )}
                      {onBoardLicenseMap[`${cloud?.providerName}|${cloud?.id}`]
                        ?.length > 0 &&
                        cloud?.providerName !== "THINKIFIC" && (
                          <div
                            style={{
                              width: "100%",
                              height: "40px",
                              padding: "15px 20px",
                            }}
                            className="CF_d-flex ai-center"
                          >
                            <div
                              className="cf_workdflow_cloud_license_item"
                              style={{
                                height: "40px",
                                padding: "0 5px",
                                borderTop: "1px solid #e0e0e0",
                              }}
                            >
                              <p style={{ color: "#64748b" }}>
                                Selected:{" "}
                                {
                                  onBoardLicenseMap[
                                    `${cloud?.providerName}|${cloud?.id}`
                                  ]?.length
                                }
                              </p>
                            </div>
                          </div>
                        )}
                    </div>
                  ) : (
                    ""
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Popup>
  );
};

export default CreateWorkFlow;
