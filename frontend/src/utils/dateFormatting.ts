/**
 * Format meeting date with timezone support
 */
export const formatMeetingDate = (isoString?: string, timeZone?: string | null): string | null => {
  if (!isoString) return null;

  try {
    const date = new Date(isoString);
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes);
    date.setMinutes(roundedMinutes, 0, 0);

    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timeZone || undefined,
    };

    return new Intl.DateTimeFormat('en-GB', options).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid Date';
  }
};