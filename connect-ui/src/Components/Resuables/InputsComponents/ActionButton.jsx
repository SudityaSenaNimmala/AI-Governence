import React, { useRef } from "react";
import { notifyToast } from "../../helpers/utils";
const ActionButton = (props) => {
  const fileUploadRef = useRef(null);
  const handleCSVUpload = () => {
    fileUploadRef.current.value = "";
    fileUploadRef.current.click();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (props?.sizeLimit) {
      let sizeLimit = props?.sizeLimit.split("MB")[0];
      sizeLimit = +sizeLimit * 1024 * 1024;
      if (file?.size > sizeLimit) {
        notifyToast("warn", `Only Accepts files less than ${props?.sizeLimit}`);
        return;
      }
    }

    if (props?.fileType === ".zip") {
      if (!file?.name?.toLowerCase()?.endsWith(".zip")) {
        notifyToast("warn", "Invalid File Uploaded, Only Accepts ZIP Format");
        return;
      }
    } else if (props?.fileType === ".pdf") {
      if (!file?.name?.toLowerCase()?.endsWith(".pdf")) {
        notifyToast("warn", "Invalid File Uploaded, Only Accepts PDF Format");
        return;
      }
    } else {
      if (props?.fileType) {
        if (!file?.name?.toLowerCase()?.endsWith(props?.fileType)) {
          notifyToast("warn", `Invalid File Uploaded, Only Accepts ${props?.fileType} Format`);
          return;
        }
      } else if (!file?.name?.toLowerCase()?.endsWith(".csv")) {
        notifyToast("warn", "Invalid File Uploaded, Only Accepts CSV Format");
        return;
      }
    }
    var reader = new FileReader();

    reader.onload = async () => {
      props?.getFileStream(file);
    };
    reader.readAsText(file);
  };

  return (
    <>
      {props?.buttonType !== "button" ? (
        <input
          type="file"
          accept={props?.fileType ? props?.fileType : ".csv"}
          ref={fileUploadRef}
          onChange={(e) => handleFileUpload(e)}
          style={{
            visibility: "hidden",
            width: "0",
            height: "0",
            position: "absolute",
          }}
        />
      ) : (
        ""
      )}
      <button
        ref={props?.customRef ?? null}
        onClick={() =>
          props?.buttonType === "button"
            ? props?.buttonClickAction()
            : handleCSVUpload()
        }
        style={{ ...props?.customStyles }}
        disabled={props?.isDisabled ? `disabled` : ""}
        className={`cf_action_button ${props?.customClass}`}
        title={props?.title ?? ""}
      >
        {props?.children}
      </button>
    </>
  );
};

export default ActionButton;
