browser.commands.onCommand.addListener((command) => {
  if (command === "open-manager") browser.runtime.openOptionsPage();
});
