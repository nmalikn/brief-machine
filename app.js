(function () {
  "use strict";

  const RECENT_KEY = "brief-machine.recent";
  const RECENT_LIMIT = 10;
  const SPIN_FIRST_STOP = 800;
  const SPIN_STAGGER = 250;
  const SPIN_FAST_TICK = 60;
  const SPIN_SLOW_TICK = 130;
  const SPIN_SLOW_WINDOW = 250;
  const FLASH_MS = 1000;
  const SWATCH_COUNT = 5;

  const columns = [
    { key: "category", label: "Category", items: BRIEF_DATA.categories },
    { key: "brand", label: "Brand Name", items: BRIEF_DATA.brands },
    { key: "palette", label: "Meme Palette", items: BRIEF_DATA.memes },
    { key: "interface", label: "Interface", items: BRIEF_DATA.interfaces },
  ];

  const els = {
    columns: document.getElementById("columns"),
    brief: document.getElementById("brief"),
    meme: document.getElementById("meme"),
    pickHint: document.getElementById("pick-hint"),
    swatches: document.getElementById("swatches"),
    clearColors: document.getElementById("clear-colors"),
    copyBrief: document.getElementById("copy-brief"),
    generate: document.getElementById("generate"),
    status: document.getElementById("status"),
    recent: document.getElementById("recent"),
  };

  let spinning = false;
  let recent = loadRecent();
  let picks = new Array(SWATCH_COUNT).fill(null);
  let nextPick = 0;
  let drawnMeme = null;

  const memeContext = els.meme.getContext("2d", { willReadFrequently: true });
  const imageSource = (path) => BRIEF_IMAGES[path] || path;
  const memeImages = BRIEF_DATA.memes.map((meme) => {
    const image = new Image();
    image.src = imageSource(meme.image);
    return image;
  });

  // Helpers

  const labelOf = (item) => (typeof item === "string" ? item : item.name);
  const currentLabel = (key) => {
    const column = columns.find((c) => c.key === key);
    return labelOf(column.items[column.index]).toUpperCase();
  };
  const paletteColumn = () => columns.find((c) => c.key === "palette");
  const pickedColors = () => picks.filter(Boolean);

  function randomOtherIndex(column) {
    const n = column.items.length;
    return (column.index + 1 + Math.floor(Math.random() * (n - 1))) % n;
  }

  function articleFor(word) {
    return /^([aeiou]|hr\b)/i.test(word) ? "an" : "a";
  }

  // Returns text pieces; objects are the parts that come from the columns.
  function briefParts() {
    const category = currentLabel("category");
    return [
      `Design ${articleFor(category)} `,
      { pick: category },
      " product called ",
      { pick: currentLabel("brand") },
      ", in the ",
      { pick: currentLabel("palette") },
      " palette, for ",
      { pick: currentLabel("interface") },
      ".",
    ];
  }

  function briefSentence() {
    return briefParts()
      .map((part) => (typeof part === "string" ? part : part.pick))
      .join("");
  }

  function readableInk(hex) {
    const n = parseInt(hex.slice(1), 16);
    const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return luma > 150 ? "#000" : "#fff";
  }

  // Columns

  function buildColumn(column) {
    const wrap = document.createElement("div");
    wrap.className = "column";

    const head = document.createElement("div");
    head.className = "column-head";

    const title = document.createElement("span");
    title.className = "column-title";
    title.id = `${column.key}-title`;
    title.textContent = column.label;

    const lock = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `${column.key}-lock`;
    checkbox.setAttribute("aria-label", `Lock ${column.label}`);
    checkbox.addEventListener("change", () => {
      column.locked = checkbox.checked;
      updateGenerateAvailability();
    });

    const lockLabel = document.createElement("label");
    lockLabel.htmlFor = checkbox.id;
    lockLabel.textContent = "Lock";
    lock.append(checkbox, lockLabel);
    head.append(title, lock);

    const list = document.createElement("ul");
    list.className = "listbox sunken-panel";
    list.tabIndex = 0;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-labelledby", title.id);

    column.options = column.items.map((item, index) => {
      const option = document.createElement("li");
      option.className = "option";
      option.id = `${column.key}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = labelOf(item);
      option.title = labelOf(item);
      option.addEventListener("click", () => {
        if (!spinning) select(column, index);
      });
      list.append(option);
      return option;
    });

    list.addEventListener("keydown", (event) => {
      if (spinning) return;
      const last = column.items.length - 1;
      const moves = {
        ArrowDown: Math.min(column.index + 1, last),
        ArrowUp: Math.max(column.index - 1, 0),
        Home: 0,
        End: last,
      };
      if (event.key in moves) {
        event.preventDefault();
        select(column, moves[event.key]);
      }
    });

    wrap.append(head, list);
    column.list = list;
    column.locked = false;
    column.index = -1;
    return wrap;
  }

  function select(column, index) {
    if (column.index >= 0) {
      column.options[column.index].setAttribute("aria-selected", "false");
    }
    const changed = column.index >= 0 && column.index !== index;
    column.index = index;
    if (changed && column.key === "palette") clearPicks();

    const option = column.options[index];
    option.setAttribute("aria-selected", "true");
    column.list.setAttribute("aria-activedescendant", option.id);
    // Keeps the pick mid-list, and unlike scrollIntoView never moves the page.
    column.list.scrollTop =
      option.offsetTop - column.list.offsetTop - (column.list.clientHeight - option.offsetHeight) / 2;

    renderPreview();
  }

  // Preview

  function renderBrief() {
    els.brief.replaceChildren(
      ...briefParts().map((part) => {
        if (typeof part === "string") return document.createTextNode(part);
        const bold = document.createElement("b");
        bold.textContent = part.pick;
        return bold;
      })
    );
  }

  function drawMeme() {
    const column = paletteColumn();
    const image = memeImages[column.index];
    if (drawnMeme === image) return;
    if (!image.complete) {
      image.addEventListener("load", drawMeme, { once: true });
      return;
    }
    drawnMeme = image;
    els.meme.width = image.naturalWidth;
    els.meme.height = image.naturalHeight;
    memeContext.drawImage(image, 0, 0);
    els.meme.setAttribute("aria-label", column.items[column.index].name);
  }

  function renderSwatches() {
    [...els.swatches.children].forEach((swatch, i) => {
      const hex = picks[i];
      swatch.disabled = !hex;
      swatch.classList.toggle("is-next", i === nextPick);
      swatch.style.background = hex || "";
      swatch.style.color = hex ? readableInk(hex) : "";
      swatch.textContent = hex || "";
      swatch.setAttribute("aria-label", hex ? `Copy ${hex}` : "Empty color slot");
    });
  }

  function renderPreview() {
    if (columns.some((column) => column.index < 0)) return;
    renderBrief();
    drawMeme();
  }

  function buildSwatches() {
    for (let i = 0; i < SWATCH_COUNT; i += 1) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.addEventListener("click", async () => {
        const copied = await copyText(picks[i]);
        swatch.textContent = copied ? "COPIED" : "FAILED";
        setTimeout(renderSwatches, FLASH_MS);
      });
      els.swatches.append(swatch);
    }
  }

  // Color picking

  function sampleColor(event) {
    const box = els.meme.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * els.meme.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * els.meme.height);
    try {
      const [r, g, b] = memeContext.getImageData(x, y, 1, 1).data;
      const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
      return `#${hex.toUpperCase()}`;
    } catch (error) {
      els.pickHint.textContent = "Run embed-images.py to pick from this picture";
      return null;
    }
  }

  function clearPicks() {
    picks = new Array(SWATCH_COUNT).fill(null);
    nextPick = 0;
    renderSwatches();
    syncRecentColors();
  }

  function pickColor(event) {
    if (spinning) return;
    const hex = sampleColor(event);
    if (!hex) return;
    picks[nextPick] = hex;
    nextPick = (nextPick + 1) % SWATCH_COUNT;
    renderSwatches();
    syncRecentColors();
  }

  // Previews the color under the cursor in the slot the next click will fill.
  function previewColor(event) {
    if (spinning || event.pointerType !== "mouse") return;
    const hex = sampleColor(event);
    if (!hex) return;
    const swatch = els.swatches.children[nextPick];
    swatch.style.background = hex;
    swatch.style.color = readableInk(hex);
    swatch.textContent = hex;
  }

  // Clipboard

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      return copyTextFallback(text);
    }
  }

  // navigator.clipboard is missing or blocked on file:// in some browsers.
  function copyTextFallback(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    area.remove();
    return copied;
  }

  function fullBriefText() {
    const colors = pickedColors();
    return colors.length ? `${briefSentence()}\n\n${colors.join(", ")}` : briefSentence();
  }

  // Generate

  function spinColumn(column, target, stopAt, onStop) {
    const tick = () => {
      const left = stopAt - performance.now();
      if (left <= 0) {
        select(column, target);
        onStop();
        return;
      }
      select(column, randomOtherIndex(column));
      setTimeout(tick, left < SPIN_SLOW_WINDOW ? SPIN_SLOW_TICK : SPIN_FAST_TICK);
    };
    tick();
  }

  function setSpinning(value) {
    spinning = value;
    els.status.textContent = value ? "GENERATING..." : "READY";
    els.brief.setAttribute("aria-busy", String(value));
    columns.forEach((column) => {
      document.getElementById(`${column.key}-lock`).disabled = value;
    });
  }

  function generate() {
    const spinners = columns.filter((column) => !column.locked);
    if (spinning || spinners.length === 0) return;

    setSpinning(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let stillSpinning = spinners.length;

    spinners.forEach((column, order) => {
      const stopAt = reduceMotion ? start : start + SPIN_FIRST_STOP + order * SPIN_STAGGER;
      spinColumn(column, randomOtherIndex(column), stopAt, () => {
        stillSpinning -= 1;
        if (stillSpinning === 0) {
          setSpinning(false);
          addRecent();
        }
      });
    });
  }

  function updateGenerateAvailability() {
    els.generate.disabled = columns.every((column) => column.locked);
  }

  // Recent

  function loadRecent() {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY));
      return Array.isArray(saved) ? saved.slice(0, RECENT_LIMIT) : [];
    } catch (error) {
      return [];
    }
  }

  function saveRecent() {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch (error) {
      // Recent still works for this visit; it just won't persist.
    }
  }

  function addRecent() {
    const entry = {
      sentence: briefSentence(),
      image: paletteColumn().items[paletteColumn().index].image,
      colors: pickedColors(),
    };
    recent = [entry, ...recent].slice(0, RECENT_LIMIT);
    saveRecent();
    renderRecent();
  }

  // Colors get picked after a spin, so they land on the brief it just added.
  function syncRecentColors() {
    if (spinning || !recent[0] || recent[0].sentence !== briefSentence()) return;
    recent[0].colors = pickedColors();
    saveRecent();
    renderRecent();
  }

  function renderRecent() {
    els.recent.replaceChildren(
      ...recent.map((entry) => {
        const row = document.createElement("li");
        row.className = "recent-item";

        if (entry.image) {
          const thumb = document.createElement("img");
          thumb.className = "recent-thumb";
          thumb.src = imageSource(entry.image);
          thumb.alt = "";
          row.append(thumb);
        }

        const chips = document.createElement("span");
        chips.className = "recent-chips";
        chips.setAttribute("aria-hidden", "true");
        entry.colors.forEach((hex) => {
          const chip = document.createElement("span");
          chip.style.background = hex;
          chips.append(chip);
        });

        const text = document.createElement("span");
        text.textContent = entry.sentence;
        if (entry.colors.length) row.append(chips);
        row.append(text);
        return row;
      })
    );
  }

  // Start up

  buildSwatches();
  els.columns.append(...columns.map(buildColumn));
  columns.forEach((column) => {
    select(column, Math.floor(Math.random() * column.items.length));
  });
  renderSwatches();
  renderRecent();

  els.generate.addEventListener("click", generate);
  els.meme.addEventListener("click", pickColor);
  els.meme.addEventListener("pointermove", previewColor);
  els.meme.addEventListener("pointerleave", renderSwatches);
  els.clearColors.addEventListener("click", () => {
    if (!spinning) clearPicks();
  });

  els.copyBrief.addEventListener("click", async () => {
    if (spinning) return;
    const copied = await copyText(fullBriefText());
    els.copyBrief.textContent = copied ? "Copied!" : "Copy failed";
    setTimeout(() => {
      els.copyBrief.textContent = "Copy brief";
    }, FLASH_MS);
  });
})();
