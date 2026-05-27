(() => {
  const block = document.querySelector("#inst4478");

  if (!block) {
    return {
      ok: false,
      url: location.href,
      error: "Kunne ikke finde Grade-Me blokken. Tjek at du er logget ind på Moodle i denne browser."
    };
  }

  return {
    ok: true,
    url: location.href,
    title: document.title,
    html: block.outerHTML,
    fetchedAt: new Date().toISOString()
  };
})();
