import type { CSSProperties } from 'react';
import { useTheme } from '../theme';

const FLAKE_COUNT = 52;

function flakeStyle(index: number, symbolic: boolean): CSSProperties {
  return {
    left: `${(index * 37) % 100}%`,
    animationDelay: `${(index * 1.7) % 18}s`,
    animationDuration: `${9 + (index % 8)}s`,
  ...(symbolic
      ? {}
      : { width: 4 + (index % 6), height: 4 + (index % 6) }),
    ['--snow-drift' as string]: `${-36 + (index % 72)}px`,
    ['--snow-opacity' as string]: `${0.35 + (index % 5) * 0.12}`,
  };
}

export function NewYearSnow() {
  const { look } = useTheme();
  if (look !== 'newyear') return null;

  return (
    <div className="newyear-snow" aria-hidden="true">
      {Array.from({ length: FLAKE_COUNT }, (_, index) => {
        const symbolic = index % 5 === 0;
        return (
          <span
            key={index}
            className={`newyear-snowflake${symbolic ? ' is-star' : ''}`}
            style={flakeStyle(index, symbolic)}
          />
        );
      })}
    </div>
  );
}