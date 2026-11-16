from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from anyascii import anyascii
from rapidfuzz import fuzz

ACCEPT_AT = 0.75
REVIEW_AT = 0.55

ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_DIACRITICS_RE = re.compile(r"[ً-ْٰـ]")
_ALEF_RE = re.compile(r"[أإآٱ]")
_QUALIFIER_RE = re.compile(
    r"[(\[][^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|clip|music video|mv)\b[^)\]]*[)\]]",
    re.IGNORECASE,
)
_FEAT_PAREN_RE = re.compile(r"[(\[]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]", re.IGNORECASE)
_FEAT_TAIL_RE = re.compile(r"\s(?:feat\.?|ft\.?|featuring)\s.*$", re.IGNORECASE)
_PUNCT_RE = re.compile(r"[^\w\s]")
_ARABIZI = {"2": "", "3": "", "5": "kh", "6": "t", "7": "h", "8": "gh", "9": "s"}
_ARABIZI_RE = re.compile(r"(?<=[a-z])[235-9]|[235-9](?=[a-z])")
_AR_ARTICLE_RE = re.compile(r"(?<!\S)ال(?=\S{2,})")

_SEGMENT_MARKERS = {
    "live": r"\blive\b",
    "cover": r"\bcover\b",
    "acoustic": r"\bacoustic\b",
    "instrumental": r"\binstrumental\b",
    "remix": r"\bremix\b",
}
_ANYWHERE_MARKERS = {
    "slowed": r"\bslowed\b",
    "sped up": r"\bsped[ -]?up\b|\bspeed[ -]?up\b",
    "nightcore": r"\bnightcore\b",
    "8d": r"\b8d\b",
    "karaoke": r"\bkaraoke\b|كاريوكي",
    "live": r"لايف|حفلة",
    "remix": r"ريمكس",
}
_SEGMENT_RE = re.compile(r"[(\[]([^)\]]*)[)\]]|\s[-–—|]\s(.*)$")


@dataclass
class Recording:
    title: str
    artists: list[str] = field(default_factory=list)
    duration_ms: int | None = None
    isrc: str | None = None
    official: bool = False


def normalize_arabic(text: str) -> str:
    text = _DIACRITICS_RE.sub("", text)
    text = _ALEF_RE.sub("ا", text)
    return text.replace("ة", "ه").replace("ى", "ي")


def normalize(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower()
    s = _QUALIFIER_RE.sub(" ", s)
    s = _FEAT_PAREN_RE.sub(" ", s)
    s = _FEAT_TAIL_RE.sub("", s)
    s = normalize_arabic(s)
    s = _PUNCT_RE.sub(" ", s)
    return " ".join(s.split())


def latinize(text: str) -> str:
    if ARABIC_RE.search(text):
        return anyascii(text).lower()
    return _ARABIZI_RE.sub(lambda m: _ARABIZI[m.group(0)], text.lower())


def skeleton(text: str) -> str:
    s = normalize(text)
    if ARABIC_RE.search(s):
        s = _AR_ARTICLE_RE.sub("", s)
    words = latinize(s).split()
    if len(words) > 1 and words[0] in ("el", "al"):
        words = words[1:]
    s = "".join(words)
    s = s.replace("c", "k").replace("q", "k")
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"[aeiouyw]", "", s)
    return re.sub(r"(.)\1+", r"\1", s)


def similarity(a: str, b: str) -> float:
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    direct = (fuzz.token_set_ratio(na, nb) + fuzz.token_sort_ratio(na, nb)) / 200
    if bool(ARABIC_RE.search(na)) != bool(ARABIC_RE.search(nb)):
        sa, sb = skeleton(na), skeleton(nb)
        if sa and sb:
            direct = max(direct, fuzz.ratio(sa, sb) / 100)
    return direct


def markers(title: str) -> set[str]:
    s = unicodedata.normalize("NFKC", title).lower()
    found = {name for name, pattern in _ANYWHERE_MARKERS.items() if re.search(pattern, s)}
    for m in _SEGMENT_RE.finditer(s):
        segment = m.group(1) or m.group(2) or ""
        found |= {name for name, pattern in _SEGMENT_MARKERS.items() if re.search(pattern, segment)}
    return found


def duration_score(a_ms: int | None, b_ms: int | None) -> float:
    if a_ms is None or b_ms is None:
        return 0.5
    diff = abs(a_ms - b_ms) / 1000
    if diff <= 2:
        return 1.0
    if diff >= 15:
        return 0.0
    return 1 - (diff - 2) / 13


def score(source: Recording, candidate: Recording) -> float:
    title = similarity(source.title, candidate.title)
    artist = similarity(" ".join(source.artists), " ".join(candidate.artists)) if source.artists and candidate.artists else 0.5
    isrc = 1.0 if source.isrc and candidate.isrc and source.isrc.upper() == candidate.isrc.upper() else 0.0
    total = (
        0.35 * title
        + 0.25 * artist
        + 0.20 * duration_score(source.duration_ms, candidate.duration_ms)
        + 0.10 * (1.0 if candidate.official else 0.0)
        + 0.10 * isrc
    )
    total -= 0.5 * len(markers(source.title) ^ markers(candidate.title))
    return round(total, 4)


def classify(value: float) -> str:
    if value >= ACCEPT_AT:
        return "accepted"
    if value >= REVIEW_AT:
        return "review"
    return "unmatched"


def best_match(source: Recording, candidates: list[Recording]) -> tuple[int, float] | None:
    if not candidates:
        return None
    scored = [(score(source, c), i) for i, c in enumerate(candidates)]
    value, index = max(scored)
    return index, value
