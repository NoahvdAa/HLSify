import child from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as net from 'node:net';

export class PipeStream {
    _streamConfig;
    _process;
    _workingDir;
    _lastReadAt = Date.now();
    _hasSeenData = false;
    _server;

    constructor(streamConfig) {
        this._streamConfig = streamConfig;
    }

    hasTimedOut() {
        return (Date.now() - this._lastReadAt) > this._streamConfig.timeout;
    }

    start(workingDir) {
        if (this._process) {
            throw new Error('Stream is already running');
        }

        let viewers = [];
        let that = this;
        this._server = net.createServer(function(stream) {
            let me = {stream, broadcast: true};
            viewers.push(me);

            stream.on('data', function(c) {
                that._hasSeenData = true;
                me.broadcast = false;
                for (let v of viewers) {
                    if (v !== me && v.broadcast) {
                        v.stream.write(c);
                        that._lastReadAt = Date.now();
                    }
                }
            });
            stream.on('end', function() {
                viewers = viewers.filter((v) => v !== me);
            });
        });
        this._server.listen(path.join(workingDir, this._streamConfig.pipe));

        this._workingDir = workingDir;
        this._process = child.spawn('bash', ['-c', this._streamConfig.command.replaceAll('%TMP%', this._workingDir)], {
            cwd: this._workingDir,
            stdio: 'ignore'
        });
    }

    isReady() {
        this._lastReadAt = Date.now();
        return this._hasSeenData;
    }

    cleanup() {
        if (this._process) {
            this._process.kill();
        }
        if (this._workingDir && fs.existsSync(this._workingDir)) {
            fs.rmSync(this._workingDir, { recursive: true, force: true });
        }
        if (this._server) {
            this._server.close();
        }
    }
}
