export function installPageInteractionUnlock(): void {
  const stateKey = '__pixelScopeInteractionUnlockInstalled__';
  const pageWindow = window as Window & { __pixelScopeInteractionUnlockInstalled__?: boolean };
  if (pageWindow[stateKey]) return;
  pageWindow[stateKey] = true;

  const unlockedEventTypes = new Set(['contextmenu', 'dragstart', 'selectstart']);
  const originalPreventDefault: unknown = Reflect.get(Event.prototype, 'preventDefault');
  if (typeof originalPreventDefault !== 'function') return;
  Event.prototype.preventDefault = function preventDefault(this: Event): void {
    const interactionsUnlocked = document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked');
    const pixelScopeToolActive = document.documentElement.hasAttribute('data-pixelscope-tool-active');
    if (!interactionsUnlocked || pixelScopeToolActive || !unlockedEventTypes.has(this.type)) Reflect.apply(originalPreventDefault, this, []);
  };
  const allowDefaultInteraction = (event: Event): void => {
    if (!document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')
      || document.documentElement.hasAttribute('data-pixelscope-tool-active')) return;
    event.stopImmediatePropagation();
  };
  for (const type of unlockedEventTypes) window.addEventListener(type, allowDefaultInteraction, { capture: true });
}
