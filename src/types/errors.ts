export class Pay402Error extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Pay402Error";
  }
}

export class NoCompatibleRailError extends Pay402Error {
  constructor(
    public readonly availableRails: string[],
    public readonly configuredWallets: string[],
  ) {
    super(
      `No compatible rail found. Server offers: [${availableRails.join(", ")}], ` +
        `configured wallets: [${configuredWallets.join(", ")}]`,
    );
    this.name = "NoCompatibleRailError";
  }
}

export class SpendLimitExceededError extends Pay402Error {
  constructor(
    public readonly limitType: string,
    public readonly limitAmountUsd: number,
    public readonly attemptedAmountUsd: number,
    public readonly currentSpendUsd: number,
  ) {
    super(
      `Spend limit exceeded: ${limitType} limit is $${limitAmountUsd.toFixed(2)}, ` +
        `current spend $${currentSpendUsd.toFixed(2)}, ` +
        `attempted $${attemptedAmountUsd.toFixed(2)}`,
    );
    this.name = "SpendLimitExceededError";
  }
}

export class PaymentFailedError extends Pay402Error {
  constructor(
    public readonly rail: string,
    public readonly underlyingError: Error,
  ) {
    super(`Payment failed on rail "${rail}": ${underlyingError.message}`, {
      cause: underlyingError,
    });
    this.name = "PaymentFailedError";
  }
}

export class PaymentInFlightError extends Pay402Error {
  constructor(
    public readonly rail: string,
    public readonly paymentId?: string,
  ) {
    super(
      `Payment on rail "${rail}" is in-flight — outcome unknown. ` +
        (paymentId ? `Payment ID: ${paymentId}` : "No payment ID available."),
    );
    this.name = "PaymentInFlightError";
  }
}

export class PaymentVerificationError extends Pay402Error {
  constructor(
    public readonly rail: string,
    public readonly statusCode: number,
  ) {
    super(
      `Server rejected payment proof on rail "${rail}" — ` +
        `returned status ${statusCode} after retry`,
    );
    this.name = "PaymentVerificationError";
  }
}

export class BridgePaymentFailedError extends Pay402Error {
  constructor(
    public readonly bridgePath: string,
    public readonly underlyingError: Error,
  ) {
    super(
      `Bridge payment failed on path "${bridgePath}": ${underlyingError.message}`,
      { cause: underlyingError },
    );
    this.name = "BridgePaymentFailedError";
  }
}

export class InvoiceExpiredError extends Pay402Error {
  constructor(
    public readonly invoiceExpiry: Date,
    public readonly now: Date,
  ) {
    super(
      `BOLT11 invoice expired at ${invoiceExpiry.toISOString()} ` +
        `(now: ${now.toISOString()})`,
    );
    this.name = "InvoiceExpiredError";
  }
}
