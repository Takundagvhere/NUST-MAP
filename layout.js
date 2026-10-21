// Wraps the map page in a university-website style layout:
// a small utility bar, a brand bar with main navigation, and a fuller footer.
// All colours live in the four variables at the top, so they are easy to change.
(function () {
  "use strict";

  const css = document.createElement("style");
  css.textContent = `
    /* CHANGE THESE FOUR to match the colours you want (placeholders, not NUST's exact colours) */
    :root { --brand:#1d3b73; --brand-ink:#ffffff; --bar:#eef1f5; --cta:#c8102e; }
    @media (prefers-color-scheme: light) { :root { --accent: var(--brand); } }

    .sx-util { background:var(--bar); border-bottom:1px solid var(--line); font-size:.78rem; }
    .sx-util .sx-in { display:flex; gap:16px; padding:6px 14px; overflow-x:auto; white-space:nowrap; }
    .sx-util a { color:var(--muted); text-decoration:none; }
    .sx-util a:hover { text-decoration:underline; }

    .sx-brand { background:var(--brand); color:var(--brand-ink); }
    .sx-brand .sx-in { display:flex; align-items:center; gap:14px; padding:10px 14px; }
    .sx-word { font-weight:700; font-size:1.05rem; line-height:1.1; white-space:nowrap; }
    .sx-word small { display:block; font-weight:400; font-size:.68rem; opacity:.85; }
    .sx-nav { display:flex; gap:4px; margin-left:auto; overflow-x:auto; white-space:nowrap; }
    .sx-nav a { color:var(--brand-ink); text-decoration:none; font-size:.85rem; padding:8px 10px; border-radius:6px; }
    .sx-nav a:hover { background:rgba(255,255,255,.16); }
    .sx-nav a.sx-active { background:rgba(255,255,255,.22); }
    .sx-nav a.sx-cta { background:var(--cta); }

    .sx-foot { background:var(--brand); color:var(--brand-ink); font-size:.75rem; padding:8px 14px; }
    .sx-foot a { color:var(--brand-ink); }

    @media (max-width: 700px) { .sx-util { display:none; } .sx-word small { display:none; } }
  `;
  document.head.appendChild(css);

  const link = (href, text, cls) =>
    '<a href="' + href + '" target="_blank" rel="noopener"' + (cls ? ' class="' + cls + '"' : "") + ">" + text + "</a>";

  const top = document.createElement("div");
  top.innerHTML =
    '<div class="sx-util"><div class="sx-in">' +
      link("https://www.nust.na/documents-and-forms", "Forms and Documents") +
      link("http://library.nust.na", "Library") +
      link("https://www.nust.na/procurement", "Procurement") +
      link("https://www.nust.na/vacancies", "Vacancies") +
      link("https://www.nust.na/contact", "Contact") +
    "</div></div>" +
    '<div class="sx-brand"><div class="sx-in">' +
      '<div class="sx-word">Campus Map<small>Unofficial student-made map</small></div>' +
      '<nav class="sx-nav" aria-label="Main navigation">' +
        '<a href="#" class="sx-active" aria-current="page">Map</a>' +
        link("https://www.nust.na/", "Home") +
        link("https://www.nust.na/admissions", "Admissions") +
        link("https://www.nust.na/academics", "Academics") +
        link("https://www.nust.na/students", "Students") +
        link("https://www.nust.na/satellite-campuses", "Satellite Campuses") +
        link("https://my.nust.na", "myNUST", "sx-cta") +
      "</nav>" +
    "</div></div>";
  document.body.prepend(top);

  const foot = document.querySelector("footer");
  if (foot) {
    foot.className = "sx-foot";
    foot.innerHTML =
      "Unofficial student-made map. Not affiliated with the university. Verify details on campus. " +
      link("https://www.nust.na/contact", "University contact page") +
      " &middot; Map data &copy; OpenStreetMap contributors";
  }
})();
