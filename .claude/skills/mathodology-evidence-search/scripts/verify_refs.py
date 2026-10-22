#!/usr/bin/env python3
"""verify_refs.py -- check DOIs and bibliography entries against public registries.

Usage:
    verify_refs.py [--json] [--timeout S] [--max N] [--no-openalex] INPUT...

INPUT is any mix of .bib, .md and .tex files (.txt, .qmd, .rmd and .rst are
read like Markdown) and bare DOIs or arXiv ids (``arXiv:1706.03762``).
Commented-out TeX lines are ignored.

Resolution follows Mathodology Studio: Crossref first; otherwise doi.org/ra names
the registration agency, and metadata comes from DataCite or, for other agencies
(mEDRA, JaLC, ISTIC, CNKI, KISTI...), from doi.org content negotiation (CSL JSON).
Each DOI ends as ``resolves``; ``not_found`` (the DOI system says it does not
exist: likely mistyped or invented); ``invalid`` (not DOI syntax); or
``unverifiable`` (timeout, network error, rate limit or unexpected answer, which
is never evidence that a DOI is fabricated).
Bibliography entries are also compared with the registered title, first author
and year, checked for retraction, correction, expression-of-concern and
withdrawal notices, and given a candidate DOI when they lack one. Preprints are
flagged and a published version is looked up.

Exit status: 1 if any item fails, 2 on usage errors, 0 otherwise. Standard
library only. Inputs are only read; no e-mail address or credential is sent.
"""
from __future__ import annotations

import argparse
import bisect
import collections
import html
import http.client
import json
from pathlib import Path
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = 'Mathodology (https://github.com/ymylive/mathodology)'
CROSSREF = 'https://api.crossref.org/works'
DATACITE = 'https://api.datacite.org/dois/'
DOI_PROXY = 'https://doi.org/'
OPENALEX = 'https://api.openalex.org/works/doi:'
CSL_JSON = 'application/vnd.citationstyles.csl+json'
ARXIV_DOI = '10.48550/arXiv.'
SEARCH_FIELDS = 'DOI,title,subtitle,author,issued,container-title,type'

TEXT_SUFFIXES = {'.md', '.markdown', '.tex', '.ltx', '.txt', '.qmd', '.rmd', '.rst'}
WEB_TYPES = {'online', 'www', 'webpage', 'electronic'}
NOT_PUBLISHED_TYPES = {'posted-content', 'peer-review', 'component', 'grant', 'dataset'}
RANK = {'ok': 0, 'info': 1, 'inconclusive': 2, 'warn': 3, 'fail': 4}
VERDICTS = ('ok', 'warn', 'fail', 'inconclusive', 'info')
NOTICE_TEXT = {'retraction': 'retraction', 'withdrawal': 'withdrawal',
               'correction': 'correction', 'expression_of_concern': 'expression of concern'}

# --- identifiers -------------------------------------------------------------

DOI_SHAPE = re.compile(r'10\.\d{4,9}/\S+\Z')
DOI_PREFIX = re.compile(r'(?:(?:https?://)?(?:dx\.|www\.)?doi\.org/|doi:\s*|doi\s+)', re.I)
# A DOI in prose ends at a space, a quote, Markdown emphasis or a table bar, or CJK text and
# punctuation (Chinese puts no space around it, so it may also follow a Han character).
TEXT_DOI = re.compile(r'(?<![0-9A-Za-z_.])10\.\d{4,9}/[^\s"\'`*|\\\u2013\u2014\u2018-\u201f\u2026'
                      r'\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+')
ARXIV_ID = r'((?:[a-z][a-z\-]*(?:\.[a-z]{2})?/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?'
TEXT_ARXIV = re.compile(r'(?:arxiv\.org/(?:abs|pdf)/|\barxiv:\s*)' + ARXIV_ID, re.I)
BARE_ARXIV = re.compile(ARXIV_ID + r'\Z', re.I)
ARG_ARXIV = re.compile(r'(?:https?://)?(?:www\.)?' + TEXT_ARXIV.pattern + r'\Z', re.I)
DOI_LIKE = re.compile(r'(?:' + DOI_PREFIX.pattern + r'|10\.)', re.I)
CLOSERS = {')': '(', ']': '[', '}': '{', '>': '<'}


def _trim_doi(doi):
    """Drop trailing punctuation and closing brackets that have no opening partner."""
    while doi:
        last = doi[-1]
        if last in '.,;:\'"' or (last in CLOSERS and doi.count(last) > doi.count(CLOSERS[last])):
            doi = doi[:-1]
        else:
            break
    return doi


def normalize_doi(raw):
    """Return the bare DOI in ``raw`` (resolver prefix and trailing punctuation removed) or None."""
    if not isinstance(raw, str):
        return None
    doi = raw.strip()
    match = DOI_PREFIX.match(doi)
    if match:
        doi = doi[match.end():]
        if 'doi.org' in match.group(0).lower():
            doi = re.split(r'[?#]', doi, maxsplit=1)[0]
    doi = _trim_doi(urllib.parse.unquote(doi).strip())
    if len(doi) >= 300 or not DOI_SHAPE.match(doi):
        return None
    if '/./' in doi or '/../' in doi or doi.endswith(('/.', '/..')):
        return None
    return doi


def tex_doi(value):
    """A DOI field as written in BibTeX or LaTeX: grouping braces dropped, \\_ \\% \\# \\& unescaped."""
    return re.sub(r'\\([_%#&])', r'\1', value).replace('{', '').replace('}', '').strip()


def arxiv_doi(arxiv_id):
    return ARXIV_DOI + arxiv_id


def _cut_unbalanced(token):
    """Cut a token at the first closing bracket that was never opened inside it."""
    depth = dict.fromkeys('([{<', 0)
    for i, char in enumerate(token):
        if char in depth:
            depth[char] += 1
        elif char in CLOSERS:
            if depth[CLOSERS[char]] == 0:
                return token[:i]
            depth[CLOSERS[char]] -= 1
    return token


def _inside_url(text, start):
    token = re.split(r'[\s"\'<>()\[\]{}]', text[max(0, start - 300):start])[-1]
    return '://' in token or token.lower().endswith('doi.org/')


