// Small, optional delights: theme switch, a ripple on background clicks, and elements that can be
// dragged around and spring back. Everything is transform/opacity only and respects reduced motion.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function setUpThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const root = document.documentElement;
  button?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', root.dataset.theme);
    } catch {
      // Private mode: the choice just won't be remembered.
    }
  });
}

function setUpRipple() {
  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion.matches || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('a, button, input, select, textarea, label, summary, dialog, [data-spring], .file-list')) return;
    const ripple = document.createElement('span');
    ripple.className = 'tap-ripple';
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    ripple.addEventListener('animationend', () => ripple.remove());
    document.body.append(ripple);
  });
}

/** Lets an element follow the pointer, then springs it back to where it started. */
function springDrag(element: HTMLElement) {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

  element.addEventListener('pointerdown', (event) => {
    // Links only drag with a mouse, so taps and scrolling on touch screens behave normally.
    if (event.button !== 0 || (element instanceof HTMLAnchorElement && event.pointerType !== 'mouse')) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved) {
      if (Math.hypot(dx, dy) < 6) return;
      moved = true;
      element.setPointerCapture(event.pointerId);
      element.classList.remove('returning');
      element.classList.add('dragging');
    }
    element.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 25}deg)`;
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (!moved) return;
    element.classList.remove('dragging');
    element.classList.add('returning');
    element.style.transform = '';
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('transitionend', () => element.classList.remove('returning'));
  // A drag that ends on a link must not also open it.
  element.addEventListener(
    'click',
    (event) => {
      if (!moved) return;
      event.preventDefault();
      moved = false;
    },
    true,
  );
}

export function setUpEffects() {
  setUpThemeToggle();
  setUpRipple();
  document.querySelectorAll<HTMLElement>('[data-spring]').forEach(springDrag);
}
