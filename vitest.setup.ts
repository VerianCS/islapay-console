import '@testing-library/jest-dom/vitest';

/**
 * jsdom ships `<dialog>` without `showModal`.
 *
 * A gap in the test environment, not in the console: the element, its
 * focus trapping and its Escape handling are the browser's and are not this
 * repository's to test. What these tests are about is the form inside, so the
 * two methods are given just enough behaviour to open and close.
 *
 * Deliberately not a full polyfill. One that faked focus trapping would let a
 * test assert accessibility the real page might not have.
 */
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };

  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, value?: string) {
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  };
}
