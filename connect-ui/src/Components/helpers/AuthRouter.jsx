import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";

const AuthRouter = () => {
  const navigate = useNavigate();

  const currentRole = localStorage?.globalState
    ? JSON.parse(localStorage?.globalState)?.user
    : "";

  useEffect(() => {
    if (!currentRole) {
      navigate("/");
    }
  }, [currentRole]);

  if (currentRole) {
    return <Outlet />;
  }

  return null;
};

export default AuthRouter;
