import { describe, it } from "mocha";
import { expect } from "chai";
import {
    detectKind,
    isManagedSubpath,
    validateEvent,
    validateTask,
} from "../../src/sync/frontmatter";

describe("detectKind", () => {
    it("classifies event and task notes by top folder", () => {
        expect(detectKind("events/x.md", "events", "tasks")).to.equal("event");
        expect(detectKind("tasks/y.md", "events", "tasks")).to.equal("task");
        expect(detectKind("notes/z.md", "events", "tasks")).to.equal(null);
    });
    it("handles nested paths and stray slashes", () => {
        expect(detectKind("events/archive/x.md", "events", "tasks")).to.equal("event");
        expect(detectKind("/events/x.md", "/events/", "tasks")).to.equal("event");
    });
});

describe("isManagedSubpath", () => {
    it("flags archive/overdue/completed subfolders", () => {
        expect(isManagedSubpath("events/archive/x.md", "events", "tasks")).to.equal(true);
        expect(isManagedSubpath("tasks/overdue/x.md", "events", "tasks")).to.equal(true);
        expect(isManagedSubpath("tasks/completed/x.md", "events", "tasks")).to.equal(true);
    });
    it("does not flag top-level notes", () => {
        expect(isManagedSubpath("events/x.md", "events", "tasks")).to.equal(false);
        expect(isManagedSubpath("tasks/y.md", "events", "tasks")).to.equal(false);
    });
});

describe("validateEvent", () => {
    it("requires a title and a date", () => {
        const r = validateEvent({});
        expect(r.ok).to.equal(false);
        expect(r.errors).to.have.length(2);
    });
    it("accepts a valid event and preserves extra keys", () => {
        const r = validateEvent({
            title: "Standup",
            date: "2026-06-02T09:00:00",
            color: "#bf40bf",
        });
        expect(r.ok).to.equal(true);
        expect(r.value?.title).to.equal("Standup");
        expect((r.value as Record<string, unknown>).color).to.equal("#bf40bf");
    });
});

describe("validateTask", () => {
    it("requires a title", () => {
        expect(validateTask({}).ok).to.equal(false);
    });
    it("rejects a non-boolean completed", () => {
        const r = validateTask({ title: "Buy milk", completed: "yes" });
        expect(r.ok).to.equal(false);
    });
    it("accepts a valid task", () => {
        const r = validateTask({ title: "Buy milk", completed: false });
        expect(r.ok).to.equal(true);
        expect(r.value?.title).to.equal("Buy milk");
    });
});
