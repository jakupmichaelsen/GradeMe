# GradeMe Dashboard

## Install

1. Open `edge://extensions` or `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this extension folder.

## Firefox Install

Use the sibling `Mozilla` folder for Firefox.

For permanent installation in Firefox Release, extensions must be signed before installation. Submit the Mozilla folder as an unlisted add-on through Mozilla Add-ons to get a signed `.xpi`. During development, use Firefox's Load Temporary Add-on flow instead.

Chrome and Edge should keep using the default `manifest.json`. Firefox needs the separate manifest because it uses `background.scripts` for Manifest V3 background code instead of Chrome's `background.service_worker`.

## Use

1. Open the extension from the toolbar.
2. Click Opdater to pull the current Grade-Me block from Moodle.
3. Use the checkboxes to mark multiple rows you want to work on together.
4. Click Åbn markerede to open the selected feedback pages in new tabs.
5. Click Download markerede to download the selected submission files.
6. You can still use the per-row checkmark and download buttons for single items.

## Requirements Tooltips

The dashboard can show assignment-specific requirement text when you hover over an assignment name.

Create a local `requirements.md` file in the extension folder. This file is ignored by git, so course-specific requirements stay local.

Use one heading per assignment title from the Grade-Me block:

```markdown
# Assignment Requirements

## Assignment title from Moodle

Requirement text shown in the dashboard tooltip.
```

The dashboard matches each heading to the assignment title from the Grade-Me block and shows the text below that heading on mouseover.

## Notes

- The extension uses your current Moodle login in that browser profile.
- It stores only local app state in the browser.
