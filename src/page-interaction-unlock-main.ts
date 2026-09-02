export function installPageInteractionUnlock(): void {
  const stateKey = '__pixelScopeInteractionUnlockInstalled__';
  const patchVersion = 2;
  const pageWindow = window as Window & { __pixelScopeInteractionUnlockInstalled__?: boolean | number };
  if (pageWindow[stateKey] === patchVersion) return;

  const unlockedEventTypes = new Set(['contextmenu', 'dragstart', 'selectstart']);
  const originalPreventDefault: unknown = Reflect.get(Event.prototype, 'preventDefault');
  const originalStopImmediatePropagation: unknown = Reflect.get(Event.prototype, 'stopImmediatePropagation');
  if (typeof originalPreventDefault !== 'function' || typeof originalStopImmediatePropagation !== 'function') return;
  pageWindow[stateKey] = patchVersion;

  Event.prototype.preventDefault = function preventDefault(this: Event): void {
    const interactionsUnlocked = document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked');
    const pixelScopeToolActive = document.documentElement.hasAttribute('data-pixelscope-tool-active');
    if (!interactionsUnlocked || pixelScopeToolActive || !unlockedEventTypes.has(this.type)) Reflect.apply(originalPreventDefault, this, []);
  };
  Event.prototype.stopImmediatePropagation = function stopImmediatePropagation(this: Event): void {
    const isPixelScopeShortcut = this instanceof KeyboardEvent && this.type === 'keydown'
      && this.altKey && !this.ctrlKey && !this.metaKey && !this.shiftKey && !this.repeat && this.code === 'Backquote';
    if (!isPixelScopeShortcut) Reflect.apply(originalStopImmediatePropagation, this, []);
  };
  const allowDefaultInteraction = (event: Event): void => {
    if (!document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')
      || document.documentElement.hasAttribute('data-pixelscope-tool-active')) return;
    event.stopImmediatePropagation();
  };
  for (const type of unlockedEventTypes) window.addEventListener(type, allowDefaultInteraction, { capture: true });
}
