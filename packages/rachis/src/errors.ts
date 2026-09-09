export class UnknownColumnError extends Error {
  readonly code = "UnknownColumn";
  constructor(message = "UnknownColumn: unknown column") {
    super(message);
    this.name = "UnknownColumnError";
  }
}

// Reserved for a future table registry. Raw fragments validate table names
// with a regex today, so nothing throws this yet. Kept exported so the
// four-error surface stays stable.
export class UnknownTableError extends Error {
  readonly code = "UnknownTable";
  constructor(message = "UnknownTable: unknown table") {
    super(message);
    this.name = "UnknownTableError";
  }
}

export class UnsafeFullTableError extends Error {
  readonly code = "UnsafeFullTable";
  constructor(message = "UnsafeFullTable: refused unsafe full-table operation") {
    super(message);
    this.name = "UnsafeFullTableError";
  }
}

export class UnsafeRawError extends Error {
  readonly code = "UnsafeRaw";
  constructor(message = "UnsafeRaw: unsafe raw fragment") {
    super(message);
    this.name = "UnsafeRawError";
  }
}

export class UnknownOperatorError extends Error {
  readonly code = "UnknownOperator";
  constructor(message = "UnknownOperator: unknown operator") {
    super(message);
    this.name = "UnknownOperatorError";
  }
}

export class UnknownRelationError extends Error {
  readonly code = "UnknownRelation";
  constructor(message = "UnknownRelation: unknown relation") {
    super(message);
    this.name = "UnknownRelationError";
  }
}
