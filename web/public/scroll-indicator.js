/* global document, window, ResizeObserver */

const ARROW_COUNT = 20;
const MOBILE_MAX_WIDTH = '(max-width: 800px)';

/** User portal: hide chevron rail on phone — native touch scroll is enough. */
export function isUserPortalScrollIndicatorSuppressed() {
  if (typeof window === 'undefined') return false;
  return (
    document.body.classList.contains('user-portal') &&
    window.matchMedia(MOBILE_MAX_WIDTH).matches
  );
}

export function scrollIndicatorMarkup() {
  return Array.from({ length: ARROW_COUNT }, () => '<div class="arrow"></div>').join('');
}

/**
 * Right-edge scroll chevrons for `.main` (portal content area).
 * @returns {() => void} cleanup
 */
export function initScrollIndicator(scrollerSelector = '.main', indicatorId = 'scrollIndicator') {
  const scroller = document.querySelector(scrollerSelector);
  const indicator = document.getElementById(indicatorId);
  if (!scroller || !indicator) return () => {};

  let prevTop = scroller.scrollTop;
  let clearTimer = null;
  let resizeTimer = null;

  function updateScrollable() {
    if (isUserPortalScrollIndicatorSuppressed()) {
      indicator.classList.remove('is-scrollable', 'up', 'down');
      scroller.classList.remove('has-scroll-indicator');
      return;
    }
    const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
    indicator.classList.toggle('is-scrollable', canScroll);
    scroller.classList.toggle('has-scroll-indicator', canScroll);
    if (!canScroll) indicator.classList.remove('up', 'down');
  }

  function pulseDirection(dir) {
    if (!dir || !indicator.classList.contains('is-scrollable')) return;
    indicator.classList.remove('up', 'down');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => indicator.classList.add(dir));
    });
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => indicator.classList.remove('up', 'down'), 1000);
  }

  const onScroll = () => {
    if (isUserPortalScrollIndicatorSuppressed() || !indicator.classList.contains('is-scrollable')) return;
    const currentTop = scroller.scrollTop;
    const dir = currentTop > prevTop ? 'down' : currentTop < prevTop ? 'up' : '';
    prevTop = currentTop;
    pulseDirection(dir);
  };

  const onClick = (ev) => {
    if (isUserPortalScrollIndicatorSuppressed() || !indicator.classList.contains('is-scrollable')) return;
    const rect = indicator.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const goingUp = ev.clientY < mid;
    scroller.scrollBy({
      top: goingUp ? -scroller.clientHeight * 0.82 : scroller.clientHeight * 0.82,
      behavior: 'smooth',
    });
    pulseDirection(goingUp ? 'up' : 'down');
  };

  const scheduleMeasure = () => {
    window.requestAnimationFrame(updateScrollable);
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleMeasure, 80);
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  indicator.addEventListener('click', onClick);
  window.addEventListener('resize', onResize, { passive: true });

  const mobileMq = window.matchMedia(MOBILE_MAX_WIDTH);
  const onMobileMq = () => scheduleMeasure();
  mobileMq.addEventListener('change', onMobileMq);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleMeasure);
    ro.observe(scroller);
    document.querySelectorAll('.tab-panel').forEach((panel) => ro.observe(panel));
  }

  scheduleMeasure();

  return () => {
    scroller.removeEventListener('scroll', onScroll);
    indicator.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    mobileMq.removeEventListener('change', onMobileMq);
    if (resizeTimer) clearTimeout(resizeTimer);
    if (clearTimer) clearTimeout(clearTimer);
    ro?.disconnect();
    indicator.classList.remove('is-scrollable', 'up', 'down');
    scroller.classList.remove('has-scroll-indicator');
  };
}

/** Re-check after tab/content changes (legacy user portal). */
export function remeasureScrollIndicator(scrollerSelector = '.main', indicatorId = 'scrollIndicator') {
  const scroller = document.querySelector(scrollerSelector);
  const indicator = document.getElementById(indicatorId);
  if (!scroller || !indicator) return;
  if (isUserPortalScrollIndicatorSuppressed()) {
    indicator.classList.remove('is-scrollable', 'up', 'down');
    scroller.classList.remove('has-scroll-indicator');
    return;
  }
  const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
  indicator.classList.toggle('is-scrollable', canScroll);
  scroller.classList.toggle('has-scroll-indicator', canScroll);
  if (!canScroll) indicator.classList.remove('up', 'down');
}
