const ASSIGNMENTS_KEY = "manglerBedommelseAssignments";
const LAST_UPDATED_KEY = "manglerBedommelseLastUpdated";
const THEME_KEY = "manglerBedommelseTheme";
const VIEW_MODE_KEY = "manglerBedommelseViewMode";
const SAVED_FILTERS_KEY = "manglerBedommelseSavedFilters";
const GROUP_OPEN_STATE_KEY = "manglerBedommelseGroupOpenState";
const extensionApi = globalThis.browser || chrome;
const ASSIGNMENT_REQUIREMENTS_URL = extensionApi.runtime.getURL("requirements.md");
const MAX_SAVED_FILTERS = 12;

let assignments = [];
let lastUpdated = "";
let darkMode = false;
let viewMode = "assignment";
let savedFilters = [];
let assignmentRequirements = new Map();
let selectedRows = new Set();
let batchBusy = false;
let groupOpenState = {
  assignment: {},
  date: {}
};

const modulesEl = document.getElementById("modules");
const summaryEl = document.getElementById("summary");
const searchEl = document.getElementById("search");
const saveSearchEl = document.getElementById("saveSearch");
const savedSearchesEl = document.getElementById("savedSearches");
const refreshEl = document.getElementById("refresh");
const openSelectedEl = document.getElementById("openSelected");
const downloadSelectedEl = document.getElementById("downloadSelected");
const clearSelectionEl = document.getElementById("clearSelection");
const viewModeEl = document.getElementById("viewMode");
const toggleAllEl = document.getElementById("toggleAll");
const darkModeEl = document.getElementById("darkMode");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const stored = await extensionApi.storage.local.get({
    [ASSIGNMENTS_KEY]: [],
    [LAST_UPDATED_KEY]: "",
    [THEME_KEY]: "light",
    [VIEW_MODE_KEY]: "assignment",
    [SAVED_FILTERS_KEY]: [],
    [GROUP_OPEN_STATE_KEY]: {
      assignment: {},
      date: {}
    }
  });

  assignments = Array.isArray(stored[ASSIGNMENTS_KEY]) ? stored[ASSIGNMENTS_KEY] : [];
  lastUpdated = stored[LAST_UPDATED_KEY] || "";
  darkMode = stored[THEME_KEY] === "dark";
  viewMode = stored[VIEW_MODE_KEY] === "date" ? "date" : "assignment";
  savedFilters = normalizeSavedFilters(stored[SAVED_FILTERS_KEY]);
  groupOpenState = normalizeGroupOpenState(stored[GROUP_OPEN_STATE_KEY]);
  assignmentRequirements = await loadAssignmentRequirements();
  applyTheme();

  wireEvents();
  render();

  if (!assignments.length) {
    setStatus("Tryk Opdater for at hente Grade-Me blokken fra Moodle.");
  }
}

function wireEvents() {
  refreshEl.addEventListener("click", refreshFromMoodle);
  searchEl.addEventListener("input", render);
  saveSearchEl.addEventListener("click", toggleSavedFilter);

  savedSearchesEl.addEventListener("click", async event => {
    const remove = event.target.closest("[data-remove-filter]");
    if (remove) {
      await removeSavedFilter(remove.dataset.removeFilter);
      return;
    }

    const chip = event.target.closest("[data-apply-filter]");
    if (chip) {
      await applySavedFilter(chip.dataset.applyFilter);
    }
  });

  modulesEl.addEventListener("click", event => {
    const downloadButton = event.target.closest("[data-download-url]");
    if (downloadButton) {
      downloadSubmission(downloadButton);
      return;
    }

    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      toggleGroup(toggle.closest("[data-group]").dataset.groupView, toggle.closest("[data-group]").dataset.groupKey);
    }
  });

  modulesEl.addEventListener("change", async event => {
    const box = event.target.closest("[data-select]");
    if (!box) return;

    if (box.checked) {
      selectedRows.add(box.dataset.select);
    } else {
      selectedRows.delete(box.dataset.select);
    }

    render();
  });

  openSelectedEl.addEventListener("click", openSelectedFeedbacks);
  downloadSelectedEl.addEventListener("click", downloadSelectedSubmissions);
  clearSelectionEl.addEventListener("click", clearSelection);
  toggleAllEl.addEventListener("click", toggleAllGroups);

  document.addEventListener("click", event => {
    const link = event.target.closest('a[target="_blank"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
    window.focus();
  });

  viewModeEl.addEventListener("click", async () => {
    viewMode = viewMode === "assignment" ? "date" : "assignment";
    await extensionApi.storage.local.set({ [VIEW_MODE_KEY]: viewMode });
    render();
  });

  darkModeEl.addEventListener("click", async () => {
    darkMode = !darkMode;
    await extensionApi.storage.local.set({ [THEME_KEY]: darkMode ? "dark" : "light" });
    applyTheme();
  });
}

