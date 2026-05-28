import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleTasksClient } from "../../src/google/tasks";
import { GoogleApiError } from "../../src/google/api";
import { emptyResp, fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

describe("GoogleTasksClient", () => {
    it("lists task lists", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { items: [{ id: "L1", title: "Home" }] })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        const lists = await client.listTaskLists();
        expect(lists[0]?.id).to.equal("L1");
        expect(calls[0]?.url).to.equal("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
    });

    it("inserts a task with bearer auth and JSON body", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "t1", title: "Buy milk" })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        const result = await client.insertTask("L1", { title: "Buy milk" });
        expect(result.id).to.equal("t1");
        expect(calls[0]?.method).to.equal("POST");
        expect(calls[0]?.url).to.equal("https://tasks.googleapis.com/tasks/v1/lists/L1/tasks");
        expect(calls[0]?.headers?.Authorization).to.equal("Bearer test-token");
    });

    it("patches a task by id", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "t1" })]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        await client.patchTask("L1", "t1", { status: "completed" });
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/lists/L1/tasks/t1");
    });

    it("deletes a task", async () => {
        const { calls, fn } = fakeHttp([emptyResp(204)]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);
        await client.deleteTask("L1", "t1");
        expect(calls[0]?.method).to.equal("DELETE");
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
            await client.insertTask("L1", { title: "X" });
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(GoogleApiError);
        expect((err as GoogleApiError).status).to.equal(500);
    });
});
