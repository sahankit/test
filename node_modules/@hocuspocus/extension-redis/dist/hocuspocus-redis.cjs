'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var RedisClient = require('ioredis');
var Redlock = require('redlock');
var uuid = require('uuid');
var server = require('@hocuspocus/server');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var RedisClient__default = /*#__PURE__*/_interopDefaultLegacy(RedisClient);
var Redlock__default = /*#__PURE__*/_interopDefaultLegacy(Redlock);

class Redis {
    constructor(configuration) {
        /**
         * Make sure to give that extension a higher priority, so
         * the `onStoreDocument` hook is able to intercept the chain,
         * before documents are stored to the database.
         */
        this.priority = 1000;
        this.configuration = {
            port: 6379,
            host: '127.0.0.1',
            prefix: 'hocuspocus',
            identifier: `host-${uuid.v4()}`,
            lockTimeout: 1000,
            disconnectDelay: 1000,
        };
        this.locks = new Map();
        /**
         * Handle incoming messages published on all subscribed document channels.
         * Note that this will also include messages from ourselves as it is not possible
         * in Redis to filter these.
        */
        this.handleIncomingMessage = async (channel, pattern, data) => {
            const message = new server.IncomingMessage(data);
            // we don't need the documentName from the message, we are just taking it from the redis channelName.
            // we have to immediately write it back to the encoder though, to make sure the structure of the message is correct
            message.writeVarString(message.readVarString());
            const channelName = pattern.toString();
            const [_, documentName, identifier] = channelName.split(':');
            const document = this.instance.documents.get(documentName);
            if (identifier === this.configuration.identifier) {
                return;
            }
            if (!document) {
                return;
            }
            new server.MessageReceiver(message, this.logger).apply(document, undefined, reply => {
                return this.pub.publishBuffer(this.pubKey(document.name), Buffer.from(reply));
            });
        };
        /**
         * Make sure to *not* listen for further changes, when there’s
         * noone connected anymore.
         */
        this.onDisconnect = async ({ documentName }) => {
            const disconnect = () => {
                const document = this.instance.documents.get(documentName);
                // Do nothing, when other users are still connected to the document.
                if (document && document.getConnectionsCount() > 0) {
                    return;
                }
                // Time to end the subscription on the document channel.
                this.sub.punsubscribe(this.subKey(documentName), (error) => {
                    if (error) {
                        console.error(error);
                    }
                });
            };
            // Delay the disconnect procedure to allow last minute syncs to happen
            setTimeout(disconnect, this.configuration.disconnectDelay);
        };
        this.configuration = {
            ...this.configuration,
            ...configuration,
        };
        // We’ll replace that in the onConfigure hook with the global instance.
        this.logger = new server.Debugger();
        // Create Redis instance
        const { port, host, options, nodes, redis, createClient, } = this.configuration;
        if (typeof createClient === 'function') {
            this.pub = createClient();
            this.sub = createClient();
        }
        else if (redis) {
            this.pub = redis.duplicate();
            this.sub = redis.duplicate();
        }
        else if (nodes && nodes.length > 0) {
            this.pub = new RedisClient__default["default"].Cluster(nodes, options);
            this.sub = new RedisClient__default["default"].Cluster(nodes, options);
        }
        else {
            this.pub = new RedisClient__default["default"](port, host, options);
            this.sub = new RedisClient__default["default"](port, host, options);
        }
        this.sub.on('pmessageBuffer', this.handleIncomingMessage);
        this.redlock = new Redlock__default["default"]([this.pub]);
    }
    async onConfigure({ instance }) {
        this.logger = instance.debugger;
        this.instance = instance;
    }
    getKey(documentName) {
        return `${this.configuration.prefix}:${documentName}`;
    }
    pubKey(documentName) {
        return `${this.getKey(documentName)}:${this.configuration.identifier.replace(/:/g, '')}`;
    }
    subKey(documentName) {
        return `${this.getKey(documentName)}:*`;
    }
    lockKey(documentName) {
        return `${this.getKey(documentName)}:lock`;
    }
    /**
     * Once a document is laoded, subscribe to the channel in Redis.
     */
    async afterLoadDocument({ documentName, document }) {
        return new Promise((resolve, reject) => {
            // On document creation the node will connect to pub and sub channels
            // for the document.
            this.sub.psubscribe(this.subKey(documentName), async (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                this.publishFirstSyncStep(documentName, document);
                this.requestAwarenessFromOtherInstances(documentName);
                resolve(undefined);
            });
        });
    }
    /**
     * Publish the first sync step through Redis.
     */
    async publishFirstSyncStep(documentName, document) {
        const syncMessage = new server.OutgoingMessage(documentName)
            .createSyncMessage()
            .writeFirstSyncStepFor(document);
        return this.pub.publishBuffer(this.pubKey(documentName), Buffer.from(syncMessage.toUint8Array()));
    }
    /**
     * Let’s ask Redis who is connected already.
     */
    async requestAwarenessFromOtherInstances(documentName) {
        const awarenessMessage = new server.OutgoingMessage(documentName)
            .writeQueryAwareness();
        return this.pub.publishBuffer(this.pubKey(documentName), Buffer.from(awarenessMessage.toUint8Array()));
    }
    /**
     * Before the document is stored, make sure to set a lock in Redis.
     * That’s meant to avoid conflicts with other instances trying to store the document.
     */
    async onStoreDocument({ documentName }) {
        // Attempt to acquire a lock and read lastReceivedTimestamp from Redis,
        // to avoid conflict with other instances storing the same document.
        return new Promise((resolve, reject) => {
            this.redlock.lock(this.lockKey(documentName), this.configuration.lockTimeout, async (error, lock) => {
                if (error || !lock) {
                    // Expected behavior: Could not acquire lock, another instance locked it already.
                    // No further `onStoreDocument` hooks will be executed.
                    reject();
                    return;
                }
                this.locks.set(this.lockKey(documentName), lock);
                resolve(undefined);
            });
        });
    }
    /**
     * Release the Redis lock, so other instances can store documents.
     */
    async afterStoreDocument({ documentName }) {
        var _a;
        (_a = this.locks.get(this.lockKey(documentName))) === null || _a === void 0 ? void 0 : _a.unlock().catch(() => {
            // Not able to unlock Redis. The lock will expire after ${lockTimeout} ms.
            // console.error(`Not able to unlock Redis. The lock will expire after ${this.configuration.lockTimeout}ms.`)
        }).finally(() => {
            this.locks.delete(this.lockKey(documentName));
        });
    }
    /**
     * Handle awareness update messages received directly by this Hocuspocus instance.
     */
    async onAwarenessUpdate({ documentName, awareness, added, updated, removed, }) {
        const changedClients = added.concat(updated, removed);
        const message = new server.OutgoingMessage(documentName)
            .createAwarenessUpdateMessage(awareness, changedClients);
        return this.pub.publishBuffer(this.pubKey(documentName), Buffer.from(message.toUint8Array()));
    }
    /**
     * if the ydoc changed, we'll need to inform other Hocuspocus servers about it.
     */
    async onChange(data) {
        return this.publishFirstSyncStep(data.documentName, data.document);
    }
    async beforeBroadcastStateless(data) {
        const message = new server.OutgoingMessage(data.documentName)
            .writeBroadcastStateless(data.payload);
        return this.pub.publishBuffer(this.pubKey(data.documentName), Buffer.from(message.toUint8Array()));
    }
    /**
     * Kill the Redlock connection immediately.
     */
    async onDestroy() {
        await this.redlock.quit();
        this.pub.disconnect(false);
        this.sub.disconnect(false);
    }
}

exports.Redis = Redis;
//# sourceMappingURL=hocuspocus-redis.cjs.map