def extract_ids(text, tex=False):
    """Return ``(kind, identifier, line)`` for each DOI or arXiv id mentioned in prose."""
    if tex:  # drop comments (not URL-encoded %28); line numbers are kept
        text = re.sub(r'(?m)(?:^|(?<=\s))%.*$', '', text)
    # TeX and Markdown escapes (\_) and HTML-escaped brackets (&lt; in old SICI DOIs); lines are kept.
    text = re.sub(r'\\([_%#&])', r'\1', text)
    text = re.sub(r'&(lt|gt|amp);', lambda m: {'lt': '<', 'gt': '>', 'amp': '&'}[m.group(1).lower()], text, flags=re.I)
    newlines = [i for i, char in enumerate(text) if char == '\n']

    def line(pos):
        return bisect.bisect_left(newlines, pos) + 1

    found, pos = [], 0
    while (match := TEXT_DOI.search(text, pos)):
        # \href{https://doi.org/...}{label}: the label is not part of the DOI.
        token = _cut_unbalanced(match.group(0).split('}{')[0])
        candidate = re.split(r'[?#]', token, maxsplit=1)[0] if _inside_url(text, match.start()) else token
        doi = normalize_doi(candidate)  # also decodes %-escapes
        if doi:
            found.append(('doi', doi, line(match.start())))
        pos = match.start() + max(len(token), 1)
    for match in TEXT_ARXIV.finditer(text):
        found.append(('arxiv', match.group(1), line(match.start())))
    return found


# --- BibTeX ------------------------------------------------------------------

