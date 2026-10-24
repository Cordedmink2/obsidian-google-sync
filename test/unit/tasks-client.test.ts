import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleTasksClient } from "../../src/google/tasks";
import { GoogleApiError } from "../../src/google/api";
import { fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

describe("GoogleTasksClient", () => {
    it("lists task lists", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { items: [{ id: "L1", title: "Home" }] })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        const lists = await client.listTaskLists();
        expect(lists[0]?.id).to.equal("L1");
        expect(calls[0]?.url).to.equal("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
    });

    it("follows nextPageToken across task list pages", async () => {
        const { calls, fn } = fakeHttp([
            jsonResp(200, { items: [{ id: "L1" }], nextPageToken: "p2" }),
            jsonResp(200, { items: [{ id: "L2" }] }),
        ]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        const lists = await client.listTaskLists();
        expect(lists.map((l) => l.id)).to.deep.equal(["L1", "L2"]);
        expect(calls[1]?.url).to.contain("pageToken=p2");
    });

    it("moves a task under a parent via the move endpoint", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "c1", parent: "p1" })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        await client.moveTask("L1", "c1", { parent: "p1" });
        expect(calls[0]?.method).to.equal("POST");
        expect(calls[0]?.url).to.equal(
            "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/c1/move?parent=p1",
        );
        expect(calls[0]?.body).to.equal(undefined);
    });

    it("patches a task by id", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "t1" })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        await client.patchTask("L1", "t1", { status: "completed" });
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/lists/L1/tasks/t1");
    });

    it("has no create capability (one-way: nothing here may insert Google tasks)", () => {
        const client = new GoogleTasksClient(fakeHttp().fn, token, noWaitRetry);
        const c = client as unknown as Record<string, unknown>;
        for (const name of ["insertTask", "createTask", "addTask"])
            expect(c[name], name).to.equal(undefined);
    });

    it("has no delete capability (one-way: nothing here may delete Google tasks)", () => {
        const client = new GoogleTasksClient(fakeHttp().fn, token, noWaitRetry);
        expect((client as unknown as Record<string, unknown>).deleteTask).to.equal(undefined);
    });

    it("throws GoogleApiError on 500", async () => {
        const { fn } = fakeHttp([
            jsonResp(500),
            jsonResp(500),
            jsonResp(500),
            jsonResp(500),
            jsonResp(500),
        ]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        let err: unknown;
        try {
            await client.patchTask("L1", "t1", { title: "X" });
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(GoogleApiError);
        expect((err as GoogleApiError).status).to.equal(500);
    });
});
