# Loaded into the session bridge before its request loop; no installed service.
import collections
import base64
import json
import os
import shutil
import signal
import subprocess
import threading
import time

search_jobs = {}
search_lock = threading.RLock()

def search_kill(job, reason):
    with search_lock:
        if job['status'] != 'running':
            return
        job['reason'] = reason
        job['cancelled'] = True
        process = job.get('process')
        if process:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass

def search_stop(owner, identifier=None):
    with search_lock:
        job = search_jobs.get(owner)
        if not job or (identifier and job['id'] != identifier): return False
        search_kill(job, 'Stopped by user')
        return True

def search_poll(owner, identifier):
    with search_lock:
        job = search_jobs.get(owner)
        if not job or job['id'] != identifier: raise ValueError('Search no longer exists.')
        matches, size = [], 0
        while job['queue'] and len(matches) < 64:
            item = job['queue'][0]
            length = len(json.dumps(item, ensure_ascii=False).encode('utf8'))
            if matches and size + length > 16384: break
            matches.append(job['queue'].popleft()); size += length
        return dict(id=identifier, matches=matches, status=job['status'], reason=job['reason'], count=job['count'], scope=job['scope'], pending=bool(job['queue']))

def search_start(args):
    owner, identifier = args['owner'], args['id']
    with search_lock:
        search_stop(owner)
        job = dict(id=identifier, queue=collections.deque(), status='running', reason='', count=0, scope=args['root'], cancelled=False, process=None)
        search_jobs[owner] = job
    threading.Thread(target=search_worker, args=(job, args), daemon=True).start()
    return dict(id=identifier)

def search_worker(job, o):
    timer = threading.Timer(o['timeoutSeconds'], lambda: search_kill(job, 'Time limit reached'))
    timer.daemon = True; timer.start()
    stderr = bytearray()
    def error_reader(pipe):
        while True:
            chunk = pipe.read(512)
            if not chunk: return
            stderr.extend(chunk)
            if len(stderr) > 2000: del stderr[:-2000]
    def text(field):
        return field.get('text') if 'text' in field else base64.b64decode(field.get('bytes', '')).decode('utf8', 'replace')
    def utf16(value): return len(value.encode('utf-16-le')) // 2
    try:
        root = os.path.realpath(o['root'])
        scope = os.path.realpath(os.path.join(root, o.get('directory') or '.'))
        if os.path.commonpath([root, scope]) != root or not os.path.isdir(scope):
            raise ValueError('Search scope must be a folder inside this workspace.')
        job['scope'] = scope
        rg = shutil.which('rg')
        if not rg: raise ValueError('Project search requires ripgrep (rg) on this SSH host. Install it on the host, then rerun the search.')
        args = [rg, '--no-config', '--json', '--fixed-strings', '--color', 'never', '--threads', str(o['threads']), '--max-filesize', str(o['maxFileSizeMB']) + 'M']
        if not o.get('caseSensitive'): args.append('--ignore-case')
        if o.get('wholeWord'): args.append('--word-regexp')
        if o.get('includeHidden'): args.append('--hidden')
        if o.get('includeIgnored'): args.append('--no-ignore')
        if o.get('maxDepth'): args.extend(['--max-depth', str(o['maxDepth'])])
        for glob in (v.strip() for v in o.get('include', '').split(',')):
            if glob: args.extend(['--glob', glob])
        for glob in (v.strip() for v in o.get('exclude', '').split(',')):
            if glob: args.extend(['--glob', '!' + glob.lstrip('!')])
        args.extend(['--glob', '!**/.git/**', '--glob', '!**/.owlet-*/**', '--', o['query'], '.'])
        with search_lock:
            if job['cancelled']: return
            process = subprocess.Popen(args, cwd=scope, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            job['process'] = process
        errors = threading.Thread(target=error_reader, args=(process.stderr,), daemon=True); errors.start()
        size = 0
        while not job['cancelled']:
            line = process.stdout.readline(8 * 1024 * 1024 + 1)
            if not line: break
            if len(line) > 8 * 1024 * 1024:
                search_kill(job, 'Oversized result line; narrow the search'); break
            message = json.loads(line)
            if message['type'] != 'match': continue
            data = message['data']
            if not data['submatches']: continue
            match = data['submatches'][0]
            line_text = text(data['lines']); raw = line_text.encode('utf8')
            prefix = raw[:match['start']].decode('utf8', 'replace')
            matched = raw[match['start']:match['end']].decode('utf8', 'replace')
            start = max(0, len(prefix) - 100); end = min(len(line_text.rstrip()), len(prefix) + min(len(matched), 200) + 160)
            filename = os.path.abspath(os.path.join(scope, text(data['path'])))
            if os.path.commonpath([scope, filename]) != scope: raise ValueError('Search returned an out-of-scope path')
            item = dict(path=filename, line=data['line_number'], column=utf16(prefix)+1, match=matched, text=line_text[start:end], start=utf16(line_text[start:len(prefix)]), end=utf16(line_text[start:min(end, len(prefix)+len(matched))]), clippedStart=start>0, clippedEnd=end<len(line_text.rstrip()))
            length = len(json.dumps(item, ensure_ascii=False).encode('utf8'))
            if size + length > o['maxResultMB'] * 1024 * 1024 or job['count'] >= o['maxResults']:
                search_kill(job, 'Result limit reached'); break
            with search_lock:
                job['queue'].append(item); job['count'] += 1
            size += length
            if job['count'] >= o['maxResults']: search_kill(job, 'Result limit reached')
        code = process.wait(); errors.join(timeout=1)
        with search_lock:
            if not job['cancelled']:
                job['status'] = 'complete' if code in (0, 1) else 'error'
                job['reason'] = stderr.decode('utf8', 'replace').strip()
    except Exception as error:
        with search_lock:
            if not job['cancelled']: job['status'] = 'error'; job['reason'] = str(error)
    finally:
        timer.cancel()
        with search_lock:
            if job['cancelled']: job['status'] = 'stopped' if job['reason'] == 'Stopped by user' else 'limited'
            process = job.get('process')
            if process:
                if process.poll() is None:
                    try: os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                process.stdout.close(); process.stderr.close()

def search_dispatch(method, args):
    if method == 'search-start': return search_start(args)
    if method == 'search-poll': return search_poll(args['owner'], args['id'])
    if method == 'search-stop': return search_stop(args['owner'], args.get('id'))
    if method == 'search-dispose':
        with search_lock:
            search_stop(args['owner']); search_jobs.pop(args['owner'], None)
        return True
    raise ValueError('Unknown search action')
