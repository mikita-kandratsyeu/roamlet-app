import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './disclosures.css';

export function PlannerDetails({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="planner-details planner-disclosure">
      <summary className="section-heading">
        <h2>{title}</h2>
        <span className="disclosure-toggle" aria-hidden="true"><ChevronDown size={18} /></span>
      </summary>
      <div className="planner-details-body">{children}</div>
    </details>
  );
}
