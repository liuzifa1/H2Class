const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => fullDate.format(new Date(iso));

export const utcRange = (daysBefore: number, daysAfter: number) => {
  const now = Date.now();
  return {
    startAt: new Date(now - daysBefore * 86_400_000).toISOString(),
    endAt: new Date(now + daysAfter * 86_400_000).toISOString(),
  };
};
