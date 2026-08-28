/**
 * EditToolbar.js
 * Hardware-Accelerated Bottom Toolbar for Interactive Edit Mode
 */

export class EditToolbar {
  constructor({ onAddWidget, onUndo, onSave, onCancel, onRevertPage, eventBus }) {
    this.onAddWidget = onAddWidget;
    this.onUndo = onUndo;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.onRevertPage = onRevertPage;
    this.eventBus = eventBus;
    this.element = null;
    this.currentOrientation = 'portrait';
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-edit-toolbar hidden';
    this.render();
    container.appendChild(this.element);
  }

  setOrientation(orientation) {
    this.currentOrientation = orientation;
  }

  render() {
    this.element.innerHTML = `
      <div class="fd-edit-toolbar-inner">
        <button type="button" id="tb-cancel-btn" class="fd-tb-btn fd-tb-btn-cancel" title="Discard Changes">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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

        <button type="button" id="tb-revert-btn" class="fd-tb-btn fd-tb-btn-revert" title="Revert This Page To Default">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          <span>Revert Page</span>
        </button>

        <button type="button" id="tb-save-btn" class="fd-tb-btn fd-tb-btn-save" title="Save Layout">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Save</span>
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
  }

  show() {
    if (this.element) {
      this.element.classList.remove('hidden');
    }
  }

  hide() {
    if (this.element) {
      this.element.classList.add('hidden');
    }
  }
}

