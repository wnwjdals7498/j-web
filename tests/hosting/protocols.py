import ftplib, io, json, os, socket, ssl, subprocess, sys, tempfile

request = json.load(sys.stdin)
context = ssl.create_default_context(cafile='/etc/jweb/tls/ca.crt')
context.maximum_version = ssl.TLSVersion.TLSv1_2

class ReusedTLS(ftplib.FTP_TLS):
    def ntransfercmd(self, cmd, rest=None):
        connection, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            connection = self.context.wrap_socket(connection, server_hostname=self.host, session=self.sock.session)
        return connection, size

def ftp(user, password):
    client = ReusedTLS(context=context, timeout=8)
    client.connect('127.0.0.1', 21)
    client.login(user, password)
    client.prot_p()
    return client

def sftp(user, password, commands):
    with tempfile.TemporaryDirectory(prefix='jweb-client-') as work:
        known = work + '/known_hosts'
        with open('/etc/ssh/ssh_host_ed25519_key.pub') as source, open(known, 'w') as target:
            target.write('[127.0.0.1]:2222 ' + source.read())
        batch = work + '/batch'
        with open(batch, 'w') as target: target.write(commands)
        return subprocess.run(['sshpass', '-d0', 'sftp', '-oBatchMode=no', '-oStrictHostKeyChecking=yes', '-oUserKnownHostsFile=' + known, '-P', '2222', '-b', batch, user + '@127.0.0.1'], input=password.encode() + b'\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)

def https(domain, target='/index.html'):
    with socket.create_connection(('127.0.0.1', 443), timeout=8) as raw:
        with context.wrap_socket(raw, server_hostname=domain) as secure:
            secure.sendall(('GET ' + target + ' HTTP/1.1\r\nHost: ' + domain + '\r\nConnection: close\r\n\r\n').encode())
            return secure.makefile('rb').read()

try:
    action = request['action']
    if action == 'ftps-upload':
        client = ftp(request['account'], request['password'])
        client.storbinary('STOR public/' + request['name'], io.BytesIO(request['data'].encode()))
        downloaded = io.BytesIO(); client.retrbinary('RETR public/' + request['name'], downloaded.write); client.quit()
        assert downloaded.getvalue() == request['data'].encode()
    elif action == 'ftps-deny':
        try: client = ftp(request['account'], request['password'])
        except ftplib.error_perm: pass
        else: client.close(); raise AssertionError('Unexpected authenticated FTPS')
    elif action == 'plain-ftp-deny':
        client = ftplib.FTP('127.0.0.1', timeout=8)
        try: client.login(request['account'], request['password'])
        except ftplib.error_perm as error: assert str(error).startswith('530')
        else: raise AssertionError('Plain FTP accepted')
        finally: client.close()
    elif action == 'sftp-upload':
        with tempfile.NamedTemporaryFile(mode='w', prefix='jweb-upload-') as source:
            os.chmod(source.name, 0o644)
            source.write(request['data']); source.flush()
            result = sftp(request['account'], request['password'], 'put ' + source.name + ' public/' + request['name'] + '\n')
            if result.returncode != 0:
                descriptor = os.open('/tmp/jweb-sftp-diagnostic.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(descriptor, 'wb') as diagnostic: diagnostic.write(result.stderr)
            assert result.returncode == 0, 'SFTP upload failed'
    elif action == 'sftp-deny':
        result = sftp(request['account'], request['password'], 'get ' + request['target'] + '\n')
        assert result.returncode != 0, 'SFTP confinement failed'
    elif action == 'ssh-deny':
        with tempfile.TemporaryDirectory(prefix='jweb-client-') as work:
            known = work + '/known_hosts'
            with open('/etc/ssh/ssh_host_ed25519_key.pub') as source, open(known, 'w') as target: target.write('[127.0.0.1]:2222 ' + source.read())
            base = ['sshpass', '-d0', 'ssh', '-oStrictHostKeyChecking=yes', '-oUserKnownHostsFile=' + known, '-p', '2222']
            if request.get('forward'):
                base += ['-oExitOnForwardFailure=yes', '-W', '127.0.0.1:443']
            result = subprocess.run(base + [request['account'] + '@127.0.0.1', 'id'], input=request['password'].encode() + b'\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            assert result.returncode != 0 or b'uid=' not in result.stdout
            if request.get('forward'): assert result.returncode != 0
    elif action == 'https':
        response = https(request['domain'], request.get('target', '/index.html'))
        assert response.startswith(('HTTP/1.1 ' + str(request.get('status', 200))).encode())
        if 'data' in request: assert request['data'].encode() in response
    else: raise AssertionError('Unknown fixture action')
    print(json.dumps({'ok': True}))
except Exception as error:
    print(json.dumps({'ok': False, 'code': 'protocol_assertion_failed', 'action': request.get('action'), 'reason': str(error) if isinstance(error, (AssertionError, ftplib.error_perm)) else type(error).__name__}))
    sys.exit(1)
