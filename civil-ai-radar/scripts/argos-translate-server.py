#!/usr/bin/env python3
"""LibreTranslate-compatible local server backed by Argos Translate models."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from argostranslate import package, translate
except ImportError:
    sys.stderr.write('Argos Translate is not installed. Create .runtime/translate-venv and pip install argostranslate.\n')
    raise SystemExit(1)

PAIRS = (('en', 'zh'), ('zh', 'en'))
HOST = os.environ.get('TRANSLATE_HOST', '127.0.0.1')
PORT = int(os.environ.get('TRANSLATE_PORT', '5001'))


def installed_pairs():
    return {(item.from_code, item.to_code) for item in package.get_installed_packages()}


def ensure_models():
    have = installed_pairs()
    missing = [pair for pair in PAIRS if pair not in have]
    if not missing:
        return
    sys.stderr.write('Downloading Argos language packages: %s\n' % ', '.join('%s-%s' % pair for pair in missing))
    package.update_package_index()
    available = package.get_available_packages()
    for source, target in missing:
        match = next((item for item in available if item.from_code == source and item.to_code == target), None)
        if match is None:
            raise SystemExit('No Argos package for %s -> %s' % (source, target))
        package.install_from_path(match.download())
        sys.stderr.write('Installed %s -> %s\n' % (source, target))


def translate_one(text, source, target):
    if not text.strip():
        return text
    return translate.translate(text, source, target)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip('/') in ('', '/health', '/languages'):
            self._send(200, {
                'ok': True,
                'engine': 'argos',
                'languages': [{'code': 'en', 'name': 'English'}, {'code': 'zh', 'name': 'Chinese'}],
            })
            return
        self._send(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path.rstrip('/') != '/translate':
            self._send(404, {'error': 'Not found'})
            return
        length = int(self.headers.get('Content-Length') or 0)
        if length > 2_000_000:
            self._send(413, {'error': 'Request too large'})
            return
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            self._send(400, {'error': 'Invalid JSON'})
            return
        source = body.get('source')
        target = body.get('target')
        if (source, target) not in PAIRS:
            self._send(400, {'error': 'Only en <-> zh is supported'})
            return
        query = body.get('q')
        try:
            if isinstance(query, list):
                translated = [translate_one(str(item or ''), source, target) for item in query]
            else:
                translated = translate_one(str(query or ''), source, target)
        except Exception as error:
            self._send(502, {'error': str(error)})
            return
        self._send(200, {'translatedText': translated})


def main():
    ensure_models()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print('Argos LibreTranslate-compatible server on %s:%s' % (HOST, PORT), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
