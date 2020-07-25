/**
 * util.js
 *
 * Utility methods used within VWVCU.
 */
'use strict';

/**
 * Importing modules.
 */
const http = require('request-promise-native');

/**
 * Constants
 */
const USER_AGENT = 'Vocaloid Wiki View Count Updater';

/**
 * Utility class.
 */
class Util {
    /**
     * Sets the cookie jar for Fandom API queries.
     * @param {http.CookieJar} jar Fandom cookie jar
     * @static
     */
    static setJar(jar) {
        this._jar = jar;
    }
    /**
     * Queries the MediaWiki API.
     * @param {string} domain Fandom wiki domain to query
     * @param {String} action API action to execute
     * @param {String} method HTTP method to use
     * @param {Object} params API request parameters
     * @returns {Promise} Promise to listen on for response
     * @static
     */
    static apiQuery(domain, action, method, params) {
        return http({
            headers: {
                'User-Agent': USER_AGENT
            },
            jar: this._jar,
            json: true,
            method,
            uri: `https://${domain}/api.php`,
            [method === 'POST' ? 'form' : 'qs']: Object.assign({
                action,
                cb: Date.now(),
                format: 'json'
            }, params)
        });
    }
    /**
     * Adds commas into a number, separating the groups of three digits.
     * @param {Number} num Number to commafy
     * @returns {String} Number with commas
     * @static
     */
    static commafy(num) {
        if (isNaN(num)) {
            // HACK: Fix 'undefined' view count errors.
            return 'und,efi,ned';
        }
        const str = String(num),
              l = str.length;
        let ret = '';
        for (let i = 0; i < l; ++i) {
            if (i !== 0 && i % 3 === 0) {
                ret = `,${ret}`;
            }
            ret = str[str.length - i - 1] + ret;
        }
        return ret;
    }
}

module.exports = Util;
