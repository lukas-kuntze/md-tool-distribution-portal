import { forgetShell } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { alertBox, queryParameter, render } from '../core/dom.js';
import { messageForCode } from '../core/messages.js';

/**
 * Login page: the sign-in itself runs through GitHub; this only explains a failed attempt. Signing out and an
 * expired session both end here, so the tab's cached shell is forgotten here.
 */
export const LoginPage = App.register('LoginPage', {
  init(): void {
    const target = document.querySelector('[data-login-error]');
    const code = queryParameter('error');

    if (target === null) {
      return;
    }

    forgetShell();

    if (code !== null) {
      render(target, alertBox('danger', 'Anmeldung nicht möglich', messageForCode(code)));
    }
  },
});
