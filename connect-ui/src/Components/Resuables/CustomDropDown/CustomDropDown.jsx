import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaCircleCheck } from "react-icons/fa6";

import "./css/CustomDropDown.css";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
const CustomDropDown = (props) => {
  const [dropDownList, setDropDownList] = useState([]);
  const [dropDownOpen, setDropDownOpen] = useState(false);
  const [activeDropDown, setActiveDropDown] = useState({});
  const selectDownRef = useRef(null);
  const matchKey = props?.matchKey || "key";
  useEffect(() => {
    setDropDownList(props?.dropDownList);
    // setActiveDropDown(props?.dropDownList[0]);
  }, [props?.dropDownList]);

  useEffect(() => {
    setActiveDropDown(props?.defaultVal);
  }, [props?.defaultVal]);

  const updateFilter = (e, data) => {
    e.stopPropagation();
    props?.selectFilter(data);
    setActiveDropDown(data);
    setDropDownOpen(false);
  };

  const handleClickOutside = (event) => {
    if (
      selectDownRef.current &&
      !selectDownRef.current.contains(event.target)
    ) {
      setDropDownOpen(false);
    }
  };

  useEffect(() => {
    if (dropDownOpen) {
      document.addEventListener("click", handleClickOutside);
    } else {
      document.removeEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [dropDownOpen]);

  return (
    <div
      className="cf_dropdown_contatiner"
      onClick={() => setDropDownOpen(true)}
      ref={selectDownRef}
      style={{ lineHeight: 0 }}
    >
      {props?.children ?? ""}
      {dropDownOpen ? (
        <div
          className="cf_dropdown_contatiner_content"
          style={{ ...props?.customDropDownStyles }}
        >
          {dropDownList?.map((data) => {
            return (
              <div key={data?.key} onClick={(e) => updateFilter(e, data)}>
                {activeDropDown?.[matchKey] === data?.[matchKey] ? (
                  <FaCircleCheck />
                ) : (
                  <FaCircleCheck style={{ visibility: "hidden" }} />
                )}
                {props?.isCloudsList && data?.key !== "ALL" ? (
                  <img
                    src={cloudImageMapper(data?.key)}
                    alt="cloud"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  ""
                )}
                <span>
                  {getCloudName(data?.value) === "all"
                    ? "All"
                    : getCloudName(data?.value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        ""
      )}
    </div>
  );
};

export default CustomDropDown;
