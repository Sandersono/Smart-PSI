function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatLocalDateInput(date: Date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalMonthInput(date: Date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function toLocalDateInput(value: string | Date | null | undefined) {
  if (!value) return formatLocalDateInput();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return formatLocalDateInput();
  return formatLocalDateInput(date);
}

export function toLocalMonthInput(value: string | Date | null | undefined) {
  if (!value) return formatLocalMonthInput();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return formatLocalMonthInput();
  return formatLocalMonthInput(date);
}

export function toOptionalLocalDateInput(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDateInput(date);
}

export function toOptionalLocalMonthInput(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalMonthInput(date);
}
