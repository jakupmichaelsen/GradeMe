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

  const downloadUrl = new URL(url);
  if (studentName) {
    downloadUrl.searchParams.set("hf_student_name", studentName);
  }

  const tab = await extensionApi.tabs.create({ url: downloadUrl.href, active: false });
  try {
    await waitForComplete(tab.id);

    const [result] = await extensionApi.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["download-submission.js"]
    });

    if (!result?.result) {
      return { ok: false, error: "Download-scriptet svarede ikke." };
    }

    return result.result;
  } finally {
    setTimeout(() => {
      extensionApi.tabs.remove(tab.id).catch(() => {});
    }, 15000);
  }
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
