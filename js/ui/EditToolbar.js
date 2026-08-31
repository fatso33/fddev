/**
 * EditToolbar.js
 * Top toolbar for Interactive Edit Mode — occupies the same flex slot as
 * the app's normal header bar (.top-bar), which it hides while shown, so
 * editing gets the header's own vertical space instead of overlapping the
 * bottom of the widget grid. See docs/... (root README) for why this
 * replaced the previous fixed-bottom bar.
 */

export class EditToolbar {
  constructor({ onAddWidget, onUndo, onSave, onCancel, onRevertPage, onCompactLayout, onToggleAutoReposition, autoRepositionEnabled = false, eventBus }) {
    this.onAddWidget = onAddWidget;
    this.onUndo = onUndo;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.onRevertPage = onRevertPage;
    this.onCompactLayout = onCompactLayout;
    this.onToggleAutoReposition = onToggleAutoReposition;
    this.autoRepositionEnabled = autoRepositionEnabled;
    this.eventBus = eventBus;
    this.element = null;
    this.headerEl = null;
    this.currentOrientation = 'portrait';
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-edit-toolbar hidden';
    this.render();

    // Insert right after the header (not appended at the end) so it takes
    // the header's own place in #app's normal flex-column flow.
    this.headerEl = container.querySelector('.top-bar');
    if (this.headerEl) {
      this.headerEl.insertAdjacentElement('afterend', this.element);
    } else {
      container.appendChild(this.element);
    }
  }

  setOrientation(orientation) {
    this.currentOrientation = orientation;
  }

  render() {
    this.element.innerHTML = `
      <div class="fd-edit-toolbar-inner">
        <button type="button" id="tb-cancel-btn" class="fd-tb-btn fd-tb-btn-cancel" title="Discard Changes">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span>Discard</span>
        </button>

        <button type="button" id="tb-undo-btn" class="fd-tb-btn fd-tb-btn-undo" title="Undo Layout Change">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          <span>Undo</span>
        </button>

        <button type="button" id="tb-add-widget-btn" class="fd-tb-btn fd-tb-btn-add" title="Add Avionics Widget">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Add</span>
        </button>

        <button type="button" id="tb-compact-btn" class="fd-tb-btn fd-tb-btn-compact" title="Compact Layout (Close Gaps)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 10l5 5 5-5"/><path d="M7 4l5 5 5-5"/></svg>
          <span>Compact</span>
        </button>

        <button type="button" id="tb-revert-btn" class="fd-tb-btn fd-tb-btn-revert" title="Revert This Page To Default">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          <span>Revert</span>
        </button>

        <button type="button" id="tb-save-btn" class="fd-tb-btn fd-tb-btn-save" title="Save Layout">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Save</span>
        </button>

        <button type="button" id="tb-autoreposition-btn" class="fd-tb-btn fd-tb-btn-autoreposition ${this.autoRepositionEnabled ? 'is-on' : 'is-off'}" title="Toggle Auto-Reposition: when on, dropping a widget onto another nudges it out of the way; when off, an overlapping drop is refused">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3L4 7l4 4"/><path d="M4 7h9a4 4 0 0 1 4 4v1"/><path d="M16 21l4-4-4-4"/><path d="M20 17h-9a4 4 0 0 1-4-4v-1"/></svg>
          <span>Nudge</span>
        </button>
      </div>
    `;

    this.element.querySelector('#tb-add-widget-btn').addEventListener('click', () => {
      if (this.onAddWidget) this.onAddWidget();
    });

    this.element.querySelector('#tb-undo-btn').addEventListener('click', () => {
      if (this.onUndo) this.onUndo();
    });

    this.element.querySelector('#tb-cancel-btn').addEventListener('click', () => {
      if (this.onCancel) this.onCancel();
    });

    this.element.querySelector('#tb-save-btn').addEventListener('click', () => {
      if (this.onSave) this.onSave();
    });

    this.element.querySelector('#tb-revert-btn').addEventListener('click', () => {
      if (this.onRevertPage) this.onRevertPage();
    });

    this.element.querySelector('#tb-compact-btn').addEventListener('click', () => {
      if (this.onCompactLayout) this.onCompactLayout();
    });

    this.element.querySelector('#tb-autoreposition-btn').addEventListener('click', () => {
      if (this.onToggleAutoReposition) this.onToggleAutoReposition();
    });
  }

  /**
   * Mirrors FlightDeckApp.autoRepositionEnabled onto the toggle button's
   * visual state -- the button's click just calls onToggleAutoReposition(),
   * the actual boolean lives in app.js, so this is how it gets pushed back
   * down (same pattern as setOrientation()).
   * @param {boolean} enabled
   */
  setAutoRepositionState(enabled) {
    this.autoRepositionEnabled = enabled;
    const btn = this.element?.querySelector('#tb-autoreposition-btn');
    if (!btn) return;
    btn.classList.toggle('is-on', enabled);
    btn.classList.toggle('is-off', !enabled);
  }

  show() {
    if (this.element) {
      this.element.classList.remove('hidden');
    }
    if (this.headerEl) {
      this.headerEl.style.display = 'none';
    }
  }

  hide() {
    if (this.element) {
      this.element.classList.add('hidden');
    }
    if (this.headerEl) {
      this.headerEl.style.display = '';
    }
  }
}

