# Returns service — shared policy

The product requirements and observable channel behavior are identical to the
current implementation in returns-before. Web and store share one policy owner.
Return eligibility, remaining quantities, processing fees and quote lifetime now
have one change location. The channel adapters still preserve separate storage
and audit routing. Receipt rendering is unchanged.

This is a tradeoff: independent channel policies would need an explicit policy
boundary. The current requirements do not justify independent return rules.
The authored equivalence test checks both channels, boundary dates and exclusions.
