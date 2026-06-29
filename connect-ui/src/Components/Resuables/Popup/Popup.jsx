import React, { useEffect, useState } from "react";
import "./css/Popup.css";
import { IoClose } from "react-icons/io5";
import ReactDOM from "react-dom";
const Popup = (props) => {
  let {
    isOpen,
    title,
    subTitle,
    popupWidth,
    popupHeight,
    popupTop,
    toggleOpen,
    customStyles,
    parentStyles,
    type,
    oTitle,
    titleCustomStyles,
    titleStyle,
    titleDivStyles,
    disableEscapeKey = false,
  } = {
    ...props?.options,
  };
  const [isVisible, setIsVisible] = useState(isOpen ?? false);
  useEffect(() => {
    setIsVisible(isOpen === "" ? false : isOpen);
  }, [isOpen]);

  const handleClose = () => {
    props.toggleOpen("");
    setIsVisible(false);
  };

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && isVisible && !disableEscapeKey) {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleEscapeKey);
    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isVisible]);

  const popupRoot =
    typeof document !== "undefined" ? document.getElementById("popup-root") : null;
  if (!popupRoot) {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      className={isVisible ? "cf_popup_main_container" : "cf_d-none"}
      style={{ ...(parentStyles ?? {}) }}
    >
      <div
        className={
          type === "side" || titleStyle === "LIGHT"
            ? `cf_popup_container_side`
            : `cf_popup_container`
        }
        style={{
          width: popupWidth ?? "300px",
          height: popupHeight ?? "150px",
          //   maxHeight: "450px",
          marginTop: popupTop ?? "0px",
          ...customStyles,
        }}
      >
        <div
          className={
            type === "side"
              ? `cf_popup_container_side_title`
              : titleStyle === "LIGHT"
                ? `cf_popup_container_title_light cf_popup_container_title`
                : `cf_popup_container_title`
          }
          style={{ ...titleDivStyles }}
        >
          <h3
            title={oTitle ? oTitle : title ?? "Title"}
            style={{
              ...titleCustomStyles,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <>
              {title ?? "Title"}
              {subTitle ?? ""}
            </>
          </h3>
          {props?.closeContent ? (
            <p>{props?.closeContent}</p>
          ) : (
            <div
              onClick={() => handleClose(false)}
              style={{ marginLeft: "auto", ...titleCustomStyles }}
            >
              <IoClose />
            </div>
          )}
        </div>
        {props?.children}
      </div>
    </div>,
    popupRoot
  );
};

export default Popup;
