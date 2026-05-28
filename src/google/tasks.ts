import { GoogleTask } from "../types";
import { HttpFn, RetryOptions } from "./http";
import { ApiCall, TokenProvider, apiCall } from "./api";

const BASE = "https://tasks.googleapis.com/tasks/v1";
const enc = encodeURIComponent;

export interface TaskListEntry {
    id: string;
    title?: string;
}

/** Thin Google Tasks v1 client over an injectable transport. */
export class GoogleTasksClient {
    constructor(
        private readonly http: HttpFn,
        private readonly getToken: TokenProvider,
        private readonly retry: RetryOptions = {},
    ) {}

    private call(c: ApiCall): Promise<unknown> {
        return apiCall(this.http, this.getToken, this.retry, c);
    }

    async listTaskLists(): Promise<TaskListEntry[]> {
        const r = (await this.call({ method: "GET", url: `${BASE}/users/@me/lists` })) as {
            items?: TaskListEntry[];
        };
        return r.items ?? [];
    }

    async insertTask(taskListId: string, task: GoogleTask): Promise<GoogleTask> {
        return (await this.call({
            method: "POST",
            url: `${BASE}/lists/${enc(taskListId)}/tasks`,
            body: task,
        })) as GoogleTask;
    }

    async patchTask(
        taskListId: string,
        taskId: string,
        patch: Partial<GoogleTask>,
    ): Promise<GoogleTask> {
        return (await this.call({
            method: "PATCH",
            url: `${BASE}/lists/${enc(taskListId)}/tasks/${enc(taskId)}`,
            body: patch,
        })) as GoogleTask;
    }

    async deleteTask(taskListId: string, taskId: string): Promise<void> {
        await this.call({
            method: "DELETE",
            url: `${BASE}/lists/${enc(taskListId)}/tasks/${enc(taskId)}`,
        });
    }
}
