/** Small text helpers shared by the Analysis insight modules. */

const MINUTE = 60_000;

export const formatMinutes = (ms: number) => {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};
export const formatHour = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;
export const percent = (value: number) => `${Math.round(value * 100)}%`;