ENTRY_START = re.compile(r'@[ \t]*([A-Za-z]+)\s*([{(])')
ENTRY_KEY = re.compile(r'\s*([^\s,{}()"#=]*)\s*')
FIELD_NAME = re.compile(r'[A-Za-z][A-Za-z0-9_\-:.+/]*')
BARE_VALUE = re.compile(r'[^\s,#{}()"=]+')
LINE_AT = re.compile(r'^[ \t]*@', re.M)
MONTHS = {m: m.capitalize() for m in
          ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec')}


class BibError(ValueError):
    pass


def _skip_ws(text, i):
    while i < len(text) and text[i].isspace():
        i += 1
    return i


def _balanced(text, i, open_char='{', close_char='}'):
    """``text[i]`` opens a group; return the index just past its matching close."""
    depth = 0
    for j in range(i, len(text)):
        if text[j] == open_char:
            depth += 1
        elif text[j] == close_char:
            depth -= 1
            if depth == 0:
                return j + 1
    raise BibError('unbalanced braces')


def _quoted(text, i):
    """``text[i]`` is a quote; return the index past the closing quote at brace depth 0."""
    depth = 0
    for j in range(i + 1, len(text)):
        char = text[j]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth < 0:
                break
        elif char == '"' and depth == 0:
            return j + 1
    raise BibError('unterminated quoted value')


def _value(text, i, strings):
    parts = []
    while True:
        i = _skip_ws(text, i)
        if i >= len(text):
            raise BibError('unexpected end of file')
        if text[i] == '{':
            j = _balanced(text, i)
            parts.append(text[i + 1:j - 1])
        elif text[i] == '"':
            j = _quoted(text, i)
            parts.append(text[i + 1:j - 1])
        else:
            match = BARE_VALUE.match(text, i)
            if not match:
                raise BibError(f'unexpected {text[i]!r} in a field value')
            j, word = match.end(), match.group(0)
            parts.append(word if word.isdigit() else strings.get(word.lower(), word))
        i = _skip_ws(text, j)
        if i < len(text) and text[i] == '#':
            i += 1
            continue
        return ' '.join(''.join(parts).split()), i


def _fields(text, i, closer, strings):
    fields = {}
    while True:
        i = _skip_ws(text, i)
        if i < len(text) and text[i] == closer:
            return fields, i + 1
        match = FIELD_NAME.match(text, i)
        if not match:
            raise BibError('expected a field name')
        name = match.group(0).lower()
        i = _skip_ws(text, match.end())
        if i >= len(text) or text[i] != '=':
            raise BibError(f'expected "=" after field {name}')
        value, i = _value(text, i + 1, strings)
        fields.setdefault(name, value)  # BibTeX keeps the first duplicate
        i = _skip_ws(text, i)
        if i < len(text) and text[i] == ',':
            i += 1
        elif i < len(text) and text[i] == closer:
            return fields, i + 1
        else:
            raise BibError(f'expected "," or "{closer}" after field {name}')


def parse_bib(text):
    """Return ``(entries, errors)``; an entry is ``{type, key, fields, line}``."""
    entries, errors, strings = [], [], dict(MONTHS)
    pos = 0
    while (match := ENTRY_START.search(text, pos)):
        kind, opener = match.group(1).lower(), match.group(2)
        closer = '}' if opener == '{' else ')'
        line = text.count('\n', 0, match.start()) + 1
        try:
            if kind in ('comment', 'preamble'):
                pos = _balanced(text, match.end() - 1, opener, closer)
                continue
            if kind == 'string':
                fields, pos = _fields(text, match.end(), closer, strings)
                strings.update(fields)
                continue
            key_match = ENTRY_KEY.match(text, match.end())
            key, i = key_match.group(1), key_match.end()
            if not key:
                raise BibError('missing citation key')
            if i < len(text) and text[i] == ',':
                fields, pos = _fields(text, i + 1, closer, strings)
            elif i < len(text) and text[i] == closer:
                fields, pos = {}, i + 1
            else:
                raise BibError(f'expected "," after key {key}')
            entries.append({'type': kind, 'key': key, 'fields': fields, 'line': line})
        except BibError as exc:
            errors.append({'line': line, 'message': str(exc)})
            following = LINE_AT.search(text, match.end())
            pos = following.start() if following else len(text)
    return entries, errors


# --- text comparison ---------------------------------------------------------

SYMBOL_ACCENT = re.compile(r'\\[`\'^"~=.]\s*(?:\{\s*([A-Za-z])\s*\}|([A-Za-z]))')
LETTER_ACCENT = re.compile(r'\\[uvHtcdbkr]\s*\{\s*([A-Za-z])\s*\}')
SPECIAL_LETTER = re.compile(r'\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])')
COMMAND = re.compile(r'\\([A-Za-z]+)\*?|\\(.)')
MARKUP = re.compile(r'</?[A-Za-z][\w:.-]*(?:\s[^<>]*)?/?>')
FOLD = str.maketrans({'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'æ': 'ae',
                      'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ı': 'i', 'þ': 'th', 'ß': 'ss'})


def _command(match):
    name = match.group(1)
    if name is None:
        return match.group(2) if match.group(2) in '&%$#_{}' else ' '
    case = 'SMALL' if name[0].islower() else 'CAPITAL'
    try:  # \alpha -> α, so a LaTeX title can match a registry title with Unicode Greek
        return unicodedata.lookup(f'GREEK {case} LETTER {name.upper()}')
    except KeyError:
        return ' '


def latex_to_text(value):
    value = SYMBOL_ACCENT.sub(lambda m: m.group(1) or m.group(2), value or '')
    value = LETTER_ACCENT.sub(r'\1', value)
    value = SPECIAL_LETTER.sub(lambda m: {'aa': 'a', 'AA': 'A'}.get(m.group(1), m.group(1)), value)
    value = COMMAND.sub(_command, value).replace('~', ' ')
    return value.replace('{', '').replace('}', '').replace('$', '')


def normalize_text(value):
    """Lowercase, LaTeX/markup removed, accents folded, punctuation dropped, spaces collapsed."""
    # Tags go before and after unescaping, for CO<sub>2</sub> and CO&lt;sub&gt;2&lt;/sub&gt; alike.
    value = latex_to_text(MARKUP.sub('', html.unescape(MARKUP.sub('', value or ''))))
    value = unicodedata.normalize('NFKD', value.translate(FOLD))
    value = ''.join(c for c in value if not unicodedata.combining(c)).casefold()
    return ' '.join(re.sub(r'[\W_]+', ' ', value).split())


def _bigrams(text):
    return collections.Counter(text[i:i + 2] for i in range(len(text) - 1))


def similarity(a, b):
    """Character-bigram Dice on normalized text, 0-1, as in Mathodology Studio. A title that is
    the other one plus a subtitle (shorter one at least 20 characters) scores 0.95."""
    a, b = normalize_text(a), normalize_text(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 20 and long_.startswith(short):
        return 0.95
    shared = sum((_bigrams(a) & _bigrams(b)).values())
    total = len(a) - 1 + len(b) - 1
    return 2 * shared / total if total > 0 else 0.0


def registered_title(meta):
    """Registry title with its subtitle appended unless the title already contains it."""
    title, subtitle = meta.get('title') or '', meta.get('subtitle') or ''
    return f'{title}: {subtitle}' if subtitle and subtitle.lower() not in title.lower() else title


def title_similarity(title, meta):
    return similarity(title, registered_title(meta))


def _split_top(value, sep=None):
    """Split at brace depth 0 on ``sep`` (whitespace when None)."""
    parts, depth, current = [], 0, []
    for char in value:
        depth += char == '{'
        depth -= char == '}'
        if depth == 0 and (char.isspace() if sep is None else char == sep):
            parts.append(''.join(current))
            current = []
        else:
            current.append(char)
    parts.append(''.join(current))
    return [p.strip() for p in parts if p.strip()]


NAME_AND = re.compile(r'\s+and\s+', re.I)


def split_names(value):
    """Split a BibTeX name list on ``and`` outside braces."""
    names, depth, start, i = [], 0, 0, 0
    while i < len(value or ''):
        char = value[i]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        elif depth == 0 and char.isspace():
            match = NAME_AND.match(value, i)
            if match:
                names.append(value[start:i])
                start = i = match.end()
                continue
        i += 1
    names.append((value or '')[start:])
    return [n.strip() for n in names if n.strip()]


def surname(name):
    """Family name of a BibTeX name in ``Last, First`` or ``First Last`` form."""
    parts = _split_top(name, ',')
    if not parts:
        return ''
    if len(parts) > 1:
        return latex_to_text(parts[0]).strip()
    words = _split_top(parts[0])
    if len(words) == 1 and parts[0].startswith('{'):
        return latex_to_text(parts[0]).strip()  # {World Health Organization}
    return latex_to_text(words[-1]).strip() if words else ''


CJK = re.compile('[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]')


def author_matches(name, author):
    """Whether the written ``name`` names this registry ``author`` (a dict or a family name).

    True or False, or None when it cannot be told: one name is in Latin script and the other not.
    """
    if isinstance(author, str):
        author = {'family': author}
    a = normalize_text(name).split()
    f = normalize_text(author.get('family') or author.get('name') or '').split()
    if not a or not f:
        return None
    if any(re.search('[a-z]', t) for t in a) != any(re.search('[a-z]', t) for t in f):
        return None  # transliteration (e.g. Chinese characters vs pinyin) cannot be compared here
    plain, family = ''.join(a), ''.join(f)
    if CJK.search(plain) or CJK.search(family):
        # East Asian names are often written whole, family name first, with no separator.
        whole = family + ''.join(normalize_text(author.get('given') or '').split())
        return (plain in (whole, family) or plain.startswith(family)
                or (len(whole) > 1 and whole.startswith(plain)))
    return f' {" ".join(f)} ' in f' {" ".join(a)} ' or plain == family


def year_of(fields):
    for key in ('year', 'date'):
        match = re.search(r'(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)', fields.get(key, ''))
        if match:
            return int(match.group(1))
    return None


def _first(value):
    if isinstance(value, list):
        return next((v for v in value if isinstance(v, str) and v.strip()), None)
    return value if isinstance(value, str) and value.strip() else None


def _family(author):
    return (author or {}).get('family') or (author or {}).get('name') or ''


# --- HTTP --------------------------------------------------------------------

class Reply:
    __slots__ = ('status', 'body', 'error')

    def __init__(self, status, body=b'', error=None):
        self.status, self.body, self.error = status, body, error

    def data(self):
        """The parsed JSON body, or None."""
        try:
            return json.loads(self.body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            return None

    def json(self):
        data = self.data()
        return data if isinstance(data, dict) else None

    def describe(self):
        return self.error or f'HTTP {self.status}'


def default_fetch(request, timeout):
    return urllib.request.urlopen(request, timeout=timeout)  # follows redirects


def _describe_error(exc):
    reason = getattr(exc, 'reason', None) or exc
    if isinstance(reason, TimeoutError) or 'timed out' in str(reason):
        return 'timed out'
    return (f'{type(reason).__name__}: {reason}' if str(reason) else type(reason).__name__)[:200]


class Http:
    """Polite GET client: paced requests, small backoff on 429/5xx, network errors never raised."""

    def __init__(self, fetch=None, timeout=15.0, interval=0.34, retries=2,
                 sleep=time.sleep, clock=time.monotonic):
        self.fetch, self.timeout, self.interval, self.retries = fetch or default_fetch, timeout, interval, retries
        self.sleep, self.clock = sleep, clock
        self._next = 0.0
        self._network_failures = {}

    def _pace(self):
        now = self.clock()
        if now < self._next:
            self.sleep(self._next - now)
            now = self._next
        self._next = now + self.interval

    def get(self, url, retry=True, accept='application/json'):
        host = urllib.parse.urlsplit(url).netloc
        if self._network_failures.get(host, 0) >= 3:
            return Reply(None, error=f'{host} skipped after repeated network errors')
        headers = {'User-Agent': USER_AGENT, 'Accept': accept}
        for attempt in range(self.retries + 1):
            self._pace()
            reply_headers = {}
            try:
                with self.fetch(urllib.request.Request(url, headers=headers), self.timeout) as resp:
                    status, body = resp.status, resp.read()
            except urllib.error.HTTPError as exc:
                status, body, reply_headers = exc.code, b'', exc.headers or {}
                exc.close()
            except (OSError, http.client.HTTPException, ValueError) as exc:
                self._network_failures[host] = self._network_failures.get(host, 0) + 1
                return Reply(None, error=_describe_error(exc))
            self._network_failures[host] = 0
            if retry and attempt < self.retries and (status == 429 or 500 <= status <= 599):
                wait = str(reply_headers.get('Retry-After') or '')
                self.sleep(min(float(wait), 10.0) if wait.isdigit() else 2.0 ** attempt)
                continue
            return Reply(status, body)
        return Reply(None, error='retries exhausted')  # not reached


# --- registries --------------------------------------------------------------

TITLE_NOTICES = ((re.compile(r'\s*(?:retracted|retraction)\b', re.I), 'retraction'),
                 (re.compile(r'\s*withdrawn\b', re.I), 'withdrawal'),
                 (re.compile(r'\s*expression of concern\b', re.I), 'expression_of_concern'))


def _notice_kind(text):
    text = (text or '').lower()
    if 'retract' in text or 'removal' in text:
        return 'retraction'
    if 'withdraw' in text:
        return 'withdrawal'
    if 'concern' in text:
        return 'expression_of_concern'
    if 'correct' in text or 'errat' in text or 'corrig' in text:
        return 'correction'
    return None


def _add_notice(notices, kind, doi, label, via, source=None):
    doi = normalize_doi(doi) if doi else None
    if any(n['kind'] == kind and (n['doi'] or '').lower() == (doi or '').lower() for n in notices):
        return
    notices.append({'kind': kind, 'doi': doi, 'label': label, 'via': via, 'source': source})


def _title_notice(notices, title):
    """For publishers that rename the article instead of linking a notice."""
    if any(n['kind'] in ('retraction', 'withdrawal') for n in notices):
        return
    for pattern, kind in TITLE_NOTICES:
        match = pattern.match(title or '')
        if match:
            _add_notice(notices, kind, None, f'title begins "{match.group(0).strip()}"', 'title')
            return


def _date_year(value):
    if isinstance(value, dict):
        parts = value.get('date-parts') or []
        if parts and parts[0] and str(parts[0][0]).isdigit():
            return int(parts[0][0])
        value = value.get('literal') or value.get('raw')
    match = re.search(r'(?<!\d)(?:1[5-9]|20)\d\d(?!\d)', str(value or ''))
    return int(match.group(0)) if match else None


def crossref_metadata(message):
    authors = [a for a in message.get('author') or [] if isinstance(a, dict)]
    authors.sort(key=lambda a: a.get('sequence') != 'first')
    year = next((y for y in (_date_year(message.get(k)) for k in
                             ('issued', 'published', 'published-print', 'published-online')) if y), None)
    return {
        'title': _first(message.get('title')),
        'subtitle': _first(message.get('subtitle')),
        'authors': [{'family': a.get('family'), 'given': a.get('given'), 'name': a.get('name')} for a in authors],
        'year': year,
        'container': _first(message.get('container-title')),
        'type': message.get('type'),
        'preprint': message.get('type') == 'posted-content',
    }


def crossref_notices(message):
    notices = []
    for via in ('updated-by', 'update-to'):
        for entry in message.get(via) or []:
            if isinstance(entry, dict):
                kind = _notice_kind(f"{entry.get('type', '')} {entry.get('label', '')}")
                if kind:
                    _add_notice(notices, kind, entry.get('DOI'), entry.get('label') or entry.get('type'),
                                via, entry.get('source'))
    relation = message.get('relation') if isinstance(message.get('relation'), dict) else {}
    for name, targets in relation.items():
        kind = _notice_kind(name)
        if not kind:
            continue
        for target in targets if isinstance(targets, list) else [targets]:
            doi = target.get('id') if isinstance(target, dict) and target.get('id-type') == 'doi' else None
            _add_notice(notices, kind, doi, name, 'relation')
    return notices


def _datacite_person(creator):
    family, given, name = creator.get('familyName'), creator.get('givenName'), creator.get('name') or ''
    if not family and creator.get('nameType') != 'Organizational' and name.count(',') == 1:
        family, given = (part.strip() for part in name.split(','))
    return {'family': family, 'given': given, 'name': None if family else name or None}


def datacite_metadata(doi, attributes):
    titles = [t for t in attributes.get('titles') or [] if isinstance(t, dict)]
    main = next((t for t in titles if not t.get('titleType')), titles[0] if titles else {})
    publisher = attributes.get('publisher')
    year = attributes.get('publicationYear')
    kind = (attributes.get('types') or {}).get('resourceTypeGeneral')
    return {
        'title': main.get('title'),
        'subtitle': next((t.get('title') for t in titles if t.get('titleType') == 'Subtitle'), None),
        'authors': [_datacite_person(c) for c in attributes.get('creators') or [] if isinstance(c, dict)],
        'year': int(year) if str(year or '').isdigit() else None,
        'container': publisher.get('name') if isinstance(publisher, dict) else publisher,
        'type': kind,
        'preprint': kind == 'Preprint' or doi.lower().startswith('10.48550/'),
    }


def datacite_published(doi, attributes):
    """A version DOI the record names (IsVersionOf / IsPreviousVersionOf), e.g. an arXiv paper's journal DOI."""
    for rel in attributes.get('relatedIdentifiers') or []:
        if (isinstance(rel, dict) and rel.get('relatedIdentifierType') == 'DOI'
                and rel.get('relationType') in ('IsVersionOf', 'IsPreviousVersionOf')):
            target = normalize_doi(str(rel.get('relatedIdentifier') or ''))
            if target and target.lower() != doi.lower():
                return {'doi': target, 'via': 'relation'}
    return None


def csl_metadata(doi, csl):
    """CSL JSON from doi.org content negotiation (mEDRA, JaLC, ISTIC, CNKI, KISTI and others)."""
    authors = []
    for a in csl.get('author') or []:
        if isinstance(a, dict):
            # CNKI/ISTIC may put a whole Chinese name in `given`; others give only `literal`.
            family = a.get('family') or a.get('literal') or a.get('name') or a.get('given')
            if family:
                authors.append({'family': family, 'given': a.get('given') if a.get('family') else None,
                                'name': None})
    return {
        'title': _first(csl.get('title')),
        'subtitle': _first(csl.get('subtitle')),
        'authors': authors,
        'year': _date_year(csl.get('issued')),
        'container': _first(csl.get('container-title')),
        'type': csl.get('type'),
        'preprint': csl.get('type') == 'posted-content' or doi.lower().startswith('10.48550/'),
    }


def _found(res, registry, meta, notices):
    """Record a registry answer; the full author list stays internal, the report keeps ten."""
    res.update(state='resolves', registry=registry, notices=notices, authors_all=meta['authors'],
               metadata=dict(meta, authors=meta['authors'][:10], author_count=len(meta['authors'])))
    _title_notice(res['notices'], meta['title'])


def _empty_openalex(status, reason=None):
    return {'status': status, 'is_retracted': None, 'cited_by_count': None, 'reason': reason}


def doi_path(doi):
    """The DOI as a URL path, each segment escaped so parentheses, '#', '?' and '<>' survive."""
    return '/'.join(urllib.parse.quote(segment, safe='') for segment in doi.split('/'))


class Resolver:
    """DOI resolution shared with Mathodology Studio; results are cached for the run.

    Crossref first; otherwise the DOI system names the registration agency (doi.org/ra), whose
    "DOI does not exist" is the only route to ``not_found``. Metadata then comes from DataCite or
    from doi.org content negotiation. A timeout or unreadable answer leaves the DOI ``unverifiable``.
    """

    def __init__(self, http, openalex=True):
        self.http, self.openalex = http, openalex
        self.openalex_off = None if openalex else '--no-openalex'
        self.cache, self.searches = {}, {}

    def _call(self, service, url, trace, retry=True, accept='application/json'):
        reply = self.http.get(url, retry=retry, accept=accept)
        trace.append({'service': service, 'status': reply.status, 'error': reply.error})
        return reply

    def resolve(self, doi):
        key = doi.lower()
        if key not in self.cache:
            self.cache[key] = self._resolve(doi)
        return self.cache[key]

    def _resolve(self, doi):
        trace = []
        res = {'state': 'unverifiable', 'registry': None, 'metadata': None, 'notices': [],
               'published_version': None, 'openalex': None, 'reason': None, 'authors_all': [], 'trace': trace}
        path = doi_path(doi)
        reply = self._call('crossref', f'{CROSSREF}/{path}', trace)
        message = (reply.json() or {}).get('message') if reply.status == 200 else None
        if isinstance(message, dict):
            _found(res, 'crossref', crossref_metadata(message), crossref_notices(message))
            relation = message.get('relation') if isinstance(message.get('relation'), dict) else {}
            for target in relation.get('is-preprint-of') or []:
                if isinstance(target, dict) and target.get('id-type') == 'doi':
                    res['published_version'] = {'doi': target.get('id'), 'via': 'relation'}
                    break
        else:
            self._by_agency(doi, path, res, f'Crossref answered {reply.describe()}')
        if res['state'] == 'resolves':
            res['openalex'] = self._openalex(doi)
            if res['openalex']['is_retracted'] and not any(n['kind'] == 'retraction' for n in res['notices']):
                _add_notice(res['notices'], 'retraction', None, 'OpenAlex is_retracted', 'openalex')
            meta = res['metadata']
            if meta and meta['preprint'] and not res['published_version']:
                res['published_version'] = self._published_version(doi, meta, trace)
        return res

    def _by_agency(self, doi, path, res, crossref_answer):
        trace = res['trace']
        reply = self._call('doi.org/ra', f'{DOI_PROXY}ra/{path}', trace)
        data = reply.data() if reply.status == 200 else None
        entry = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None
        if entry is None:
            res['reason'] = f'doi.org/ra {reply.describe() if reply.status != 200 else "gave no answer"}'
            return
        agency = str(entry.get('RA') or '')
        if not agency:
            status = str(entry.get('status') or '')
            if 'does not exist' in status.lower():
                res['state'] = 'not_found'
            elif 'invalid' in status.lower():
                res['state'] = 'invalid'
            else:
                res['reason'] = f'doi.org/ra: {status or "no agency named"}'
            return
        res.update(state='resolves', registry=agency.lower())
        if agency.lower() == 'crossref':
            res['reason'] = crossref_answer  # registered with Crossref, record unreadable just now
            return
        if agency.lower() == 'datacite':
            reply = self._call('datacite', DATACITE + path, trace)
            data = (reply.json() or {}).get('data') if reply.status == 200 else None
            attributes = data.get('attributes') if isinstance(data, dict) else None
            if isinstance(attributes, dict):
                _found(res, 'datacite', datacite_metadata(doi, attributes), [])
                if res['metadata']['preprint']:
                    res['published_version'] = datacite_published(doi, attributes)
                return
        reply = self._call('doi.org/csl', DOI_PROXY + path, trace, accept=CSL_JSON)
        csl = reply.json() if reply.status == 200 else None
        if csl:
            _found(res, agency.lower(), csl_metadata(doi, csl), [])
        else:
            res['reason'] = f'{agency} gave no metadata (doi.org {reply.describe()})'

    def _openalex(self, doi):
        if self.openalex_off:
            return _empty_openalex('disabled' if not self.openalex else 'skipped', self.openalex_off)
        reply = self.http.get(OPENALEX + doi_path(doi), retry=False)
        data = reply.json() if reply.status == 200 else None
        if data is not None:
            count = data.get('cited_by_count')
            return {'status': 'ok', 'is_retracted': bool(data.get('is_retracted')),
                    'cited_by_count': count if isinstance(count, int) else None, 'reason': None}
        if reply.status == 404:
            return _empty_openalex('not_found', 'not indexed by OpenAlex')
        if reply.status in (401, 403, 429):
            self.openalex_off = f'OpenAlex {reply.describe()} earlier in this run'
        return _empty_openalex('skipped', reply.describe())

    @staticmethod
    def search_url(query):
        return CROSSREF + '?' + urllib.parse.urlencode(
            {'query.bibliographic': query, 'rows': 5, 'select': SEARCH_FIELDS})

    def search(self, query, trace=None):
        """Crossref bibliographic search; returns (ok, items, reason)."""
        url = self.search_url(query)
        if url not in self.searches:
            reply = self.http.get(url)
            data = reply.json() if reply.status == 200 else None
            message = data.get('message') if data else None
            if isinstance(message, dict) and isinstance(message.get('items'), list):
                items = [dict(crossref_metadata(i), doi=i.get('DOI')) for i in message['items']
                         if isinstance(i, dict) and i.get('DOI')]
                self.searches[url] = (True, items, None)
            else:
                self.searches[url] = (False, [], reply.describe())
        result = self.searches[url]
        if trace is not None:
            trace.append({'service': 'crossref-search', 'status': 200 if result[0] else None,
                          'error': result[2]})
        return result

    def _published_version(self, doi, meta, trace):
        first = _family(meta['authors'][0]) if meta['authors'] else ''
        if not meta.get('title'):
            return None
        ok, items, _ = self.search(' '.join(x for x in (meta['title'], first) if x), trace)
        best = None
        for item in items if ok else []:
            if (item['doi'] or '').lower() == doi.lower() or item['type'] in NOT_PUBLISHED_TYPES:
                continue
            score = title_similarity(meta['title'], item)
            if score < 0.9 or (first and item['authors']
                               and author_matches(first, item['authors'][0]) is False):
                continue
            if best is None or score > best['similarity']:
                best = {'doi': item['doi'], 'via': 'search', 'title': item['title'],
                        'container': item['container'], 'year': item['year'], 'similarity': round(score, 3)}
        return best


# --- checks ------------------------------------------------------------------

NOTICE_LEVEL = {'retraction': ('fail', 'do not rely on this work'),
                'withdrawal': ('fail', 'do not rely on this work'),
                'expression_of_concern': ('warn', 'check whether it affects the cited claim'),
                'correction': ('info', 'make sure the cited version is the corrected one')}


def new_item(source, kind, location, **extra):
    item = {'source': source, 'kind': kind, 'key': None, 'entry_type': None, 'line': None, 'lines': [],
            'location': location, 'doi': None, 'arxiv': None, 'state': None, 'registry': None,
            'verdict': 'ok', 'problems': [], 'metadata': None, 'comparison': None, 'notices': [],
            'candidate': None, 'published_version': None, 'openalex': None, 'trace': []}
    item.update(extra)
    return item


def add(item, level, message):
    item['problems'].append({'level': level, 'message': message})


def finish(item):
    item['problems'].sort(key=lambda p: -RANK[p['level']])
    item['verdict'] = item['problems'][0]['level'] if item['problems'] else 'ok'
    return item


def arxiv_of(fields):
    """arXiv id (without version) from eprint/arxiv fields or arXiv mentions in an entry."""
    kind = (fields.get('archiveprefix', '') + fields.get('eprinttype', '')).lower()
    eprint = re.sub(r'^arxiv:\s*', '', fields.get('eprint', '').strip(), flags=re.I)
    if eprint and ('arxiv' in kind or not kind):
        match = BARE_ARXIV.match(eprint)
        if match:
            return match.group(1)
    for name in ('arxiv', 'arxivid'):
        match = BARE_ARXIV.match(re.sub(r'^arxiv:\s*', '', fields.get(name, '').strip(), flags=re.I))
        if match:
            return match.group(1)
    for name in ('url', 'journal', 'note', 'howpublished', 'journaltitle'):
        match = TEXT_ARXIV.search(fields.get(name, ''))
        if match:
            return match.group(1)
    return None


class Checker:
    def __init__(self, resolver, max_lookups=None):
        self.resolver, self.remaining = resolver, max_lookups

    def _allowed(self, key):
        if key in self.resolver.cache or key in self.resolver.searches or self.remaining is None:
            return True
        if self.remaining > 0:
            self.remaining -= 1
            return True
        return False

    def _not_checked(self, item):
        add(item, 'inconclusive', 'not checked: lookup limit (--max) reached')

    @staticmethod
    def _invalid(item, raw):
        item.update(doi=raw, state='invalid')
        add(item, 'fail', f'not a valid DOI: {raw!r}')
        return finish(item)

    def _lookup(self, item, doi):
        """Resolve ``doi`` into ``item``; return the resolution or None if over budget."""
        item['doi'] = doi
        if doi.lower().startswith(ARXIV_DOI.lower()) and not item['arxiv']:
            item['arxiv'] = doi[len(ARXIV_DOI):]
        if not self._allowed(doi.lower()):
            self._not_checked(item)
            return None
        res = self.resolver.resolve(doi)
        item.update(state=res['state'], registry=res['registry'], metadata=res['metadata'],
                    notices=list(res['notices']), published_version=res['published_version'],
                    openalex=res['openalex'], trace=list(res['trace']))
        label = f"arXiv:{item['arxiv']}" if item['arxiv'] else 'DOI'
        if res['state'] == 'not_found':
            add(item, 'fail', f'{label} does not exist (doi.org has no registration): likely mistyped or invented')
        elif res['state'] == 'invalid':
            add(item, 'fail', f'not a valid DOI (doi.org): {doi}')
        elif res['state'] == 'unverifiable':
            reasons = '; '.join(f"{t['service']} {t['error'] or 'HTTP %s' % t['status']}" for t in res['trace'])
            if res['reason'] and res['reason'] not in reasons:
                reasons += f"; {res['reason']}"
            add(item, 'inconclusive', f'could not verify {label} ({reasons}); this is not evidence that it is wrong')
        for notice in item['notices']:
            ref = f" {notice['doi']}" if notice['doi'] else ''
            if notice['via'] == 'update-to' and notice['doi'] and notice['doi'].lower() != doi.lower():
                add(item, 'warn', f"this DOI is itself the {NOTICE_TEXT[notice['kind']]} notice for{ref}: "
                                  'cite it only when discussing that notice')
                continue
            level, advice = NOTICE_LEVEL[notice['kind']]
            add(item, level, f"registry lists a {NOTICE_TEXT[notice['kind']]}{ref} (via {notice['via']}): {advice}")
        meta, published = res['metadata'], res['published_version']
        if meta and meta['preprint']:
            if published and published['via'] == 'relation':
                add(item, 'warn', f"preprint; the registry links a published version {published['doi']}: "
                                  'cite that unless the preprint itself is meant')
            elif published:
                venue = ', '.join(str(x) for x in (published['container'], published['year']) if x)
                add(item, 'warn', f"preprint; a published version appears to exist: {published['doi']}"
                                  f"{' (' + venue + ')' if venue else ''}: check it is the same work and cite it")
            else:
                add(item, 'info', 'preprint; no published version found in Crossref: label it as a preprint')
        return res

    def check_entry(self, source, entry, seen_keys):
        fields, key = entry['fields'], entry['key']
        item = new_item(source, 'bib', key, key=key, entry_type=entry['type'],
                        line=entry['line'], lines=[entry['line']])
        if key.lower() in seen_keys:
            add(item, 'warn', 'duplicate citation key')
        seen_keys.add(key.lower())
        raw_doi = fields.get('doi', '').strip()
        doi = normalize_doi(tex_doi(raw_doi)) if raw_doi else None
        if raw_doi and not doi:
            return self._invalid(item, raw_doi)
        url = fields.get('url', '').strip()
        if not doi and DOI_PREFIX.match(url) and 'doi.org' in url.lower():
            doi = normalize_doi(url)
        arxiv = None if doi else arxiv_of(fields)
        if doi or arxiv:
            item['arxiv'] = arxiv
            res = self._lookup(item, doi or arxiv_doi(arxiv))
            if res and res['state'] == 'resolves':
                self._compare(item, fields, res)
            return finish(item)
        title = fields.get('title', '').strip()
        if not title:
            add(item, 'warn', 'entry has neither a title nor a DOI: nothing to check')
            return finish(item)
        if entry['type'] in WEB_TYPES and url:
            note = '' if fields.get('urldate') or fields.get('accessed') else '; add an access date (urldate)'
            add(item, 'info', 'web source without DOI: not checked against a registry; cite it only if the '
                              f'page was actually retrieved{note}')
            return finish(item)
        self._search(item, fields, title)
        return finish(item)

    def _compare(self, item, fields, res):
        meta = res['metadata']
        if not meta:
            # Usually a rate limit or outage: the entry itself is unchecked, as in Mathodology Studio.
            reason = f" ({res['reason']})" if res['reason'] else ''
            add(item, 'inconclusive' if res['reason'] else 'info',
                f"registered with {res['registry']}, but its record could not be read{reason}: "
                'title, first author and year were not compared')
            return
        comparison = {'title_similarity': None, 'first_author': None, 'year': None}
        item['comparison'] = comparison
        title = fields.get('title', '').strip()
        if title and meta['title']:
            score = title_similarity(title, meta)
            comparison['title_similarity'] = round(score, 3)
            if score < 0.5:
                add(item, 'fail', f'title does not match the registered work: "{registered_title(meta)}"')
            elif score < 0.8:
                add(item, 'warn', f'title differs from the registered title: "{registered_title(meta)}"')
        elif not title:
            add(item, 'warn', 'entry has no title to compare with the registered work')
        names = split_names(fields.get('author', ''))
        authors = res['authors_all']
        if names and names[0].lower() != 'others' and authors:
            written, registered = surname(names[0]), _family(authors[0])
            match = author_matches(names[0], authors[0])
            later = any(author_matches(names[0], a) for a in authors[1:]) if match is False else None
            comparison['first_author'] = {'entry': written, 'registry': registered, 'match': match,
                                          'listed_later': later}
            if later:
                add(item, 'info', f'first author "{written}" is a later author in the registry record '
                                  f'(registered first author "{registered}")')
            elif match is False:
                add(item, 'warn', f'first author "{written}" is not among the registered authors '
                                  f'(registered first author "{registered}")')
        entry_year, registered_year = year_of(fields), meta['year']
        if entry_year and registered_year:
            comparison['year'] = {'entry': entry_year, 'registry': registered_year}
            gap = abs(entry_year - registered_year)
            if gap == 1:
                add(item, 'info', f'year {entry_year} is one off the registered year {registered_year} '
                                  '(often online-first versus print)')
            elif gap > 1:
                add(item, 'warn', f'year {entry_year} differs from the registered year {registered_year}')

    def _search(self, item, fields, title):
        if len(normalize_text(title).split()) < 3:
            add(item, 'inconclusive', 'no DOI, and the title is too short to match a registry record')
            return
        names = split_names(fields.get('author', '') or fields.get('editor', ''))
        first = surname(names[0]) if names and names[0].lower() != 'others' else ''
        year = year_of(fields)
        query = ' '.join(x for x in (normalize_text(title), normalize_text(first), str(year or '')) if x)
        if not self._allowed(self.resolver.search_url(query)):
            self._not_checked(item)
            return
        ok, candidates, reason = self.resolver.search(query, item['trace'])
        if not ok:
            add(item, 'inconclusive', f'no DOI, and Crossref search failed ({reason}): not evidence either way')
            return
        best, best_score = None, 0.0
        for cand in candidates:
            score = title_similarity(title, cand)
            best_score = max(best_score, score)
            if score < 0.9:
                continue
            checks = [author_matches(names[0], a) for a in cand['authors'][:3]] if first else []
            if checks and all(c is False for c in checks):
                continue  # same title, different first author: another work or a reply to it
            # Prefer the original work over chapters, reviews and notices reusing its title.
            rank = score + 0.05 * (cand['type'] in ('journal-article', 'proceedings-article')) \
                + 0.05 * bool(year and cand['year'] and abs(year - cand['year']) <= 1)
            if best is None or rank > best[0]:
                best = (rank, score, cand)
        item['comparison'] = {'title_similarity': round(best_score, 3), 'first_author': None, 'year': None}
        if best is None:
            add(item, 'inconclusive', 'no DOI and no matching registry record '
                                      '(could be a book, report, web page, or invented)')
            return
        _, score, cand = best
        item['candidate'] = {'doi': cand['doi'], 'title': cand['title'], 'year': cand['year'],
                             'container': cand['container'], 'type': cand['type'],
                             'first_author': _family(cand['authors'][0]) if cand['authors'] else None,
                             'similarity': round(score, 3)}
        note = (f" (registry year {cand['year']}: check it is the same work)"
                if year and cand['year'] and abs(year - cand['year']) > 1 else '')
        add(item, 'info', f"no DOI in the entry; Crossref has a matching record: add doi = {{{cand['doi']}}}{note}")

    def check_bib(self, source, text):
        entries, errors = parse_bib(text)
        items = [finish(new_item(source, 'bib', f"line {e['line']}", line=e['line'], lines=[e['line']],
                                 problems=[{'level': 'warn', 'message': f"could not parse entry: {e['message']}"}]))
                 for e in errors]
        seen = set()
        for entry in entries:
            items.append(self.check_entry(source, entry, seen))
        return sorted(items, key=lambda i: i['line'] or 0)

    def check_text(self, source, text, tex=False):
        groups = {}
        for kind, ident, line in extract_ids(text, tex):
            doi = ident if kind == 'doi' else arxiv_doi(ident)
            group = groups.setdefault(doi.lower(), {'doi': doi, 'arxiv': None, 'lines': []})
            if kind == 'arxiv':
                group['arxiv'] = group['arxiv'] or ident
            group['lines'].append(line)
        items = []
        for group in sorted(groups.values(), key=lambda g: min(g['lines'])):
            lines = sorted(set(group['lines']))
            item = new_item(source, 'text', f'line {lines[0]}', line=lines[0], lines=lines, arxiv=group['arxiv'])
            self._lookup(item, group['doi'])
            items.append(finish(item))
        return items

    def check_arg(self, raw, doi, arxiv):
        item = new_item('(command line)', 'arg', raw, arxiv=arxiv)
        if not doi and not arxiv:
            return self._invalid(item, raw)
        self._lookup(item, doi or arxiv_doi(arxiv))
        return finish(item)


# --- output ------------------------------------------------------------------

LABELS = {'ok': 'ok', 'info': 'info', 'warn': 'WARN', 'fail': 'FAIL', 'inconclusive': 'INCONCLUSIVE'}


def summarize(items):
    counts = {v: 0 for v in VERDICTS}
    for item in items:
        counts[item['verdict']] += 1
    counts['total'] = len(items)
    return counts


def render_text(groups, summary):
    lines = []
    for source, items in groups:
        lines.append(source)
        if not items:
            lines.append('  (no DOIs, arXiv ids or entries found)')
        for item in items:
            ident = f"arXiv:{item['arxiv']}" if item['arxiv'] else (item['doi'] or '')
            if item['kind'] == 'arg':
                where = ''
            elif item['kind'] == 'bib' and item['key']:
                where = f"{item['key']} (line {item['line']})  "
            else:
                where = item['location'] + '  '
            state = '/'.join(x for x in (item['state'], item['registry']) if x)
            lines.append(f"  {LABELS[item['verdict']]:<12} {where}{ident}"
                         f"{'  [' + state + ']' if state else ''}".rstrip())
            for problem in item['problems']:
                lines.append(f"      {problem['level']}: {problem['message']}")
            meta = item['metadata']
            if item['kind'] != 'bib' and meta and meta.get('title'):
                year = f" ({meta['year']})" if meta.get('year') else ''
                lines.append(f'      registered as: "{meta["title"]}"{year}')
    lines.append(f"Summary: {summary['ok']} ok, {summary['warn']} warn, {summary['fail']} fail, "
                 f"{summary['inconclusive']} inconclusive, {summary['info']} info "
                 f"({summary['total']} items)")
    return '\n'.join(lines)


def _read(path):
    data = path.read_bytes()
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('latin-1')


def main(argv=None, fetch=None, sleep=time.sleep, progress=None):
    parser = argparse.ArgumentParser(
        description='Check DOIs, arXiv ids and .bib entries against Crossref, DataCite and doi.org.',
        epilog='Exit status: 1 if any item fails, 2 on usage errors, 0 otherwise.')
    parser.add_argument('inputs', nargs='+', metavar='INPUT', help='.bib/.md/.tex file, DOI or arXiv:ID')
    parser.add_argument('--json', action='store_true', help='print machine-readable results')
    parser.add_argument('--timeout', type=float, default=15.0, help='seconds per request (default 15)')
    parser.add_argument('--max', type=int, default=None, metavar='N', help='cap the number of lookups')
    parser.add_argument('--no-openalex', action='store_true', help='skip the OpenAlex retraction lookup')
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    if args.max is not None and args.max < 0:
        parser.error('--max must be zero or more')

    sources, bare = [], []
    for raw in args.inputs:
        path = Path(raw)
        if path.is_file():
            suffix = path.suffix.lower()
            if suffix != '.bib' and suffix not in TEXT_SUFFIXES:
                parser.error(f'unsupported file type: {raw} (use .bib, .md or .tex)')
            try:
                sources.append((raw, suffix, _read(path)))
            except OSError as exc:
                parser.error(f'cannot read {raw}: {exc}')
        elif path.exists():
            parser.error(f'not a regular file: {raw}')
        else:
            doi = normalize_doi(raw)
            match = None if doi else ARG_ARXIV.match(raw.strip())
            if not doi and not match and not DOI_LIKE.match(raw.strip()):
                parser.error(f'no such file, and not a DOI or arXiv:ID: {raw}')
            bare.append((raw, doi, match.group(1) if match else None))  # DOI-like but invalid: reported

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    show = sys.stderr.isatty() if progress is None else progress
    checker = Checker(Resolver(Http(fetch, timeout=args.timeout, sleep=sleep), openalex=not args.no_openalex),
                      max_lookups=args.max)
    groups = []
    for index, (label, suffix, text) in enumerate(sources, 1):
        if show:
            print(f'checking {label} ({index}/{len(sources)})', file=sys.stderr)
        if suffix == '.bib':
            groups.append((label, checker.check_bib(label, text)))
        else:
            groups.append((label, checker.check_text(label, text, tex=suffix in ('.tex', '.ltx'))))
    if bare:
        groups.append(('(command line)', [checker.check_arg(raw, doi, arxiv) for raw, doi, arxiv in bare]))

    items = [item for _, group in groups for item in group]
    summary = summarize(items)
    if args.json:
        print(json.dumps({'tool': 'verify_refs', 'schema': 1, 'summary': summary,
                          'inputs': [label for label, _ in groups], 'items': items},
                         indent=2, ensure_ascii=False))
    else:
        print(render_text(groups, summary))
    return 1 if summary['fail'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
