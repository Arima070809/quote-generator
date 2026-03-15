// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseQuotes(text) {
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

function cleanField(str) {
  if (!str) return "";
  let s = str.trim();
  while (s.startsWith('"') && s.endsWith('"') && s.length > 1) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function splitCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseAnimeCSV(raw) {
  const text = normaliseQuotes(raw);
  return text.trim().split(/\r?\n/).slice(1).map(line => {
    const cols      = splitCSVLine(line);
    const quote     = cleanField(cols[0]);
    const character = cleanField(cols[1]);
    const anime     = cleanField(cols[2]);
    if (!quote) return null;
    return {
      text: quote,
      attribution: [character, anime].filter(Boolean).join(" — "),
      author: character,
      type: "anime"
    };
  }).filter(Boolean);
}

function parseGeneralJSON(raw) {
  try {
    const data = JSON.parse(raw);
    return data.map(item => {
      const quote  = (item.Quote || "").trim();
      const author = (item.Author || "Unknown").trim();
      if (!quote) return null;
      return {
        text: quote,
        attribution: author,
        author: author,
        type: "general"
      };
    }).filter(Boolean);
  } catch (e) {
    console.error("Failed to parse quotes JSON:", e);
    return [];
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

let animeQuotes   = [];
let generalQuotes = [];
let activePool    = [];   // full pool for chosen category
let filteredPool  = [];   // pool after optional author filter
let lastIndex     = -1;
let currentCategory = "both";

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadAllQuotes() {
  const [animeRaw, generalRaw] = await Promise.all([
    fetch("AnimeQuotes.csv").then(r => r.text()).catch(() => ""),
    fetch("quotes.json").then(r => r.text()).catch(() => ""),
  ]);

  animeQuotes   = animeRaw   ? parseAnimeCSV(animeRaw)      : [];
  generalQuotes = generalRaw ? parseGeneralJSON(generalRaw) : [];

  console.log(`Anime: ${animeQuotes.length} | General: ${generalQuotes.length}`);
  showCategoryScreen();
}

// ─── Category Screen ──────────────────────────────────────────────────────────

function showCategoryScreen() {
  const container = document.querySelector(".container");
  container.innerHTML = `
    <h1>THINK ABOUT IT</h1>
    <div class="quote-box category-screen">
      <p class="category-prompt">What kind of quotes do you want?</p>
      <div class="category-buttons">
        <button class="btn cat-btn" data-cat="both">✨ Both</button>
        <button class="btn cat-btn" data-cat="anime">⚔️ Anime Only</button>
        <button class="btn cat-btn" data-cat="general">📖 No Anime</button>
      </div>
    </div>
  `;

  document.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.cat;
      if (currentCategory === "both")    activePool = [...animeQuotes, ...generalQuotes];
      if (currentCategory === "anime")   activePool = [...animeQuotes];
      if (currentCategory === "general") activePool = [...generalQuotes];
      filteredPool = [...activePool];
      lastIndex = -1;
      showQuoteScreen();
    });
  });
}

// ─── Quote Screen ─────────────────────────────────────────────────────────────

