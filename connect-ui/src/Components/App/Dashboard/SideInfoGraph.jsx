import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { getCloudName } from "../../helpers/helpers";
import { getTeamsGroupsSummary } from "./DashboardActions/DashboardActions";
import { getAppsSummary } from "./DashboardActions/DashboardActions";
import { SET_CLOUDS_LIST } from "../../../GlobalContext/action.types";
import { getCloudsList } from "../../helpers/utils";

const SideInfoGraph = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [graphData, setGraphData] = useState([]);

  const fetchData = async () => {
    let clouds = await getCloudsList();

    if (clouds?.res?.length > 0) {
      let updatedData = clouds?.res?.map((data) => {
        let newData = {
          ...data,
          name: getCloudName(data?.cloudName ?? data?.providerName),
          "Total Users": data?.usersCount ?? data?.totolClouds ?? 0,
          "Active Users": data?.activeUsers ?? data?.provisionedClouds ?? 0,
          "In Active Users": data?.inActiveUSers ?? data?.notProvisioned ?? 0,
          "Total Groups": 0,
          "Total Resource Apps": 0,
        };
        return newData;
      });

      const fetchTeamsGroupsAndAppsInfo = async () => {
        const promises = updatedData.map(async (data) => {
          if (data?.memberId && data?.providerName) {
            const teamsGroupsPromise = getTeamsGroupsSummary(
              data?.memberId,
              data?.providerName
            );
            const appsInfoPromise = getAppsSummary(
              data?.memberId,
              data?.providerName
            );
            const [teamsGroupsRes, appsInfoRes] = await Promise.all([
              teamsGroupsPromise,
              appsInfoPromise,
            ]);

            if (teamsGroupsRes?.status === "OK") {
              data["Total Groups"] = teamsGroupsRes?.res[0]?.count || 0;
            }
            if (appsInfoRes?.status === "OK") {
              data["Total Resource Apps"] = appsInfoRes?.res[0]?.count || 0;
            }
          }
        });

        await Promise.all(promises);
        dispatch({
          type: SET_CLOUDS_LIST,
          payload: updatedData,
        });
        let newGraphData = [];
        updatedData?.map((data) => {
          return data?.providerName ? newGraphData?.push(data) : "";
        });
        setGraphData(newGraphData);
      };

      fetchTeamsGroupsAndAppsInfo();
    }
  };
  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="cf_sideInfo_graph_container">
      <div className="cf_sideInfo_graph_container_holder">
        <div className="cf_sideInfo_graph_container_title">
          <h2>SaaS Apps Summary</h2>
        </div>
        <div className="cf_sideInfo_graph_container_body">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              width={500}
              height={300}
              data={graphData}
              margin={{
                top: 20,
                right: 30,
                left: 20,
                bottom: 5,
              }}
            >
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Total Users" fill="#001a6f" />
              <Bar dataKey="Active Users" stackId="a" fill="#0062ff" />
              <Bar dataKey="In Active Users" stackId="a" fill="#AFDBF5" />
              <Bar dataKey="Total Groups" stackId="b" fill="#0096FF" />
              <Bar dataKey="Total Resource Apps" stackId="b" fill="#6F8FAF" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default SideInfoGraph;
