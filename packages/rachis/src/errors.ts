export class UnknownColumnError extends Error {
  readonly code = "UnknownColumn";
  constructor(message: string) {
    super(message);
    this.name = "UnknownColumnError";
  }
}

export class UnknownTableError extends Error {
  readonly code = "UnknownTable";
  constructor(message: string) {
    super(message);
    this.name = "UnknownTableError";
  }
}

export class UnsafeFullTableError extends Error {
  readonly code = "UnsafeFullTable";
  constructor(message: string) {
    super(message);
    this.name = "UnsafeFullTableError";
  }
}

export class UnsafeRawError extends Error {
  readonly code = "UnsafeRaw";
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRawError";
  }
}

export class UnknownOperatorError extends Error {
  readonly code = "UnknownOperator";
  constructor(message: string) {
    super(message);
    this.name = "UnknownOperatorError";
  }
}
