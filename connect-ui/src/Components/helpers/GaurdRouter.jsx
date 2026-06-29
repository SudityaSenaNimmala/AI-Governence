import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";

const GuardRouter = ({ roles }) => {
  const navigate = useNavigate();

  const currentRole = localStorage?.globalState
    ? JSON.parse(localStorage?.globalState)?.user?.roles
      ? JSON.parse(localStorage?.globalState)?.user?.roles[0]?.name
      : ""
    : "";

  useEffect(() => {
    if (!roles.includes(currentRole)) {
      navigate(-1);
    }
  }, [roles, currentRole, navigate]);

  if (roles.includes(currentRole)) {
    return <Outlet />;
  }

  return null;
};

export default GuardRouter;
