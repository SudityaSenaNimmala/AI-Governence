import React, { useEffect } from "react";
import "./css/Calendar.css";
import { useState } from "react";
import { FaAngleLeft, FaAngleRight, FaCaretUp } from "react-icons/fa6";
import { formatDateNew, getRandomArray } from "../../helpers/helpers";
import { FaCaretDown } from "react-icons/fa6";

const Calendar = (props) => {
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
  useEffect(() => {
    let year = new Date(props?.customDate).getFullYear();
    let month = new Date(props?.customDate).getMonth();
    setCalendarConfiguration({
      year: year,
      month: month,
      originalDate: new Date(props?.customDate).getTime(),
      numberOfDays: new Date(year, month + 1, 0).getDate(),
      firstDayOfMonth: new Date(year, month, 1).getDay(),
      selectedDate: new Date(props?.customDate).getTime(),
    });
  }, [props?.customDate]);

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
            `${calendarConfiguration?.month + 1}/${day}/${
              calendarConfiguration?.year
            }`
          ).getTime();
          const dateNow = new Date().getTime();
          const maxDate = calendarConfiguration?.originalDate;
          const selectedData = calendarConfiguration?.selectedDate;
          const isDisabled = unixDate > dateNow || unixDate < maxDate;

          row.push(
            <td
              key={`${i}-${j}`}
              className={isDisabled ? "cf_cal_nextDate_disabled" : ""}
              // onClick={() => handleDateClick(unixDate)}
            >
              <div
                className={
                  selectedData === unixDate ? "cf_cal_current_date" : ""
                }
                onClick={() =>
                  setCalendarConfiguration({
                    ...calendarConfiguration,
                    selectedDate: unixDate,
                  })
                }
              >
                {day}
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
  }, [calendarConfiguration]);

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
      className="cf_calendar_container"
      style={{
        top: props?.customData?.positionY - 350,
        left: props?.customData?.positionX - 500,
      }}
    >
      <div className="cf_calendar_header">
        <span style={{ fontWeight: "500" }}>CALENDAR</span>
      </div>
      <div className="cf_calendar_body">
        <div className="cf_calendar_body_cal_container">
          <div className="cf_calendar_body_cal_container_header">
            {calendarView === "CALENDAR" ? (
              <button
                className="cf_cal_month_year"
                onClick={() => setCalendarView("YEARS")}
              >
                {calendarMonths[calendarConfiguration?.month]}{" "}
                {calendarConfiguration?.year}&nbsp;&nbsp;
                <FaCaretDown />
              </button>
            ) : (
              ""
            )}
            {calendarView === "YEARS" ? (
              <button
                className="cf_cal_month_year"
                onClick={() => setCalendarView("CALENDAR")}
              >
                2010 - {new Date().getFullYear()}&nbsp;&nbsp;
                <FaCaretUp />
              </button>
            ) : (
              ""
            )}
            {calendarView === "MONTHS" ? (
              <button
                className="cf_cal_month_year"
                onClick={() => setCalendarView("YEARS")}
              >
                {cacheConfiguration?.year}&nbsp;&nbsp;
                <FaCaretUp />
              </button>
            ) : (
              ""
            )}
            <div className="cf_cal_mover_div">
              <div onClick={() => handleChangeCalendar("previous")}>
                <FaAngleLeft />
              </div>
              <div
                onClick={() => handleChangeCalendar("next")}
                className={
                  calendarConfiguration?.month === todayInfo?.month &&
                  calendarConfiguration?.year === todayInfo?.year
                    ? "cf_cal_nextDate_disabled"
                    : ""
                }
              >
                <FaAngleRight />
              </div>
            </div>
          </div>
          {calendarView === "CALENDAR" ? (
            <div className="cf_calendar_body_cal_container_body">
              <table className="cf_calendar_table">
                <thead>
                  <tr>
                    {calendarWeeks?.map((data, index) => {
                      return <th key={data + index}>{data}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>{calendarRows}</tbody>
              </table>
            </div>
          ) : (
            ""
          )}
          {calendarView === "YEARS" ? (
            <div className="cf_calendar_body_years">
              {getRandomArray(new Date().getFullYear() - 2009)?.map(
                (data, index) => {
                  return (
                    <div
                      key={2010 + index}
                      onClick={() => handleCalendarChange("YEAR", 2010 + index)}
                      className={
                        cacheConfiguration?.year === 2010 + index
                          ? "cf_calendar_body_years_active"
                          : ""
                      }
                    >
                      {2010 + index}
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            ""
          )}
          {calendarView === "MONTHS" ? (
            <div className="cf_calendar_body_years">
              {calendarMonths?.map((data, index) => {
                return (
                  <div
                    key={data}
                    onClick={() => handleCalendarChange("MONTHS", index)}
                    className={
                      cacheConfiguration?.month === index
                        ? "cf_calendar_body_years_active"
                        : ""
                    }
                  >
                    {data}
                  </div>
                );
              })}
            </div>
          ) : (
            ""
          )}
        </div>
        <div className="cf_calendar_body_cal_presets">
          <p style={{ color: "#2e4156", fontWeight: "600 !important" }}>
            Preset Filters
          </p>
          <p
            className={`cf_cal_preset_filters ${
              calendarConfiguration?.originalDate >
              new Date().getTime() - 90 * 86400000
                ? "cf_cal_nextDate_disabled"
                : ""
            } ${presetFilter === 90 ? "cf_cal_filter_date" : ""}`}
            data-cal-filter="90"
            data-filter-unix-date={new Date().getTime() - 90 * 86400000}
          >
            Last 3 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${
              calendarConfiguration?.originalDate >
              new Date().getTime() - 180 * 86400000
                ? "cf_cal_nextDate_disabled"
                : ""
            } ${presetFilter === 180 ? "cf_cal_filter_date" : ""}`}
            data-cal-filter="180"
            data-filter-unix-date={new Date().getTime() - 180 * 86400000}
          >
            Last 6 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${
              calendarConfiguration?.originalDate >
              new Date().getTime() - 270 * 86400000
                ? "cf_cal_nextDate_disabled"
                : ""
            } ${presetFilter === 270 ? "cf_cal_filter_date" : ""}`}
            data-cal-filter="270"
            data-filter-unix-date={new Date().getTime() - 270 * 86400000}
          >
            Last 9 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${
              calendarConfiguration?.originalDate >
              new Date().getTime() - 365 * 86400000
                ? "cf_cal_nextDate_disabled"
                : ""
            } ${presetFilter === 365 ? "cf_cal_filter_date" : ""}`}
            data-cal-filter="365"
            data-filter-unix-date={new Date().getTime() - 365 * 86400000}
          >
            Last 1 Year
          </p>
        </div>
      </div>
      <div className="cf_calendar_footer">
        <button
          id="cf_cal_btn_cancel"
          onClick={() =>
            props?.closeDate({ ...props?.closeDate, channelDate: "" })
          }
        >
          Cancel
        </button>
        <button
          id="cf_cal_btn_apply"
          onClick={() =>
            props?.applyChangeDate({
              originalDate: calendarConfiguration.originalDate,
              currentIndex: props?.customData?.currentIndex,
              newDate: calendarConfiguration.selectedDate,
              channelId: props?.customData?.channelId,
            })
          }
        >
          Apply
        </button>
      </div>
    </div>
  );
};

export default Calendar;
