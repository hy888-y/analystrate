/**
 * Map a recommendation date to the nearest trading day available in the price series.
 *
 * Rules (all three protect against misplaced chart markers):
 *   - Returns undefined when prices is empty.
 *   - Returns undefined when the date is strictly before the first price date (would snap
 *     to the wrong first bar if allowed through).
 *   - Returns undefined when the date is strictly after the last price date (beyond history).
 *   - Otherwise returns the first price date that is >= the given date.
 */
export function snapToTradingDay(
  date: string,
  priceDays: string[],
): string | undefined {
  if (!priceDays.length) return undefined;
  if (date < priceDays[0]) return undefined;
  if (date > priceDays[priceDays.length - 1]) return undefined;
  return priceDays.find((t) => t >= date);
}
