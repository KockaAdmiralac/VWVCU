/**
 * list.js
 *
 * Generates a list of pages to update
 */
'use strict';

/**
 * Importing modules
 */
const util = require('./util.js');

/**
 * Lists pages to update
 */
class Lister {
    /**
     * Starts listing of pages
     * @param {http.CookieJar} jar Cookie jar for FANDOM authentication
     * @returns {Promise} Promise to listen on for the list
     */
    run() {
        this._pages = [];
        return new Promise(function(resolve, reject) {
            this._resolve = resolve;
            this._reject = reject;
            this._list();
        }.bind(this));
    }
    /**
     * Lists pages from a specified point
     * @param {String} eicontinue Value to pass to eicontinue parameter
     * @private
     */
    _list(eicontinue) {
        util.apiQuery('query', 'GET', {
            eicontinue,
            eifilterredir: 'nonredirects',
            eilimit: 'max',
            einamespace: 0,
            eititle: 'Template:Song box 2',
            list: 'embeddedin'
        }).then(this._callback.bind(this))
        .catch(this._reject);
    }
    /**
     * Callback after listing pages
     * @param {Object} data MediaWiki API response
     * @private
     */
    _callback(data) {
        if (data.error) {
            this._reject(data.error);
        } else {
            this._pages = this._pages
                .concat(data.query.embeddedin.map(p => p.title));
            if (data['query-continue']) {
                this._list(data['query-continue'].embeddedin.eicontinue);
            } else {
                this._resolve(this._pages);
            }
        }
    }
}

module.exports = Lister;
