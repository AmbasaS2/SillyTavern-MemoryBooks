import { getCurrentLocale } from '../../../i18n.js';
import { createSlothToastr } from './sloth-notification-policy.js';

export const slothToastr = createSlothToastr(() => globalThis.toastr, getCurrentLocale);
