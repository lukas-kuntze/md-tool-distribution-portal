// Frontend entry point: imports the modules, then starts the registry. No logic of its own.
// The stylesheet is linked in partials/head.html so that it blocks the first paint, in development too.
import './modules/theme.js';
import './modules/branding.js';
import './modules/overlays.js';
import './modules/toast.js';
import './modules/tabs.js';
import './modules/dropdown.js';
import './modules/clipboard.js';
import './modules/shell.js';
import './modules/role-assignments.js';
import './modules/audit-log.js';
import './modules/share-links.js';
import './modules/share-page.js';
import './modules/apps-page.js';
import './modules/login-page.js';
import './modules/dashboard-page.js';
import './modules/projects-page.js';
import './modules/project-page.js';
import './modules/application-page.js';
import './modules/release-page.js';
import './modules/access-page.js';
import './modules/storage-page.js';
import './modules/account-page.js';
import './modules/users-page.js';
import './modules/settings-page.js';

import { App } from './core/app.js';

App.start();
