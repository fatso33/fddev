// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { BindingsList } from '../js/ui/BindingsList.js';

/**
 * The PWA's bindings list shows one row per sim binding, and the write rows
 * follow the order of `WRITE_EVENT_BINDING_FIELDS` in the registry. These tests
 * pin that order for a Rotary, and that a write the Rotary never sends
 * (Write Deck Event in Pulse mode, the fast events without Acceleration) is
 * not listed.
 */

/** A Rotary carrying every write-event binding field, each under a distinct name. */
function rotaryDefinition(props) {
  return {
    components: [{
      id: 'rot',
      type: 'core.rotary',
      label: 'Heading',
      props,
      binding: {
        readSimVar: 'apHdgBugValue',
        writeEvent: 'writeEv',
        incrementEvent: 'incrementEv',
        decrementEvent: 'decrementEv',
        fastIncrementEvent: 'fastIncrementEv',
        fastDecrementEvent: 'fastDecrementEv',
        ackEvent: 'ackEv',
        pushEvent: 'pushEv'
      }
    }]
  };
}

/** The list's rows as they appear on screen, top to bottom. */
function listedRows(container) {
  return [...container.querySelectorAll('.fd-bl-row')].map((row) => ({
    kind: row.querySelector('.fd-bl-tag').textContent,
    name: row.querySelector('[data-bl-input]').value
  }));
}

describe('BindingsList row order for a Rotary', () => {
  let container;
  let list;

  beforeEach(() => {
    container = document.createElement('div');
    list = new BindingsList();
    list.mount(container);
  });

  it('lists a Pulse Rotary with Acceleration: read, then Increment, Decrement, Fast Increment, Fast Decrement, Acknowledge, Push', () => {
    expect(list.load(rotaryDefinition({ writeMode: 'pulse', acceleration: true }))).toBe(true);

    expect(listedRows(container)).toEqual([
      { kind: 'read', name: 'apHdgBugValue' },
      { kind: 'write', name: 'incrementEv' },
      { kind: 'write', name: 'decrementEv' },
      { kind: 'write', name: 'fastIncrementEv' },
      { kind: 'write', name: 'fastDecrementEv' },
      { kind: 'write', name: 'ackEv' },
      { kind: 'write', name: 'pushEv' }
    ]);
  });

  it('does not list Write Deck Event on a Pulse Rotary, which never sends it', () => {
    list.load(rotaryDefinition({ writeMode: 'pulse', acceleration: true }));

    expect(listedRows(container).map((r) => r.name)).not.toContain('writeEv');
  });

  it('lists an Absolute Rotary: read, then Write, Increment, Decrement, Acknowledge, Push, without the fast events', () => {
    list.load(rotaryDefinition({ writeMode: 'absolute', acceleration: true }));

    expect(listedRows(container)).toEqual([
      { kind: 'read', name: 'apHdgBugValue' },
      { kind: 'write', name: 'writeEv' },
      { kind: 'write', name: 'incrementEv' },
      { kind: 'write', name: 'decrementEv' },
      { kind: 'write', name: 'ackEv' },
      { kind: 'write', name: 'pushEv' }
    ]);
  });

  it('omits the fast events on a Pulse Rotary whose Acceleration is off', () => {
    list.load(rotaryDefinition({ writeMode: 'pulse', acceleration: false }));

    expect(listedRows(container).map((r) => r.name)).toEqual([
      'apHdgBugValue', 'incrementEv', 'decrementEv', 'ackEv', 'pushEv'
    ]);
  });
});
