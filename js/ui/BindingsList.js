/**
 * BindingsList.js
 * Release 1.1-C: the PWA's per-component bindings list.
 *
 * Replaces 0.1-D's hidden generic binding fields for composite widgets. Those
 * fields wrote `config.binding.readSimVar`/`writeEvent`, which CompositeWidget
 * has never read — so they were hidden rather than fixed, leaving the phone
 * able to *see* a broken binding but not touch it. This is the editor that
 * makes the difference.
 *
 * Why the phone and not just Studio: the phone is where you find out something
 * is wrong — sitting on the runway, tapping a button that does nothing. Studio
 * lives on the PC behind the sim. Being able to diagnose a binding but having
 * to alt-tab out of a flight to change it is the bottleneck this removes.
 *
 * One row per binding SITE, not per component: a core.input carries both a
 * read and a write and they fail independently, so they get a row each.
 * Rows come from shared/widgetVarExtractor.js's extractBindingRows(), which
 * shares its traversal with the name extractor so the two can't disagree about
 * what counts as a binding.
 *
 * Edits are staged in a working copy and only reach the widget when the
 * inspector's Apply Changes is pressed — Cancel must genuinely discard, which
 * is the same contract seedFromContext established for popover scratch state.
 */

import { SecurityValidator } from '../core/SecurityValidator.js';
import { extractBindingRows, applyBindingRow } from '../core/widgetVarExtractor.js';

export class BindingsList {
  /**
   * @param {object} opts
   * @param {object} opts.simBridge - live PC Bridge connection, for resolve/probe/fire
   */
  constructor({ simBridge } = {}) {
    this.simBridge = simBridge;
    this.container = null;
    this.workingDef = null;
    this.rows = [];
    this.dirty = false;
  }

