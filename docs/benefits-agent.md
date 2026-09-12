# Benefits Agent — governed boundary

The Benefits Agent answers one bounded question for a development case: **did
we get what we paid for?**

It reads the existing `get_case_benefits_screen` result as the signed-in user.
That is the same canonical value spine shown in the Case Workspace:

- expected value is the recorded case benefit;
- forecast is the latest observed checkpoint;
- actual is the latest human-verified checkpoint;
- variance is actual minus expected;
- project leakage is approved BENEFITS value minus verified realized value;
- attribution is the latest independently verified statement in each of the
  seven governed leakage buckets;
- every benefit, checkpoint, attribution and evidence source is returned by
  record identifier.

The agent does not have a service-role client or a write operation. It cannot
record or verify an actual, allocate leakage, prove causation, approve an
investment, accept risk, or change an operating record. Missing actuals, an
unevaluable baseline, incomplete trajectory points, invalid attribution and
unattributed residual are displayed as limitations rather than filled in.

The narrative is deterministic and generated from governed records. It does
not require an external model and cannot drift from the numeric result. The
Edge Function is JWT-verified and calls the tenant-scoped RPC with the
requesting human's bearer token.
