import { useState } from 'react';
import { isDisclaimerAcknowledged, saveDisclaimerAcknowledgement } from '../domain/disclaimer';

export function useDisclaimer() {
  const [acknowledged, setAcknowledged] = useState(isDisclaimerAcknowledged);
  const [storageError, setStorageError] = useState(false);

  function acknowledge() {
    setStorageError(!saveDisclaimerAcknowledgement());
    setAcknowledged(true);
  }

  return {
    acknowledged,
    acknowledge,
    storageError,
    dismissStorageError: () => setStorageError(false),
  };
}
