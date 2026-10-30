import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

export function PlannerChoice<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  menuClassName = '',
  selectedLabel,
  action,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  selectedLabel?: string;
  action?: { label: string; onSelect: () => void; disabled?: boolean };
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
          <span>{selectedLabel ? t(selectedLabel) : selected ? t(selected.label) : value}</span>
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
        {action && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={action.disabled} onSelect={action.onSelect}>
            {t(action.label)}
          </DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
