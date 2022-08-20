/**
 * list.js
 *
 * Generates a list of pages to update.
 */
'use strict';

const {CookieJar} = require('tough-cookie');
const {readFile} = require('fs/promises');
const {apiQuery} = require('./util.js');

/**
 * Lists pages to update.
 */
class Lister {
    /**
     * Class constructor.
     * @param {object} options Method options
     * @param {string} options.domain Domain of the wiki whose pages we're
     * listing
     * @param {boolean} options.file Whether to use a list file instead of API
     */
    constructor({domain, file}) {
        this._domain = domain;
        this._file = file;
    }
    /**
     * Starts listing of pages.
     * @param {CookieJar} jar Fandom cookie jar
     * @returns {Promise} Promise to listen on for the list
     */
    run(jar) {
        this._pages = [];
        if (this._file) {
            return this._fileList();
        }
        return this._pageList(jar);
    }
    /**
     * Lists pages from a specified point.
     * @param {CookieJar} jar Fandom cookie jar
     * @param {string} eicontinue Value to pass to eicontinue parameter
     * @private
     */
    async _pageList(jar, eicontinue) {
        const data = await apiQuery(this._domain, jar, 'query', 'GET', {
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
            this._pages = [
                ...this._pages,
                ...data.query.embeddedin.map(p => p.title)
            ];
            if (data.continue) {
                return this._pageList(jar, data.continue.eicontinue);
            }
            return this._pages;
        }
    }
    /**
     * Lists pages specified in a file.
     * @private
     */
    async _fileList() {
        return (await readFile('list.txt', {
            encoding: 'utf-8'
        })).trim().split('\n');
    }
}

module.exports = Lister;
