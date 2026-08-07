export function focusDialogElement(
  element: HTMLElement | null,
  options: { select?: boolean } = {},
) {
  const timers: number[] = [];
  const frames: number[] = [];

  const focus = () => {
    if (!element?.isConnected) return;
    element.focus({ preventScroll: true });
    if (options.select && element instanceof HTMLInputElement) {
      element.select();
    }
  };

  focus();
  frames.push(
    window.requestAnimationFrame(() => {
      focus();
      frames.push(window.requestAnimationFrame(focus));
    }),
  );
  timers.push(window.setTimeout(focus, 0));
  timers.push(window.setTimeout(focus, 50));
  timers.push(window.setTimeout(focus, 150));

  return () => {
    for (const frame of frames) window.cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
  };
}
