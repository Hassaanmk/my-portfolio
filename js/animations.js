/* ===================================================================
 * Motion layer
 *
 * No dependencies. Everything animates transform/opacity only, runs
 * off a single rAF scroll bus and a single IntersectionObserver, and
 * is skipped entirely when the user prefers reduced motion.
 * ------------------------------------------------------------------- */

(function () {

    'use strict';

    const html = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    const prefersReduced = function () {
        return reduceMotion.matches;
    };

    const clamp = function (value, min, max) {
        return Math.min(Math.max(value, min), max);
    };


    /* preloader watchdog
     *
     * The hero reveal is gated on body.ss-show, which the preloader only
     * adds after its fade-out `transitionend` fires. If that event is
     * ever missed — interrupted transition, restored tab, a browser that
     * skips it — the headline would stay masked forever. Force the flag
     * shortly after load so the hero cannot get stuck.
     * -------------------------------------------------- */
    (function preloaderWatchdog() {

        function force() {
            window.setTimeout(function () {
                if (document.body.classList.contains('ss-show')) return;
                html.classList.remove('ss-preload');
                html.classList.add('ss-loaded');
                document.body.classList.add('ss-show');
                const preloader = document.querySelector('#preloader');
                if (preloader) preloader.style.display = 'none';
            }, 1200);
        }

        if (document.readyState === 'complete') force();
        else window.addEventListener('load', force);

    })();


    /* rAF scroll bus
     * One scroll listener for the whole page. Subscribers get called
     * at most once per frame with the current scroll position.
     * -------------------------------------------------- */
    const scrollBus = (function () {

        const subscribers = [];
        let ticking = false;

        function flush() {
            ticking = false;
            const y = window.pageYOffset || document.documentElement.scrollTop || 0;
            for (let i = 0; i < subscribers.length; i++) {
                subscribers[i](y);
            }
        }

        function onScroll() {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(flush);
        }

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });

        return {
            add: function (fn) {
                subscribers.push(fn);
                fn(window.pageYOffset || 0);
            }
        };

    })();


    /* shared reveal observer
     * -------------------------------------------------- */
    const revealObserver = (function () {

        const targets = document.querySelectorAll('[data-reveal]');
        if (!targets.length) return null;

        if (prefersReduced() || !('IntersectionObserver' in window)) {
            targets.forEach(function (el) { el.classList.add('is-revealed'); });
            return null;
        }

        function reveal(el) {
            if (el.classList.contains('is-revealed')) return;

            const delay = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);
            el.style.setProperty('--reveal-delay', delay + 'ms');
            el.classList.add('is-revealed');

            // line-mask children inside this block cascade after it
            el.querySelectorAll('.line-inner').forEach(function (line, i) {
                line.style.setProperty('--line-delay', (delay + 80 + i * 90) + 'ms');
            });

            // release the compositor hint once the transition is done
            window.setTimeout(function () {
                el.style.willChange = 'auto';
            }, delay + 900);

            observer.unobserve(el);
        }

        // threshold 0 so short elements that flash past during a fast
        // scroll still trigger on any intersection at all
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) reveal(entry.target);
            });
        }, {
            rootMargin: '0px 0px -8% 0px',
            threshold: 0
        });

        targets.forEach(function (el) { observer.observe(el); });

        /* Safety net.
         *
         * IntersectionObserver can miss an element that enters and leaves
         * between callbacks during fast or programmatic scrolling, which
         * would leave that content permanently at opacity 0. Sweep on
         * every scroll frame and reveal anything already scrolled into
         * or past the viewport. Elements are unobserved once revealed,
         * so this costs nothing after the first pass.
         */
        scrollBus.add(function () {
            const pending = document.querySelectorAll('[data-reveal]:not(.is-revealed)');
            if (!pending.length) return;
            const limit = window.innerHeight * 0.95;
            pending.forEach(function (el) {
                if (el.getBoundingClientRect().top < limit) reveal(el);
            });
        });

        return observer;

    })();


    /* scroll progress bar
     * -------------------------------------------------- */
    const ssScrollProgress = function () {

        const bar = document.querySelector('.scroll-progress__bar');
        if (!bar) return;

        scrollBus.add(function (y) {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const ratio = max > 0 ? clamp(y / max, 0, 1) : 0;
            bar.style.transform = 'scaleX(' + ratio + ')';
        });

    };


    /* hero: scroll parallax + pointer tilt
     * -------------------------------------------------- */
    const ssHero = function () {

        const media = document.querySelector('.hero-media__parallax');
        const intro = document.querySelector('#intro');
        if (!media || !intro || prefersReduced()) return;

        scrollBus.add(function (y) {
            const height = intro.offsetHeight || 1;
            if (y > height) return;
            const shift = clamp(y * 0.12, 0, 90);
            media.style.setProperty('--hero-shift', shift.toFixed(2) + 'px');
        });

        if (!finePointer.matches) return;

        let queued = false;
        let pointerX = 0;
        let pointerY = 0;

        intro.addEventListener('mousemove', function (e) {
            pointerX = e.clientX;
            pointerY = e.clientY;
            if (queued) return;
            queued = true;
            window.requestAnimationFrame(function () {
                queued = false;
                const rect = intro.getBoundingClientRect();
                const dx = (pointerX - rect.left) / rect.width - 0.5;
                const dy = (pointerY - rect.top) / rect.height - 0.5;
                media.style.setProperty('--hero-ry', (dx * 6).toFixed(2) + 'deg');
                media.style.setProperty('--hero-rx', (-dy * 4).toFixed(2) + 'deg');
            });
        });

        intro.addEventListener('mouseleave', function () {
            media.style.setProperty('--hero-ry', '0deg');
            media.style.setProperty('--hero-rx', '0deg');
        });

    };


    /* 3D cursor tilt on cards
     * -------------------------------------------------- */
    const ssTiltCards = function () {

        const cards = document.querySelectorAll('.tilt-card');
        if (!cards.length || prefersReduced() || !finePointer.matches) return;

        const MAX_TILT = 5;

        cards.forEach(function (card) {

            let queued = false;
            let px = 0;
            let py = 0;

            function reset() {
                card.classList.remove('is-tilting');
                card.style.transform = '';
                card.style.willChange = 'auto';
            }

            card.addEventListener('mouseenter', function () {
                card.classList.add('is-tilting');
                card.style.willChange = 'transform';
            });

            card.addEventListener('mousemove', function (e) {
                px = e.clientX;
                py = e.clientY;
                if (queued) return;
                queued = true;
                window.requestAnimationFrame(function () {
                    queued = false;
                    const rect = card.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const dx = (px - rect.left) / rect.width - 0.5;
                    const dy = (py - rect.top) / rect.height - 0.5;
                    card.style.transform =
                        'perspective(1200px) translate3d(0, -4px, 0) ' +
                        'rotateX(' + (-dy * MAX_TILT).toFixed(2) + 'deg) ' +
                        'rotateY(' + (dx * MAX_TILT).toFixed(2) + 'deg)';
                });
            });

            card.addEventListener('mouseleave', reset);
            card.addEventListener('blur', reset, true);
        });

    };


    /* magnetic buttons
     * -------------------------------------------------- */
    const ssMagnetic = function () {

        const buttons = document.querySelectorAll('.btn--magnetic');
        if (!buttons.length || prefersReduced() || !finePointer.matches) return;

        const STRENGTH = 0.28;

        buttons.forEach(function (btn) {

            let queued = false;
            let px = 0;
            let py = 0;

            btn.addEventListener('mousemove', function (e) {
                px = e.clientX;
                py = e.clientY;
                if (queued) return;
                queued = true;
                window.requestAnimationFrame(function () {
                    queued = false;
                    const rect = btn.getBoundingClientRect();
                    const mx = (px - rect.left - rect.width / 2) * STRENGTH;
                    const my = (py - rect.top - rect.height / 2) * STRENGTH;
                    btn.style.setProperty('--mx', clamp(mx, -14, 14).toFixed(1) + 'px');
                    btn.style.setProperty('--my', clamp(my, -10, 10).toFixed(1) + 'px');
                });
            });

            btn.addEventListener('mouseleave', function () {
                btn.style.setProperty('--mx', '0px');
                btn.style.setProperty('--my', '0px');
            });
        });

    };


    /* custom cursor
     * -------------------------------------------------- */
    const ssCursor = function () {

        const dot = document.querySelector('.cursor-dot');
        const ring = document.querySelector('.cursor-ring');
        if (!dot || !ring || prefersReduced() || !finePointer.matches) return;

        html.classList.add('has-cursor');

        let targetX = window.innerWidth / 2;
        let targetY = window.innerHeight / 2;
        let ringX = targetX;
        let ringY = targetY;
        let running = false;

        function loop() {
            ringX += (targetX - ringX) * 0.16;
            ringY += (targetY - ringY) * 0.16;
            ring.style.transform = 'translate3d(' + ringX.toFixed(1) + 'px,' + ringY.toFixed(1) + 'px,0)';
            dot.style.transform = 'translate3d(' + targetX.toFixed(1) + 'px,' + targetY.toFixed(1) + 'px,0)';
            window.requestAnimationFrame(loop);
        }

        document.addEventListener('mousemove', function (e) {
            targetX = e.clientX;
            targetY = e.clientY;
            if (!running) {
                running = true;
                ringX = targetX;
                ringY = targetY;
                html.classList.add('cursor-ready');
                window.requestAnimationFrame(loop);
            }
        }, { passive: true });

        document.addEventListener('mouseleave', function () {
            html.classList.remove('cursor-ready');
        });

        document.addEventListener('mouseenter', function () {
            if (running) html.classList.add('cursor-ready');
        });

        const hotSelector = 'a, button, .btn, .entry, input, textarea, [role="button"]';

        document.addEventListener('mouseover', function (e) {
            const hot = e.target.closest && e.target.closest(hotSelector);
            if (hot && !hot.contains(e.relatedTarget)) {
                html.classList.add('cursor-hot');
            }
        }, { passive: true });

        document.addEventListener('mouseout', function (e) {
            const hot = e.target.closest && e.target.closest(hotSelector);
            if (hot && !hot.contains(e.relatedTarget)) {
                html.classList.remove('cursor-hot');
            }
        }, { passive: true });

    };


    /* lazy image fade-in
     * -------------------------------------------------- */
    const ssImageFade = function () {

        const images = document.querySelectorAll('img[loading="lazy"]');

        images.forEach(function (img) {
            if (img.complete && img.naturalWidth > 0) {
                img.classList.add('is-loaded');
                return;
            }
            img.addEventListener('load', function () {
                img.classList.add('is-loaded');
            }, { once: true });
            img.addEventListener('error', function () {
                img.classList.add('is-loaded');
            }, { once: true });
        });

    };


    /* count-up numbers in the credential strip
     * -------------------------------------------------- */
    const ssCounters = function () {

        const counters = document.querySelectorAll('[data-count-to]');
        if (!counters.length) return;

        if (prefersReduced() || !('IntersectionObserver' in window)) return;

        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;

                const el = entry.target;
                const target = parseFloat(el.getAttribute('data-count-to'));
                const prefix = el.getAttribute('data-count-prefix') || '';
                const suffix = el.getAttribute('data-count-suffix') || '';
                const duration = 900;
                const start = performance.now();

                function step(now) {
                    const t = clamp((now - start) / duration, 0, 1);
                    const eased = 1 - Math.pow(1 - t, 3);
                    el.textContent = prefix + Math.round(target * eased) + suffix;
                    if (t < 1) window.requestAnimationFrame(step);
                }

                window.requestAnimationFrame(step);
                observer.unobserve(el);
            });
        }, { threshold: 0.6 });

        counters.forEach(function (el) { observer.observe(el); });

    };


    /* pause the extracurricular carousel on hover / focus
     * -------------------------------------------------- */
    const ssCarouselPause = function () {

        const slider = document.querySelector('.extracurricular-slider');
        if (!slider) return;

        function withSwiper(fn) {
            const instance = slider.swiper;
            if (instance && instance.autoplay) fn(instance);
        }

        slider.addEventListener('mouseenter', function () {
            withSwiper(function (s) { s.autoplay.stop(); });
        });

        slider.addEventListener('mouseleave', function () {
            withSwiper(function (s) { s.autoplay.start(); });
        });

        slider.addEventListener('focusin', function () {
            withSwiper(function (s) { s.autoplay.stop(); });
        });

    };


    /* section numeral parallax
     *
     * The ghost 01/02/03 behind each section heading drifts against the
     * heading as its section crosses the viewport. Writes a custom
     * property; the transform itself lives in CSS.
     * -------------------------------------------------- */
    const ssNumeralParallax = function () {

        if (prefersReduced()) return;

        const headers = document.querySelectorAll('.section-header[data-num]');
        if (!headers.length) return;

        const RANGE = 46; // px of total travel, top of viewport to bottom

        scrollBus.add(function () {
            const vh = window.innerHeight;
            headers.forEach(function (header) {
                const rect = header.getBoundingClientRect();
                if (rect.bottom < -200 || rect.top > vh + 200) return;
                // -1 when the header sits at the bottom edge, 1 at the top
                const progress = clamp(1 - (rect.top + rect.height / 2) / (vh / 2), -1, 1);
                header.style.setProperty('--num-shift', (progress * RANGE).toFixed(2));
            });
        });

    };


    /* scroll-velocity skew
     *
     * The works grid leans into the direction of travel and springs back
     * when scrolling stops. Deliberately tiny — anything past ~1.4deg
     * stops reading as weight and starts reading as a rendering bug.
     * -------------------------------------------------- */
    const ssSkewScroll = function () {

        if (prefersReduced()) return;

        const targets = document.querySelectorAll('.folio-bento, .folio-entries');
        if (!targets.length) return;

        const MAX = 1.4;

        let lastY = window.pageYOffset || 0;
        let lastT = 0;
        let current = 0;
        let target = 0;
        let running = false;

        function write() {
            running = false;
            // ease toward the target so the spring-back is not a step
            current += (target - current) * 0.12;
            if (Math.abs(current) < 0.01) current = 0;

            targets.forEach(function (el) {
                el.style.setProperty('--scroll-skew', current.toFixed(3));
            });

            // keep the frame loop alive only while there is motion left
            if (current !== 0 || target !== 0) {
                running = true;
                window.requestAnimationFrame(write);
            }
        }

        function kick() {
            if (running) return;
            running = true;
            window.requestAnimationFrame(write);
        }

        scrollBus.add(function (y) {
            const now = window.performance ? window.performance.now() : Date.now();
            const dt = lastT ? Math.max(now - lastT, 1) : 16;
            lastT = now;

            const velocity = (y - lastY) / dt; // px per ms
            lastY = y;

            target = clamp(velocity * 1.6, -MAX, MAX);
            kick();
        });

        // decay the target back to rest so the grid never stays leaning
        window.setInterval(function () {
            if (target === 0) return;
            target *= 0.55;
            if (Math.abs(target) < 0.02) target = 0;
            kick();
        }, 90);

    };


    /* theme toggle
     * -------------------------------------------------- */
    const ssTheme = function () {

        const toggle = document.querySelector('.theme-toggle');
        if (!toggle) return;

        const STORAGE_KEY = 'hmk-theme';
        const scheme = window.matchMedia('(prefers-color-scheme: dark)');

        function stored() {
            try {
                const value = localStorage.getItem(STORAGE_KEY);
                return value === 'dark' || value === 'light' ? value : null;
            } catch (e) {
                return null;
            }
        }

        function apply(theme, persist) {
            html.setAttribute('data-theme', theme);

            const dark = theme === 'dark';
            toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
            toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');

            // keep the browser UI colour in step with the page
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', dark ? '#0f100f' : '#c9502a');

            if (persist) {
                try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* private mode */ }
            }
        }

        // the inline head script already set the attribute; sync the control to it
        apply(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);

        toggle.addEventListener('click', function () {
            apply(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
        });

        // follow the OS only while the visitor has not made an explicit choice
        const onSchemeChange = function (e) {
            if (stored()) return;
            apply(e.matches ? 'dark' : 'light', false);
        };

        if (scheme.addEventListener) {
            scheme.addEventListener('change', onSchemeChange);
        } else if (scheme.addListener) {
            scheme.addListener(onSchemeChange);
        }

    };


    /* init
     * -------------------------------------------------- */
    function init() {
        ssTheme();
        ssScrollProgress();
        ssHero();
        ssTiltCards();
        ssMagnetic();
        ssCursor();
        ssImageFade();
        ssCounters();
        ssCarouselPause();
        ssNumeralParallax();
        ssSkewScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // keep everything honest if the user flips the OS motion setting live
    if (reduceMotion.addEventListener) {
        reduceMotion.addEventListener('change', function () {
            if (!prefersReduced()) return;
            document.querySelectorAll('[data-reveal]').forEach(function (el) {
                el.classList.add('is-revealed');
            });
            html.classList.remove('cursor-ready', 'has-cursor', 'cursor-hot');
        });
    }

})();
