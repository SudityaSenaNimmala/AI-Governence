import React, { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { formatCurrencyShort, getRandomColor } from "../../helpers/utils";
import "./css/Calendar.css";
import { RESET_APP_CONTEXT } from "../../../GlobalContext/action.types";

const ReCalendar = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { calenderData } = globalContext?.billingSummary || {};

  const [calendarMonths] = useState([
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ]);
  const [calendarConfiguration, setCalendarConfiguration] = useState({});

  const makeCalendarConfiguration = () => {
    if (calenderData && !Array.isArray(calenderData)) {
      dispatch({
        type: RESET_APP_CONTEXT,
        payload: "",
      });
      setTimeout(() => {
        localStorage.clear();
        navigation("/#login");
      }, 500);
      return;
    }
    let month = new Date().getMonth();
    let year = new Date().getFullYear();
    let newMap = {};
    let renewalDates = calenderData || [];
    if (renewalDates?.length === 0) {
      return;
    }
    for (let i = 0; i < 12; i++) {
      let monthName = calendarMonths[month];
      let startDate = new Date(year, month, 1).getTime();
      let endDate = new Date(year, month + 1, 1).getTime();
      let renewalDatesList = renewalDates?.filter(
        (date) => date?.renewalDate >= startDate && date?.renewalDate < endDate
      );
      if (renewalDatesList?.length > 0) {
        newMap[i] = {
          year: year,
          month: monthName,
          startDate: startDate,
          endDate: endDate,
          renewalDates: renewalDatesList
            ?.sort((a, b) => a?.renewalDate - b?.renewalDate)
            ?.reduce((acc, date) => {
              if (acc?.find((d) => d?.adminCloudId === date?.adminCloudId)) {
              } else {
                acc.push({
                  ...date,
                  date: date?.renewalDate,
                  vendor: date?.vendorName,
                });
              }
              return acc;
            }, []),
        };
      }
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
    setCalendarConfiguration(newMap);
  };

  useEffect(() => {
    makeCalendarConfiguration();
  }, [calenderData]);

  return (
    <div
      className="cf_ReCalendar_container"
      style={{
        gridTemplateColumns: `repeat(${
          Object.values(calendarConfiguration)?.length > 4
            ? 3
            : Object.values(calendarConfiguration)?.length === 4
            ? 2
            : 1
        }, minmax(0, 1fr))`,
      }}
    >
      {Object.values(calendarConfiguration)?.length === 0 && (
        <div
          className="cf_ReCalendar_container_item_body_item"
          style={{
            backgroundColor: getRandomColor("dull"),
            textAlign: "center",
          }}
        >
          <p style={{ textAlign: "center", width: "100%" }}>
            No Renewals Found
          </p>
        </div>
      )}
      {Object.values(calendarConfiguration)?.map((item, index) => {
        return (
          <div
            className="cf_new_dashboard_info_pannel cf_ReCalendar_container_item"
            key={`${index}_RENEWAL_CALENDAR`}
          >
            <div
              className="cf_new_dashboard_info_pannel_title cf_ReCalendar_container_item_title"
              style={{ gap: "5px" }}
            >
              <p style={{ color: "#64748b" }}>{item?.month}'</p>
              <p style={{ color: "#64748b" }}>
                {item?.year?.toString()?.slice(2)}
              </p>
              <span style={{ marginLeft: "auto" }}></span>
              <div
                className="CF_d-flex CF_align-center"
                style={{ flexDirection: "column" }}
              >
                <p
                  style={{
                    textAlign: "right",
                    fontWeight: "600",
                    fontSize: "16px",
                  }}
                >
                  $
                  {formatCurrencyShort(
                    item?.renewalDates?.reduce((acc, date) => {
                      acc += date?.cost;
                      return acc;
                    }, 0)
                  )}
                </p>
                {/* <span
                  style={{
                    fontSize: "10px",
                    lineHeight: "1px",
                    color: "#64748b",
                    fontWeight: "400",
                  }}
                >
                  Renewals
                </span> */}
              </div>
            </div>
            <div
              className="cf_new_dashboard_info_pannel_body cf_ReCalendar_container_item_title"
              style={{}}
            >
              {item?.renewalDates?.map((date, index) => {
                return (
                  <div
                    className="cf_ReCalendar_container_item_body_item"
                    style={{ backgroundColor: getRandomColor("dull") }}
                    key={`${index}-${
                      date?.vendorName === "OTHERS"
                        ? date?.externalProviderName
                        : date?.vendorName
                    }`}
                  >
                    <img
                      src={cloudImageMapper(
                        date?.vendorName,
                        date?.externalProviderName
                      )}
                      alt={getCloudName(
                        date?.vendorName === "OTHERS"
                          ? date?.externalProviderName
                          : date?.vendorName
                      )}
                      style={{
                        width: "16px",
                        height: "16px",
                        objectFit: "contain",
                      }}
                    />
                    <p
                      style={{
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        width: "70%",
                      }}
                      title={getCloudName(
                        date?.vendorName === "OTHERS"
                          ? date?.externalProviderName
                          : date?.vendorName
                      )}
                    >
                      {getCloudName(
                        date?.vendorName === "OTHERS"
                          ? date?.externalProviderName
                          : date?.vendorName
                      )}
                    </p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <p
                      style={{
                        fontSize: "10px",
                        fontWeight: "500",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(+date?.renewalDate).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "2-digit",
                        }
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ReCalendar;
