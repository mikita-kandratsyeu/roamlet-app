import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { toast } from 'sonner';
import i18n from './i18n';

beforeEach(async () => {
  toast.dismiss();
  await i18n.changeLanguage('en');
});
