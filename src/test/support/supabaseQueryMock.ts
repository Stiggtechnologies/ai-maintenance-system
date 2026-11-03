/**
 * Chainable stand-in for the Supabase client used by edge functions.
 * Records every query and resolves it from a per-test handler. No network.
 */

export type QueryFilter = { method: string; args: unknown[] };

export type QueryCall = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  payload?: unknown;
  filters: QueryFilter[];
  columns?: string;
  options?: { count?: string; head?: boolean };
  rowLimit?: number;
  asSingle: boolean;
};

export type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => snapshot(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, snapshot(item)]),
    );
  }
  return value;
}

export function eqValue(call: QueryCall, column: string): unknown {
  return call.filters.find((filter) => filter.method === "eq" && filter.args[0] === column)
    ?.args[1];
}

type FromHandler = (call: QueryCall) => QueryResult;
type RpcHandler = (name: string, args: unknown) => QueryResult;

export function createSupabaseDouble(initialFrom?: FromHandler) {
  const calls: QueryCall[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const clients: { url: string; key: string; options?: unknown }[] = [];
  let fromHandler: FromHandler = initialFrom ?? (() => ({ data: null, error: null }));
  let rpcHandler: RpcHandler = () => ({ data: null, error: null });
  let listUsers = (_args: unknown): QueryResult => ({
    data: { users: [] },
    error: null,
  });
  let membership: {
    id: string;
    organization_id: string;
    role: string;
    email: string;
    full_name: string;
  } | null = {
    id: "user-1",
    organization_id: "tenant-1",
    role: "admin",
    email: "ada@example.com",
    full_name: "Ada",
  };
  let authHandler = (token: string): {
    data: { user: { id: string; email: string } | null };
    error: { message: string } | null;
  } => {
    if (token === "user-jwt") {
      return {
        data: {
          user: {
            id: membership?.id ?? "user-1",
            email: membership?.email ?? "ada@example.com",
          },
        },
        error: null,
      };
    }
    return { data: { user: null }, error: { message: "invalid jwt" } };
  };

  class QueryBuilder {
    op: QueryCall["op"] = "select";
    payload: unknown;
    filters: QueryFilter[] = [];
    columns?: string;
    options?: QueryCall["options"];
    rowLimit?: number;
    asSingle = false;

    constructor(readonly table: string) {}

    filter(method: string, args: unknown[]) {
      this.filters.push({ method, args });
      return this;
    }

    select(columns?: string, options?: QueryCall["options"]) {
      this.columns = columns;
      this.options = options;
      if (this.op === "select") this.op = "select";
      return this;
    }

    insert(payload: unknown) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }

    update(payload: unknown) {
      this.op = "update";
      this.payload = payload;
      return this;
    }

    delete() {
      this.op = "delete";
      return this;
    }

    upsert(payload: unknown) {
      this.op = "upsert";
      this.payload = payload;
      return this;
    }

    eq(column: string, value: unknown) {
      return this.filter("eq", [column, value]);
    }

    neq(column: string, value: unknown) {
      return this.filter("neq", [column, value]);
    }

    gte(column: string, value: unknown) {
      return this.filter("gte", [column, value]);
    }

    gt(column: string, value: unknown) {
      return this.filter("gt", [column, value]);
    }

    lt(column: string, value: unknown) {
      return this.filter("lt", [column, value]);
    }

    lte(column: string, value: unknown) {
      return this.filter("lte", [column, value]);
    }

    in(column: string, value: unknown) {
      return this.filter("in", [column, value]);
    }

    is(column: string, value: unknown) {
      return this.filter("is", [column, value]);
    }

    not(column: string, operator: string, value: unknown) {
      return this.filter("not", [column, operator, value]);
    }

    or(expression: string) {
      return this.filter("or", [expression]);
    }

    contains(column: string, value: unknown) {
      return this.filter("contains", [column, value]);
    }

    order(column: string, options?: unknown) {
      return this.filter("order", [column, options]);
    }

    limit(count: number) {
      this.rowLimit = count;
      return this;
    }

    match(query: unknown) {
      return this.filter("match", [query]);
    }

    maybeSingle() {
      this.asSingle = true;
      return this;
    }

    single() {
      this.asSingle = true;
      return this;
    }

    toCall(): QueryCall {
      return {
        table: this.table,
        op: this.op,
        payload: snapshot(this.payload),
        filters: this.filters,
        columns: this.columns,
        options: this.options,
        rowLimit: this.rowLimit,
        asSingle: this.asSingle,
      };
    }

    then<TResult1 = QueryResult, TResult2 = never>(
      onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      const call = this.toCall();
      calls.push(call);
      return Promise.resolve()
        .then(() => {
          if (call.table === "user_profiles" && call.op === "select") {
            return membership
              ? { data: { ...membership }, error: null }
              : { data: null, error: null };
          }
          return fromHandler(call);
        })
        .then(onFulfilled, onRejected);
    }
  }

  function bearerFromOptions(options: unknown): string {
    if (!options || typeof options !== "object") return "";
    const headers = (options as { global?: { headers?: { Authorization?: string } } }).global
      ?.headers;
    const header = headers?.Authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  }

  function createClient(url: string, key: string, options?: unknown) {
    clients.push({ url, key, options });
    const clientToken = bearerFromOptions(options);
    return {
      from(table: string) {
        return new QueryBuilder(table);
      },
      rpc(name: string, args?: unknown) {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcHandler(name, args));
      },
      auth: {
        getUser(jwt?: string) {
          const token = typeof jwt === "string" && jwt ? jwt : clientToken;
          return Promise.resolve(authHandler(token));
        },
        admin: {
          listUsers(args?: unknown) {
            return Promise.resolve(listUsers(args));
          },
        },
      },
    };
  }

  return {
    createClient,
    calls,
    rpcCalls,
    clients,
    setFrom(fn: FromHandler) {
      fromHandler = fn;
    },
    setRpc(fn: RpcHandler) {
      rpcHandler = fn;
    },
    setListUsers(fn: typeof listUsers) {
      listUsers = fn;
    },
    setMembership(profile: typeof membership) {
      membership = profile;
    },
    setAuth(fn: typeof authHandler) {
      authHandler = fn;
    },
    reset() {
      calls.length = 0;
      rpcCalls.length = 0;
      clients.length = 0;
    },
  };
}

export type SupabaseDouble = ReturnType<typeof createSupabaseDouble>;
