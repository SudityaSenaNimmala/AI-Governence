import React, { useEffect } from "react";
import { ImSpinner8 } from "react-icons/im";

const ButtonComponent = (props) => {
  const handleClick = () => {
    if (typeof props?.buttonClickAction === "function") {
      props?.buttonClickAction();
    }
  };

  // useEffect(() => {
  //   if (!props?.isDisabled) {
  //     const handleKeyDown = (event) => {
  //       if (event.key === "Enter") {
  //         handleClick();
  //       }
  //     };
  //     window.addEventListener("keydown", handleKeyDown);
  //     return () => window.removeEventListener("keydown", handleKeyDown);
  //   }
  // }, [props?.isDisabled]);

  return (
    <button
      style={{ width: props?.inputWidth ?? "300px", ...props?.customstyles }}
      className={`cf_button ${props?.isDisabled ? "cf_button_disabled" : ""}`}
      onClick={handleClick}
      disabled={props?.isDisabled || false}
    >
      {props?.isLoading ? (
        <div className="cf_button_loader">
          <ImSpinner8 className="cf_animate_spinner" />
        </div>
      ) : (
        <>
          {props?.children ?? ""}
          {props?.buttonName ?? ""}
        </>
      )}
    </button>
  );
};

export default ButtonComponent;