  mount(container) {
    this.container = container;
    // Delegated once at mount rather than per row — rows are re-rendered on
    // every load and per-row listeners would accumulate on the same node.
    container.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-bl-action]');
      if (!actionBtn) return;
      const idx = Number(actionBtn.dataset.blIndex);
      if (actionBtn.dataset.blAction === 'fire') this.handleFire(idx);
      else if (actionBtn.dataset.blAction === 'probe') this.handleProbe(idx);
    });
    container.addEventListener('change', (e) => {
      const input = e.target.closest('[data-bl-input]');
      if (input) this.handleRename(Number(input.dataset.blIndex), input.value);
    });
  }

  /**
   * @param {object|null} definition - the widget's config.definition
   * @returns {boolean} whether this widget has any sim bindings to show
   */
  load(definition) {
    this.dirty = false;
    this.workingDef = definition ? JSON.parse(JSON.stringify(definition)) : null;
    this.rows = this.workingDef ? extractBindingRows(this.workingDef) : [];
    this.render();
    return this.rows.length > 0;
  }

  /** The edited definition, or null if nothing changed (so save can skip it). */
  getDefinition() {
    return this.dirty ? this.workingDef : null;
  }

  render() {
    if (!this.container) return;
    if (!this.rows.length) {
      this.container.innerHTML = '';
      return;
    }

    const rowsHtml = this.rows.map((row, i) => {
      const isWrite = row.kind === 'write';
      // A raw A:/L:/H:/K: address bypasses the profile entirely (FDWS v1.2
      // §1.5), so it has no "resolves to" line to wait for — say so up front
      // instead of showing a spinner that never resolves.
      const resolvedText = row.isRaw ? 'Raw address — sent to the sim as typed.' : 'Resolving…';
      const btn = isWrite
        ? `<button type="button" class="fd-bl-btn" data-bl-action="fire" data-bl-index="${i}" title="Fire this now${row.value !== undefined ? ` (value ${row.value})` : ''}">▶</button>`
        : `<button type="button" class="fd-bl-btn" data-bl-action="probe" data-bl-index="${i}" title="Read this now">↻</button>`;

      return `
        <div class="fd-bl-row" data-bl-row="${i}">
          <div class="fd-bl-head">
            <span class="fd-bl-label">${escapeHtml(row.componentLabel)}</span>
            <span class="fd-bl-tag fd-bl-tag-${row.kind}">${row.kind}</span>
            ${row.source === 'interaction' ? `<span class="fd-bl-tag fd-bl-tag-src">${escapeHtml(row.trigger || 'tap')}</span>` : ''}
          </div>
          <div class="fd-bl-edit">
            <input type="text" data-bl-input data-bl-index="${i}" value="${escapeHtml(row.name)}" spellcheck="false" autocapitalize="off" autocomplete="off" />
            ${btn}
          </div>
          <div class="fd-bl-resolved" data-bl-resolved="${i}">${escapeHtml(resolvedText)}</div>
        </div>`;
    }).join('');

    this.container.innerHTML = `
      <div class="fd-insp-field">
        <label>Bindings (${this.rows.length})</label>
        <div class="fd-bl-list">${rowsHtml}</div>
      </div>`;

    this.resolveAll();
  }

  /**
   * Fills in each row's "resolves to" line. Fire-and-forget per row: one
   * unmapped or slow name must not stop the rest of the list from resolving,
   * the same error-isolation rule the polling batch needed.
   */
  resolveAll() {
    if (!this.simBridge?.connected) {
      this.rows.forEach((row, i) => {
        if (!row.isRaw) this.setResolved(i, 'PC Bridge not connected — cannot resolve or test.');
      });
      return;
    }
    this.rows.forEach((row, i) => {
      if (row.isRaw) return;
      this.simBridge.resolveDeckEvent(row.name, row.kind)
        .then((res) => {
          if (!res) {
            this.setResolved(i, `Not mapped in this profile — ${row.kind === 'write' ? 'this control does nothing' : 'no value will arrive'}.`, true);
            return;
          }
          this.setResolved(i, row.kind === 'write'
            ? `→ ${res.event}${res.valueFormat ? ` (${res.valueFormat})` : ''} · ${res.profileName}`
            : `→ ${res.simVar}${res.unit ? ` (${res.unit})` : ''} · ${res.profileName}`);
        })
        .catch(() => this.setResolved(i, 'Could not resolve.', true));
    });
  }

  setResolved(index, text, isWarning = false) {
    const el = this.container?.querySelector(`[data-bl-resolved="${index}"]`);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('fd-bl-warn', isWarning);
  }

  handleRename(index, rawValue) {
    const row = this.rows[index];
    if (!row) return;
    const trimmed = String(rawValue || '').trim();
    const clean = trimmed
      ? (row.kind === 'write' ? SecurityValidator.sanitizeEventName(trimmed) : SecurityValidator.sanitizeSimVar(trimmed))
      : '';
    if (clean === row.name) return;

    applyBindingRow(this.workingDef, row, clean);
    row.name = clean;
    row.isRaw = /^(A|L|H|K):/i.test(clean);
    this.dirty = true;

    // Reflect any sanitizer rewrite back into the field, so a silently
    // mangled name can't sit there looking like what was typed.
    const input = this.container?.querySelector(`[data-bl-input][data-bl-index="${index}"]`);
    if (input && input.value !== clean) input.value = clean;

    if (!clean) { this.setResolved(index, 'Cleared — this binding does nothing.', true); return; }
    if (row.isRaw) { this.setResolved(index, 'Raw address — sent to the sim as typed.'); return; }
    this.setResolved(index, 'Resolving…');
    if (!this.simBridge?.connected) { this.setResolved(index, 'PC Bridge not connected — cannot resolve or test.'); return; }
    this.simBridge.resolveDeckEvent(clean, row.kind)
      .then((res) => {
        if (!res) { this.setResolved(index, 'Not mapped in this profile yet.', true); return; }
        this.setResolved(index, row.kind === 'write'
          ? `→ ${res.event}${res.valueFormat ? ` (${res.valueFormat})` : ''} · ${res.profileName}`
          : `→ ${res.simVar}${res.unit ? ` (${res.unit})` : ''} · ${res.profileName}`);
      })
      .catch(() => this.setResolved(index, 'Could not resolve.', true));
  }

  /**
   * ⚠ Fires for real, into the running sim. There is no dry run — the whole
   * point is to confirm the binding moves the actual aircraft. Uses the row's
   * own dispatch value where it has one so the test matches what a tap does;
   * a plain writeEvent binding has no declared value, and 1 is the activate
   * convention across the catalog (com1Swap, xpndrIdent).
   */
  handleFire(index) {
    const row = this.rows[index];
    if (!row) return;
    if (!row.name) { this.setResolved(index, 'Nothing to fire — this binding is empty.', true); return; }
    if (!this.simBridge?.connected) { this.setResolved(index, 'PC Bridge not connected.', true); return; }
    const value = row.value !== undefined ? row.value : 1;
    try {
      this.simBridge.sendEvent(row.name, value);
      this.setResolved(index, `Fired ${row.name} (value ${value}) — watch the aircraft.`);
    } catch (err) {
      this.setResolved(index, `Could not fire: ${err.message}`, true);
    }
  }

  handleProbe(index) {
    const row = this.rows[index];
    if (!row) return;
    if (!row.name) { this.setResolved(index, 'Nothing to read — this binding is empty.', true); return; }
    if (!this.simBridge?.connected) { this.setResolved(index, 'PC Bridge not connected.', true); return; }
    this.setResolved(index, 'Reading…');

    // A bare Deck Event has to be resolved to a real address before it can be
    // probed — probeReadSimVar takes a raw name, not a logical one.
    const addressOf = row.isRaw
      ? Promise.resolve({ simVar: row.name, unit: '' })
      : this.simBridge.resolveDeckEvent(row.name, 'read');

    addressOf
      .then((res) => {
        if (!res || !res.simVar) throw new Error('not mapped in this profile');
        return this.simBridge.probeReadSimVar(res.simVar, res.unit || '')
          .then((value) => this.setResolved(index, `${res.simVar} = ${value}`));
      })
      .catch((err) => this.setResolved(index, `Could not read: ${err.message}`, true));
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
