import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { harden } from "./harden.ts";
import type { PackagePool } from "./pool-files.ts";

/**
 * A pool that lives in memory, for a window that refuses OPFS (SDD-0004 §15).
 * It offers what the store uses of the OPFS pool, over SQLite's in-memory
 * databases: a file is its bytes, a connection is a `:memory:` database that
 * deserializes them when opened and serializes them back when closed. Nothing
 * is written anywhere; the window closing ends it.
 */
export function createMemoryPool(sqlite3: Sqlite3Static): PackagePool {
  const { capi, wasm, oo1 } = sqlite3;
  /** Each file's bytes as of its last close; a file open now is read from its connection. */
  const files = new Map<string, Uint8Array>();
  const open = new Map<string, Database>();

  const bytesOf = (file: string): Uint8Array => {
    const db = open.get(file);
    if (db) return capi.sqlite3_js_db_export(db.pointer as number);
    const bytes = files.get(file);
    if (!bytes) throw new Error(`${file}: no such file`);
    return bytes;
  };

  class MemoryDb extends oo1.DB {
    #file: string; // set after super(), which makes the database

    constructor(file: string) {
      super(":memory:");
      this.#file = file;
      if (!harden(sqlite3, this)) {
        super.close();
        throw new Error(`${file}: SQLite would not be set to run safely`);
      }
      if (open.has(file)) {
        super.close();
        throw new Error(`${file} is already open`);
      }
      const bytes = files.get(file);
      if (bytes?.length) {
        // The database takes the copy and frees it on close.
        const copy = wasm.allocFromTypedArray(bytes);
        const rc = capi.sqlite3_deserialize(
          this.pointer as number,
          "main",
          copy,
          bytes.length,
          bytes.length,
          capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
        );
        if (rc !== 0) {
          super.close();
          throw new Error(`${file}: could not be read (code ${rc})`);
        }
      } else {
        files.set(file, new Uint8Array(0)); // opening makes the file, as the pool does
      }
      open.set(file, this);
    }

    // The whole file is serialized back, written to or not: a book is a few MB.
    override close(): void {
      try {
        if (this.pointer && open.get(this.#file) === this) {
          files.set(this.#file, capi.sqlite3_js_db_export(this.pointer));
        }
      } finally {
        // The connection ends and the file is free to open again, whatever the export did.
        if (open.get(this.#file) === this) open.delete(this.#file);
        super.close();
      }
    }
  }

  return {
    getFileNames: () => [...files.keys()],
    getFileCount: () => files.size,
    // There are no slots to make.
    reserveMinimumCapacity: async (n) => n,
    importDb: (file, bytes) => {
      if (open.has(file)) throw new Error(`${file} is open`);
      files.set(file, Uint8Array.from(bytes));
      return bytes.length;
    },
    exportFile: (file) => Uint8Array.from(bytesOf(file)),
    unlink: (file) => {
      if (open.has(file)) throw new Error(`${file} is open`);
      return files.delete(file);
    },
    OpfsSAHPoolDb: MemoryDb as unknown as new (file: string) => Database,
    pauseVfs: () => {},
  };
}
