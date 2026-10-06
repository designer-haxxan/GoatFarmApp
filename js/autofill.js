/* Magic-link auto-fill: opens the app with #u=<username>&p=<password> in the URL.
   Credentials live only in the hash (never sent to any server) and are erased from
   the address bar immediately.  No auto-submit – the user taps Login themselves. */
(function () {
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var u = params.get('u'), p = params.get('p');
  if (u === null || p === null) return;           // normal URL – do nothing

  // Erase credentials from the address bar right away, before anything else runs
  history.replaceState(null, '', location.pathname + location.search);

  var tries = 0;
  (function fill() {
    // If the app shell is already visible the user is already signed in – abort
    var appView = document.getElementById('view-app');
    if (appView && !appView.classList.contains('d-none')) return;

    var loginView = document.getElementById('view-login');
    var userEl    = document.getElementById('login-username');
    var passEl    = document.getElementById('login-password');

    // Wait up to 10 s for the login form to appear
    if (!userEl || !passEl || !loginView || loginView.classList.contains('d-none')) {
      if (++tries < 100) setTimeout(fill, 100);
      return;
    }

    // Fill values and notify any listeners (validation, Bootstrap floating labels)
    userEl.value = u;
    passEl.value = p;
    userEl.dispatchEvent(new Event('input',  { bubbles: true }));
    passEl.dispatchEvent(new Event('input',  { bubbles: true }));
    userEl.dispatchEvent(new Event('change', { bubbles: true }));
    passEl.dispatchEvent(new Event('change', { bubbles: true }));
    u = p = null;                                 // drop from closure

    // Urdu hint so the user knows what to do next
    var hint = document.createElement('div');
    hint.className = 'autofill-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = 'یوزر نیم اور پاس ورڈ خود بخود بھر دیے گئے ہیں۔ بس لاگ ان دبائیں';

    // Pulse the Login button so even an uneducated user knows to tap it
    var btn = document.getElementById('login-btn');
    if (btn) {
      btn.parentNode.insertBefore(hint, btn);
      btn.classList.add('btn-autofill-pulse');
    }
  })();
})();
