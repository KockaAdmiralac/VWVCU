/**
 * util.js
 *
 * Utility methods used within VWVCU.
 */
'use strict';

const http = require('got');

const USER_AGENT = 'Vocaloid Wiki View Count Updater';

/**
 * Queries the MediaWiki API.
 * @param {string} domain Fandom wiki domain to query
 * @param {http.CookieJar} jar Fandom cookie jar for authentication
 * @param {string} action API action to execute
 * @param {string} method HTTP method to use
 * @param {object} params API request parameters
 * @returns {Promise} Promise to listen on for response
 * @static
 */
function apiQuery(domain, jar, action, method, params) {
    return http({
        cookieJar: jar,
        headers: {
            'User-Agent': USER_AGENT
        },
        method,
        url: `https://${domain}/api.php`,
        [method === 'POST' ? 'form' : 'searchParams']: {
            action,
            cb: Date.now(),
            format: 'json',
            formatversion: 2,
            ...params
        }
    }).json();
}

/**
 * Adds commas into a number, separating the groups of three digits.
 * @param {number} num Number to commafy
 * @returns {string} Number with commas
 * @static
 */
function commafy(num) {
    if (isNaN(num)) {
        // HACK: Fix 'undefined' view count errors.
        return 'und,efi,ned';
    }
    const str = String(num);
    const l = str.length;
    let ret = '';
    for (let i = 0; i < l; ++i) {
        if (i !== 0 && i % 3 === 0) {
            ret = `,${ret}`;
        }
        ret = str[str.length - i - 1] + ret;
    }
    return ret;
}

/**
 * Replicates {{v}} template's number rounding.
 * @param {number} num Number of views
 * @returns {string} Rounded number of views
 */
function roundV(num) {
    const len = String(num).length;
    switch (len) {
        case 1:
            return String(num);
        case 2:
            return String(Math.round(num / 10) * 10);
        case 3:
            return `${String(num).slice(0, -1)}0`;
        case 4:
        case 5:
        case 6:
            return `${String(num).slice(0, -2)}00`;
        case 7:
        case 8:
            return `${String(num).slice(0, -3)}000`;
        default:
            return 'unsupported';
    }
}

module.exports = {
    apiQuery,
    commafy,
    roundV
};
