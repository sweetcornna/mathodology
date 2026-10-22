#!/usr/bin/env python3
"""Offline tests for verify_refs.py: every HTTP call goes to an injected fake opener.

Run from this folder with ``python3 -m unittest`` (or
``python3 -m unittest discover -s <this folder>`` from elsewhere).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import verify_refs as vr  # noqa: E402


class FakeResponse:
    def __init__(self, status, body=b''):
        self.status, self._body = status, body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeNet:
    """Routes a URL prefix to a status/payload, an exception, or a list consumed in order.

    The first matching prefix wins, so list doi.org/ra/ before the bare doi.org/ (CSL) route.
    """

    def __init__(self, routes=()):
        self.routes, self.calls = list(routes), []

    def __call__(self, request, timeout):
        url = request.full_url
        self.calls.append((url, dict(request.header_items())))
        for prefix, outcome in self.routes:
            if url.startswith(prefix):
                if isinstance(outcome, list):
                    outcome = outcome.pop(0) if len(outcome) > 1 else outcome[0]
                if isinstance(outcome, BaseException):
                    raise outcome
                status, payload = outcome
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                if status >= 300:
                    raise urllib.error.HTTPError(url, status, 'fake', {}, io.BytesIO(body))
                return FakeResponse(status, body)
        if url.startswith(vr.OPENALEX):
            raise urllib.error.HTTPError(url, 404, 'fake', {}, io.BytesIO(b''))
        raise AssertionError(f'unexpected request: {url}')

    def urls(self):
        return [url for url, _ in self.calls]


def crossref_work(doi, title, family='Kermack', year=1927, authors=None, **extra):
    message = {'DOI': doi, 'title': [title], 'type': 'journal-article',
               'author': authors or [{'given': 'W. O.', 'family': family, 'sequence': 'first'}],
               'issued': {'date-parts': [[year, 8, 1]]}, 'container-title': ['Proc. R. Soc. A']}
    message.update(extra)
    return (200, {'status': 'ok', 'message': message})


def datacite_record(doi, title, creators, year, kind='Dataset', related=()):
    return (200, {'data': {'id': doi, 'attributes': {
        'doi': doi.lower(), 'titles': [{'title': title}], 'publicationYear': year, 'publisher': 'Zenodo',
        'creators': creators, 'types': {'resourceTypeGeneral': kind}, 'relatedIdentifiers': list(related)}}})


def agency(name):
    return (200, [{'DOI': 'x', 'RA': name}])


def ra_status(text):
    return (200, [{'DOI': 'x', 'status': text}])


CR = vr.CROSSREF + '/'
DC = vr.DATACITE
RA = vr.DOI_PROXY + 'ra/'
CSL = vr.DOI_PROXY
SEARCH = vr.CROSSREF + '?'
SIR = '10.1098/rspa.1927.0118'
SIR_TITLE = 'A contribution to the mathematical theory of epidemics'
CROSSREF_404 = (CR, (404, {}))


def checker(routes, openalex=False, max_lookups=None):
    net, sleeps = FakeNet(routes), []
    http = vr.Http(net, timeout=1, sleep=sleeps.append)
    return vr.Checker(vr.Resolver(http, openalex=openalex), max_lookups), net, sleeps


def bib_entry(fields, key='k', kind='article'):
    return {'type': kind, 'key': key, 'fields': fields, 'line': 1}


def messages(item):
    return ' | '.join(p['message'] for p in item['problems'])


def levels(item):
    return [p['level'] for p in item['problems']]


class NormalizeTests(unittest.TestCase):
    def test_prefixes_and_trailing_punctuation(self):
        cases = {
            'https://doi.org/10.1098/rspa.1927.0118': SIR,
            'http://dx.doi.org/10.1098/rspa.1927.0118.': SIR,
            'doi:10.1098/rspa.1927.0118;': SIR,
            'DOI: 10.1098/rspa.1927.0118)': SIR,
            '10.1098/rspa.1927.0118",': SIR,
            '10.1016/S0140-6736(97)11096-0': '10.1016/S0140-6736(97)11096-0',
            '10.1016/S0140-6736(97)11096-0).': '10.1016/S0140-6736(97)11096-0',
            'https://doi.org/10.1002/%28SICI%291097-0258': '10.1002/(SICI)1097-0258',
            '10.1002/%28SICI%291097-0258': '10.1002/(SICI)1097-0258',
        }
        for raw, expected in cases.items():
            self.assertEqual(vr.normalize_doi(raw), expected, raw)

    def test_rejects_malformed(self):
        for raw in ['10.12/abc', '11.1234/abc', '10.1234/', '10.1234/a/../b', '10.1234/./b',
                    '10.1234/' + 'x' * 300, 'doi.org', '', None]:
            self.assertIsNone(vr.normalize_doi(raw), raw)

    def test_doi_path_escapes_each_segment(self):
        self.assertEqual(vr.doi_path('10.1002/(SICI)1097:8<857>;2-E'), '10.1002/%28SICI%291097%3A8%3C857%3E%3B2-E')

    def test_title_similarity_is_bigram_dice_with_prefix_rule(self):
        self.assertEqual(vr.similarity(SIR_TITLE, SIR_TITLE.upper() + '.'), 1.0)
        self.assertEqual(vr.similarity(SIR_TITLE, SIR_TITLE + ': part one'), 0.95)
        self.assertAlmostEqual(vr.similarity('night', 'nacht'), 0.25)
        self.assertEqual(vr.title_similarity('Deep learning: a review', {'title': 'Deep learning', 'subtitle': 'A review'}), 1.0)

    def test_registry_title_markup_and_entities(self):
        mathml = ('Precision measurement of the <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:msub>'
                  '<mml:mi>B</mml:mi><mml:mi>s</mml:mi></mml:msub></mml:math> lifetime')
        for title in (mathml, mathml.replace('<', '&lt;').replace('>', '&gt;')):
            self.assertEqual(vr.similarity('Precision measurement of the Bs lifetime', title), 1.0)
        self.assertEqual(vr.similarity('CO2 uptake by forests', 'CO<sub>2</sub> uptake by forests'), 1.0)
        self.assertEqual(vr.similarity('CO2 uptake by forests', 'CO&lt;sub&gt;2&lt;/sub&gt; uptake by forests'), 1.0)


class ExtractionTests(unittest.TestCase):
    def test_markdown_dois_and_arxiv(self):
        text = ('See [Kermack](https://doi.org/10.1098/rspa.1927.0118).\n'
                'Also doi:10.1000/XYZ.123, and (10.1016/S0140-6736(97)11096-0).\n'
                '<https://doi.org/10.5555/auto> and https://doi.org/10.1002/%28SICI%291097?x=1\n'
                'Preprint arXiv:1706.03762v5; old https://arxiv.org/abs/hep-th/9711200.\n')
        self.assertEqual(vr.extract_ids(text), [
            ('doi', SIR, 1), ('doi', '10.1000/XYZ.123', 2), ('doi', '10.1016/S0140-6736(97)11096-0', 2),
            ('doi', '10.5555/auto', 3), ('doi', '10.1002/(SICI)1097', 3),
            ('arxiv', '1706.03762', 4), ('arxiv', 'hep-th/9711200', 4)])

    def test_tex_escapes_braces_and_comments(self):
        text = ('\\href{https://doi.org/10.1000/a\\_b}{link}\n'
                '\\doi{10.1000/c}. [x](https://doi.org/10.1000/d)]\n')
        self.assertEqual([i for _, i, _ in vr.extract_ids(text, tex=True)],
                         ['10.1000/a_b', '10.1000/c', '10.1000/d'])
        commented = '% \\doi{10.9999/old}\nText 50\\% done \\url{https://doi.org/10.1002/%28SICI%29x} % 10.9999/b\n'
        self.assertEqual([(i, n) for _, i, n in vr.extract_ids(commented, tex=True)], [('10.1002/(SICI)x', 2)])

    def test_markdown_emphasis_tables_and_cjk_punctuation(self):
        text = ('See `10.1038/nature14539`, **10.1000/bold** and | 10.1000/cell |.\n'
                '（DOI：10.1016/j.ecolmodel.2020.109123）和“10.1000/quoted”，见10.1000/zh的研究。\n')
        self.assertEqual(vr.extract_ids(text), [
            ('doi', '10.1038/nature14539', 1), ('doi', '10.1000/bold', 1), ('doi', '10.1000/cell', 1),
            ('doi', '10.1016/j.ecolmodel.2020.109123', 2), ('doi', '10.1000/quoted', 2), ('doi', '10.1000/zh', 2)])

    def test_link_labels_escapes_and_html_escaped_sici(self):
        sici = '10.1002/(SICI)1097-0258(19980815/30)17:15/16<1661::AID-SIM968>3.0.CO;2-2'
        text = ('\\href{https://doi.org/10.1038/nature14539}{Nature} and 10.1000/a\\_b\n'
                + sici.replace('<', '&lt;').replace('>', '&gt;') + '.\n')
        self.assertEqual(vr.extract_ids(text), [('doi', '10.1038/nature14539', 1), ('doi', '10.1000/a_b', 1),
                                                ('doi', sici, 2)])

    def test_markdown_link_text_and_target_are_one_item(self):
        text = '[10.1000/same](https://doi.org/10.1000/same) and 10.1000/SAME.'
        items = checker([(CR, crossref_work('10.1000/same', 'T'))])[0].check_text('p.md', text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['lines'], [1])


class BibParserTests(unittest.TestCase):
    BIB = r'''
@string{ proc = "Proc. R. Soc." }
@comment{ ignored {nested} }
% an @ sign in a comment: user@example.com
@Article{kermack1927,
  title  = {A {C}ontribution to the {Mathematical {Theory}} of Epidemics},
  author = "Kermack, W. O. and McKendrick, A. {\relax G}.",
  journal = proc # " A",
  year = 1927,
  doi = {10.1098/rspa.1927.0118},
}
@misc(paren, title = "Quoted {"}braces{"} inside", note = {a, b})
@book{broken, title = {unbalanced
@book{after, title = {Recovered}}
'''

    def test_entries_fields_and_recovery(self):
        entries, errors = vr.parse_bib(self.BIB)
        self.assertEqual([e['key'] for e in entries], ['kermack1927', 'paren', 'after'])
        first = entries[0]['fields']
        self.assertEqual(entries[0]['type'], 'article')
        self.assertEqual(first['title'], 'A {C}ontribution to the {Mathematical {Theory}} of Epidemics')
        self.assertEqual(first['author'], 'Kermack, W. O. and McKendrick, A. {\\relax G}.')
        self.assertEqual(first['journal'], 'Proc. R. Soc. A')
        self.assertEqual(first['year'], '1927')
        self.assertEqual(entries[1]['fields'], {'title': 'Quoted {"}braces{"} inside', 'note': 'a, b'})
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]['line'], 13)

    def test_names_and_text_normalization(self):
        self.assertEqual(vr.split_names('Kermack, W. O. and {Smith and Sons} AND Doe, J.'),
                         ['Kermack, W. O.', '{Smith and Sons}', 'Doe, J.'])
        self.assertEqual(vr.surname('Kermack, W. O.'), 'Kermack')
        self.assertEqual(vr.surname('Johannes Diderik {van der Waals}'), 'van der Waals')
        self.assertTrue(vr.author_matches('Erd{\\H{o}}s, Paul', 'Erdős'))
        self.assertTrue(vr.author_matches('Ashish Vaswani', {'family': 'Vaswani', 'given': 'Ashish'}))
        self.assertFalse(vr.author_matches('Smith, John', 'Kermack'))
        self.assertEqual(vr.normalize_text(r'The {\"O}ber-$\alpha$ <i>model</i>: \emph{A} test'),
                         'the ober α model a test')

    def test_cjk_author_rules(self):
        self.assertTrue(vr.author_matches('张三', {'family': '张', 'given': '三'}))      # family + given
        self.assertTrue(vr.author_matches('张', {'family': '张', 'given': '三'}))        # family alone
        self.assertTrue(vr.author_matches('张三丰', {'family': '张', 'given': '三'}))    # starts with family
        self.assertTrue(vr.author_matches('王桂民', {'family': '王桂民', 'given': None}))  # CNKI given-only name
        self.assertFalse(vr.author_matches('李四', {'family': '张', 'given': '三'}))
        self.assertIsNone(vr.author_matches('张三', {'family': 'Zhang', 'given': 'San'}))  # mixed scripts


class ResolverTests(unittest.TestCase):
    ENTRY = {'title': '{A} contribution to the mathematical theory of epidemics',
             'author': 'Kermack, William Ogilvy and McKendrick, A. G.', 'year': '1927', 'doi': SIR}

    def check_entry(self, routes, fields=None, kind='article', **kwargs):
        check, net, sleeps = checker(routes, **kwargs)
        return check.check_entry('r.bib', bib_entry(fields or self.ENTRY, kind=kind), set()), net

    def test_crossref_hit_with_matching_metadata_is_ok(self):
        item, net = self.check_entry([(CR, crossref_work(SIR, SIR_TITLE))])
        self.assertEqual((item['state'], item['registry'], item['verdict']), ('resolves', 'crossref', 'ok'))
        self.assertEqual(item['comparison']['title_similarity'], 1.0)
        self.assertEqual(net.urls(), [CR + '10.1098/rspa.1927.0118'])
        for _, headers in net.calls:
            self.assertEqual(headers['User-agent'], vr.USER_AGENT)
            self.assertNotIn('@', json.dumps(headers))

    def test_doi_fields_with_tex_escapes_or_extra_braces(self):
        doi = '10.1007/978-3-319-24574-4_28'
        fields = {'title': 'U-Net', 'author': 'Ronneberger, O.', 'year': '2015', 'doi': '10.1007/978-3-319-24574-4\\_28'}
        item, net = self.check_entry([(CR, crossref_work(doi, 'U-Net', family='Ronneberger', year=2015))], fields)
        self.assertEqual((item['doi'], item['verdict'], net.urls()), (doi, 'ok', [CR + doi]))
        entries, _ = vr.parse_bib('@article{k, title={U-Net}, doi = {{10.1000/xyz}}}')
        item = checker([(CR, crossref_work('10.1000/xyz', 'U-Net'))])[0].check_entry('r.bib', entries[0], set())
        self.assertEqual((item['doi'], item['state']), ('10.1000/xyz', 'resolves'))

    def test_title_mismatch_fails(self):
        item, _ = self.check_entry([(CR, crossref_work(SIR, 'Deep residual learning for image recognition'))])
        self.assertEqual(item['verdict'], 'fail')
        self.assertIn('title does not match the registered work', messages(item))

    def test_author_and_year_severities(self):
        later = [{'family': 'Bernoulli', 'sequence': 'first'}, {'family': 'Kermack', 'sequence': 'additional'}]
        item, _ = self.check_entry([(CR, crossref_work(SIR, SIR_TITLE, year=1928, authors=later))])
        self.assertEqual(levels(item), ['info', 'info'])  # listed later; one year off
        self.assertTrue(item['comparison']['first_author']['listed_later'])
        item, _ = self.check_entry([(CR, crossref_work(SIR, SIR_TITLE, family='Bernoulli', year=1931))])
        self.assertEqual(levels(item), ['warn', 'warn'])  # not among the authors; year off by four
        self.assertIn('not among the registered authors', messages(item))
        self.assertIn('year 1927 differs', messages(item))

    def test_notice_severities(self):
        work = crossref_work(SIR, SIR_TITLE, **{'updated-by': [
            {'DOI': '10.1016/s0140-6736(10)60175-4', 'type': 'retraction', 'label': 'Retraction',
             'source': 'retraction-watch'},
            {'DOI': '10.1000/fix', 'type': 'erratum', 'label': 'Erratum'},
            {'DOI': '10.1000/eoc', 'type': 'expression_of_concern', 'label': 'Expression of concern'}]})
        item, _ = self.check_entry([(CR, work)])
        self.assertEqual(levels(item), ['fail', 'warn', 'info'])
        self.assertEqual([n['kind'] for n in item['notices']], ['retraction', 'correction', 'expression_of_concern'])
        corrected = crossref_work(SIR, SIR_TITLE, **{'updated-by': [{'DOI': '10.1000/fix', 'type': 'correction'}]})
        self.assertEqual(self.check_entry([(CR, corrected)])[0]['verdict'], 'info')
        retracted = crossref_work(SIR, 'RETRACTED: ' + SIR_TITLE)
        text_item = checker([(CR, retracted)])[0].check_text('p.md', f'doi:{SIR}')[0]
        self.assertEqual((text_item['verdict'], text_item['notices'][0]['via']), ('fail', 'title'))

    def test_citing_a_notice_record_warns(self):
        notice = crossref_work('10.1000/notice', 'Notice', **{'update-to': [
            {'DOI': SIR, 'type': 'retraction', 'label': 'Retraction'}]})
        item = checker([(CR, notice)])[0].check_arg('x', '10.1000/notice', None)
        self.assertEqual(item['verdict'], 'warn')
        self.assertIn('itself the retraction notice', messages(item))

    def test_datacite_agency(self):
        doi = '10.5281/zenodo.123'
        record = datacite_record(doi, 'Fishery catch data', [{'name': 'Lovelace, Ada', 'nameType': 'Personal'}], 2020)
        entry = {'title': 'Fishery catch data', 'author': 'Ada Lovelace', 'year': '2020', 'doi': doi}
        item, net = self.check_entry([CROSSREF_404, (RA, agency('DataCite')), (DC, record)], entry, kind='misc')
        self.assertEqual((item['state'], item['registry'], item['verdict']), ('resolves', 'datacite', 'ok'))
        self.assertEqual(item['metadata']['authors'][0]['family'], 'Lovelace')
        self.assertEqual(net.urls(), [CR + '10.5281/zenodo.123', RA + '10.5281/zenodo.123', DC + '10.5281/zenodo.123'])

    def test_other_agency_metadata_from_csl(self):
        doi = '10.11975/j.issn.1002-6819.2017.01.001'
        csl = (200, {'title': '中国耕地流转时空特征及影响因素分解', 'container-title': ['农业工程学报'],
                     'issued': {'date-parts': [[2017]]}, 'type': 'article-journal', 'author': [{'given': '王桂民'}]})
        entry = {'title': '中国耕地流转时空特征及影响因素分解', 'author': '王桂民 and 叶春', 'year': '2017', 'doi': doi}
        item, net = self.check_entry([CROSSREF_404, (RA, agency('ISTIC')), (CSL, csl)], entry)
        self.assertEqual((item['registry'], item['verdict']), ('istic', 'ok'))
        self.assertEqual(item['metadata']['container'], '农业工程学报')
        self.assertEqual(net.calls[-1][1]['Accept'], vr.CSL_JSON)
        self.assertEqual(net.urls()[-1], CSL + doi)

    def test_crossref_agency_without_record_resolves_but_entry_is_inconclusive(self):
        routes = [(CR, (503, {})), (RA, agency('Crossref'))]
        item, net = self.check_entry(routes)
        self.assertEqual((item['state'], item['registry'], item['metadata'], item['verdict']),
                         ('resolves', 'crossref', None, 'inconclusive'))
        self.assertIn('could not be read (Crossref answered HTTP 503)', messages(item))
        self.assertEqual(len(net.urls()), 4)  # Crossref tried three times (backoff), then doi.org/ra

    def test_agency_without_metadata_still_resolves(self):
        routes = [CROSSREF_404, (RA, agency('mEDRA')), (CSL, (406, b''))]
        item = checker(routes)[0].check_text('p.md', 'doi:10.3280/ecag2020-001001')[0]
        self.assertEqual((item['state'], item['registry'], item['verdict']), ('resolves', 'medra', 'ok'))

    def test_does_not_exist_is_not_found_and_fails(self):
        check, net, _ = checker([CROSSREF_404, (RA, ra_status('DOI does not exist'))])
        item = check.check_arg('10.9999/fake.12345', '10.9999/fake.12345', None)
        self.assertEqual((item['state'], item['verdict']), ('not_found', 'fail'))
        self.assertEqual(len(net.calls), 2)
        # Authoritative even when Crossref itself could not be reached.
        down = urllib.error.URLError(TimeoutError('timed out'))
        item = checker([(CR, down), (RA, ra_status('DOI does not exist'))])[0].check_arg('x', '10.1000/x', None)
        self.assertEqual(item['state'], 'not_found')

    def test_invalid_states(self):
        item = checker([CROSSREF_404, (RA, ra_status('Invalid DOI'))])[0].check_arg('x', '10.1000/x', None)
        self.assertEqual((item['state'], item['verdict']), ('invalid', 'fail'))
        check, net, _ = checker([])
        item = check.check_entry('r.bib', bib_entry({'title': 'T', 'doi': '10.12/short'}), set())
        self.assertEqual((item['state'], item['verdict'], net.calls), ('invalid', 'fail', []))
        self.assertIn('not a valid DOI', messages(item))

    def test_network_error_or_bad_answer_is_inconclusive_not_fail(self):
        down = urllib.error.URLError(TimeoutError('timed out'))
        for ra in (down, (503, b''), (200, b'<html>proxy</html>'), ra_status('something new')):
            item = self.check_entry([(CR, down), (RA, ra)])[0]
            self.assertEqual((item['state'], item['verdict']), ('unverifiable', 'inconclusive'), ra)
            self.assertIn('not evidence', messages(item))

    def test_host_skipped_after_repeated_network_errors(self):
        down = OSError('reset')
        check, net, _ = checker([(CR, down), (RA, down)])
        for n in range(4):
            check.check_arg('x', f'10.1000/{n}', None)
        self.assertEqual(len(net.calls), 6)  # the fourth DOI makes no request
        self.assertIn('skipped after repeated network errors', messages(check.check_arg('x', '10.1000/9', None)))

    def test_server_errors_retry_with_backoff(self):
        routes = [(CR, [(429, {}), (503, {}), crossref_work(SIR, SIR_TITLE)])]
        check, net, sleeps = checker(routes)
        item = check.check_arg('x', SIR, None)
        self.assertEqual((item['state'], item['registry']), ('resolves', 'crossref'))
        self.assertEqual(len(net.urls()), 3)
        self.assertIn(1.0, sleeps)
        self.assertIn(2.0, sleeps)

    def test_arxiv_eprint_resolves_through_datacite_with_published_version(self):
        doi = '10.48550/arXiv.1602.03837'
        record = datacite_record(doi, 'Observation of Gravitational Waves from a Binary Black Hole Merger',
                                 [{'name': 'The LIGO Scientific Collaboration', 'nameType': 'Organizational'}],
                                 2016, kind='Text', related=[{'relationType': 'IsVersionOf', 'relatedIdentifierType': 'DOI',
                                                              'relatedIdentifier': '10.1103/physrevlett.116.061102'}])
        entry = {'title': 'Observation of gravitational waves from a binary black hole merger',
                 'author': '{The LIGO Scientific Collaboration}', 'year': '2016',
                 'eprint': '1602.03837v1', 'archiveprefix': 'arXiv'}
        item, net = self.check_entry([CROSSREF_404, (RA, agency('DataCite')), (DC, record)], entry, kind='misc')
        self.assertEqual(net.urls()[2], DC + '10.48550/arXiv.1602.03837')
        self.assertEqual((item['arxiv'], item['registry'], item['verdict']), ('1602.03837', 'datacite', 'warn'))
        self.assertEqual(item['published_version'], {'doi': '10.1103/physrevlett.116.061102', 'via': 'relation'})

    def test_preprint_without_relation_searches_for_published_version(self):
        doi = '10.1101/2020.03.22.002386'
        work = crossref_work(doi, 'A protein interaction map', family='Gordon', year=2020, type='posted-content')
        search = (200, {'message': {'items': [
            {'DOI': '10.1038/s41586-020-2286-9', 'title': ['A protein interaction map'], 'type': 'journal-article',
             'author': [{'family': 'Gordon'}], 'issued': {'date-parts': [[2020]]}, 'container-title': ['Nature']}]}})
        item = checker([(SEARCH, search), (CR, work)])[0].check_text('p.md', doi)[0]
        self.assertEqual(item['verdict'], 'warn')
        self.assertEqual(item['published_version']['doi'], '10.1038/s41586-020-2286-9')

    def test_no_doi_candidate_no_match_and_short_title(self):
        hit = (200, {'message': {'items': [
            {'DOI': '10.1000/reply', 'title': [SIR_TITLE], 'type': 'journal-article', 'author': [{'family': 'Other'}]},
            {'DOI': SIR, 'title': [SIR_TITLE], 'type': 'journal-article', 'author': [{'family': 'Kermack'}],
             'issued': {'date-parts': [[1927]]}}]}})
        fields = {k: v for k, v in self.ENTRY.items() if k != 'doi'}
        item, net = self.check_entry([(SEARCH, hit)], fields)
        self.assertEqual(item['verdict'], 'info')
        self.assertEqual(item['candidate']['doi'], SIR)  # the same-title item by another author is skipped
        self.assertIn('add doi = {10.1098/rspa.1927.0118}', messages(item))
        self.assertIn('rows=5', net.urls()[0])
        miss = (200, {'message': {'items': [{'DOI': '10.1000/other', 'title': ['Unrelated'], 'type': 'book'}]}})
        item, _ = self.check_entry([(SEARCH, miss)], {'title': 'An invented handbook of things', 'author': 'Doe, J.'},
                                   kind='book')
        self.assertEqual(item['verdict'], 'inconclusive')
        self.assertIn('could be a book, report, web page, or invented', messages(item))
        item, net = self.check_entry([], {'title': 'Convex Optimization'}, kind='book')
        self.assertEqual((item['verdict'], net.calls), ('inconclusive', []))

    def test_entries_without_title_or_doi_and_web_sources(self):
        check, net, _ = checker([])
        item = check.check_entry('r.bib', bib_entry({'author': 'Doe, J.'}), set())
        self.assertEqual(item['verdict'], 'warn')
        web = check.check_entry('r.bib', bib_entry({'title': 'Data portal', 'url': 'https://example.org'},
                                                   kind='online'), set())
        self.assertEqual(web['verdict'], 'info')
        self.assertEqual(net.calls, [])

    def test_openalex_skips_silently_and_flags_retraction(self):
        work = crossref_work(SIR, SIR_TITLE)
        check, _, _ = checker([(CR, work), (vr.OPENALEX, (403, {}))], openalex=True)
        item = check.check_arg('x', SIR, None)
        self.assertEqual((item['verdict'], item['openalex']['status']), ('ok', 'skipped'))
        retracted = (200, {'is_retracted': True, 'cited_by_count': 7})
        item = checker([(CR, work), (vr.OPENALEX, retracted)], openalex=True)[0].check_arg('x', SIR, None)
        self.assertEqual((item['verdict'], item['openalex']['cited_by_count']), ('fail', 7))

    def test_lookup_cap_and_cache(self):
        check, net, _ = checker([(CR, crossref_work(SIR, SIR_TITLE))], max_lookups=1)
        items = check.check_text('p.md', f'{SIR}\nhttps://doi.org/{SIR}\n10.1000/other')
        self.assertEqual([i['verdict'] for i in items], ['ok', 'inconclusive'])
        self.assertEqual(check.check_arg('x', SIR, None)['verdict'], 'ok')  # cached, not a new lookup
        self.assertEqual(len(net.calls), 1)


class CliTests(unittest.TestCase):
    def run_cli(self, *argv, routes=()):
        out, net = io.StringIO(), FakeNet(routes)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            try:
                code = vr.main(list(argv), fetch=net, sleep=lambda s: None, progress=False)
            except SystemExit as exc:
                code = exc.code
        return code, out.getvalue()

    def test_usage_errors_exit_2(self):
        self.assertEqual(self.run_cli()[0], 2)
        self.assertEqual(self.run_cli('missing-file.bib')[0], 2)
        self.assertEqual(self.run_cli('--timeout', '0', SIR)[0], 2)

    def test_malformed_doi_argument_is_reported_invalid(self):
        code, out = self.run_cli('10.12/short')
        self.assertEqual(code, 1)
        self.assertIn('not a valid DOI', out)

    def test_files_json_schema_exit_code_and_inputs_untouched(self):
        routes = [(CR + '10.1098', crossref_work(SIR, SIR_TITLE)), (CR + '10.9999', (404, {})),
                  (RA, ra_status('DOI does not exist'))]
        with tempfile.TemporaryDirectory() as tmp:
            bib, md = Path(tmp, 'refs.bib'), Path(tmp, 'paper.md')
            bib.write_text('@article{k, title={A contribution to the mathematical theory of epidemics}, '
                           'author={Kermack, W. O.}, year={1927}, doi={10.1098/rspa.1927.0118}}\n')
            md.write_text('Fake: https://doi.org/10.9999/fake.2026.12345.\n')
            before = {p: p.read_bytes() for p in (bib, md)}
            code, out = self.run_cli('--json', '--no-openalex', str(bib), str(md), routes=routes)
            self.assertEqual({p: p.read_bytes() for p in before}, before)
            self.assertEqual(sorted(os.listdir(tmp)), ['paper.md', 'refs.bib'])
        self.assertEqual(code, 1)
        report = json.loads(out)
        self.assertEqual(report['summary'], {'ok': 1, 'warn': 0, 'fail': 1, 'inconclusive': 0, 'info': 0,
                                             'total': 2})
        keys = {'source', 'kind', 'key', 'location', 'doi', 'state', 'registry', 'verdict', 'problems',
                'metadata', 'notices', 'candidate', 'openalex'}
        for item in report['items']:
            self.assertTrue(keys <= set(item))
            self.assertNotIn('authors_all', item)
        self.assertEqual(report['items'][0]['openalex']['status'], 'disabled')
        self.assertEqual((report['items'][1]['location'], report['items'][1]['state']), ('line 1', 'not_found'))

    def test_text_output_and_network_failure_exit_0(self):
        down = urllib.error.URLError(OSError('no route'))
        code, out = self.run_cli('--no-openalex', 'doi:10.1000/x', routes=[(CR, down), (RA, down)])
        self.assertEqual(code, 0)
        self.assertIn('INCONCLUSIVE', out)
        self.assertIn('Summary: 0 ok, 0 warn, 0 fail, 1 inconclusive, 0 info (1 items)', out)


if __name__ == '__main__':
    unittest.main()
