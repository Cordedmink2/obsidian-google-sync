import { App, Modal } from "obsidian";
import { PendingLine, pendingHeading } from "./sync/push-report";

/** Preview (dry run) result: one row per note with pending updates and the fields that changed. */
export class PendingUpdatesModal extends Modal {
    constructor(
        app: App,
        private readonly lines: PendingLine[],
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass("google-sync-pending");
        this.setTitle("Pending Google updates");
        contentEl.createEl("p", {
            text: `${pendingHeading(this.lines.length)} Nothing has been sent (dry run).`,
        });
        const list = contentEl.createEl("ul");
        for (const line of this.lines) {
            const li = list.createEl("li", { cls: line.blocked ? "google-sync-blocked" : "" });
            li.createEl("strong", { text: line.path });
            li.createSpan({ text: ` — ${line.detail}` });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