async function refreshFromMoodle() {
  setStatus("Henter Grade-Me blokken fra Moodle...");
  refreshEl.disabled = true;
  selectedRows = new Set();

  try {
    const response = await extensionApi.runtime.sendMessage({ type: "SCRAPE_COURSE" });
    if (!response?.ok) {
      throw new Error(response?.error || "Kunne ikke hente Moodle-data.");
    }

    assignments = parseMoodleBlock(response.html);
    lastUpdated = new Date().toISOString();

    await extensionApi.storage.local.set({
      [ASSIGNMENTS_KEY]: assignments,
      [LAST_UPDATED_KEY]: lastUpdated
    });

    setStatus(`Opdateret ${formatDateTime(lastUpdated)} fra ${response.url || "Moodle"}.`);
    render();
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    refreshEl.disabled = false;
  }
}

async function downloadSubmission(button) {
  const url = button.dataset.downloadUrl;
  const name = button.dataset.studentName || "eleven";
  button.disabled = true;
  setStatus(`Henter aflevering for ${name}...`);

  try {
    const response = await extensionApi.runtime.sendMessage({ type: "DOWNLOAD_SUBMISSION", url, studentName: name });
    if (!response?.ok) {
      throw new Error(response?.error || "Kunne ikke hente afleveringen.");
    }

    setStatus(`Download startet for ${name}: ${response.count} fil${response.count === 1 ? "" : "er"}.`);
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    button.disabled = false;
  }
}

async function openSelectedFeedbacks() {
  const rows = getSelectedRows();
  if (!rows.length) return;

  setBatchBusy(true);
  setStatus(`Åbner ${rows.length} feedbackside${rows.length === 1 ? "" : "r"}...`);

  try {
    rows.forEach(row => {
      window.open(gradeUrl(row.assignment.id, row.userId, row.importedGradeUrl), "_blank", "noopener,noreferrer");
    });
    window.focus();
    setStatus(`Åbnede ${rows.length} feedbackside${rows.length === 1 ? "" : "r"}.`);
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    setBatchBusy(false);
  }
}

async function downloadSelectedSubmissions() {
  const rows = getSelectedRows();
  if (!rows.length) return;

  setBatchBusy(true);
  setStatus(`Downloader ${rows.length} aflevering${rows.length === 1 ? "" : "er"}...`);

  let successCount = 0;
  const failures = [];

  try {
    for (const row of rows) {
      const response = await extensionApi.runtime.sendMessage({
        type: "DOWNLOAD_SUBMISSION",
        url: gradeUrl(row.assignment.id, row.userId, row.importedGradeUrl),
        studentName: row.name
      });

      if (!response?.ok) {
        failures.push(`${row.name}: ${response?.error || "kunne ikke hente afleveringen"}`);
        continue;
      }

      successCount += 1;
    }

    if (failures.length) {
      setStatus(`Downloadet ${successCount} af ${rows.length}. Fejl: ${failures.join(" · ")}`);
    } else {
      setStatus(`Downloadet ${successCount} aflevering${successCount === 1 ? "" : "er"}.`);
    }
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    setBatchBusy(false);
  }
}

function clearSelection() {
  if (!selectedRows.size) return;

  selectedRows = new Set();
  render();
}

function toggleGroup(view, key) {
  const nextOpen = !getGroupOpenState(view, key);
  setGroupOpenState(view, key, nextOpen);
  render();
}

