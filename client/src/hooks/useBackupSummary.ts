import { useEffect, useState } from 'react';
import { listRoutes } from '../domain/storage';

export function useBackupSummary(active: boolean, revision: unknown) {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setCount(null);
    setFailed(false);
    let invalid = 0;
    listRoutes((value) => {
      invalid = value;
    })
      .then((routes) => {
        if (!current) return;
        if (invalid) setFailed(true);
        else setCount(routes.length);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [active, revision, attempt]);
  return { count, failed, retry: () => setAttempt((value) => value + 1) };
}
