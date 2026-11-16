from jobbos_media.worker import Breaker


def test_breaker_opens_after_five_failures_in_a_row_and_closes_after_the_pause():
    now = [0.0]
    b = Breaker(failures=5, pause_s=900, clock=lambda: now[0])
    for _ in range(4):
        assert b.record(ok=False) is False
    assert b.record(ok=True) is False
    assert [b.record(ok=False) for _ in range(5)] == [False, False, False, False, True]
    assert b.is_open()
    now[0] = 899
    assert b.is_open()
    now[0] = 900
    assert not b.is_open()
