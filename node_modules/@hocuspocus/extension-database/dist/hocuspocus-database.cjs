'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var Y = require('yjs');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return Object.freeze(n);
}

var Y__namespace = /*#__PURE__*/_interopNamespace(Y);

class Database {
    /**
     * Constructor
     */
    constructor(configuration) {
        /**
         * Default configuration
         */
        this.configuration = {
            fetch: async () => null,
            store: async () => null,
        };
        this.configuration = {
            ...this.configuration,
            ...configuration,
        };
    }
    /**
     * Get stored data from the database.
     */
    async onLoadDocument(data) {
        const update = await this.configuration.fetch(data);
        if (update) {
            Y__namespace.applyUpdate(data.document, update);
        }
        return data.document;
    }
    /**
     * Store new updates in the database.
     */
    async onStoreDocument(data) {
        return this.configuration.store({
            ...data,
            state: Buffer.from(Y__namespace.encodeStateAsUpdate(data.document)),
        });
    }
}

exports.Database = Database;
//# sourceMappingURL=hocuspocus-database.cjs.map
