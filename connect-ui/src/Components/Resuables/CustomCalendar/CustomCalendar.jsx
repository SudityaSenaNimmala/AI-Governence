import React, { useEffect, useCallback, useState } from "react";
import "./css/Calendar.css";
import { FaAngleLeft, FaAngleRight, FaCaretUp, FaCaretDown } from "react-icons/fa6";
import { formatDateNew, getRandomArray } from "../../helpers/helpers";

const startOfDayTs = (input) => {
  const x = input instanceof Date ? new Date(input) : new Date(input);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const ymdFromTs = (ts) => {
  const x = new Date(ts);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const d = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** Parse API / parent value: "2024-09-25|2025-09-25" */
export const parseCalendarDateRangeString = (str) => {
  if (!str || typeof str !== "string" || !str.includes("|")) return null;
  const parts = str.split("|").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { startYmd: parts[0], endYmd: parts[1] };
};

/** Build API value: one day is start|start */
export const formatCalendarDateRangeString = (startTs, endTs) => {
  const a = ymdFromTs(startTs);
  const b = ymdFromTs(endTs);
  if (!a || !b) return "";
  const lo = Math.min(startOfDayTs(startTs), startOfDayTs(endTs));
  const hi = Math.max(startOfDayTs(startTs), startOfDayTs(endTs));
  return `${ymdFromTs(lo)}|${ymdFromTs(hi)}`;
};

const CustomCalendar = (props) => {
  const allowRangeSelection = props?.allowRangeSelection === true;
  const cancelButtonLabel = props?.cancelButtonLabel ?? "Cancel";
  const [calendarView, setCalendarView] = useState("CALENDAR");
  const [calendarWeeks] = useState(["S", "M", "T", "W", "T", "F", "S"]);
  const [calendarMonths] = useState([
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ]);
  const [calendarConfiguration, setCalendarConfiguration] = useState({
    year: 0,
    month: 0,
    originalDate: "",
    numberOfDays: 0,
    firstDayOfMonth: 0,
    selectedDate: new Date(formatDateNew(new Date(), true)).getTime(),
    isDisabled: props?.isDisabled,
  });
  const [cacheConfiguration, setCacheConfiguration] = useState({ year: 0, month: 0 });
  const [todayInfo] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    date: new Date().getDate(),
  });
  const [calendarRows, setCalendarRows] = useState([]);
  const [presetFilter, setPresetFilter] = useState(0);
  const [dateRangePick, setDateRangePick] = useState({ start: null, end: null });

  const applyInitialRange = useCallback((rangeStr) => {
    const parsed = parseCalendarDateRangeString(rangeStr);
    if (!parsed) return;
    const s = startOfDayTs(new Date(`${parsed.startYmd}T12:00:00`));
    const e = startOfDayTs(new Date(`${parsed.endYmd}T12:00:00`));
    if (s != null && e != null) {
      setDateRangePick({ start: s, end: e });
    }
  }, []);

  useEffect(() => {
    const year = new Date(props?.customDate).getFullYear();
    const month = new Date(props?.customDate).getMonth();
    const origTs = new Date(props?.originalDate ? props?.originalDate : props?.customDate).getTime();
    setCalendarConfiguration({
      year,
      month,
      originalDate: origTs,
      numberOfDays: new Date(year, month + 1, 0).getDate(),
      firstDayOfMonth: new Date(year, month, 1).getDay(),
      selectedDate: new Date(props?.customDate).getTime(),
      isDisabled: props?.isDisabled,
    });
  }, [props?.customDate, props?.originalDate, props?.isDisabled]);

  useEffect(() => {
    if (!allowRangeSelection) return;
    if (props?.initialDateRange) {
      applyInitialRange(props.initialDateRange);
    } else {
      setDateRangePick({ start: null, end: null });
    }
  }, [allowRangeSelection, props?.initialDateRange, applyInitialRange]);

  const handleDayClick = useCallback(
    (unixDate) => {
      if (!allowRangeSelection) {
        setCalendarConfiguration((prev) => ({
          ...prev,
          selectedDate: unixDate,
        }));
        return;
      }
      const dayTs = startOfDayTs(unixDate);
      if (dayTs == null) return;
      setCalendarConfiguration((prev) => ({
        ...prev,
        selectedDate: unixDate,
      }));
      setDateRangePick((prev) => {
        if (prev.end != null || prev.start == null) {
          return { start: dayTs, end: null };
        }
        let a = prev.start;
        let b = dayTs;
        if (b < a) [a, b] = [b, a];
        return { start: a, end: b };
      });
    },
    [allowRangeSelection]
  );

  useEffect(() => {
    let days = [];
    let day = 1;
    const dateNow = new Date().getTime();
    const maxDate = calendarConfiguration?.originalDate;
    const selectedData = calendarConfiguration?.selectedDate;
    const rs = dateRangePick.start;
    const re = dateRangePick.end;
    const lo =
      allowRangeSelection && rs != null && re != null
        ? Math.min(startOfDayTs(rs), startOfDayTs(re))
        : null;
    const hi =
      allowRangeSelection && rs != null && re != null
        ? Math.max(startOfDayTs(rs), startOfDayTs(re))
        : null;

    for (let i = 0; i < 6; i++) {
      let row = [];
      for (let j = 0; j < 7; j++) {
        if ((i === 0 && j < calendarConfiguration?.firstDayOfMonth) || day > calendarConfiguration?.numberOfDays) {
          row.push(<td key={`${i}-${j}`} />);
        } else {
          const unixDate = new Date(
            `${calendarConfiguration?.month + 1}/${day}/${calendarConfiguration?.year}`
          ).getTime();
          let isDisabled = unixDate > dateNow || unixDate < maxDate;
          if (!calendarConfiguration?.isDisabled) {
            isDisabled = false;
          }
          const dayTs = startOfDayTs(unixDate);
          let cellClass = "";
          if (allowRangeSelection && lo != null && hi != null && dayTs != null) {
            if (dayTs === lo && dayTs === hi) cellClass = "cf_cal_range_single";
            else if (dayTs === lo) cellClass = "cf_cal_range_start";
            else if (dayTs === hi) cellClass = "cf_cal_range_end";
            else if (dayTs > lo && dayTs < hi) cellClass = "cf_cal_range_between";
          } else if (allowRangeSelection && rs != null && re == null && dayTs === startOfDayTs(rs)) {
            cellClass = "cf_cal_range_anchor";
          } else if (selectedData === unixDate) {
            cellClass = "cf_cal_current_date";
          }

          row.push(
            <td key={`${i}-${j}`} className={isDisabled ? "cf_cal_nextDate_disabled" : ""}>
              <div className={cellClass} onClick={() => !isDisabled && handleDayClick(unixDate)}>
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
  }, [calendarConfiguration, allowRangeSelection, dateRangePick, handleDayClick]);

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
      year,
      month,
      numberOfDays: new Date(year, month + 1, 0).getDate(),
      firstDayOfMonth: new Date(year, month, 1).getDay(),
    });
  };

  const handleCalendarChange = (action, data) => {
    let year;
    let month;
    if (action === "YEAR") {
      year = data;
      setCalendarView("MONTHS");
      setCacheConfiguration({ ...cacheConfiguration, year });
    }
    if (action === "MONTHS") {
      year = cacheConfiguration?.year;
      month = data;
      setCalendarView("CALENDAR");
      setCacheConfiguration({ ...cacheConfiguration, month });
      setCalendarConfiguration({
        ...calendarConfiguration,
        year,
        month,
        numberOfDays: new Date(year, month + 1, 0).getDate(),
        firstDayOfMonth: new Date(year, month, 1).getDay(),
      });
    }
  };

  const applyPresetDaysAgo = (daysAgo) => {
    const newDate = new Date().getTime() - daysAgo * 86400000;
    const year = new Date(newDate).getFullYear();
    const month = new Date(newDate).getMonth();
    const sel = new Date(formatDateNew(newDate)).getTime();
    if (allowRangeSelection) {
      const start = startOfDayTs(newDate);
      const end = startOfDayTs(Date.now());
      setDateRangePick({ start, end });
      setCalendarConfiguration({
        ...calendarConfiguration,
        year,
        month,
        originalDate: calendarConfiguration?.originalDate,
        numberOfDays: new Date(year, month + 1, 0).getDate(),
        firstDayOfMonth: new Date(year, month, 1).getDay(),
        selectedDate: sel,
      });
    } else {
      setCalendarConfiguration({
        year,
        month,
        originalDate: calendarConfiguration?.originalDate,
        numberOfDays: new Date(year, month + 1, 0).getDate(),
        firstDayOfMonth: new Date(year, month, 1).getDay(),
        selectedDate: sel,
        isDisabled: calendarConfiguration?.isDisabled,
      });
    }
  };

  const handleApply = () => {
    let dateRange = "";
    if (allowRangeSelection && dateRangePick.start != null) {
      const end = dateRangePick.end != null ? dateRangePick.end : dateRangePick.start;
      dateRange = formatCalendarDateRangeString(dateRangePick.start, end);
    } else {
      const ts = calendarConfiguration.selectedDate;
      dateRange = `${ymdFromTs(ts)}|${ymdFromTs(ts)}`;
    }
    props?.applyChangeDate({
      originalDate: calendarConfiguration.originalDate,
      currentIndex: props?.customData?.currentIndex,
      newDate: calendarConfiguration.selectedDate,
      channelId: props?.customData?.channelId,
      dateRange,
    });
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
      <div className="cf_calendar_body" style={{ height: "calc(100% - 100px)" }}>
        <div className="cf_calendar_body_cal_container">
          <div className="cf_calendar_body_cal_container_header">
            {calendarView === "CALENDAR" ? (
              <button className="cf_cal_month_year" type="button" onClick={() => setCalendarView("YEARS")}>
                {calendarMonths[calendarConfiguration?.month]} {calendarConfiguration?.year}&nbsp;&nbsp;
                <FaCaretDown />
              </button>
            ) : (
              ""
            )}
            {calendarView === "YEARS" ? (
              <button className="cf_cal_month_year" type="button" onClick={() => setCalendarView("CALENDAR")}>
                2010 - {new Date().getFullYear()}&nbsp;&nbsp;
                <FaCaretUp />
              </button>
            ) : (
              ""
            )}
            {calendarView === "MONTHS" ? (
              <button className="cf_cal_month_year" type="button" onClick={() => setCalendarView("YEARS")}>
                {cacheConfiguration?.year}&nbsp;&nbsp;
                <FaCaretUp />
              </button>
            ) : (
              ""
            )}
            <div className="cf_cal_mover_div">
              <div onClick={() => handleChangeCalendar("previous")} role="presentation">
                <FaAngleLeft />
              </div>
              <div
                onClick={() => handleChangeCalendar("next")}
                role="presentation"
                className={
                  !calendarConfiguration?.isDisabled
                    ? ""
                    : calendarConfiguration?.month === todayInfo?.month &&
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
                    {calendarWeeks?.map((data, index) => (
                      <th key={data + index}>{data}</th>
                    ))}
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
              {getRandomArray(new Date().getFullYear() - 2009)?.map((data, index) => (
                <div
                  key={2010 + index}
                  onClick={() => handleCalendarChange("YEAR", 2010 + index)}
                  className={cacheConfiguration?.year === 2010 + index ? "cf_calendar_body_years_active" : ""}
                  role="presentation"
                >
                  {2010 + index}
                </div>
              ))}
            </div>
          ) : (
            ""
          )}
          {calendarView === "MONTHS" ? (
            <div className="cf_calendar_body_years">
              {calendarMonths?.map((data, index) => (
                <div
                  key={data}
                  onClick={() => handleCalendarChange("MONTHS", index)}
                  className={cacheConfiguration?.month === index ? "cf_calendar_body_years_active" : ""}
                  role="presentation"
                >
                  {data}
                </div>
              ))}
            </div>
          ) : (
            ""
          )}
        </div>
        <div className="cf_calendar_body_cal_presets">
          <p style={{ color: "#2e4156", fontWeight: "600 !important" }}>Preset Filters</p>
          <p
            className={`cf_cal_preset_filters ${calendarConfiguration?.originalDate > new Date().getTime() - 90 * 86400000 ? "cf_cal_nextDate_disabled" : ""
              } ${presetFilter === 90 ? "cf_cal_filter_date" : ""}`}
            onClick={() => applyPresetDaysAgo(90)}
            role="presentation"
          >
            Last 3 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${calendarConfiguration?.originalDate > new Date().getTime() - 180 * 86400000 ? "cf_cal_nextDate_disabled" : ""
              } ${presetFilter === 180 ? "cf_cal_filter_date" : ""}`}
            onClick={() => applyPresetDaysAgo(180)}
            role="presentation"
          >
            Last 6 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${calendarConfiguration?.originalDate > new Date().getTime() - 270 * 86400000 ? "cf_cal_nextDate_disabled" : ""
              } ${presetFilter === 270 ? "cf_cal_filter_date" : ""}`}
            onClick={() => applyPresetDaysAgo(270)}
            role="presentation"
          >
            Last 9 Months
          </p>
          <p
            className={`cf_cal_preset_filters ${calendarConfiguration?.originalDate > new Date().getTime() - 365 * 86400000 ? "cf_cal_nextDate_disabled" : ""
              } ${presetFilter === 365 ? "cf_cal_filter_date" : ""}`}
            onClick={() => applyPresetDaysAgo(365)}
            role="presentation"
          >
            Last 1 Year
          </p>
        </div>
      </div>
      <div className="cf_calendar_footer">
        <button
          id="cf_cal_btn_cancel"
          type="button"
          onClick={() => {
            if (typeof props?.onResetFilter === "function") {
              props.onResetFilter();
            }
            props?.closeDate({ ...props?.closeDate, channelDate: "" });
          }}
        >
          {cancelButtonLabel}
        </button>
        <button id="cf_cal_btn_apply" type="button" onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
};

export default CustomCalendar;
