import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {SegmentStream} from './segmentStream.js';
import {PipeStream} from './pipeStream.js';
import * as net from 'node:net';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const tmpFsPath = path.resolve(process.cwd(), config.tmpfs);

const app = express();
const activeStreams = {};

if (!fs.existsSync(tmpFsPath)) {
    fs.mkdirSync(tmpFsPath);
}

app.get('/:stream{/:file}', async (req, res, next) => {
    let streamConfig = config.streams[req.params.stream];
    if (!streamConfig) {
        return res.status(404).send('Stream not found');
    }

    let piped = streamConfig.type === 'piped';

    let activeStream = activeStreams[req.params.stream];
    if (!activeStream) {
        if (req.params.file !== streamConfig.playlist && !piped) {
            return res.status(404).send('Stream not started (request playlist to start)');
        }

        activeStream = piped ? new PipeStream(streamConfig) : new SegmentStream(streamConfig);
        activeStreams[req.params.stream] = activeStream;
        const workingDir = path.join(tmpFsPath, String(Math.floor(Date.now() * Math.random())));
        fs.mkdirSync(workingDir);
        activeStream.start(workingDir);
    }

    const abortController = new AbortController();
    const { signal } = abortController;
    req.on('close', () => abortController.abort());

    while (!activeStream.isReady()) {
        if (signal.aborted) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!piped) {
        const filePath = path.join(activeStream._workingDir, req.params.file ?? '');
        if (!req.params.file || !fs.existsSync(filePath)) {
            return res.status(404).send('File not found');
        }

        res.sendFile(filePath);
    } else {
        // Read from the unix socket
        const socketPath = path.join(activeStream._workingDir, streamConfig.pipe);
        const connection = net.createConnection(socketPath);
        res.on('close', () => {
            connection.end();
        });
        connection.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).send('Error connecting to stream');
            }
        });
        if (streamConfig.mime) {
            res.header('Content-Type', streamConfig.mime);
        }
        connection.pipe(res);
    }
});

setInterval(() => {
    for (const [streamName, streamInstance] of Object.entries(activeStreams)) {
        if (streamInstance.hasTimedOut()) {
            streamInstance.cleanup();
            delete activeStreams[streamName];
        }
    }
}, 1000);

process.on('SIGINT', () => {
    for (const streamInstance of Object.values(activeStreams)) {
        streamInstance.cleanup();
    }
    process.exit(0);
});

app.listen(config.httpPort, config.httpAddress, () => {
    console.log(`Server running at http://${config.httpAddress.includes(':') ? `[${config.httpAddress}]` : config.httpAddress}:${config.httpPort}/`);
});
