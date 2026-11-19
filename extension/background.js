// Opens the panel page. The panel (not this service worker) owns the folder
// handle, because showDirectoryPicker() needs a page and a user click.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
});
