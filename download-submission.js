async function downloadSubmissionsFromGradePage() {
  const params = new URLSearchParams(location.search);
  const studentName = firstName(params.get("hf_student_name") || findStudentName() || params.get("userid") || "student");
  const mimeToExt = mime => ({
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "image/jpeg": "jpg",
    "image/png": "png"
  }[mime] || "file");

  const urls = [];
  const fileLinks = [
    ...document.querySelectorAll(
      '.fileuploadsubmission a[href*="pluginfile.php"], .assignsubmission.assignsubmission_file a[href*="pluginfile.php"]'
    )
  ];
  urls.push(...fileLinks.map(link => link.href));

  const audio = document.querySelectorAll("audio.assignsubmission_onlinepoodll_audio[src]");
  urls.push(...[...audio].map(element => element.src));

  const uniqueUrls = [...new Set(urls)];
  if (!uniqueUrls.length) {
    return {
      ok: false,
      count: 0,
      error: "Ingen fil- eller lydaflevering fundet."
    };
  }

  uniqueUrls.forEach((url, index) => {
    fetch(url)
      .then(response => response.blob())
      .then(blob => {
        const ext = mimeToExt(blob.type);
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const suffix = uniqueUrls.length > 1 ? `-${index + 1}` : "";
        link.href = blobUrl;
        link.download = `${studentName}${suffix}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      });
  });

  return {
    ok: true,
    count: uniqueUrls.length
  };
}

function findStudentName() {
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

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = String(element.textContent || "").trim();
      const match = text.match(/^([A-ZÆØÅ][^\n(]+?)(?:\s*[-–|]\s*|\s*\()/);
      if (match) {
        return match[1].trim();
      }
      if (text && text.split(/\s+/).length >= 2) {
        return text;
      }
    }
  }

  const title = String(document.title || "").trim();
  const titleMatch = title.match(/^([A-ZÆØÅ][^-\n]+?)(?:\s*[-–|]\s*|\s*\()/);
  return titleMatch ? titleMatch[1].trim() : "";
}

function firstName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .map(part => part.replace(/[^A-Za-zÆØÅæøåÀ-ÖØ-öø-ÿ0-9._-]/g, ""));

  const candidate = parts.find(part => part && !/^[A-ZÆØÅ]{1,4}$/.test(part)) || parts[0] || "";
  return candidate || "student";
}

downloadSubmissionsFromGradePage();
