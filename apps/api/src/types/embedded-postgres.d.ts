declare module 'embedded-postgres' {
  type EmbeddedPostgresOptions = {
    databaseDir: string;
    user?: string;
    password?: string;
    port?: number;
    persistent?: boolean;
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
  };

  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  }
}
