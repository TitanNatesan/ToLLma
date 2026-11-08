"""Cross-module summarizer isolation (order-dependence regression).

The injectable summarizer (compaction.set_summarizer) is module-global
mutable state. This file deliberately carries NO per-file reset fixture:
it proves the suite-wide conftest guard resets the seam between tests, so
a module that injects without cleaning up can never redirect a later
module's summaries through its fake. Definition order is execution order:
the first test dirties the seam, the second must see it clean.
"""

from tollms.api.conversations import compaction


async def _fake(adapter, instruction, transcript):
    return "LEAKED-FAKE-SUMMARY"


def test_summarizer_seam_can_be_dirtied():
    compaction.set_summarizer(_fake)
    assert compaction._summarizer() is _fake


def test_summarizer_seam_reset_between_tests():
    assert compaction._summarizer() is compaction._default_summarizer
