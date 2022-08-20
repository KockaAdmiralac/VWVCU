/**
 * auth.js
 *
 * Provides authentication with external services.
 */
'use strict';

const {createInterface, Interface, Readline} = require('readline/promises');
const {google} = require('googleapis');
const {env, stdin, stdout} = require('process');
const http = require('got');
const {CookieJar} = require('tough-cookie');

const USER_AGENT = 'Vocaloid Wiki View Count Updater';
const PROVIDERS = [
    'google',
    'vimeo',
    'wikia'
];
const {GoogleAuth} = google.auth;

/**
 * Handles authentication with video providers.
 */
class Auth {
    /**
     * Begins authentication with services.
     * @returns {Promise} Promise to listen on for response
     */
    async run() {
        const tokens = {};
        for (const provider of PROVIDERS) {
            const credentials = require(`../auth/${provider}.json`);
            tokens[provider] = await this[`_${provider}`](credentials);
        }
        return tokens;
    }
    /**
     * Handles Google authentication.
     * @param {object} credentials Saved Google credentials
     * @returns {GoogleAuth} Google authentication client
     * @private
     */
    _google(credentials) {
        env.GOOGLE_CLOUD_PROJECT = credentials.project_id;
        return new GoogleAuth({
            keyFile: 'auth/google.json',
            scopes: ['https://www.googleapis.com/auth/youtube.readonly']
        });
    }
    /**
     * Handles Vimeo authentication.
     * @param {object} credentials Saved Google credentials
     * @returns {string} Configured Vimeo token
     * @private
     * @todo Make this fetch a token instead of just reading it
     */
    _vimeo(credentials) {
        return credentials;
    }
    /**
     * Handles Fandom authentication.
     * @param {object} options Fandom credentials
     * @param {string} options.username Fandom username
     * @param {string?} options.password Fandom password
     * @returns {Promise<CookieJar>} Cookie jar with Fandom credentials
     * @private
     */
    async _wikia({username, password}) {
        const jar = new CookieJar();
        let finalPassword = password;
        if (!finalPassword) {
            const rl = createInterface({
                input: stdin,
                output: stdout
            });
            const readline = new Readline(rl.output);
            rl.input.on('keypress', this.#rlKeypress.bind(this, rl, readline));
            finalPassword = await rl.question('Enter your Fandom password: ');
            rl.close();
        }
        try {
            // eslint-disable-next-line max-len
            await http.post('https://services.fandom.com/mobile-fandom-app/fandom-auth/login', {
                cookieJar: jar,
                form: {
                    password: finalPassword,
                    username
                },
                headers: {
                    'User-Agent': USER_AGENT,
                    'X-Fandom-Auth': 1,
                    'X-Wikia-WikiaAppsID': 1234
                }
            });
            return jar;
        } catch (error) {
            if (error.statusCode === 400) {
                throw new Error('Invalid Fandom credentials!');
            }
            throw error;
        }
    }
    /**
     * Handler for the readline event when a key is pressed.
     * @param {Interface} rl Readline interface where the key was pressed
     * @param {Readline} readline Readline object for manipulating the stream
     */
    async #rlKeypress(rl, readline) {
        const len = rl.line.length;
        readline.moveCursor(-len, 0);
        readline.clearLine(1);
        await readline.commit();
        rl.output.write('*'.repeat(len));
    }
}

module.exports = Auth;
