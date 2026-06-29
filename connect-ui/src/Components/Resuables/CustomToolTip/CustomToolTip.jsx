import React, { useState } from "react";
import "./css/CustomToolTip.css";

const CustomToolTip = (props) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({});
  const handleMouseEnter = (e) => {
    let position = e.target.getBoundingClientRect();

    let cpyPosition = {
      top: position.top,
      left: position.left,
      right: position.right,
      bottom: position.bottom,
      width: position.width,
      height: position.height,
    };
    if (window.innerHeight - cpyPosition.bottom < 50) {
      cpyPosition.top = cpyPosition.top - 20;
    }
    if (window.innerWidth - cpyPosition.right < 50) {
      cpyPosition.left = cpyPosition.left - 100;
    }

    setPosition(cpyPosition);
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  return (
    <>
      <div
        className="cf_tooltip-container CF_Pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {props?.children}
      </div>
      {isVisible && (
        <div
          className="cf_tooltip-popup"
          style={{
            fontSize: "12px",
            top: `${position?.top + position?.height}px`,
            maxWidth: props?.customWidthValue
              ? props?.customWidthValue
              : props?.customWidth
              ? `${position?.width + 50}px`
              : "300px",
          }}
        >
          {props?.title}
        </div>
      )}
    </>
  );
};
export default CustomToolTip;
