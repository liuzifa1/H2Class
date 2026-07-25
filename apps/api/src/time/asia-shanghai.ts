export const ASIA_SHANGHAI_UTC_OFFSET_MINUTES = 8 * 60;

export const compareShanghaiLocalDates = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

// Converts a validated YYYY-MM-DD plus minutes from local midnight to a UTC
// epoch instant. Asia/Shanghai has a fixed +08:00 offset and no DST.
export const shanghaiLocalDateTimeToUtcEpochSeconds = (
  date: string,
  minute: number,
) => {
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return Math.floor(
    (Date.UTC(year, month - 1, day, 0, minute) -
      ASIA_SHANGHAI_UTC_OFFSET_MINUTES * 60_000) /
      1_000,
  );
};

export const shanghaiLocalDateTimeToUtcDate = (
  date: string,
  minute: number,
) => new Date(shanghaiLocalDateTimeToUtcEpochSeconds(date, minute) * 1_000);

export const addShanghaiLocalDays = (date: string, days: number) => {
  const [yearText, monthText, dayText] = date.split("-");
  const instant = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days),
  );
  return instant.toISOString().slice(0, 10);
};

export const shanghaiLocalWeekday = (date: string) => {
  const [yearText, monthText, dayText] = date.split("-");
  return new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)),
  ).getUTCDay();
};

export const utcToShanghaiLocalParts = (instant: Date) => {
  const local = new Date(
    instant.getTime() + ASIA_SHANGHAI_UTC_OFFSET_MINUTES * 60_000,
  );
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
};

export const formatShanghaiDateTime = (instant: Date) => {
  const local = new Date(
    instant.getTime() + ASIA_SHANGHAI_UTC_OFFSET_MINUTES * 60_000,
  );
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const hour = String(local.getUTCHours()).padStart(2, "0");
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${minute}`;
};
