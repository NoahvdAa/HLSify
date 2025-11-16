import child from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class Stream {
    _streamConfig;
    _process;
    _workingDir;
    _lastRequestedAt = Date.now();

    constructor(streamConfig) {
        this._streamConfig = streamConfig;
    }

    hasTimedOut() {
        return (Date.now() - this._lastRequestedAt) > this._streamConfig.timeout;
    }

    start(workingDir) {
        if (this._process) {
            throw new Error('Stream is already running');
        }

        this._workingDir = workingDir;
        this._process = child.spawn('bash', ['-c', this._streamConfig.command], {
            cwd: this._workingDir,
            stdio: 'ignore',
        });
    }

    isReady() {
        this._lastRequestedAt = Date.now();
        return fs.existsSync(path.join(this._workingDir, this._streamConfig.playlist));
    }

    cleanup() {
        console.log('C')
        if (this._process) {
            this._process.kill();
        }
        if (this._workingDir && fs.existsSync(this._workingDir)) {
            fs.rmSync(this._workingDir, { recursive: true, force: true });
        }
    }
}
