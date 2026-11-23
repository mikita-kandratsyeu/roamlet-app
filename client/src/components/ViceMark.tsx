import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & {
  active?: boolean;
  size?: number;
};

export function ViceMark({ active = false, size = 18, className, ...props }: Props) {
  const sunStroke = active ? 'var(--vice-sun, currentColor)' : 'currentColor';
  const palmStroke = active ? 'var(--vice-palm, currentColor)' : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <circle
        cx="12"
        cy="6.5"
        r="4.25"
        fill={active ? 'var(--vice-sun, currentColor)' : 'none'}
        stroke={sunStroke}
        strokeWidth="1.5"
      />
      <path
        d="M12 11.5v2.5M12 14l-5 8.5M12 14l5 8.5"
        stroke={palmStroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}