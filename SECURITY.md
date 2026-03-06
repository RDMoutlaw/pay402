# Security Policy

## Scope

pay402 handles private keys, payment authorizations, and real money across multiple payment rails. Security issues in this project can have direct financial consequences.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please report them via [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact (e.g., fund loss, key exposure, spend limit bypass)
- Suggested fix, if you have one

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## What Qualifies

- Private key exposure through logs, errors, or serialization
- Spend control bypasses (limit checks that can be circumvented)
- Payment replay attacks (reusing proofs to avoid paying)
- Double-spend scenarios (concurrent requests causing duplicate payments)
- Header parsing bugs that could be exploited by a malicious server
- Facilitator trust boundary violations
- Dependency vulnerabilities with a realistic attack path in pay402's usage

## What Doesn't Qualify

- The facilitator trust model itself — this is a known design tradeoff, documented in the README
- Denial of service via spend limit exhaustion (this is the spend controls working as intended)
- Issues requiring physical access to the machine running pay402

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Security Design Decisions

These are intentional and not bugs:

- **No auto-retry after payment failure.** Money may have left the wallet. The caller must decide what to do.
- **No auto-fallback between rails.** Once payment begins on a rail, the SDK will not try another.
- **In-memory spend tracking.** Restarting the process resets spend counters. This is a v1 tradeoff — persistent tracking is planned.
- **Static BTC price option.** When `autoFetchBtcPrice` is off, the user-provided price is used. Stale prices can cause inaccurate USD spend tracking for Lightning payments.
