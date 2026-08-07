/**
 * Formats a timestamp, Date, or ISO string into China / Beijing Time (Asia/Shanghai, UTC+8)
 * Default output format: "YYYY/MM/DD" or "YYYY/MM/DD HH:mm"
 */
export function formatChinaDate(
  dateInput: number | string | Date | null | undefined,
  includeTime: boolean = false
): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'number' || typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      : {}),
  };

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', options).formatToParts(d);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const dateStr = `${year}/${month}/${day}`;

    if (includeTime) {
      const hour = getPart('hour');
      const minute = getPart('minute');
      return `${dateStr} ${hour}:${minute}`;
    }
    return dateStr;
  } catch (e) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}/${month}/${day}`;
    if (includeTime) {
      const hour = String(d.getHours()).padStart(2, '0');
      const minute = String(d.getMinutes()).padStart(2, '0');
      return `${dateStr} ${hour}:${minute}`;
    }
    return dateStr;
  }
}
