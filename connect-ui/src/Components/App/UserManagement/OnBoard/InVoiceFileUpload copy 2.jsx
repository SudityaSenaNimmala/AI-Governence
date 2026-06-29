import { useNavigate } from "react-router-dom";
import {
  formatDateForRenewal,
  formatMsToDateString,
  getMaxChar,
  notifyToast,
} from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import Popup from "../../../Resuables/Popup/Popup";
import {
  saveManuallyIntegration,
  saveVendorWithInvoice,
} from "../../Oauth/OauthActions/OauthApiActions";
import { CircleX, Clock, FileText, Sparkles, Trash2 } from "lucide-react";
import { FaRegCheckCircle } from "react-icons/fa";
import { useContext, useEffect, useState } from "react";
import {
  getDownloadStatus,
  saveAndUpdateLicense,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import { formatDateNew } from "../../../helpers/helpers";
import CustomCalendar from "../../../Resuables/CustomCalendar/CustomCalendar";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { SET_SAAS_CLOUD } from "../../../../GlobalContext/action.types";

export const InVoiceFileUploadNew = ({
  isUploadInvoice,
  setIsUploadInvoice,
  saasVendor,
  getLicenses,
  fetchSaaSCosting,
}) => {
  const navigate = useNavigate();
  const [changeChannelDate, setChangeChannelDate] = useState(null);
  const [selectEdit, setSelectEdit] = useState(null);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isDataExtractionUsingAIComplete, setIsDataExtractionUsingAIComplete] =
    useState(false);
  const [extractedData, setExtractedData] = useState({});
  const [invoiceSteps, setInvoiceSteps] = useState([
    {
      stepIndex: 0,
      title: "Uploading File",
      subtitle: "Uploading your invoice to the server",
      processStatus: "IN_PROGRESS",
    },
    {
      stepIndex: 1,
      title: "Parsing File Using AI",
      subtitle: "AI is reading and extracting text from your invoice",
      processStatus: "YET_TO_START",
    },
    {
      stepIndex: 2,
      title: "Analyzing Data Using AI",
      subtitle:
        "AI is identifying invoice fields and extracting key information",
      processStatus: "YET_TO_START",
    },
    {
      stepIndex: 3,
      title: "User Validation",
      subtitle: "User need to validate the data before saving",
      processStatus: "YET_TO_START",
    },
    {
      stepIndex: 4,
      title: "Saving Data",
      subtitle: "Invoice data is being saved to the database",
      processStatus: "YET_TO_START",
    },
    {
      stepIndex: 5,
      title: "Processing Complete",
      subtitle: "Invoice data has been successfully extracted and structured",
      processStatus: "YET_TO_START",
    },
  ]);

  useEffect(() => {
    setSelectEdit(null);
    setIsFileUploading(false);
    setChangeChannelDate(null);
    setIsDataExtractionUsingAIComplete(false);
    setExtractedData({});
    setInvoiceSteps([
      {
        stepIndex: 0,
        title: "Uploading File",
        subtitle: "Uploading your invoice to the server",
        processStatus: "IN_PROGRESS",
      },
      {
        stepIndex: 1,
        title: "Parsing File Using AI",
        subtitle: "AI is reading and extracting text from your invoice",
        processStatus: "YET_TO_START",
      },
      {
        stepIndex: 2,
        title: "Analyzing Data Using AI",
        subtitle:
          "AI is identifying invoice fields and extracting key information",
        processStatus: "YET_TO_START",
      },
      {
        stepIndex: 3,
        title: "User Validation",
        subtitle: "User need to validate the data before saving",
        processStatus: "YET_TO_START",
      },
      {
        stepIndex: 4,
        title: "Saving Data",
        subtitle: "Invoice data is being saved to the database",
        processStatus: "YET_TO_START",
      },
      {
        stepIndex: 5,
        title: "Processing Complete",
        subtitle: "Invoice data has been successfully extracted and structured",
        processStatus: "YET_TO_START",
      },
    ]);
  }, [isUploadInvoice]);

  const addVendorWithInvoice = async (file) => {
    setIsFileUploading(true);
    setIsDataExtractionUsingAIComplete(false);
    setExtractedData({});
    let res = await saveVendorWithInvoice(file);
    if (res.status === "OK") {
      updateInvoiceSteps(0, "COMPLETED");
      updateInvoiceSteps(1, "IN_PROGRESS");
      startStatusCheck(res?.res?.adminMemberId);
    } else {
      updateInvoiceSteps(0, "CONFLICT");
    }
  };

  let retryCount = 0;
  const startStatusCheck = async (userId) => {
    let res = await getDownloadStatus(userId, "INVOICE_UPLOAD");
    if (res?.status === "OK") {
      if (res?.res?.status === "PARSING_FILE") {
        updateInvoiceSteps(1, "IN_PROGRESS");
      } else if (res?.res?.status === "ANALYZING_DATA") {
        updateInvoiceSteps(2, "IN_PROGRESS");
      } else if (res?.res?.status === "FILE_PARSING_COMPLETED") {
        updateInvoiceSteps(3, "IN_PROGRESS");
      } else if (res?.res?.status === "DATA_EXTRACTION_COMPLETED") {
        setIsDataExtractionUsingAIComplete(true);
        setExtractedData(res?.res?.saaSExternalVendor);
        updateInvoiceSteps(4, "IN_PROGRESS");
      } else if (res?.res?.status === "PROCESSED") {
        updateInvoiceSteps(5, "COMPLETED");
        setTimeout(() => {
          notifyToast("success", "App Integrated Successfully");
          //   setIsFileUploading(false);
          setTimeout(() => {
            navigate("/Integrations/Manage");
          }, 1000);
        }, 2000);
      } else if (res?.res?.status === "FAILED") {
        let inprogressSteps = invoiceSteps.find(
          (step) => step.processStatus === "IN_PROGRESS"
        );
        updateInvoiceSteps(
          inprogressSteps.stepIndex,
          "CONFLICT",
          res?.res?.errorDescription
        );
        notifyToast("error", res?.res?.errorDescription);
      }

      if (
        res?.res?.status !== "FAILED" &&
        res?.res?.status !== "PROCESSED" &&
        res?.res?.status !== "DATA_EXTRACTION_COMPLETED"
      ) {
        setTimeout(() => {
          startStatusCheck(res?.res?.adminMemberId);
        }, 2000);
      }
    } else {
      retryCount++;
      if (retryCount < 3) {
        setTimeout(() => {
          startStatusCheck(res?.res?.adminMemberId);
        }, 2000);
      } else {
        let inprogressSteps = invoiceSteps.find(
          (step) => step.processStatus === "IN_PROGRESS"
        );
        updateInvoiceSteps(inprogressSteps.stepIndex, "CONFLICT");
      }
    }
  };

  const updateInvoiceSteps = (stepIndex, processStatus, errorDescription) => {
    let updatedSteps = [...invoiceSteps];
    for (let i = 0; i < invoiceSteps.length; i++) {
      if (i === stepIndex) {
        updatedSteps[i].processStatus = processStatus;
        if (processStatus === "CONFLICT") {
          updatedSteps[i].subtitle = errorDescription;
        }
      } else if (i < stepIndex) {
        updatedSteps[i].processStatus = "COMPLETED";
      } else if (i > stepIndex) {
        updatedSteps[i].processStatus = "YET_TO_START";
      }
    }
    setInvoiceSteps(updatedSteps);
  };

  const handleChangeDate = (date) => {
    console.log(changeChannelDate, "changeChannelDate");
    console.log(date, "date");
    let updatedData = [...extractedData?.subscriptions];
    updatedData[changeChannelDate?.currentIndex][changeChannelDate?.id] =
      formatMsToDateString(date?.newDate);
    setExtractedData({ ...extractedData, subscriptions: updatedData });
    setChangeChannelDate(null);
  };

  const updateExtractedData = (index, value, id) => {
    let updatedData = [...extractedData?.subscriptions];
    updatedData[index][id] = value;
    setExtractedData({ ...extractedData, subscriptions: updatedData });
    setSelectEdit(null);
  };

  const handleSaveData = async () => {
    updateInvoiceSteps(4, "IN_PROGRESS");
    setIsDataExtractionUsingAIComplete(false);
    if (saasVendor?.providerName) {
      let newLicBody = extractedData?.subscriptions?.reduce((acc, data) => {
        acc.push({
          ...data,
          adminCloudId: saasVendor?.id,
          vendor: saasVendor?.providerName,
          adminMemberId: saasVendor?.memberId,
          planId: data?.planId ? data?.planId : data?.planName,
          productId: data?.productId ? data?.productId : data?.planName,
        });
        return acc;
      }, []);

      let res = await saveAndUpdateLicense(
        newLicBody,
        saasVendor?.providerName
      );

      if (res?.status === "OK" && res?.res?.length > 0) {
        updateInvoiceSteps(5, "COMPLETED");
        notifyToast("success", "Successfully Saved License Details");

        let licMapper = saasVendor?.billingInfo?.expiryDateMap ?? {};
        res?.res?.map((data) => {
          if (data?.expiryDate) {
            licMapper[data?.planName] = formatDateForRenewal(data?.expiryDate);
          }
        });
        dispatch({
          type: SET_SAAS_CLOUD,
          payload: {
            ...globalContext?.saasCloud,
            billingInfo: {
              ...saasVendor?.billingInfo,
              expiryDateMap: licMapper,
            },
          },
        });

        getLicenses();
        fetchSaaSCosting();

        setTimeout(() => {
          setIsUploadInvoice(false);
        }, 3000);
      } else {
        updateInvoiceSteps(4, "CONFLICT", "Failed to save License Details");
        notifyToast("error", "Failed to save License Details");
      }
    } else {
      let res = await saveManuallyIntegration(extractedData);
      if (res?.status === "OK") {
        updateInvoiceSteps(5, "COMPLETED");
        notifyToast("success", "Application Integrated Successfully");
        setTimeout(() => {
          navigate("/Integrations/Manage");
        }, 3000);
      } else {
        updateInvoiceSteps(
          4,
          "CONFLICT",
          res?.res === "Vendor Already Exist"
            ? "Application Already Exist"
            : res?.res
        );
        notifyToast("error", res?.res);
      }
    }
  };

  return (
    <>
      <Popup
        options={{
          isOpen: isUploadInvoice,
          title: isDataExtractionUsingAIComplete
            ? "Preview Invoice Data"
            : `Upload Invoice`,
          subTitle: isDataExtractionUsingAIComplete ? (
            ""
          ) : (
            <span className="cf_powered_by_ai">AI</span>
          ),
          popupWidth: isDataExtractionUsingAIComplete ? "80%" : "600px",
          type: "side",
          popupHeight: "fit-content",
          popupTop: isDataExtractionUsingAIComplete ? "40px" : "80px",
          maxHeight: "100%",
          overflowY: "auto",
          customStyles: {
            borderRadius: "10px",
          },
        }}
        toggleOpen={setIsUploadInvoice}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "10px",
            height: "calc(100% - 50px)",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            flexDirection: "column",
            // gap: "10px",
          }}
        >
          {!isFileUploading ? (
            <ActionButton
              customClass="cf_upload_invoice_container"
              fileType=".pdf"
              sizeLimit="1MB"
              getFileStream={(file) => {
                addVendorWithInvoice(file);
              }}
            >
              <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                <FileText size={20} color="#acacac" />
                <p>Browse to Upload Invoice Supports only .pdf files</p>
              </div>
            </ActionButton>
          ) : (
            ""
          )}

          {isDataExtractionUsingAIComplete ? (
            <div
              className="cf_new_tables_div"
              style={{
                height: "500px",
                overflow: "auto",
              }}
            >
              {saasVendor?.providerName ? (
                ""
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "60px",
                    margin: "10px 0",
                    padding: "0 10px",
                  }}
                  className="CF_d-flex ai-center"
                >
                  <TextInput
                    type="text"
                    autoFocus={true}
                    inputWidth="calc(100% - 0px)"
                    defaultValue={extractedData?.vendor?.externalProviderName}
                    inputName="externalProviderName"
                    placeHolder="Application Name"
                    getInputText={(val) =>
                      setExtractedData({
                        ...extractedData,
                        vendor: {
                          ...extractedData?.vendor,
                          externalProviderName: val,
                        },
                      })
                    }
                  />
                </div>
              )}

              <p
                style={{
                  paddingBottom: "5px",
                  fontSize: "16px",
                  fontWeight: "500",
                  padding: saasVendor?.providerName
                    ? "10px"
                    : "0px 0px 0px 10px",
                }}
              >
                Licenses Details
              </p>
              <table
                style={{ borderTop: "1px solid #e2e8f0", marginTop: "5px" }}
              >
                <thead>
                  <tr>
                    <th style={{ width: "150px", textAlign: "left" }}>
                      Plan Name
                    </th>
                    <th style={{ width: "150px", textAlign: "left" }}>
                      Purchase Price
                    </th>
                    <th style={{ width: "150px", textAlign: "left" }}>
                      Purchase Date
                    </th>
                    <th style={{ width: "150px", textAlign: "left" }}>
                      Expiry Date
                    </th>
                    <th style={{ width: "150px", textAlign: "left" }}>
                      Recurring
                    </th>
                    <th style={{ width: "20px", textAlign: "left" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {extractedData?.subscriptions?.map((data, index) => (
                    <tr key={`${index}_extractedData`}>
                      <td
                        style={{ position: "relative" }}
                        className={
                          selectEdit === `LICENSE_${index}`
                            ? ""
                            : "cf_new_table_hide_text"
                        }
                      >
                        {selectEdit === `LICENSE_${index}` ? (
                          <TextInputUpdate
                            defaultVal={data?.planName}
                            closeAction={() => setSelectEdit("")}
                            saveAction={(value) =>
                              updateExtractedData(index, value, "planName")
                            }
                          />
                        ) : (
                          <div
                            className="CF_d-flex ai-center CF_Pointer"
                            style={{ gap: "5px" }}
                            onClick={() => setSelectEdit(`LICENSE_${index}`)}
                          >
                            <div
                              className="CF_d-flex CF_flex-d-column"
                              style={{ width: "100%" }}
                            >
                              <span
                                className="cf_mapping_email cf_tableEdit_Option"
                                title={data?.planName}
                              >
                                {getMaxChar(data?.planName, 30)}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        style={{ position: "relative" }}
                        className={
                          selectEdit === `PRICE_${index}`
                            ? ""
                            : "cf_new_table_hide_text"
                        }
                      >
                        {selectEdit === `PRICE_${index}` ? (
                          <TextInputUpdate
                            defaultVal={data?.purchasedPrise}
                            closeAction={() => setSelectEdit("")}
                            saveAction={(value) => {
                              value !== ""
                                ? /\d/.test(+value) && +value >= 0
                                  ? updateExtractedData(
                                      index,
                                      +value,
                                      "purchasedPrise"
                                    )
                                  : ""
                                : updateExtractedData(
                                    index,
                                    0,
                                    "purchasedPrise"
                                  );
                            }}
                          />
                        ) : (
                          <div
                            className="CF_d-flex ai-center CF_Pointer"
                            style={{ gap: "5px" }}
                            onClick={() => setSelectEdit(`PRICE_${index}`)}
                          >
                            <div
                              className="CF_d-flex CF_flex-d-column"
                              style={{ width: "100%" }}
                            >
                              <span
                                className="cf_mapping_email cf_tableEdit_Option"
                                title={data?.purchasedPrise}
                              >
                                ${data?.purchasedPrise}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        style={{ position: "relative" }}
                        className="cf_new_table_hide_text"
                      >
                        <span
                          className="cf_mapping_email cf_tableEdit_Option"
                          onClick={(e) =>
                            setChangeChannelDate({
                              purchasedDate: formatDateNew(
                                new Date(data?.purchasedDate).getTime()
                              ),
                              currentIndex: index,
                              licenseId: index,
                              positionX: e.pageX,
                              positionY: 550,
                              id: "purchasedDate",
                            })
                          }
                        >
                          {formatDateNew(
                            new Date(data?.purchasedDate).getTime()
                          )}
                        </span>
                      </td>
                      <td
                        style={{ position: "relative" }}
                        className="cf_new_table_hide_text"
                      >
                        <span
                          className="cf_mapping_email cf_tableEdit_Option"
                          onClick={(e) =>
                            setChangeChannelDate({
                              purchasedDate: formatDateNew(
                                new Date(data?.expiredDate).getTime()
                              ),
                              currentIndex: index,
                              licenseId: index,
                              positionX: e.pageX,
                              positionY: 550,
                              id: "expiredDate",
                            })
                          }
                        >
                          {formatDateNew(new Date(data?.expiredDate).getTime())}
                        </span>
                      </td>
                      <td>
                        <div
                          className={`CF_d-flex ai-center`}
                          style={{ gap: "8px" }}
                        >
                          <span
                            className={`cf_switch_text ${
                              !data?.yearlySubscription
                                ? "cf_switch_active"
                                : ""
                            }`}
                          >
                            Monthly&nbsp;&nbsp;
                          </span>
                          <label className="switch">
                            <input
                              type="checkbox"
                              id="splitChannels"
                              checked={data?.yearlySubscription}
                              onChange={(e) =>
                                updateExtractedData(
                                  index,
                                  e.target.checked,
                                  "yearlySubscription"
                                )
                              }
                            />
                            <span
                              className="slider round"
                              style={{ top: "6px" }}
                            ></span>
                          </label>
                          <span
                            className={`cf_switch_text ${
                              data?.yearlySubscription ? "cf_switch_active" : ""
                            }`}
                          >
                            Yearly
                          </span>
                        </div>
                      </td>
                      <td>
                        <div
                          style={{
                            marginLeft: "auto",
                            padding: "0",
                            width: "30px",
                            height: "30px",
                            justifyContent: "center",
                          }}
                          className="cf_onboard_timer CF_d-flex ai-center CF_Pointer cf_hideforTable"
                          onClick={() => {
                            setExtractedData({
                              ...extractedData,
                              subscriptions:
                                extractedData?.subscriptions?.filter(
                                  (item, i) => i !== index
                                ),
                            });
                          }}
                        >
                          <Trash2 size={14} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : isFileUploading && !isDataExtractionUsingAIComplete ? (
            <div className="cf_upload_invoice_container_info">
              {invoiceSteps?.map((step, index) => {
                {
                  extractedData?.length === 0 && (
                    <tr>
                      <td colSpan={4}>No data found</td>
                    </tr>
                  );
                }
                return (
                  <div
                    className={`cf_upload_invoice_container_info_div ${
                      step?.processStatus === "YET_TO_START"
                        ? "cf_upload_invoice_container_info_div_yet_to_start"
                        : ""
                    }`}
                  >
                    <div
                      className="CF_d-flex ai-center"
                      style={{ gap: "20px", height: "80px" }}
                    >
                      <div>
                        {step?.processStatus === "CONFLICT" ? (
                          <CircleX size={20} color="red" className="CONFLICT" />
                        ) : step?.processStatus === "IN_PROGRESS" ? (
                          <Sparkles
                            className="cf_agentShine"
                            size={24}
                            strokeWidth={1.5}
                          />
                        ) : step?.processStatus === "COMPLETED" ? (
                          <FaRegCheckCircle className="PROCESSED cf_onBoardingCompleted" />
                        ) : (
                          <Clock size={20} color="#acacac" />
                        )}
                      </div>
                      <div
                        className="CF_d-flex"
                        style={{ flexDirection: "column" }}
                      >
                        <p className="cf_upload_invoice_container_info_div_title">
                          {step?.title}
                        </p>
                        <span className="cf_upload_invoice_container_info_div_subtitle">
                          {step?.subtitle}
                        </span>
                      </div>
                    </div>
                    <div
                      className="CF_d-flex ai-center"
                      style={{ height: "80px" }}
                    >
                      <p
                        className={`cf_upload_invoice_container_info_status ${
                          step?.processStatus === "CONFLICT"
                            ? "cf_Invoice_Conflict"
                            : step?.processStatus === "IN_PROGRESS"
                            ? "cf_Invoice_InProgress"
                            : step?.processStatus === "COMPLETED"
                            ? "cf_Invoice_Completed"
                            : "cf_Invoice_Pending"
                        }`}
                      >
                        {step?.processStatus === "CONFLICT"
                          ? "Conflict"
                          : step?.processStatus === "IN_PROGRESS"
                          ? "In Progress"
                          : step?.processStatus === "COMPLETED"
                          ? "Completed"
                          : "Yet to Start"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            ""
          )}
        </div>
        {isDataExtractionUsingAIComplete ? (
          <div className="cf_popup_container_footer">
            <ButtonComponent
              customstyles={{ marginLeft: "auto" }}
              inputWidth="100px"
              isLoading={false}
              isDisabled={!extractedData?.vendor?.externalProviderName}
              buttonName="Save"
              buttonClickAction={() => handleSaveData()}
            />
          </div>
        ) : (
          ""
        )}
      </Popup>
      {changeChannelDate?.purchasedDate ? (
        <CustomCalendar
          customDate={changeChannelDate?.purchasedDate}
          closeDate={setChangeChannelDate}
          customData={changeChannelDate}
          applyChangeDate={handleChangeDate}
          isDisabled={false}
        />
      ) : (
        ""
      )}
    </>
  );
};
