// Who may ask the engine for its stats or to forget everything: the extension's own pages (the popup, also when it
// is open in a tab), never a content script on a web page. Pure, so it is tested without Chrome.
export interface Sender {
  id?: string;
  url?: string;
}

export function fromExtensionPage(sender: Sender, extensionId: string, extensionOrigin: string): boolean {
  return sender.id === extensionId && typeof sender.url === "string" && sender.url.startsWith(extensionOrigin);
}
