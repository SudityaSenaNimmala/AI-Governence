const CalendarDates = () => {
  const totalDaysInAMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0
  ).getDate();

  return (
    <>
      <tbody></tbody>
    </>
  );
};

export default CalendarDates;
