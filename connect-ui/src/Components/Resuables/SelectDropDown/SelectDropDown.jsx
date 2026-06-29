import React, { useRef, useState, useEffect } from "react";
import { FaCaretDown } from "react-icons/fa6";
import { getCloudName } from "../../helpers/helpers";

const SelectDropDown = (props) => {
  const [inputValue, setInputValue] = useState("");
  const selectDownRef = useRef(null);
  const [dropDownFocus, setDropDownFocus] = useState(false);
  const [selectedDropDownValue, setSelectedDropDownValue] = useState(
    props?.defaultSelected ?? ""
  );

  const handleChange = (e) => {
    setInputValue(e.target.value);
  };

  useEffect(() => {
    if (
      props?.defaultSelected &&
      Object.keys(props?.defaultSelected).length > 0
    ) {
      setInputValue(" ");
      setSelectedDropDownValue(props?.defaultSelected);
    }
  }, [props?.defaultSelected]);

  const toggleDropDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropDownFocus((open) => !open);
  };

  const selectDropDownElement = (data, action) => {
    if (action === "SELECTED") {
      setDropDownFocus(true);
    } else {
      setDropDownFocus(false);
    }
    setInputValue("  ");
    props?.onSelect(data);
    setSelectedDropDownValue(data);
  };

  const handleClickOutside = (event) => {
    if (
      selectDownRef.current &&
      !selectDownRef.current.contains(event.target)
    ) {
      setDropDownFocus(false);
    }
  };

  useEffect(() => {
    if (dropDownFocus) {
      document.addEventListener("click", handleClickOutside);
    } else {
      document.removeEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [dropDownFocus]);

  return (
    <>
      <div
        className="cf_input_placer"
        ref={selectDownRef}
        style={{ ...props?.customDivStyles }}
      >
        <input
          style={{ width: props?.inputWidth ?? "100%", ...props?.customstyles }}
          type={props?.type ?? "Text"}
          name={props?.inputName ?? ""}
          className="cf_textInput"
          id={props?.placeHolder ?? "Text"}
          value={inputValue}
          onFocus={() => setDropDownFocus(true)}
          onChange={handleChange}
          // onBlur={() => setDropDownFocus(false)}
          autoFocus={false}
          autoComplete="off"
          readOnly
        />
        <label
          htmlFor={props?.placeHolder ?? "Text"}
          className="cf_input_lable"
        >
          {props?.placeHolder ?? "Text"}
        </label>
        <div
          className="cf_place_create_drop_down"
          role="button"
          tabIndex={0}
          aria-expanded={dropDownFocus}
          onMouseDown={toggleDropDown}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setDropDownFocus((open) => !open);
            }
          }}
        >
          <FaCaretDown />
        </div>
        {selectedDropDownValue && selectedDropDownValue !== " " ? (
          <div
            className="cf_dropDown_content_selected"
            onClick={() =>
              selectDropDownElement(selectedDropDownValue, "SELECTED")
            }
          >
            {selectedDropDownValue?.imageSrc ? (
              <img
                src={selectedDropDownValue?.imageSrc}
                alt="ONEDRIVE_BUSINESS_ADMIN"
              />
            ) : (
              ""
            )}
            <p style={{ ...props?.customTextFont }}>
              {props?.customObjectName
                ? getCloudName(selectedDropDownValue[props?.customObjectName])
                : selectedDropDownValue?.displayName ??
                  selectedDropDownValue?.name}
              {selectedDropDownValue?.cloudName === "SLACK" ? (
                <span style={{ fontSize: "12px", fontWeight: "500" }}>
                  ({selectedDropDownValue?.metadataUrl})
                </span>
              ) : (
                ""
              )}
            </p>
          </div>
        ) : (
          ""
        )}
        {props?.dropDownContent ? (
          <div
            className={`cf_dropDown_content ${
              dropDownFocus ? "" : "cf_d-none"
            }`}
            style={{
              maxHeight: props?.inputMaxHeight ?? `300px`,
              ...props?.dropDownContentStyles,
            }}
          >
            {props?.dropDownContent?.map((data, index) => {
              return (
                <div
                  key={index}
                  className={`${
                    data?.isDisabled ? "cf_disabled" : ""
                  } cf_dropDown_content_selector red`}
                  onClick={() => selectDropDownElement(data)}
                >
                  {data?.imageSrc ? (
                    <img src={data?.imageSrc} alt="ONEDRIVE_BUSINESS_ADMIN" />
                  ) : (
                    ""
                  )}
                  <p>
                    {props?.customObjectName
                      ? getCloudName(data[props?.customObjectName])
                      : data?.displayName ?? data?.name}{" "}
                    {data?.cloudName === "SLACK" ? (
                      <span style={{ fontSize: "12px", fontWeight: "500" }}>
                        ({data?.metadataUrl})
                      </span>
                    ) : (
                      ""
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          ""
        )}
        {props?.errorData ? (
          <span className="errorText">{props?.errorData}</span>
        ) : (
          ""
        )}
      </div>
    </>
  );
};

export default SelectDropDown;
