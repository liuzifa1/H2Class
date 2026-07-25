const shanghaiDateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const shanghaiFullDateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatShanghaiDateTime = (iso: string) =>
  shanghaiDateTime.format(new Date(iso));

export const formatShanghaiFullDateTime = (iso: string) =>
  shanghaiFullDateTime.format(new Date(iso));
