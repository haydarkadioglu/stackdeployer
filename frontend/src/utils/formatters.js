export function formatWhen(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "unknown";
  }
  return date.toLocaleString();
}

export function formatLogLine(log) {
  const stamp = formatWhen(log.created_at);
  const source = log.source || "system";
  const message = log.message || "";
  return `[ ${stamp} ] [${source}] ${message}`;
}

export function formatDuration(startedAt, completedAt) {
  if (!startedAt) {
    return "n/a";
  }
  const start = new Date(startedAt).valueOf();
  const end = completedAt ? new Date(completedAt).valueOf() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "n/a";
  }

  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatTimestamp(value) {
  return formatWhen(value);
}

export function isLikelyDomain(value) {
  if (!value) {
    return false;
  }
  return /^(?!-)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(value);
}
