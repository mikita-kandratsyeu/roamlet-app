import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu';

export function PlannerChoice<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  menuClassName = '',
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}) {
  const { t } = useTranslation();
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          className={`planner-choice ${className}`}
          aria-label={label}
          disabled={disabled}
        >
          <span>{selected ? t(selected.label) : value}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={12}
        className={`planner-choice-menu ${menuClassName}`}
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            if (option) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {t(option.label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
