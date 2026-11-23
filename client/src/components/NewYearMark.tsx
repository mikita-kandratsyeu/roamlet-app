import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & {
  active?: boolean;
  size?: number;
};

export function NewYearMark({ active = false, size = 18, className, ...props }: Props) {
  const accent = active ? 'var(--newyear-star, currentColor)' : 'currentColor';
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
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 9.5 7 7M14.5 14.5 17 17M14.5 9.5 17 7M9.5 14.5 7 17"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity={active ? 1 : 0.65}
      />
    </svg>
  );
}