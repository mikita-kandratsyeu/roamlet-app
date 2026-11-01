import './MapLoadingIndicator.css';

const route = 'M16 64C30 64 28 28 52 28S72 68 94 60S112 16 144 24';

export function MapLoadingIndicator() {
  return (
    <svg className="map-loading-route" viewBox="0 0 160 88" aria-hidden="true" focusable="false">
      <path className="map-loading-route__base" d={route} />
      <path className="map-loading-route__trace" d={route} pathLength="100" />
      <circle className="map-loading-route__stop" cx="16" cy="64" r="4" />
      <circle className="map-loading-route__stop" cx="144" cy="24" r="4" />
    </svg>
  );
}