function toggleAllGroups() {
  const queryParts = searchEl.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const rows = collectRows(queryParts);
  const groups = getVisibleGroups(rows);
  if (!groups.length) return;

  const allOpen = groups.every(group => getGroupOpenState(group.view, group.key));
  groups.forEach(group => setGroupOpenState(group.view, group.key, !allOpen));
  render();
}

function getSelectedRows() {
  const rows = [];

  assignments.forEach(assignment => {
    assignment.students.forEach(([userId, name, date, importedGradeUrl]) => {
      const key = rowKey(assignment.id, userId);
      if (!selectedRows.has(key)) return;

      rows.push({
        assignment,
        userId,
        name,
        date,
        importedGradeUrl,
        key
      });
    });
  });

  return rows;
}

function setBatchBusy(value) {
  batchBusy = Boolean(value);
  render();
}

function getVisibleGroups(rows = []) {
  if (viewMode === "date") {
    return collectDateGroups(rows);
  }

  return collectAssignmentGroups(rows);
}

function collectAssignmentGroups(rows = []) {
  const visibleAssignmentIds = new Set(rows.map(row => String(row.assignment.id)));

  return [...assignments]
    .sort((left, right) => assignmentCodeNumber(left.title) - assignmentCodeNumber(right.title))
    .filter(assignment => visibleAssignmentIds.has(String(assignment.id)))
    .map(assignment => ({
      view: "assignment",
      key: String(assignment.id),
      title: assignment.title
    }));
}

function collectDateGroups(rows = []) {
  const groups = new Map();

  rows
    .forEach(row => {
      const groupKey = row.parsedDate?.key || "unknown";
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          view: "date",
          key: groupKey,
          title: row.parsedDate?.label || "Ukendt dato"
        });
      }
    });

  return [...groups.values()];
}

function getGroupOpenState(view, key) {
  const state = groupOpenState[view] || {};
  return state[key] !== false;
}

function setGroupOpenState(view, key, open) {
  groupOpenState = {
    ...groupOpenState,
    [view]: {
      ...(groupOpenState[view] || {}),
      [key]: Boolean(open)
    }
  };
  extensionApi.storage.local.set({ [GROUP_OPEN_STATE_KEY]: groupOpenState });
}

function normalizeGroupOpenState(value) {
  const assignment = value?.assignment && typeof value.assignment === "object" ? value.assignment : {};
  const date = value?.date && typeof value.date === "object" ? value.date : {};

  return {
    assignment,
    date
  };
}

function parseMoodleBlock(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const modules = [...doc.querySelectorAll("dd.module")];
  if (!modules.length) {
    throw new Error("Ingen Moodle-opgaver fundet i Grade-Me blokken.");
  }

  return modules.map(module => {
    const assignmentLink = [...module.querySelectorAll('a[href*="/mod/assign/view.php"]')]
      .find(link => !link.href.includes("action=grade") && link.textContent.trim());
    const id = module.id.replace(/^cmid/, "") || parseIdFromUrl(assignmentLink?.href || "", "id");
    const title = assignmentLink?.textContent.trim();

    if (!id || !title) {
      throw new Error("Kunne ikke læse en opgaves titel eller id.");
    }

    const gradeLinksByUserId = new Map(
      [...module.querySelectorAll('a[href*="action=grade"]')]
        .map(link => [parseIdFromUrl(link.href, "userid"), link.href])
        .filter(([userId]) => userId)
    );

    const students = [...module.querySelectorAll("li.gradable")].map(item => {
      const gradeLink = item.querySelector('a[href*="action=grade"]');
      const profileLink = item.querySelector('a[href*="/user/view.php"][title]');
      const name = profileLink?.textContent.trim() || profileLink?.querySelector("img")?.alt || "";
      const userId = parseIdFromUrl(profileLink?.href || "", "id");
      const date = extractDateText(item, name);

      if (!name || !userId) {
        throw new Error(`Kunne ikke læse en elev under ${title}.`);
      }

      return [userId, name, date, gradeLinksByUserId.get(userId) || gradeLink?.href || "", profileLink?.href || ""];
    });

    return {
      id,
      title,
      href: assignmentLink.href,
      students
    };
  });
}

