/* 共通インタラクション */
(function () {
  // モバイルナビ
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () { nav.classList.toggle('open'); });
    nav.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('open'); });
    });
  }
  // 現在地ハイライト
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    if (a.getAttribute('href') === path) a.style.color = 'var(--accent-700)';
  });
  // フェードイン（スクロール）
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.style.opacity = 1; e.target.style.transform = 'none'; io.unobserve(e.target); }
      });
    }, { threshold: .12 });
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.style.opacity = 0; el.style.transform = 'translateY(18px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
  }
})();
