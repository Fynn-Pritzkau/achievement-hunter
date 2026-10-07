// The few Node APIs the tests use, so the project needs no @types/node (and app code gets no Node globals).

declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function existsSync(path: string): boolean;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:sqlite' {
  interface StatementSync {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    readonly isOpen: boolean;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
