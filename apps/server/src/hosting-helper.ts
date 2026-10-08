import { spawn } from "node:child_process";
export type HelperAction =
  | "site-create"
  | "site-delete"
  | "account-create"
  | "account-passwd"
  | "account-delete"
  | "nginx-apply"
  | "remove-all";
export interface HelperResult {
  ok: boolean;
  phase?: string;
  code?: string;
  account?: string | null;
  backupId?: string;
}
export interface HostingHelper {
  run(
    action: HelperAction,
    body: Record<string, string>,
  ): Promise<HelperResult>;
}
export class SudoHostingHelper implements HostingHelper {
  async run(
    action: HelperAction,
    body: Record<string, string>,
  ): Promise<HelperResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/sudo",
        ["--non-interactive", "--", "/usr/local/sbin/jweb-helper", action],
        {
          shell: false,
          env: {
            PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
            LANG: "C",
            LC_ALL: "C",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [];
      let length = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
      timer.unref();
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 8192) child.kill("SIGKILL");
        else chunks.push(chunk);
      });
      child.stderr.on("data", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Helper unavailable."));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const result: HelperResult = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          if (
            length > 8192 ||
            typeof result.ok !== "boolean" ||
            (result.ok && code !== 0) ||
            (!result.ok && code === 0)
          )
            throw new Error();
          resolve(result);
        } catch {
          reject(new Error("Helper unavailable."));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(body));
    });
  }
}
