import React, { useEffect, useState } from "react";
import "./css/InputComponents.css";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { copyToClipboard } from "../../helpers/utils";

const TextInput = (props) => {
  const [isCopied, setIsCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [inputValue, setInputValue] = useState(
    props?.isLableRequired ? props?.placeHolder : ""
  );

  const isPassword = props?.type === "password";
  const resolvedType = isPassword ? (showPassword ? "text" : "password") : props?.type;

  const handleChange = (e) => {
    setInputValue(e.target.value);
    props?.getInputText(e.target.value, e.target.name);
  };

  useEffect(() => {
    if (isCopied) {
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    }
  }, [isCopied]);

  return (
    <div
      className="cf_input_placer"
      style={{
        width: props?.inputWidth ?? "300px",
      }}
    >
      {props?.readOnly ? (
        <input
          type={resolvedType}
          name={props?.inputName}
          className={`cf_textInput ${props?.errorData ? "error_cf_textInput" : ""
            }`}
          id={props?.placeHolder}
          value={props?.defaultValue ?? inputValue}
          onChange={handleChange}
          autoFocus={props?.autoFocus}
          placeholder={props?.isLableRequired ? props?.placeHolder : ""}
          autoComplete="off"
          style={{
            width: props?.textInputWidth ?? "100%",
            height: props?.inputHeight ?? "40px",
            fontSize: props?.inputFontSize ?? "14px",
            padding: props?.copyToClipboard ? "0px 45px 0 10px" : "0 10px",
          }}
          readOnly
          disabled
        />
      ) : (
        <input
          type={resolvedType}
          name={props?.inputName}
          className={`cf_textInput ${props?.errorData ? "error_cf_textInput" : ""
            }`}
          id={props?.placeHolder}
          value={props?.defaultValue ?? inputValue}
          onChange={handleChange}
          autoFocus={props?.autoFocus}
          placeholder={props?.isLableRequired ? props?.placeHolder : ""}
          autoComplete="off"
          style={{
            width: props?.textInputWidth ?? "100%",
            height: props?.inputHeight ?? "40px",
            fontSize: props?.inputFontSize ?? "14px",
            paddingRight: isPassword ? "40px" : undefined,
          }}
        />
      )}
      {isPassword && (
        <div
          onClick={() => setShowPassword((prev) => !prev)}
          style={{
            position: "absolute",
            right: "10px",
            top: props?.errorData ? "30%" : "50%",
            transform: "translateY(-50%)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            color: "#888",
          }}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </div>
      )}
      {!props?.isLableRequired ? (
        <label htmlFor={props?.placeHolder} className="cf_input_lable">
          {props?.placeHolder}
        </label>
      ) : (
        ""
      )}
      {props?.errorData ? (
        <span className="errorText">{props?.errorData}</span>
      ) : (
        ""
      )}
      {props?.copyToClipboard && (
        <div
          className="cf_copy_button"
          onClick={() => {
            copyToClipboard(
              props?.defaultValue ?? inputValue,
              props?.copyButtonText
            );
            setIsCopied(true);
          }}
          style={{
            height: `calc(${props?.inputHeight ?? "40px"} - 2px)`,
          }}
        >
          {isCopied ? <Check size={16} color="green" /> : <Copy size={16} />}
        </div>
      )}
    </div>
  );
};

export default TextInput;
