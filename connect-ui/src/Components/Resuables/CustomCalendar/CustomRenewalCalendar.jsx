import React, { useEffect, useRef } from "react";
import "./css/Calendar.css";
import { useState } from "react";
import { FaAngleLeft, FaAngleRight, FaCaretUp } from "react-icons/fa6";
import {
  cloudImageMapper,
  formatDateNew,
  getRandomArray,
} from "../../helpers/helpers";
import { FaCaretDown } from "react-icons/fa6";
import ReCalendar from "../Calendar/ReCalendar";
// customDate={changeChannelDate?.channelDate}
//           closeDate={setChangeChannelDate}
//           customData={changeChannelDate}
//           applyChangeDate={handleChangeDate}
const CustomRenewalCalendar = (props) => {
  const [calendarView, setCalendarView] = useState("CALENDAR");
  const [calendarWeeks] = useState(["S", "M", "T", "W", "T", "F", "S"]);
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
  const [calendarConfiguration, setCalendarConfiguration] = useState({
    year: 0,
    month: 0,
    originalDate: "",
    numberOfDays: 0,
    firstDayOfMonth: 0,
    selectedDate: new Date(formatDateNew(new Date(), true)).getTime(),
  });
  const [cacheConfiguration, setCacheConfiguration] = useState({
    year: 0,
    month: 0,
  });
  const [todayInfo] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    date: new Date().getDate(),
  });
  const [calendarRows, setCalendarRows] = useState([]);
  const [presetFilter, setPresetFilter] = useState(0);
  const prevCustomDateRef = useRef(null);

  useEffect(() => {
    // Only update if customDate actually changed
    if (props?.customDate && prevCustomDateRef.current !== props?.customDate) {
      prevCustomDateRef.current = props?.customDate;
      let year = new Date(props?.customDate).getFullYear();
      let month = new Date(props?.customDate).getMonth();
      setCalendarConfiguration({
        year: year,
        month: month,
        originalDate: new Date(
          props?.originalDate ? props?.originalDate : props?.customDate
        ).getTime(),
        numberOfDays: new Date(year, month + 1, 0).getDate(),
        firstDayOfMonth: new Date(year, month, 1).getDay(),
        selectedDate: new Date(props?.customDate).getTime(),
      });
    }
  }, [props?.customDate, props?.originalDate]);

  useEffect(() => {
    let days = [];
    let day = 1;
    for (let i = 0; i < 6; i++) {
      let row = [];
      for (let j = 0; j < 7; j++) {
        if (
          (i === 0 && j < calendarConfiguration?.firstDayOfMonth) ||
          day > calendarConfiguration?.numberOfDays
        ) {
          row.push(<td key={`${i}-${j}`} />);
        } else {
          const unixDate = new Date(
            `${calendarConfiguration?.month + 1}/${day}/${calendarConfiguration?.year
            }`
          ).getTime();
          const dateNow = new Date().getTime();
          const maxDate = calendarConfiguration?.originalDate;
          const selectedData = calendarConfiguration?.selectedDate;
          const isDisabled = unixDate > dateNow || unixDate < maxDate;

          row.push(
            <td
              key={`${i}-${j}`}
              className={
                props?.renewalList[unixDate] ? "" : "cf_cal_nextDate_disabled"
              }
            // onClick={() => handleDateClick(unixDate)}
            >
              <div
                className={`cf_newDate_container`}
                onClick={() =>
                  setCalendarConfiguration({
                    ...calendarConfiguration,
                    selectedDate: unixDate,
                  })
                }
              >
                <p>{day}</p>
                <div className="cf_calendar_body_cal_container_renewal_list">
                  {Object.keys(props?.renewalList)?.map((licDates) => {
                    if (+licDates === unixDate) {
                      return props?.renewalList[licDates]?.map(
                        (data, index) => {
                          return <img src={cloudImageMapper(data)} alt="" />;
                        }
                      );
                    }
                  })}
                </div>
              </div>
            </td>
          );
          day++;
        }
      }
      days.push(<tr key={i}>{row}</tr>);
      if (day > calendarConfiguration?.numberOfDays) break;
    }
    setCalendarRows(days);
    setCacheConfiguration({
      year: calendarConfiguration?.year,
      month: calendarConfiguration?.month,
    });
  }, [calendarConfiguration, props?.renewalList]);

  const handleChangeCalendar = (action) => {
    let month = calendarConfiguration?.month;
    let year = calendarConfiguration?.year;
    if (action === "previous") {
      if (month === 0) {
        year -= 1;
        month = 11;
      } else {
        month -= 1;
      }
    } else {
      if (month === 11) {
        month = 0;
        year += 1;
      } else {
        month += 1;
      }
    }
    setCalendarConfiguration({
      ...calendarConfiguration,
      year: year,
      month: month,
      numberOfDays: new Date(year, month + 1, 0).getDate(),
      firstDayOfMonth: new Date(year, month, 1).getDay(),
    });
  };

  const handleCalendarChange = (action, data) => {
    let year, month;
    if (action === "YEAR") {
      year = data;
      month = calendarConfiguration?.month;
      setCalendarView("MONTHS");
      setCacheConfiguration({ ...cacheConfiguration, year: year });
    }
    if (action === "MONTHS") {
      year = cacheConfiguration?.year;
      month = data;
      setCalendarView("CALENDAR");
      setCacheConfiguration({ ...cacheConfiguration, month: month });
      setCalendarConfiguration({
        ...calendarConfiguration,
        year: year,
        month: month,
        numberOfDays: new Date(year, month + 1, 0).getDate(),
        firstDayOfMonth: new Date(year, month, 1).getDay(),
      });
    }
  };

  return (
    <div
      className="cf_calendar_container cf_calendar_container_renewal"
      style={{ overflowY: "auto" }}
    >
      <div
        className="cf_calendar_body_cal_container_body cf_calendar_body_cal_container_body_renewal"
        style={{ height: "100%", overflowY: "auto" }}
      >
        <ReCalendar />
      </div>
    </div>
  );
};

export default CustomRenewalCalendar;
