# Checkout feature snapshot

An AI-assisted change adds coupon preview, server pricing, loyalty accrual and checkout persistence to a small shop. All amounts are integer cents. The supported policy is a percentage coupon on non-gift merchandise above its minimum, capped at its configured limit. Delivery is not discounted. Loyalty earns one point per 100 paid merchandise cents. Guest checkout is supported; member checkout earns points.

The browser preview must work offline with its last downloaded campaign. Its result is advisory: the server rechecks campaign validity using the submission time. Pricing and loyalty currently use the same campaign rules; preview, invoice and rewards expose different representations. The checkout service receives an injected persistence adapter and never trusts the browser total. The code works for these contracts; no failing bug has been planted.

The team expects campaign rules to evolve but has not decided who should own the cross-layer calculation. Read the arrangement as a map of roles, then select a passage to investigate whether local reasoning or a shared decision model fits better. More centralization is not automatically better. No corrected version is provided.

Source: an authored, trusted demonstration snapshot, not a claim about a real customer repository. Code Groove itself never executes imported repositories. Only this bundled fixture is exercised by its own behavior-contract test.
