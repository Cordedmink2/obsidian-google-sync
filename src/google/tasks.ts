import { GoogleTask } from "../types";
import { HttpFn, RetryOptions } from "./http";
import { ApiCall, TokenProvider, addQuery, apiCall } from "./api";

const BASE = "https://tasks.googleapis.com/tasks/v1";
const enc = encodeURIComponent;

export interface TaskListEntry {
    id: string;
    title?: string;
}

export interface ListTasksOptions {
    pageSize?: number;
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
        const items: TaskListEntry[] = [];
        let pageToken: string | undefined;
        do {
            const r = (await this.call({
                method: "GET",
                url: addQuery(`${BASE}/users/@me/lists`, { pageToken }),
            })) as { items?: TaskListEntry[]; nextPageToken?: string };
            items.push(...(r.items ?? []));
            pageToken = r.nextPageToken;
        } while (pageToken);
        return items;
    }

    async listTasks(taskListId: string, options: ListTasksOptions = {}): Promise<GoogleTask[]> {
        const items: GoogleTask[] = [];
        let pageToken: string | undefined;

        do {
            const url = addQuery(`${BASE}/lists/${enc(taskListId)}/tasks`, {
                showCompleted: true,
                showHidden: true,
                maxResults: options.pageSize,
                pageToken,
            });
            const r = (await this.call({ method: "GET", url })) as {
                items?: GoogleTask[];
                nextPageToken?: string;
            };
            items.push(...(r.items ?? []));
            pageToken = r.nextPageToken;
        } while (pageToken);

        return items;
    }

    /**
     * Reparent and/or reposition an existing task. `parent` nests it under another
     * task (omit to promote to top level); `previous` is the sibling it follows.
     * This is the only endpoint that can change a task's parent.
     */
    async moveTask(
        taskListId: string,
        taskId: string,
        options: { parent?: string; previous?: string } = {},
    ): Promise<GoogleTask> {
        return (await this.call({
            method: "POST",
            url: addQuery(`${BASE}/lists/${enc(taskListId)}/tasks/${enc(taskId)}/move`, {
                parent: options.parent,
                previous: options.previous,
            }),
        })) as GoogleTask;
    }

    async getTask(taskListId: string, taskId: string): Promise<GoogleTask> {
        return (await this.call({
            method: "GET",
            url: `${BASE}/lists/${enc(taskListId)}/tasks/${enc(taskId)}`,
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
}
