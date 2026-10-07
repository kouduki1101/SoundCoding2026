# Returns service — current implementation

Web and store returns belong to the same product policy and the same policy owner.
Both use a 30-day standard / 45-day plus window, proof of purchase, no final-sale
returns, remaining quantities, 3% standard processing fee and a 7-day quote lifetime.
The store channel was added in a separate release; no channel-specific policy is
currently required. Storage and audit channels must remain distinct.

Both implementations currently produce correct results. Review the impact of a
future policy change and whether the duplicated decisions have a justified reason
to change independently. Do not treat two similar functions as automatically wrong.
Network adapters are injected; this repository does not run customer code.
