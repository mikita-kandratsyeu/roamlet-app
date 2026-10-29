export function estimateTime(distanceMetres: number, speedKmh: number, stopsMinutes: number) {
  if (
    !Number.isFinite(distanceMetres) ||
    distanceMetres < 0 ||
    !Number.isFinite(speedKmh) ||
    speedKmh <= 0 ||
    !Number.isFinite(stopsMinutes) ||
    stopsMinutes < 0
  )
    return null;
  const moving = (distanceMetres / 1000 / speedKmh) * 3600;
  const total = moving + stopsMinutes * 60;
  return Number.isFinite(total) ? { moving, total } : null;
}
