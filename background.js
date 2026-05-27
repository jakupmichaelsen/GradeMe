const COURSE_URL = "https://mithf.dk/course/view.php?id=189";
const COURSE_URL_PATTERN = "https://mithf.dk/course/view.php?id=189*";
const extensionApi = globalThis.browser || chrome;

extensionApi.action.onClicked.addListener(() => {
  extensionApi.tabs.create({ url: extensionApi.runtime.getURL("dashboard.html") });
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCRAPE_COURSE") {
    scrapeCourse()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "DOWNLOAD_SUBMISSION") {
    downloadSubmission(message.url, message.studentName)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  return false;
});

async function scrapeCourse() {
  const tab = await getCourseTab();
  await extensionApi.tabs.reload(tab.id, { bypassCache: true });
  await waitForComplete(tab.id);

  const [result] = await extensionApi.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scraper.js"]
  });

  if (!result?.result) {
    return { ok: false, error: "Moodle-siden svarede ikke med data." };
  }

  return result.result;
}

async function getCourseTab() {
  const tabs = await extensionApi.tabs.query({ url: COURSE_URL_PATTERN });
  if (tabs[0]) return tabs[0];
  return extensionApi.tabs.create({ url: COURSE_URL, active: false });
}

async function downloadSubmission(url, studentName) {
  if (!url || !url.startsWith("https://mithf.dk/")) {
    return { ok: false, error: "Ugyldigt Moodle-link." };
  }

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    return { ok: false, error: `Moodle-siden kunne ikke hentes (${response.status}).` };
  }

  const html = await response.text();
  const urls = extractSubmissionUrls(html, url);

  if (!urls.length) {
    return { ok: false, count: 0, error: "Ingen fil- eller lydaflevering fundet." };
  }

  const safeName = firstName(studentName || findStudentName(html) || "student");
  for (const [index, fileUrl] of urls.entries()) {
    await extensionApi.downloads.download({
      url: fileUrl,
      filename: downloadFilename(fileUrl, safeName, urls.length > 1 ? index + 1 : 0),
      conflictAction: "uniquify",
      saveAs: false
    });
  }

  return { ok: true, count: urls.length };
}

function extractSubmissionUrls(html, pageUrl) {
  const urls = [];

  for (const tag of tagsByName(html, "a").filter(tag => attributeValue(tag, "href").includes("pluginfile.php"))) {
    urls.push(attributeValue(tag, "href"));
  }

  for (const tag of matchingTags(html, "audio", ["assignsubmission_onlinepoodll_audio"])) {
    urls.push(attributeValue(tag, "src"));
  }

  return [...new Set(urls.map(url => absoluteUrl(url, pageUrl)).filter(Boolean))];
}

function tagsByName(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
}

function matchingTags(html, tagName, requiredClasses, requiredText = "") {
  const tags = tagsByName(html, tagName);
  return tags.filter(tag => {
    const className = attributeValue(tag, "class");
    const classes = className.split(/\s+/).filter(Boolean);
    return requiredClasses.some(required => classes.includes(required)) && (!requiredText || tag.includes(requiredText));
  });
}

function attributeValue(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return decodeHtmlAttribute(match?.[1] || match?.[2] || match?.[3] || "");
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absoluteUrl(url, baseUrl) {
  if (!url) return "";
  try {
    const absolute = new URL(url, baseUrl);
    return absolute.protocol === "https:" && absolute.hostname === "mithf.dk" ? absolute.href : "";
  } catch {
    return "";
  }
}

function downloadFilename(url, studentName, index) {
  const suffix = index ? `-${index}` : "";
  const ext = extensionFromUrl(url) || "file";
  return `${studentName}${suffix}.${ext}`;
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const filename = pathname.split("/").filter(Boolean).pop() || "";
    const match = filename.match(/\.([A-Za-z0-9]{1,8})$/);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function findStudentName(html) {
  const titleMatch = html.match(/<title\b[^>]*>([^<]+)/i);
  if (titleMatch) return decodeHtmlAttribute(titleMatch[1]).trim();

  const selectors = [
    ".fullname",
    ".userfullnames",
    ".logininfo",
    ".page-header-headings h1",
    ".page-header-headings",
    "h1",
    "h2",
    "h3"
  ];

  for (const selector of selectors.filter(selector => selector.startsWith("."))) {
    const className = selector.slice(1);
    const tag = (html.match(new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, "i")) || [])[0];
    const text = stripTags(tag || "").trim();
    if (text) return text;
  }

  return "";
}

function stripTags(html) {
  return decodeHtmlAttribute(String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function firstName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .map(part => part.replace(/[^A-Za-zÆØÅæøåÀ-ÖØ-öø-ÿ0-9._-]/g, ""));

  const candidate = parts.find(part => part && !/^[A-ZÆØÅ]{1,4}$/.test(part)) || parts[0] || "";
  return candidate || "student";
}

function waitForComplete(tabId) {
  return new Promise((resolve, reject) => {
    extensionApi.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        extensionApi.tabs.onUpdated.removeListener(listener);
        reject(new Error("Moodle-siden blev ikke færdig med at indlæse."));
      }, 30000);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        clearTimeout(timeout);
        extensionApi.tabs.onUpdated.removeListener(listener);
        resolve();
      };

      extensionApi.tabs.onUpdated.addListener(listener);
    }).catch(error => {
      reject(new Error(error?.message || String(error)));
    });
  });
}
