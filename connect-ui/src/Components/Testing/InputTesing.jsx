import React from "react";

const InputTesing = () => {
  let com = [
    {
      name: "Name",
      type: "text",
      required: "true",
    },
    {
      name: "Name",
      type: "checkbox",
      required: "true",
    },
    {
      name: "Name",
      type: "radio",
      required: "true",
    },
  ];
  return (
    <div>
      {com?.map((data) => {
        return <input type={data?.type} />;
      })}
    </div>
  );
};

export default InputTesing;
