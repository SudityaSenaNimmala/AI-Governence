import React, { useEffect, useState } from "react";
import TextInput from "./TextInput";
import { FiCheck } from "react-icons/fi";
import { LiaTimesSolid } from "react-icons/lia";

const TextInputUpdate = (props) => {
  const [textVal, setTextVal] = useState("");
  useEffect(() => {
    if (props?.defaultVal) {
      setTextVal(props?.defaultVal);
    }
  }, [props?.defaultVal]);

  const grabText = (val) => {
    setTextVal(val);
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      props?.saveAction(textVal);
    } else if (e.key === "Escape") {
      props?.closeAction();
    }
  };
  return (
    <div className="cf_text_input">
      <div className="cf_input_placer">
        <input
          type={props?.inputType || "text"}
          name={props?.inputName}
          className={`cf_textInput`}
          value={textVal}
          onChange={(e) => grabText(e.target.value)}
          autoFocus={true}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{
            width: props?.inputWidth ?? "300px",
            height: props?.inputHeight ?? "30px",
            fontSize: props?.inputFontSize ?? "14px",
          }}
        />
      </div>
      <div
        className="cf_input_cta"
        style={{
          right: "35px",
          ...(props?.customActionStyles
            ? { ...props?.customActionStyles }
            : {}),
        }}
        onClick={() => props?.closeAction()}
      >
        <LiaTimesSolid />
      </div>
      <div
        className="cf_input_cta"
        onClick={() => props?.saveAction(textVal)}
        style={{
          ...(props?.customActionStyles
            ? { ...props?.customActionStyles }
            : {}),
        }}
      >
        <FiCheck />
      </div>
    </div>
  );
};

export default TextInputUpdate;
