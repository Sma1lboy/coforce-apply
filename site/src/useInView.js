import { useEffect, useRef, useState } from 'react';

// Adds `is-in` to a section once it has scrolled into view, which is all the
// reveal/draw/run animations key off. IntersectionObserver plus a class beats a
// motion library for this: nothing to install, nothing to hydrate, and the
// reduced-motion rule in index.css neutralises every one of them at once.
//
// It unobserves after firing — these are entrances, not scroll-linked effects,
// and re-playing them when the user scrolls back up is the thing that makes a
// page feel restless.
export function useInView({ threshold = 0.18, once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer (or a very old browser): show everything rather than leaving
    // the page permanently blank.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setInView(true);
          if (once) observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return [ref, inView];
}

// Convenience for the common shape: spread onto a section to get the ref and the
// class together.
export function inViewProps(className = '') {
  return (ref, inView) => ({
    ref,
    className: `${className}${inView ? ' is-in' : ''}`.trim(),
  });
}
