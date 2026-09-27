const timeZone = "Asia/Tehran";

export function conversationDayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function formatConversationDay(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

export function formatConversationTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
