/**
 * list.js
 *
 * Generates a list of pages to update.
 */
'use strict';

/**
 * Importing modules.
 */
const fs = require('fs').promises,
      util = require('./util.js');

/**
 * Lists pages to update.
 */
class Lister {
    /**
     * Class constructor.
     * @param {string} domain Domain of the wiki whose pages we're listing
     * @param {boolean} list Whether to use a list file instead of API
     */
    constructor({domain, file}) {
        this._domain = domain;
        this._file = file;
    }
    /**
     * Starts listing of pages.
     * @param {http.CookieJar} jar Cookie jar for Fandom authentication
     * @returns {Promise} Promise to listen on for the list
     */
    run() {
        this._pages = [];
        if (this._file) {
            return this._fileList();
        }
        return this._pageList();
    }
    /**
     * Lists pages from a specified point.
     * @param {String} eicontinue Value to pass to eicontinue parameter
     * @private
     */
    async _pageList(eicontinue) {
        const data = await util.apiQuery(this._domain, 'query', 'GET', {
            eicontinue,
            eifilterredir: 'nonredirects',
            eilimit: 'max',
            einamespace: 0,
            eititle: 'Template:Song box 2',
            list: 'embeddedin'
        });
        if (data.error) {
            throw new Error(`MediaWiki API error: ${JSON.stringify(data.error)}`);
        } else {
            this._pages = this._pages
                .concat(data.query.embeddedin.map(p => p.title));
            if (data['query-continue']) {
                return this._pageList(
                    data['query-continue'].embeddedin.eicontinue
                );
            }
            return this._pages;
        }
    }
    /**
     * Lists pages specified in a file.
     * @private
     */
    async _fileList() {
        return (await fs.readFile('list.txt', {
            encoding: 'utf-8'
        })).trim().split('\n');
    }
}

module.exports = Lister;
