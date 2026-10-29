import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

export function parseDecimalValue(raw: string, allowZero: boolean): number | null {
  const normalized = raw.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(normalized)) return null;
  const value = Number(normalized.replace(',', '.'));
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}

export function useDecimalField(value: number, onCommit: (value: number) => void, allowZero: boolean, contextKey?: string) {
  const [buffer, setBuffer] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const edited = useRef(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  useEffect(() => {
    if (!focused.current) {
      setBuffer(String(value));
      setInvalid(false);
      edited.current = false;
    }
  }, [value, contextKey]);

  function commit() {
    if (!edited.current) {
      setBuffer(String(latestValue.current));
      setInvalid(false);
      return;
    }
    const parsed = parseDecimalValue(buffer, allowZero);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    edited.current = false;
    setInvalid(false);
    setBuffer(String(parsed));
    if (parsed !== latestValue.current) onCommit(parsed);
  }
  return {
    value: buffer,
    invalid,
    onFocus: () => { focused.current = true; },
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      edited.current = true;
      setBuffer(event.target.value);
      setInvalid(false);
    },
    onBlur: () => { focused.current = false; commit(); },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        commit();
      }
    },
  };
}
