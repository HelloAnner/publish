/** 统一错误类型与退出码。 */

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  guard: 3,
  auth: 4,
  partial: 5,
} as const;

export interface PublishErrorOptions {
  code?: string;
  exitCode?: number;
  hint?: string;
  cause?: unknown;
}

export class PublishError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;

  constructor(message: string, opts: PublishErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "PublishError";
    this.code = opts.code ?? "ERROR";
    this.exitCode = opts.exitCode ?? EXIT.error;
    this.hint = opts.hint;
  }
}

export class UsageError extends PublishError {
  constructor(message: string, hint?: string) {
    super(message, { code: "USAGE", exitCode: EXIT.usage, hint });
    this.name = "UsageError";
  }
}

export class AuthRequiredError extends PublishError {
  constructor(platform: string, detail?: string) {
    super(
      `${platform} 未登录${detail ? `（${detail}）` : ""}`,
      {
        code: "AUTH_REQUIRED",
        exitCode: EXIT.auth,
        hint: `先在浏览器里登录，然后运行：publish login -to ${platform}`,
      },
    );
    this.name = "AuthRequiredError";
  }
}

export class GuardError extends PublishError {
  constructor(message: string, hint?: string) {
    super(message, { code: "GUARD", exitCode: EXIT.guard, hint: hint ?? "确认无误可加 --force 跳过护栏" });
    this.name = "GuardError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
