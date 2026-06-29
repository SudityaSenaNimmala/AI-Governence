import React, { useEffect, useState } from "react";
import { getRandomColor } from "../helpers/utils";

const SvgName = ({ name, type = "circle" }) => {
  const [colorCode, setColorCode] = useState("");
  const initials = name
    ?.split(" ")
    ?.slice(0, 2)
    ?.map((word) => word.charAt(0).toUpperCase())
    ?.join("");

  useEffect(() => {
    setColorCode(getRandomColor());
  }, []);

  return (
    <svg
      width={type === "circle" ? "40" : "80"}
      height={type === "circle" ? "40" : "80"}
      viewBox="0 0 100 100"
      style={{ borderRadius: type === "circle" ? "" : "10px" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {type === "circle" && <circle cx="50" cy="50" r="45" fill={colorCode} />}
      {type === "square" && (
        <rect
          x="0"
          y="0"
          width="100"
          height="100"
          fill={colorCode}
          style={{ borderRadius: "10px" }}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        fill="white"
        fontSize={type === "circle" ? "36" : "40"}
        dy=".4em"
        style={{
          fontWeight: "500",
        }}
      >
        {initials}
      </text>
    </svg>
  );
};

export default SvgName;
