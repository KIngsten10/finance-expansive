/**
 * Date helpers that compute Indian calendar day/month boundaries in the
 * Asia/Kolkata timezone (UTC+05:30, no DST) and return the equivalent UTC
 * Date instances for use in MongoDB range queries.
 *
 * IST is a fixed +5:30 offset, so we can compute boundaries by shifting a
 * reference instant into IST, truncating, then shifting back to UTC.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30; // +05:30
const MS_PER_MINUTE = 60 * 1000;

/** Convert a UTC instant to the equivalent wall-clock time in IST. */
function toIst(date) {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** Convert an IST wall-clock Date (as built via UTC getters) back to a UTC instant. */
function istWallToUtc(istWall) {
  return new Date(istWall.getTime() - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * Returns { start, end } UTC Dates bounding the IST calendar DAY that contains
 * `ref`. `end` is exclusive (start of the next day).
 */
export function istDayRange(ref = new Date()) {
  const ist = toIst(ref);
  const startWall = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0)
  );
  const start = istWallToUtc(startWall);
  const end = new Date(start.getTime() + 24 * 60 * MS_PER_MINUTE);
  return { start, end };
}

/**
 * Returns { start, end } UTC Dates bounding the IST calendar MONTH that
 * contains `ref`. `end` is exclusive (start of the next month).
 */
export function istMonthRange(ref = new Date()) {
  const ist = toIst(ref);
  const startWall = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1, 0, 0, 0, 0));
  const start = istWallToUtc(startWall);
  const nextMonthWall = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  const end = istWallToUtc(nextMonthWall);
  return { start, end };
}
