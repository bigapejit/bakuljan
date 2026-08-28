import type {
  OutputObjectDefinition,
  RunOptions,
  RunResult,
  StructuredOutputError,
} from "@ai-hero/sandcastle";
import { buildRetryFeedback } from "./retry-feedback";

export interface RunWithRetryOptions<T> extends Omit<RunOptions, "output"> {
  readonly output: OutputObjectDefinition<T>;
  readonly maxAttempts?: number;
}

export async function runWithRetry<T>(
  options: RunWithRetryOptions<T>
): Promise<RunResult & { output: T }> {
  const { run, StructuredOutputError } = await import("@ai-hero/sandcastle");
  const { output, maxAttempts = 3, ...runOptions } = options;

  let lastError: StructuredOutputError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!lastError) {
        return await run({ ...runOptions, output });
      }

      const sessionId = lastError.sessionId;
      if (!sessionId) {
        throw new Error(
          "runWithRetry: the failed run carried no sessionId, so it cannot be resumed for a retry."
        );
      }

      const { promptArgs: _retryArgs, ...retryOptions } = runOptions;
      return await run({
        ...retryOptions,
        name: runOptions.name
          ? `${runOptions.name} (retry ${attempt - 1})`
          : undefined,
        promptFile: undefined,
        prompt: buildRetryFeedback(lastError, attempt, maxAttempts),
        resumeSession: sessionId,
        output,
      });
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
