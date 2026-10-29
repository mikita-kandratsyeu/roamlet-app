import i18n, { formatNumber } from '../i18n';
export const formatDistance = (metres: number) =>
  `${formatNumber(metres / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${i18n.t('km')}`;
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${formatNumber(Math.floor(minutes / 60))} ${i18n.t('h')} ${formatNumber(minutes % 60)} ${i18n.t('min')}`
    : `${formatNumber(minutes)} ${i18n.t('min')}`;
}
