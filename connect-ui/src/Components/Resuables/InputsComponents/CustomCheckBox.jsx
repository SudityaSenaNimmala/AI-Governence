import React, { useEffect, useState } from "react";

const CustomCheckBox = (props) => {
  const [isChecked, setIsChecked] = useState(false);
  const [isCheckDisabled, setIsCheckDisabled] = useState(false);
  let {
    name,
    customId,
    labelTitle,
    customStyles,
    defaultChecked,
    isDisabled,
    handleChange,
  } = {
    ...props,
  };

  useEffect(() => {
    setIsChecked(defaultChecked);
  }, [defaultChecked]);

  useEffect(() => {
    setIsCheckDisabled(isDisabled);
  }, [isDisabled]);

  const handleInputChange = (e) => {
    setIsChecked(e.target.checked);
    handleChange(e.target.checked);
  };

  return (
    <>
      <input
        type="checkbox"
        style={{ ...customStyles }}
        className="cf_customCheckBox"
        name={name || `inputCheck`}
        id={customId || `defaultId`}
        checked={isChecked}
        disabled={isCheckDisabled}
        onChange={handleInputChange}
      />
      {labelTitle ? (
        <label htmlFor={customId || `defaultId`}>{labelTitle}</label>
      ) : (
        ""
      )}
    </>
  );
};

export default CustomCheckBox;
