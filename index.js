/* index.js - home page bootstrap. Feature code lives in assets/js/home.js (omnibox, tiles, blog)
 * and assets/js/quiz.js (Knowledge Quiz). This file only reacts to URL parameters:
 *   ?quiz=1          open the quiz
 *   ?focus=search    focus the omnibox (shell.js's "/" shortcut navigates here)
 *   ?q=<text>        run the omnibox search and show the results inline
 */
document.addEventListener('DOMContentLoaded', function () {
    var p = new URLSearchParams(location.search);
    var q = (p.get('q') || '').trim();

    if (q && window.AISHome) window.AISHome.run(q);
    else if (p.get('focus') === 'search' && window.AISHome) window.AISHome.focus();

    if (p.get('quiz') === '1' && window.AISQuiz) window.AISQuiz.open();
});
