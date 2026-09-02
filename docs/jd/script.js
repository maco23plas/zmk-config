// Reveal-on-scroll. Degrades to "everything visible" when IntersectionObserver
// is missing or the visitor prefers reduced motion.
(function () {
  var els = document.querySelectorAll('.reveal, .person-card');
  var show = function (el) { el.classList.add('in'); };
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Array.prototype.forEach.call(els, show);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      show(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.12 });
  Array.prototype.forEach.call(els, function (el) { io.observe(el); });
})();
