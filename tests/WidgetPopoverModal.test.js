// @vitest-environment jsdom
/**
 * Teardown bookkeeping for the shared overlay primitive (Rotary Component rebuild,
 * ticket 00). Both regressions covered here are about the SAME defect class: a popover's
 * teardown running against module-level `activePopover` state that a later popover now
 * owns, leaving the live overlay orphaned — visible on screen with a document-level
 * Escape listener nothing will ever remove.
 *
 * Lives here rather than in shared/ (where the canonical copy of the module under test
 * is) because import paths under shared/ are written for their SYNCED destination, not
 * for shared/ itself — WidgetPopoverModal.js's `../utils/StateRefPath.js` only resolves
 * from flight-deck-pwa/js/widgets/components/, so shared/'s own copy isn't importable by
 * a test runner at all. The copy exercised here is byte-identical to shared/'s by
 * construction: scripts/check-sync.mjs enforces that, and the Stop hook runs it.
 *
 * Deliberately exercises the real module against a real (jsdom) document rather than
 * mocking the DOM: what's under test IS the listener/overlay bookkeeping, so a stubbed
 * document would assert only that the stub was called. The popover's *rendering* host is
 * injected (`createPopoverInstance`), which is what makes this testable here at all
 * without either app's widget machinery — the fake below is the same `{mount, destroy}`
 * contract CompositeWidget (PWA) and createPopoverHost (Studio) satisfy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openWidgetPopover, closeWidgetPopover } from '../js/widgets/components/WidgetPopoverModal.js';

const POPOVER_DEF = { id: 'pop', kind: 'popover', components: [] };

/** Records what the module did to it: mount/destroy calls, and the callbacks it was handed. */
function makeFakeInstance(name, log) {
  const rec = { name, mounted: null, destroyCount: 0, onClosePopover: null, mountedWhileInDocument: null };
  rec.factory = ({ onClosePopover }) => {
    rec.onClosePopover = onClosePopover;
    return {
      mount(card) {
        rec.mounted = card;
        card.dataset.popover = name;
      },
      destroy() {
        rec.destroyCount += 1;
        // The module's own PopoverHostInstance contract says destroy() runs BEFORE the
        // overlay chrome leaves the document (BaseWidget.destroy() in flight-deck-pwa
        // detaches itself via element.parentNode, so it needs to still be attached).
        rec.destroyedWhileInDocument = document.body.contains(rec.mounted);
        log.push(`${name}:destroy`);
      }
    };
  };
  return rec;
}

function open(rec, hostWidget = { state: {} }) {
  openWidgetPopover({
    hostWidget,
    popoverWidgetId: 'pop',
    contextDecl: {},
    findPopoverDef: () => POPOVER_DEF,
    createPopoverInstance: rec.factory
  });
}

const overlay = () => document.getElementById('fd-widget-popover-modal');
const pressEscape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

describe('WidgetPopoverModal teardown bookkeeping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    closeWidgetPopover();
    document.body.innerHTML = '';
  });

  it('opening a second popover closes the first and leaves no stale Escape listener behind', () => {
    const log = [];
    const a = makeFakeInstance('a', log);
    const b = makeFakeInstance('b', log);

    open(a);
    open(b); // supersedes a

    expect(a.destroyCount).toBe(1);
    expect(overlay()?.firstElementChild?.dataset.popover).toBe('b');

    // If a's keydown listener survived, this Escape runs a's close() first, which nulls
    // the module's activePopover out from under b.
    pressEscape();

    expect(overlay()).toBeNull();
    expect(b.destroyCount).toBe(1);

    // ...and b really is untracked now, rather than merely looking closed: a second
    // Escape must not re-run anyone's teardown.
    pressEscape();
    expect(a.destroyCount).toBe(1);
    expect(b.destroyCount).toBe(1);
  });

  it('a superseded popover closing itself late does not orphan the live popover', () => {
    const log = [];
    const a = makeFakeInstance('a', log);
    const b = makeFakeInstance('b', log);

    const c = makeFakeInstance('c', log);

    open(a);
    const aCloseSelf = a.onClosePopover; // e.g. core.closePopover, or a timer a's destroy() missed
    open(b);

    aCloseSelf(); // fires against a popover that is no longer the active one

    // b is still the live popover: on screen, and untouched.
    expect(overlay()?.firstElementChild?.dataset.popover).toBe('b');
    expect(b.destroyCount).toBe(0);

    // The damage a stale close() does isn't visible on screen — it's that the module
    // forgets it is still tracking b. Opening c is what surfaces it: single-instance
    // teardown has to destroy b and drop b's Escape listener, which it can only do if
    // b is still the tracked popover.
    open(c);
    expect(b.destroyCount).toBe(1);
    expect(overlay()?.firstElementChild?.dataset.popover).toBe('c');

    pressEscape();
    expect(overlay()).toBeNull();
    expect(c.destroyCount).toBe(1);
    expect(b.destroyCount).toBe(1); // no orphaned b listener fired alongside c's
  });

  it('closeWidgetPopover() destroys the instance before detaching the overlay', () => {
    const log = [];
    const a = makeFakeInstance('a', log);

    open(a);
    closeWidgetPopover();

    expect(a.destroyCount).toBe(1);
    expect(a.destroyedWhileInDocument).toBe(true);
    expect(overlay()).toBeNull();
  });

  it('closeWidgetPopover() clears an orphaned overlay when nothing is tracked', () => {
    const orphan = document.createElement('div');
    orphan.id = 'fd-widget-popover-modal';
    document.body.appendChild(orphan);

    closeWidgetPopover();

    expect(overlay()).toBeNull();
  });

  it('still refuses a non-popover definition and a missing one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = makeFakeInstance('a', []);

    openWidgetPopover({
      hostWidget: {}, popoverWidgetId: 'nope', contextDecl: {},
      findPopoverDef: () => null, createPopoverInstance: a.factory
    });
    openWidgetPopover({
      hostWidget: {}, popoverWidgetId: 'pop', contextDecl: {},
      findPopoverDef: () => ({ id: 'pop', kind: 'widget' }), createPopoverInstance: a.factory
    });

    expect(overlay()).toBeNull();
    expect(a.onClosePopover).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
