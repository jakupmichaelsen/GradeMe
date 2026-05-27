HFtodo Extension

Install
1. Open edge://extensions or chrome://extensions
2. Turn on Developer mode
3. Click Load unpacked
4. Select this HFtodo-extension folder

Firefox install
Use the sibling `Mozilla` folder for Firefox.

Firefox permanent install
1. Firefox Release requires extensions to be signed before permanent installation.
2. Submit the Mozilla folder as an unlisted add-on through Mozilla Add-ons to get a signed `.xpi`.
3. During development, use Firefox's Load Temporary Add-on flow instead.

Chrome and Edge should keep using the default `manifest.json`. Firefox needs the separate manifest because it uses `background.scripts` for Manifest V3 background code instead of Chrome's `background.service_worker`.

Use
1. Open the extension from the toolbar
2. Click Opdater to pull the current Grade-Me block from Moodle
3. Use the checkboxes to mark multiple rows you want to work on together
4. Click Åbn markerede to open the selected feedback pages in new tabs
5. Click Download markerede to download the selected submission files
6. You can still use the per-row ✓ and download buttons for single items

Requirements tooltips
1. Edit `requirements.md`
2. Add one heading per assignment title from the Grade-Me block
3. Put the requirement text under that heading
4. The dashboard shows that text on mouseover for the assignment name

Notes
- The extension uses your current Moodle login in that browser profile.
- It stores only local app state in the browser.