function showQuoteScreen(searchTerm = "") {
  const container = document.querySelector(".container");
  container.innerHTML = `
    <h1>THINK ABOUT IT</h1>
    <div class="quote-box">

      <div class="search-bar">
        <input
          type="text"
          id="author-search"
          placeholder="Search by author..."
          value="${searchTerm}"
          autocomplete="off"
        />
        <button class="btn btn-clear" id="clear-search" title="Clear">✕</button>
      </div>

      <div id="suggestions" class="suggestions hidden"></div>

      <p class="quote" id="quote"></p>

      <div id="author-filter-badge" class="author-badge hidden"></div>

      <div class="quote-actions">
        <button class="btn" id="new-quote">New Quote</button>
        <button class="btn btn-secondary" id="change-category">Change Category</button>
      </div>
    </div>
  `;

  const searchInput  = document.getElementById("author-search");
  const suggestionsEl = document.getElementById("suggestions");
  const clearBtn     = document.getElementById("clear-search");

  // Show/hide clear button
  toggleClearBtn(searchTerm);

  // If restoring a search term, apply the filter right away
  if (searchTerm) {
    applyAuthorFilter(searchTerm);
  } else {
    filteredPool = [...activePool];
    showRandomQuote();
  }

  // ── Autocomplete ──
  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim().toLowerCase();
    toggleClearBtn(searchInput.value);

    if (!val) {
      hideSuggestions();
      filteredPool = [...activePool];
      clearBadge();
      lastIndex = -1;
      showRandomQuote();
      return;
    }

    // Build unique author list from active pool
    const matches = [...new Set(
      activePool
        .map(q => q.author)
        .filter(a => a && a.toLowerCase().includes(val))
    )].sort().slice(0, 6); // show up to 6 suggestions

    if (matches.length === 0) {
      hideSuggestions();
      return;
    }

    suggestionsEl.innerHTML = matches
      .map(a => `<div class="suggestion-item" data-author="${a}">${highlightMatch(a, val)}</div>`)
      .join("");
    suggestionsEl.classList.remove("hidden");

    suggestionsEl.querySelectorAll(".suggestion-item").forEach(item => {
      item.addEventListener("click", () => {
        searchInput.value = item.dataset.author;
        hideSuggestions();
        toggleClearBtn(searchInput.value);
        applyAuthorFilter(item.dataset.author);
      });
    });
  });

  // Hide suggestions when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-bar") && !e.target.closest(".suggestions")) {
      hideSuggestions();
    }
  }, { once: false });

  // Clear button
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    toggleClearBtn("");
    hideSuggestions();
    filteredPool = [...activePool];
    clearBadge();
    lastIndex = -1;
    showRandomQuote();
  });

  // Enter key — apply top suggestion or exact match
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = searchInput.value.trim();
      if (val) {
        hideSuggestions();
        applyAuthorFilter(val);
      }
    }
  });

  document.getElementById("new-quote").addEventListener("click", showRandomQuote);
  document.getElementById("change-category").addEventListener("click", showCategoryScreen);
}

// ─── Author Filter ────────────────────────────────────────────────────────────

function applyAuthorFilter(name) {
  const lower = name.toLowerCase();
  const matches = activePool.filter(q => q.author.toLowerCase().includes(lower));

  if (matches.length === 0) {
    document.getElementById("quote").innerHTML = `
      <span class="quote-text">No quotes found for "<strong>${name}</strong>".</span>
    `;
    clearBadge();
    filteredPool = [];
    return;
  }

  filteredPool = matches;
  lastIndex = -1;

  // Show badge with match count
  const badge = document.getElementById("author-filter-badge");
  const uniqueAuthor = matches[0].author; // use first matched author's real name
  badge.textContent = `Showing ${matches.length} quote${matches.length > 1 ? "s" : ""} by ${uniqueAuthor}`;
  badge.classList.remove("hidden");

  showRandomQuote();
}

function clearBadge() {
  const badge = document.getElementById("author-filter-badge");
  if (badge) badge.classList.add("hidden");
}

// ─── Suggestion Helpers ───────────────────────────────────────────────────────

function hideSuggestions() {
  const el = document.getElementById("suggestions");
  if (el) el.classList.add("hidden");
}

function toggleClearBtn(value) {
  const btn = document.getElementById("clear-search");
  if (btn) btn.style.display = value ? "flex" : "none";
}

// Wraps matched portion in <strong> for the suggestion dropdown
function highlightMatch(author, query) {
  const i = author.toLowerCase().indexOf(query);
  if (i === -1) return author;
  return (
    author.slice(0, i) +
    `<strong>${author.slice(i, i + query.length)}</strong>` +
    author.slice(i + query.length)
  );
}

// ─── Display ──────────────────────────────────────────────────────────────────

function showRandomQuote() {
  if (filteredPool.length === 0) return;

  let index;
  do {
    index = Math.floor(Math.random() * filteredPool.length);
  } while (index === lastIndex && filteredPool.length > 1);
  lastIndex = index;

  const { text, attribution } = filteredPool[index];
  const quoteEl = document.getElementById("quote");
  if (!quoteEl) return;

  quoteEl.style.animation = "none";
  quoteEl.offsetHeight;
  quoteEl.style.animation = "";

  quoteEl.innerHTML = `
    <span class="quote-text">"${text}"</span>
    ${attribution ? `<br><span class="quote-attribution">— ${attribution}</span>` : ""}
  `;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadAllQuotes();