import { App } from '../core/app.js';

/** Fired on the `[data-tab-group]` element when a tab becomes active; `detail` is the id of its panel. */
export const TAB_CHANGE = 'tabs:change';

/**
 * WAI-ARIA tabs of the styleguide with roving tabindex: arrow keys, Home and End move between the visible tabs,
 * and moving also selects. Tabs hidden for missing permissions are skipped.
 */
export const Tabs = App.register('Tabs', {
  init(): void {
    for (const tablist of document.querySelectorAll<HTMLElement>('.tablist')) {
      Tabs.sync(tablist);
    }

    document.addEventListener('click', (event) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('.tablist .tab') : null;

      if (tab !== null) {
        Tabs.activate(tab);
      }
    });

    document.addEventListener('keydown', (event) => {
      const current = event.target instanceof Element ? event.target.closest<HTMLElement>('.tablist .tab') : null;
      const tablist = current?.closest<HTMLElement>('.tablist');

      if (current === null || current === undefined || tablist === null || tablist === undefined) {
        return;
      }

      const tabs = visibleTabs(tablist);
      const index = tabs.indexOf(current);
      const targets: Readonly<Record<string, HTMLElement | undefined>> = {
        ArrowRight: tabs[(index + 1) % tabs.length],
        ArrowDown: tabs[(index + 1) % tabs.length],
        ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
        ArrowUp: tabs[(index - 1 + tabs.length) % tabs.length],
        Home: tabs[0],
        End: tabs[tabs.length - 1],
      };
      const next = targets[event.key];

      if (next !== undefined) {
        event.preventDefault();
        Tabs.activate(next);
        next.focus();
      }
    });
  },

  /** Re-establishes the active tab, e.g. after tabs were shown or hidden; falls back to the first visible one. */
  sync(tablist: HTMLElement): void {
    const tabs = visibleTabs(tablist);
    const active = tabs.find((tab) => tab.classList.contains('is-active')) ?? tabs[0];

    if (active !== undefined) {
      Tabs.activate(active);
    }
  },

  activate(tab: HTMLElement): void {
    const tablist = tab.closest<HTMLElement>('.tablist');

    if (tablist === null) {
      return;
    }

    for (const other of tablist.querySelectorAll<HTMLElement>('.tab')) {
      const selected = other === tab;
      other.classList.toggle('is-active', selected);
      other.setAttribute('aria-selected', String(selected));
      other.setAttribute('tabindex', selected ? '0' : '-1');
    }

    const group = tablist.closest<HTMLElement>('[data-tab-group]');
    const panelId = tab.getAttribute('aria-controls');

    if (group !== null && panelId !== null) {
      for (const panel of group.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
        panel.hidden = panel.id !== panelId;
      }

      group.dispatchEvent(new CustomEvent<string>(TAB_CHANGE, { detail: panelId }));
    }
  },
});

function visibleTabs(tablist: HTMLElement): HTMLElement[] {
  return Array.from(tablist.querySelectorAll<HTMLElement>('.tab')).filter((tab) => !tab.hidden);
}