function extractDateText(item, name) {
  const machineDate = item.querySelector("time[datetime], [datetime]")?.getAttribute("datetime");
  if (machineDate) return machineDate.trim();

  const directText = [...item.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  if (directText) return directText;

  const clone = item.cloneNode(true);
  clone.querySelectorAll("a, button, input, img").forEach(node => node.remove());
  return clone.textContent
    .replace(name, "")
    .replace(/\s+/g, " ")
    .trim();
}

function render() {
  const queryParts = searchEl.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const rows = collectRows(queryParts);

  if (viewMode === "date") {
    renderDateView(rows);
  } else {
    renderAssignmentView(rows);
  }

  const totalStudents = totalStudentCount();
  summaryEl.textContent = assignments.length
    ? `${rows.length} synlige af ${totalStudents} · ${selectedRows.size} markerede${lastUpdated ? ` · ${formatDateTime(lastUpdated)}` : ""}`
    : "Ingen data hentet endnu";
  viewModeEl.setAttribute("aria-pressed", String(viewMode === "date"));
  viewModeEl.textContent = viewMode === "date" ? "▦" : "☷";
  viewModeEl.setAttribute("aria-label", viewMode === "date" ? "Skift til opgavevisning" : "Skift til datovisning");
  viewModeEl.title = viewMode === "date" ? "Skift til opgavevisning" : "Skift til datovisning";
  updateToggleAllButton(rows);
  openSelectedEl.setAttribute("aria-label", selectedRows.size ? `Åbn ${selectedRows.size} markerede` : "Åbn markerede");
  openSelectedEl.title = selectedRows.size ? `Åbn ${selectedRows.size} markerede` : "Åbn markerede";
  downloadSelectedEl.setAttribute("aria-label", selectedRows.size ? `Download ${selectedRows.size} markerede` : "Download markerede");
  downloadSelectedEl.title = selectedRows.size ? `Download ${selectedRows.size} markerede` : "Download markerede";
  clearSelectionEl.setAttribute("aria-label", selectedRows.size ? `Ryd ${selectedRows.size} markeringer` : "Ryd markeringer");
  clearSelectionEl.title = selectedRows.size ? `Ryd ${selectedRows.size} markeringer` : "Ryd markeringer";
  updateBatchButtons();
  renderSavedFilters();
}

function updateBatchButtons() {
  const disabled = batchBusy || !selectedRows.size;
  openSelectedEl.disabled = disabled;
  downloadSelectedEl.disabled = disabled;
  clearSelectionEl.disabled = batchBusy || !selectedRows.size;
}

function updateToggleAllButton(rows) {
  const groups = getVisibleGroups(rows);
  const hasGroups = groups.length > 0;
  const allOpen = hasGroups && groups.every(group => getGroupOpenState(group.view, group.key));
  const icon = allOpen ? "⊟" : "⊞";
  const label = allOpen ? "Klap sammen" : "Udvid";

  toggleAllEl.disabled = !hasGroups;
  toggleAllEl.textContent = icon;
  toggleAllEl.setAttribute("aria-label", `${label} alle grupper`);
  toggleAllEl.title = `${label} alle grupper`;
}

function renderSavedFilters() {
  const active = currentFilterSignature();
  const canSave = Boolean(currentFilterQuery());
  const alreadySaved = savedFilters.some(filter => filterSignature(filter) === active);

  saveSearchEl.disabled = !canSave;
  saveSearchEl.textContent = alreadySaved ? "★" : "☆";
  saveSearchEl.setAttribute("aria-pressed", String(alreadySaved));
  saveSearchEl.setAttribute("aria-label", alreadySaved ? "Fjern gemt søgning" : "Gem søgning");
  saveSearchEl.title = alreadySaved ? "Fjern gemt søgning" : "Gem søgning";

  savedSearchesEl.innerHTML = savedFilters.map(filter => `
    <span class="saved-chip" data-active="${filterSignature(filter) === active}">
      <button class="saved-chip-apply" type="button" data-apply-filter="${escapeAttr(filter.id)}" title="${escapeAttr(filterTitle(filter))}">
        <span class="saved-chip-label">${escapeHtml(filter.label)}</span>
      </button>
      <button class="saved-chip-remove" type="button" data-remove-filter="${escapeAttr(filter.id)}" aria-label="Fjern ${escapeAttr(filter.label)}">×</button>
    </span>`).join("");
}

async function toggleSavedFilter() {
  const query = currentFilterQuery();
  if (!query) return;

  const signature = currentFilterSignature();
  const existing = savedFilters.find(filter => filterSignature(filter) === signature);

  if (existing) {
    await removeSavedFilter(existing.id);
    return;
  }

  savedFilters = [{
    id: `filter-${Date.now()}`,
    label: query,
    query
  }, ...savedFilters].slice(0, MAX_SAVED_FILTERS);

  await persistSavedFilters();
  render();
}

async function applySavedFilter(id) {
  const filter = savedFilters.find(item => item.id === id);
  if (!filter) return;

  const activeSignature = currentFilterSignature();
  const nextSignature = filterSignature(filter);

  searchEl.value = activeSignature === nextSignature ? "" : filter.query;
  render();
}

async function removeSavedFilter(id) {
  savedFilters = savedFilters.filter(filter => filter.id !== id);
  await persistSavedFilters();
  render();
}

async function persistSavedFilters() {
  await extensionApi.storage.local.set({ [SAVED_FILTERS_KEY]: savedFilters });
}

function normalizeSavedFilters(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((filter, index) => ({
      id: String(filter?.id || `filter-${index}`),
      label: String(filter?.label || filter?.query || "").trim(),
      query: String(filter?.query || "").trim()
    }))
    .filter(filter => filter.query)
    .slice(0, MAX_SAVED_FILTERS);
}

function currentFilterQuery() {
  return searchEl.value.trim();
}

function currentFilterSignature() {
  return filterSignature({
    query: currentFilterQuery()
  });
}

function filterSignature(filter) {
  return String(filter.query || "").trim().toLowerCase();
}

function filterTitle(filter) {
  return filter.query;
}

function collectRows(queryParts) {
  const rows = [];

  assignments.forEach(assignment => {
    assignment.students.forEach(([userId, name, date, importedGradeUrl]) => {
      const key = rowKey(assignment.id, userId);
      const searchableText = `${assignment.title} ${name} ${date}`.toLowerCase();
      const matches = !queryParts.length || queryParts.some(query => searchableText.includes(query));

      if (!matches) return;

      rows.push({
        assignment,
        userId,
        name,
        date,
        importedGradeUrl,
        key,
        isSelected: selectedRows.has(key),
        parsedDate: parseTodoDate(date)
      });
    });
  });

  return rows;
}

function totalStudentCount() {
  let totalStudents = 0;

  assignments.forEach(assignment => {
    totalStudents += assignment.students.length;
  });

  return totalStudents;
}

function renderAssignmentView(rows) {
  const rowsByAssignment = new Map();
  rows.forEach(row => {
    const list = rowsByAssignment.get(row.assignment.id) || [];
    list.push(row);
    rowsByAssignment.set(row.assignment.id, list);
  });

  const parts = [];
  let visibleModules = 0;

  [...assignments]
    .sort((left, right) => assignmentCodeNumber(left.title) - assignmentCodeNumber(right.title))
    .forEach(assignment => {
      const assignmentRows = rowsByAssignment.get(assignment.id) || [];
      const studentRows = assignmentRows.map(row => studentRowHtml(row, "date")).join("");
      const isOpen = getGroupOpenState("assignment", assignment.id);

      if (!studentRows.trim()) return;
      visibleModules += 1;
      parts.push(`
        <section class="module${isOpen ? " open" : ""}" data-group data-group-view="assignment" data-group-key="${escapeAttr(String(assignment.id))}">
          <div class="module-header">
            <button class="toggle" type="button" data-toggle aria-label="Vis eller skjul ${escapeAttr(assignment.title)}"></button>
            <div class="assignment">
              <span class="assignment-icon">A</span>
              <a href="${escapeAttr(assignment.href || `https://mithf.dk/mod/assign/view.php?id=${assignment.id}`)}" target="_blank" rel="noreferrer" title="${escapeAttr(assignmentTooltip(assignment))}">${escapeHtml(assignment.title)}</a>
            </div>
            <span class="count">${assignmentRows.length}</span>
          </div>
          <ul class="students">${studentRows}</ul>
        </section>`);
    });

  modulesEl.innerHTML = parts.join("");
  emptyEl.style.display = visibleModules === 0 ? "block" : "none";
}

function renderDateView(rows) {
  const groups = new Map();

  [...rows]
    .sort((left, right) =>
      (left.parsedDate?.time ?? Number.MAX_SAFE_INTEGER) - (right.parsedDate?.time ?? Number.MAX_SAFE_INTEGER) ||
      assignmentCodeNumber(left.assignment.title) - assignmentCodeNumber(right.assignment.title) ||
      left.name.localeCompare(right.name, "da")
    )
    .forEach(row => {
      const groupKey = row.parsedDate?.key || "unknown";
      const group = groups.get(groupKey) || {
        key: groupKey,
        label: row.parsedDate?.label || "Ukendt dato",
        rows: []
      };
      group.rows.push(row);
      groups.set(groupKey, group);
    });

  modulesEl.innerHTML = [...groups.values()].map(group => {
    const isOpen = getGroupOpenState("date", group.key);
    return `
    <section class="date-group${isOpen ? " open" : ""}" data-group data-group-view="date" data-group-key="${escapeAttr(group.key)}">
      <div class="date-heading">
        <button class="toggle" type="button" data-toggle aria-label="Vis eller skjul ${escapeAttr(group.label)}"></button>
        <span>${escapeHtml(group.label)}</span>
        <span class="count">${group.rows.length}</span>
      </div>
      <ul class="students">${group.rows.map(row => studentRowHtml(row, "assignment")).join("")}</ul>
    </section>`;
  }).join("");
  emptyEl.style.display = rows.length === 0 ? "block" : "none";
}

function studentRowHtml(row, trailingType) {
  const gradeHref = gradeUrl(row.assignment.id, row.userId, row.importedGradeUrl);
  const studentHref = studentCardUrl(row.userId);
  const trailing = trailingType === "assignment"
    ? `<a class="assignment-meta" href="${escapeAttr(row.assignment.href || `https://mithf.dk/mod/assign/view.php?id=${row.assignment.id}`)}" target="_blank" rel="noreferrer" title="${escapeAttr(assignmentTooltip(row.assignment))}">${escapeHtml(row.assignment.title)}</a>`
    : `<span class="date">${escapeHtml(row.date)}</span>`;

  return `
    <li class="student ${row.isSelected ? "selected" : ""}">
      <input type="checkbox" data-select="${escapeAttr(row.key)}" ${row.isSelected ? "checked" : ""} aria-label="Vælg ${escapeAttr(row.name)} til batch handlinger">
      <a class="grade-link" href="${escapeAttr(gradeHref)}" target="_blank" rel="noreferrer" title="Bedøm opgave">✓</a>
      <button class="download-link" type="button" data-download-url="${escapeAttr(gradeHref)}" data-student-name="${escapeAttr(row.name)}" title="Download aflevering" aria-label="Download aflevering for ${escapeAttr(row.name)}">↓</button>
      <div class="student-main">
        <a class="avatar" href="${escapeAttr(studentHref)}" target="_blank" rel="noreferrer" title="${escapeAttr(row.name)}s elevkort">${escapeHtml(initials(row.name))}</a>
        <a class="student-name" href="${escapeAttr(studentHref)}" target="_blank" rel="noreferrer">${escapeHtml(row.name)}</a>
      </div>
      ${trailing}
    </li>`;
}

function parseTodoDate(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text.trim()) return null;

  if (/\bi dag\b|\btoday\b/.test(text)) {
    return dateToGroup(new Date());
  }

  if (/\bi går\b|\byesterday\b/.test(text)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return dateToGroup(date);
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return datePartsToGroup(Number(iso[3]), Number(iso[2]), iso[1]);
  }

  const numeric = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (numeric) {
    return datePartsToGroup(Number(numeric[1]), Number(numeric[2]), numeric[3]);
  }

  const monthNames = {
    jan: 1,
    januar: 1,
    feb: 2,
    februar: 2,
    mar: 3,
    marts: 3,
    apr: 4,
    april: 4,
    maj: 5,
    may: 5,
    jun: 6,
    juni: 6,
    june: 6,
    jul: 7,
    juli: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    okt: 10,
    oktober: 10,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
    january: 1,
    february: 2,
    march: 3,
    april: 4
  };
  const monthPattern = Object.keys(monthNames).join("|");
  const named = text.match(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${monthPattern})\\.?(?:\\s+(\\d{4}))?\\b`));

  if (named) {
    return datePartsToGroup(Number(named[1]), monthNames[named[2]], named[3]);
  }

  const monthFirst = text.match(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (monthFirst) {
    return datePartsToGroup(Number(monthFirst[2]), monthNames[monthFirst[1]], monthFirst[3]);
  }

  return null;
}

function datePartsToGroup(day, month, rawYear) {
  if (!day || !month || day < 1 || day > 31 || month < 1 || month > 12) return null;

  const currentYear = new Date().getFullYear();
  let year = rawYear ? Number(rawYear) : currentYear;
  if (year < 100) year += 2000;
  if (year < currentYear - 1 || year > currentYear + 1) year = currentYear;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return dateToGroup(date);
}

function dateToGroup(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    key,
    time: date.getTime(),
    label: new Intl.DateTimeFormat("da-DK", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date)
  };
}

function applyTheme() {
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  darkModeEl.setAttribute("aria-pressed", String(darkMode));
  darkModeEl.textContent = darkMode ? "☀" : "☾";
  darkModeEl.setAttribute("aria-label", darkMode ? "Lys tilstand" : "Mørk tilstand");
  darkModeEl.title = darkMode ? "Lys tilstand" : "Mørk tilstand";
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase();
}

function rowKey(moduleId, userId) {
  return `${moduleId}:${userId}`;
}

function gradeUrl(moduleId, userId, importedUrl = "") {
  try {
    const url = importedUrl
      ? new URL(importedUrl, location.href)
      : new URL("https://mithf.dk/mod/assign/view.php", location.href);
    url.searchParams.set("id", moduleId);
    url.searchParams.set("action", "grade");
    url.searchParams.set("userid", userId);
    url.searchParams.delete("rownum");
    return url.href;
  } catch {
    return `https://mithf.dk/mod/assign/view.php?id=${moduleId}&action=grade&userid=${userId}`;
  }
}

function studentCardUrl(userId) {
  return `https://mithf.dk/local/student_card/?id=${encodeURIComponent(userId)}`;
}

function parseIdFromUrl(url, name) {
  try {
    return new URL(url, location.href).searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function assignmentCodeNumber(title) {
  const match = title.match(/^E(\d+)ENG\b/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function assignmentTooltip(assignment) {
  const requirements = assignmentRequirements.get(normalizeAssignmentKey(assignment.title)) || "";
  return requirements ? `${assignment.title}\n\n${requirements}` : assignment.title;
}

async function loadAssignmentRequirements() {
  try {
    const response = await fetch(ASSIGNMENT_REQUIREMENTS_URL);
    if (!response.ok) return new Map();
    return parseAssignmentRequirementsMarkdown(await response.text());
  } catch {
    return new Map();
  }
}

function parseAssignmentRequirementsMarkdown(markdown) {
  const map = new Map();
  const lines = String(markdown || "").split(/\r?\n/);
  let currentKey = "";
  let currentBody = [];

  const flush = () => {
    const text = currentBody.join("\n").trim();
    if (currentKey && text) {
      map.set(normalizeAssignmentKey(currentKey), text);
    }
    currentBody = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentKey = heading[1];
      continue;
    }

    if (!currentKey) continue;
    currentBody.push(line);
  }

  flush();
  return map;
}

function normalizeAssignmentKey(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/\b([a-z]\d+[a-z]+)\b/i);
  return match ? match[1] : text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("da-DK", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}
