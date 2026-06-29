import { useNavigate } from "react-router-dom";
import { notifyToast } from "../../../helpers/utils";
import Popup from "../../../Resuables/Popup/Popup";
import { saveVendorWithInvoice } from "../../Oauth/OauthActions/OauthApiActions";
import { CircleX, Clock, FileText, Sparkles, Clipboard } from "lucide-react";
import { FaRegCheckCircle } from "react-icons/fa";
import { useEffect, useState, useRef } from "react";
import { getDownloadStatus } from "../../SaaSManagement/SaaSActions/SaaSActions";

export const InVoiceFileUpload = ({ isUploadInvoice, setIsUploadInvoice }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [isFileUploading, setIsFileUploading] = useState(false);

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
      title: "Saving Data",
      subtitle: "Invoice data is being saved to the database",
      processStatus: "YET_TO_START",
    },
    {
      stepIndex: 4,
      title: "Processing Complete",
      subtitle: "Invoice data has been successfully extracted and structured",
      processStatus: "YET_TO_START",
    },
  ]);

  useEffect(() => {
    setIsFileUploading(false);
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
        title: "Saving Data",
        subtitle: "Invoice data is being saved to the database",
        processStatus: "YET_TO_START",
      },
      {
        stepIndex: 4,
        title: "Processing Complete",
        subtitle: "Invoice data has been successfully extracted and structured",
        processStatus: "YET_TO_START",
      },
    ]);
  }, [isUploadInvoice]);

  useEffect(() => {
    const handlePaste = async (e) => {
      if (!isUploadInvoice || isFileUploading) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            // Convert blob to File object
            const file = new File([blob], `pasted-image-${Date.now()}.png`, {
              type: blob.type,
            });
            handleFileUpload(file);
          }
          break;
        }
      }
    };

    if (isUploadInvoice) {
      window.addEventListener("paste", handlePaste);
      return () => {
        window.removeEventListener("paste", handlePaste);
      };
    }
  }, [isUploadInvoice, isFileUploading]);

  const handleFileUpload = (file) => {
    if (!file) return;

    // Validate file type
    const validImageTypes = ["image/jpeg", "image/jpg", "image/png"];
    const validPdfTypes = ["application/pdf"];
    const validExtensions = [".pdf", ".jpg", ".jpeg", ".png"];

    const fileExtension = file.name
      ?.toLowerCase()
      .substring(file.name.lastIndexOf("."));
    const isValidType =
      validImageTypes.includes(file.type) ||
      validPdfTypes.includes(file.type) ||
      validExtensions.includes(fileExtension);

    if (!isValidType) {
      notifyToast(
        "error",
        "Invalid file type. Please upload PDF or image files (JPG, JPEG, PNG)"
      );
      return;
    }

    // Validate file size (5MB limit for images, 1MB for PDF)
    const isPdf =
      file.type === "application/pdf" ||
      fileExtension === ".pdf" ||
      file.name?.toLowerCase().endsWith(".pdf");
    const maxSize = isPdf ? 1 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const sizeLimit = isPdf ? "1MB" : "5MB";
      notifyToast(
        "error",
        `File size exceeds limit. Maximum size: ${sizeLimit}`
      );
      return;
    }

    addVendorWithInvoice(file);
  };

  const addVendorWithInvoice = async (file) => {
    setIsFileUploading(true);
    let res = await saveVendorWithInvoice(file);
    if (res.status === "OK") {
      updateInvoiceSteps(0, "COMPLETED");
      updateInvoiceSteps(1, "IN_PROGRESS");
      //   setInvoiceUploadStatus(res?.res);
      startStatusCheck(res?.res?.userId);
    } else {
      updateInvoiceSteps(0, "CONFLICT");
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith("image/")) {
            const blob = await clipboardItem.getType(type);
            const file = new File(
              [blob],
              `pasted-image-${Date.now()}.${type.split("/")[1]}`,
              {
                type: type,
              }
            );
            handleFileUpload(file);
            return;
          }
        }
      }
      notifyToast("warn", "No image found in clipboard");
    } catch (error) {
      notifyToast(
        "error",
        "Failed to read from clipboard. Please ensure you have copied an image."
      );
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
      } else if (res?.res?.status === "PROCESSED") {
        updateInvoiceSteps(4, "COMPLETED");
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

      if (res?.res?.status !== "FAILED" && res?.res?.status !== "PROCESSED") {
        setTimeout(() => {
          startStatusCheck(userId);
        }, 2000);
      }
    } else {
      retryCount++;
      if (retryCount < 3) {
        setTimeout(() => {
          startStatusCheck(userId);
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

  return (
    <Popup
      options={{
        isOpen: isUploadInvoice,
        title: `Upload Invoice`,
        subTitle: <span className="cf_powered_by_ai">AI</span>,
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              width: "100%",
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,image/jpg,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileUpload(file);
                }
                e.target.value = ""; // Reset input
              }}
              style={{
                display: "none",
              }}
            />
            <div
              className="cf_upload_invoice_container"
              onClick={() => fileInputRef.current?.click()}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px",
                border: "1px dashed #e2e8f0",
                borderRadius: "8px",
                backgroundColor: "#f8f9fa",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f1f5f9";
                e.currentTarget.style.borderColor = "#cbd5e1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#f8f9fa";
                e.currentTarget.style.borderColor = "#e2e8f0";
              }}
            >
              <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                <FileText size={20} color="#acacac" />
                <p>Browse to Upload Invoice (PDF, JPG, PNG)</p>
              </div>
            </div>
            <div
              className="cf_upload_invoice_container"
              onClick={handlePasteFromClipboard}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                backgroundColor: "#f8f9fa",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f1f5f9";
                e.currentTarget.style.borderColor = "#cbd5e1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#f8f9fa";
                e.currentTarget.style.borderColor = "#e2e8f0";
              }}
            >
              <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                <Clipboard size={20} color="#64748b" />
                <p>Paste from Clipboard</p>
              </div>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "#64748b",
                marginTop: "5px",
                textAlign: "center",
              }}
            >
              Or press Ctrl+V (Cmd+V on Mac) to paste an image
            </p>
          </div>
        ) : (
          ""
        )}

        {isFileUploading ? (
          <div className="cf_upload_invoice_container_info">
            {invoiceSteps?.map((step, index) => {
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
    </Popup>
  );
};
